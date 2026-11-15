use std::collections::HashMap;
use std::io::{Read as _, Seek as _, SeekFrom, Write as _};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use socketioxide::SocketIo;
use tokio::sync::{Mutex, Notify, mpsc, oneshot};
use tokio_tungstenite::connect_async_with_config;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

use crate::acp_registry::AcpRegistryAgentEntry;
use crate::app_state::AppState;
use crate::handlers::acp_handler::{AcpAgentsConfigFile, agents_config_path};
use crate::node_protocol::{
    CloudServerView, NodeAgentSummary, NodeFrame, NodeServerInfo, SavedServerConfig,
    ServerConnectionStatus,
};
use crate::node_server::{
    NodeSubscriptionSink, collect_agent_summaries, current_server_info, dispatch_node_method,
    extract_and_normalize_profile_dirs,
};

struct RemoteRuntime {
    config: SavedServerConfig,
    status: ServerConnectionStatus,
    error: Option<String>,
    ping_ms: Option<u64>,
    info: Option<NodeServerInfo>,
    projects: Vec<crate::workspace::ProjectInfo>,
    agents: Vec<NodeAgentSummary>,
    req_tx: Option<mpsc::UnboundedSender<NodeFrame>>,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value>>>>>,
    cancel: CancellationToken,
    reconnect_notify: Arc<Notify>,
}

pub struct ServerHub {
    config_path: PathBuf,
    remotes: Mutex<HashMap<String, RemoteRuntime>>,
    io: OnceLock<Arc<SocketIo>>,
    local_sink: OnceLock<NodeSubscriptionSink>,
    next_req_id: AtomicU64,
}

impl ServerHub {
    pub fn new(data_dir: &std::path::Path) -> Self {
        Self {
            config_path: data_dir.join("servers.json"),
            remotes: Mutex::new(HashMap::new()),
            io: OnceLock::new(),
            local_sink: OnceLock::new(),
            next_req_id: AtomicU64::new(1),
        }
    }

    pub async fn start(self: &Arc<Self>, state: AppState, io: Arc<SocketIo>) {
        let _ = self.io.set(io.clone());

        let (local_tx, mut local_rx) = mpsc::unbounded_channel::<NodeFrame>();
        let sink = NodeSubscriptionSink::new(local_tx);
        let _ = self.local_sink.set(sink);

        let hub_c = self.clone();
        tokio::spawn(async move {
            while let Some(frame) = local_rx.recv().await {
                if let NodeFrame::Event { event, data } = frame {
                    hub_c.emit_node_event("local", &event, data).await;
                }
            }
        });

        let saved = self.load_saved_configs();
        for cfg in saved {
            self.spawn_remote_worker(state.clone(), cfg).await;
        }
    }

    fn load_saved_configs(&self) -> Vec<SavedServerConfig> {
        let Ok(content) = std::fs::read_to_string(&self.config_path) else {
            return Vec::new();
        };
        serde_json::from_str::<Vec<SavedServerConfig>>(&content).unwrap_or_default()
    }

    async fn save_configs(&self) -> Result<()> {
        let configs: Vec<SavedServerConfig> = {
            let guard = self.remotes.lock().await;
            let mut list: Vec<_> = guard.values().map(|r| r.config.clone()).collect();
            list.sort_by(|a, b| a.name.cmp(&b.name).then(a.id.cmp(&b.id)));
            list
        };
        if let Some(parent) = self.config_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let json_str = serde_json::to_string_pretty(&configs)?;
        std::fs::write(&self.config_path, json_str)?;
        Ok(())
    }

    pub async fn list_servers(&self, state: &AppState) -> Vec<CloudServerView> {
        let local_projects = state.workspace.lock().await.projects();
        let local_agents = collect_agent_summaries(state).await;
        let local_view = CloudServerView {
            id: "local".to_string(),
            name: state.server_name.clone(),
            url: "local".to_string(),
            open_url: None,
            is_local: true,
            status: ServerConnectionStatus::Online,
            error: None,
            ping_ms: Some(0),
            info: Some(current_server_info(state)),
            projects: local_projects,
            agents: local_agents,
        };

        let mut list = vec![local_view];
        let guard = self.remotes.lock().await;
        let mut remote_views: Vec<CloudServerView> = guard
            .values()
            .map(|r| CloudServerView {
                id: r.config.id.clone(),
                name: r.config.name.clone(),
                url: r.config.url.clone(),
                open_url: build_open_url(&r.config.url, r.config.token.as_deref()),
                is_local: false,
                status: r.status.clone(),
                error: r.error.clone(),
                ping_ms: r.ping_ms,
                info: r.info.clone(),
                projects: r.projects.clone(),
                agents: r.agents.clone(),
            })
            .collect();
        remote_views.sort_by(|a, b| a.name.cmp(&b.name).then(a.id.cmp(&b.id)));
        list.extend(remote_views);
        list
    }

    pub async fn broadcast_servers(&self, state: &AppState) {
        let Some(io) = self.io.get() else {
            return;
        };
        let servers = self.list_servers(state).await;
        let _ = io.emit("remote:servers:updated", &json!({ "servers": servers })).await;
        let _ = io.emit("cloud:servers:updated", &json!({ "servers": servers })).await;
    }

    async fn emit_node_event(&self, server_id: &str, event: &str, data: Value) {
        let Some(io) = self.io.get() else {
            return;
        };
        match event {
            "acp:message" => {
                let mut payload = data;
                if let Some(obj) = payload.as_object_mut() {
                    obj.insert("server_id".to_string(), Value::String(server_id.to_string()));
                }
                let _ = io.emit("remote:acp:message", &payload).await;
                let _ = io.emit("cloud:acp:message", &payload).await;
            }
            "acp:history" => {
                let mut payload = data;
                if let Some(obj) = payload.as_object_mut() {
                    obj.insert("server_id".to_string(), Value::String(server_id.to_string()));
                }
                let _ = io.emit("remote:acp:history", &payload).await;
                let _ = io.emit("cloud:acp:history", &payload).await;
            }
            "acp:queue" => {
                let mut payload = data;
                if let Some(obj) = payload.as_object_mut() {
                    obj.insert("server_id".to_string(), Value::String(server_id.to_string()));
                }
                let _ = io.emit("remote:acp:queue", &payload).await;
                let _ = io.emit("cloud:acp:queue", &payload).await;
            }
            "acp:diff_stats" => {
                let agent_id = data.get("agent_id").and_then(|v| v.as_str());
                let diff_added = data.get("diff_added").and_then(|v| v.as_u64()).map(|n| n as usize);
                let diff_removed = data.get("diff_removed").and_then(|v| v.as_u64()).map(|n| n as usize);
                let diff_files = data.get("diff_files").and_then(|v| v.as_u64()).map(|n| n as usize);
                if server_id != "local" {
                    if let Some(aid) = agent_id {
                        let mut guard = self.remotes.lock().await;
                        if let Some(r) = guard.get_mut(server_id) {
                            if let Some(agent) = r.agents.iter_mut().find(|a| a.id == aid) {
                                agent.diff_added = diff_added;
                                agent.diff_removed = diff_removed;
                                agent.diff_files = diff_files;
                            }
                        }
                    }
                }
                let mut payload = data;
                if let Some(obj) = payload.as_object_mut() {
                    obj.insert("server_id".to_string(), Value::String(server_id.to_string()));
                }
                let _ = io.emit("remote:acp:diff_stats", &payload).await;
                let _ = io.emit("cloud:acp:diff_stats", &payload).await;
            }
            _ => {}
        }
    }

    pub async fn add_server(
        self: &Arc<Self>,
        state: AppState,
        name: String,
        url: String,
        token: Option<String>,
    ) -> Result<CloudServerView> {
        let normalized_url = url.trim().trim_end_matches('/').to_string();
        if normalized_url.is_empty() {
            anyhow::bail!("Server URL cannot be empty");
        }
        // Validate WS URL construction early
        let _ = build_ws_url(&normalized_url)?;

        let id = format!(
            "srv-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0)
        );
        let clean_name = if name.trim().is_empty() {
            normalized_url.clone()
        } else {
            name.trim().to_string()
        };
        let clean_token = token
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty());

        let cfg = SavedServerConfig {
            id: id.clone(),
            name: clean_name,
            url: normalized_url,
            token: clean_token,
        };
        self.spawn_remote_worker(state.clone(), cfg).await;
        self.save_configs().await?;
        self.broadcast_servers(&state).await;

        let list = self.list_servers(&state).await;
        list.into_iter()
            .find(|s| s.id == id)
            .ok_or_else(|| anyhow!("Failed to register server"))
    }

    pub async fn remove_server(&self, state: &AppState, server_id: &str) -> Result<()> {
        if server_id == "local" {
            anyhow::bail!("Cannot remove local server");
        }
        let removed = self.remotes.lock().await.remove(server_id);
        let Some(runtime) = removed else {
            anyhow::bail!("Server not found: {}", server_id);
        };
        runtime.cancel.cancel();
        self.save_configs().await?;
        self.broadcast_servers(state).await;
        Ok(())
    }

    pub async fn reconnect_server(&self, server_id: &str) -> Result<()> {
        if server_id == "local" {
            return Ok(());
        }
        let guard = self.remotes.lock().await;
        let runtime = guard
            .get(server_id)
            .ok_or_else(|| anyhow!("Server not found: {}", server_id))?;
        runtime.reconnect_notify.notify_one();
        Ok(())
    }

    pub async fn rpc(
        self: &Arc<Self>,
        state: &AppState,
        server_id: &str,
        method: &str,
        params: Value,
    ) -> Result<Value> {
        if method == "remote:sync_project" || method == "cloud:sync_project" {
            return self.sync_project_to_server(state, server_id, params).await;
        }
        if method == "remote:pull_project" || method == "cloud:pull_project" {
            return self.pull_project_from_server(state, server_id, params).await;
        }
        if method == "remote:sync_agent" || method == "cloud:sync_agent" {
            return self.sync_agent_to_server(state, server_id, params).await;
        }

        let requested_project_id = params
            .get("project_id")
            .and_then(|v| v.as_str())
            .map(str::to_string);

        let result = if server_id == "local" {
            let sink = self.local_sink.get();
            dispatch_node_method(state, method, params, sink).await
        } else {
            self.remote_rpc(server_id, method, params).await
        };

        if let Ok(ref val) = result {
            if matches!(
                method,
                "acp:start"
                    | "acp:stop"
                    | "acp:reconnect"
                    | "acp:authenticate"
                    | "workspace:add-project"
                    | "workspace:remove-project"
                    | "workspace:clone"
                    | "workspace:sync"
                    | "workspace:worktree:create"
                    | "workspace:worktree:remove"
            ) {
                if server_id == "local" {
                    if let Some(io) = self.io.get() {
                        match method {
                            "workspace:worktree:create" => {
                                let already_present = val
                                    .get("already_present")
                                    .and_then(|v| v.as_bool())
                                    .unwrap_or(true);
                                if !already_present {
                                    if let Some(project) = val.get("project") {
                                        let _ = io.emit("workspace:project-added", project).await;
                                    }
                                }
                            }
                            "workspace:add-project" | "workspace:clone" | "workspace:sync" => {
                                if let (Some(active_id), Some(projects)) = (
                                    val.get("active_project_id").and_then(|v| v.as_str()),
                                    val.get("projects").and_then(|v| v.as_array()),
                                ) {
                                    if let Some(project) = projects.iter().find(|p| {
                                        p.get("id").and_then(|v| v.as_str()) == Some(active_id)
                                    }) {
                                        let _ = io.emit("workspace:project-added", project).await;
                                    }
                                }
                            }
                            "workspace:remove-project" => {
                                if let Some(pid) = requested_project_id.as_deref() {
                                    let _ = io
                                        .emit(
                                            "workspace:project-removed",
                                            &json!({ "project_id": pid }),
                                        )
                                        .await;
                                }
                            }
                            "workspace:worktree:remove" => {
                                if let Some(pid) =
                                    val.get("removed_project_id").and_then(|v| v.as_str())
                                {
                                    let _ = io
                                        .emit(
                                            "workspace:project-removed",
                                            &json!({ "project_id": pid }),
                                        )
                                        .await;
                                }
                            }
                            _ => {}
                        }
                    }
                } else {
                    let _ = self.refresh_remote_snapshot(server_id).await;
                }
                self.broadcast_servers(state).await;
            }
        }

        result
    }

    async fn sync_project_to_server(
        self: &Arc<Self>,
        state: &AppState,
        server_id: &str,
        params: Value,
    ) -> Result<Value> {
        #[derive(serde::Deserialize)]
        struct HubSyncProjectRequest {
            path: String,
            #[serde(default)]
            name: Option<String>,
            #[serde(default)]
            target_dir: Option<String>,
            #[serde(default)]
            force_sync: bool,
        }

        let req: HubSyncProjectRequest = serde_json::from_value(params)?;
        let source_canon = std::fs::canonicalize(req.path.trim())
            .with_context(|| format!("Local project path does not exist: {}", req.path))?;
        let local_projects = state.workspace.lock().await.projects();
        let matched = local_projects.into_iter().find(|p| {
            std::fs::canonicalize(&p.root)
                .map(|r| r == source_canon)
                .unwrap_or(false)
        });
        let Some(local_project) = matched else {
            anyhow::bail!("Project must be added to the local Projects panel first");
        };

        if server_id == "local" {
            let sink = self.local_sink.get();
            let res = dispatch_node_method(
                state,
                "workspace:add-project",
                json!({ "path": source_canon.to_string_lossy() }),
                sink,
            )
            .await?;
            self.broadcast_servers(state).await;
            return Ok(res);
        }

        if !req.force_sync {
            if let Ok(res) = self
                .remote_rpc(
                    server_id,
                    "workspace:add-project",
                    json!({ "path": source_canon.to_string_lossy() }),
                )
                .await
            {
                let _ = self.refresh_remote_snapshot(server_id).await;
                self.broadcast_servers(state).await;
                return Ok(res);
            }
        }

        let project_name = req
            .name
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(local_project.name);
        let pack_root = source_canon.clone();
        let source_name_clone = project_name.clone();
        enum PreparedSync {
            Git(crate::git::PackedGitSync),
            Archive(String),
        }
        let prepared = tokio::task::spawn_blocking(move || -> Result<PreparedSync> {
            if let Some(packed) =
                crate::git::pack_git_sync_to_file(&pack_root, &source_name_clone)?
            {
                return Ok(PreparedSync::Git(packed));
            }
            let archive_b64 = pack_project_archive(&pack_root)?;
            Ok(PreparedSync::Archive(archive_b64))
        })
        .await??;

        let (git_payload, archive_b64, uploaded_tid) = match prepared {
            PreparedSync::Git(mut packed) => {
                let mut uploaded_tid = None;
                if let Some(bundle_file) = packed.bundle_file.take() {
                    let tid = self
                        .upload_temp_file_chunks(server_id, bundle_file.path())
                        .await?;
                    packed.payload.bundle_transfer_id = Some(tid.clone());
                    uploaded_tid = Some(tid);
                }
                (Some(packed.payload), String::new(), uploaded_tid)
            }
            PreparedSync::Archive(archive_b64) => (None, archive_b64, None),
        };

        let res = self
            .remote_rpc(
                server_id,
                "workspace:sync",
                json!({
                    "name": project_name,
                    "target_dir": req.target_dir,
                    "archive_b64": archive_b64,
                    "git": git_payload,
                }),
            )
            .await;
        let res = match res {
            Ok(v) => v,
            Err(err) => {
                if let Some(tid) = uploaded_tid {
                    let _ = self
                        .remote_rpc(server_id, "transfer:close", json!({ "transfer_id": tid }))
                        .await;
                }
                return Err(err);
            }
        };
        let _ = self.refresh_remote_snapshot(server_id).await;
        self.broadcast_servers(state).await;
        Ok(res)
    }

    async fn upload_temp_file_chunks(
        self: &Arc<Self>,
        server_id: &str,
        file_path: &Path,
    ) -> Result<String> {
        let begin = self.remote_rpc(server_id, "transfer:begin", json!({})).await?;
        let transfer_id = begin
            .get("transfer_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| anyhow!("Remote server returned invalid transfer_id"))?
            .to_string();

        let path = file_path.to_path_buf();
        let mut offset = 0u64;
        loop {
            let chunk_path = path.clone();
            let chunk_res = tokio::task::spawn_blocking(move || -> Result<Vec<u8>> {
                let mut f = std::fs::File::open(&chunk_path)?;
                f.seek(SeekFrom::Start(offset))?;
                let mut buf = vec![0u8; crate::git::TRANSFER_CHUNK_BYTES];
                let mut total = 0usize;
                while total < buf.len() {
                    let n = f.read(&mut buf[total..])?;
                    if n == 0 {
                        break;
                    }
                    total += n;
                }
                buf.truncate(total);
                Ok(buf)
            })
            .await;

            let bytes = match chunk_res {
                Ok(Ok(b)) => b,
                Ok(Err(e)) => {
                    let _ = self
                        .remote_rpc(server_id, "transfer:close", json!({ "transfer_id": transfer_id }))
                        .await;
                    return Err(e);
                }
                Err(e) => {
                    let _ = self
                        .remote_rpc(server_id, "transfer:close", json!({ "transfer_id": transfer_id }))
                        .await;
                    return Err(e.into());
                }
            };
            if bytes.is_empty() {
                break;
            }
            offset = offset.saturating_add(bytes.len() as u64);
            let data_b64 =
                base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
            if let Err(err) = self
                .remote_rpc(
                    server_id,
                    "transfer:chunk",
                    json!({
                        "transfer_id": transfer_id,
                        "data_b64": data_b64,
                    }),
                )
                .await
            {
                let _ = self
                    .remote_rpc(server_id, "transfer:close", json!({ "transfer_id": transfer_id }))
                    .await;
                return Err(err);
            }
        }

        Ok(transfer_id)
    }

    async fn download_remote_transfer_to_file(
        self: &Arc<Self>,
        server_id: &str,
        transfer_id: &str,
    ) -> Result<tempfile::NamedTempFile> {
        let mut temp = tempfile::NamedTempFile::new()?;
        let mut offset = 0u64;
        let res: Result<tempfile::NamedTempFile> = async {
            loop {
                let chunk = self
                    .remote_rpc(
                        server_id,
                        "transfer:read",
                        json!({
                            "transfer_id": transfer_id,
                            "offset": offset,
                            "limit": crate::git::TRANSFER_CHUNK_BYTES,
                        }),
                    )
                    .await?;
                let data_b64 = chunk
                    .get("data_b64")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let eof = chunk.get("eof").and_then(|v| v.as_bool()).unwrap_or(false);
                if !data_b64.is_empty() {
                    let owned_b64 = data_b64.to_string();
                    let (next_temp, written) = tokio::task::spawn_blocking(move || -> Result<(tempfile::NamedTempFile, u64)> {
                        let bytes = base64::Engine::decode(
                            &base64::engine::general_purpose::STANDARD,
                            owned_b64.trim(),
                        )?;
                        temp.as_file_mut().write_all(&bytes)?;
                        Ok((temp, bytes.len() as u64))
                    })
                    .await??;
                    temp = next_temp;
                    offset = offset.saturating_add(written);
                }
                if eof {
                    break;
                }
            }
            let temp = tokio::task::spawn_blocking(move || -> Result<tempfile::NamedTempFile> {
                temp.as_file_mut().flush()?;
                Ok(temp)
            })
            .await??;
            Ok(temp)
        }
        .await;

        let _ = self
            .remote_rpc(
                server_id,
                "transfer:close",
                json!({ "transfer_id": transfer_id }),
            )
            .await;
        res
    }

    async fn pull_project_from_server(
        self: &Arc<Self>,
        state: &AppState,
        server_id: &str,
        params: Value,
    ) -> Result<Value> {
        #[derive(serde::Deserialize)]
        struct HubPullProjectRequest {
            #[serde(default)]
            remote_project_id: Option<String>,
            #[serde(default)]
            remote_path: Option<String>,
            local_project_path: String,
            #[serde(default)]
            branch: Option<String>,
            #[serde(default)]
            worktree_dir: Option<String>,
        }

        if server_id == "local" {
            anyhow::bail!("Select a remote server to pull changes into a local worktree");
        }

        let req: HubPullProjectRequest = serde_json::from_value(params)?;
        let local_canon = std::fs::canonicalize(req.local_project_path.trim())
            .with_context(|| format!("Local project path does not exist: {}", req.local_project_path))?;
        let local_projects = state.workspace.lock().await.projects();
        let matched = local_projects.into_iter().find(|p| {
            std::fs::canonicalize(&p.root)
                .map(|r| r == local_canon)
                .unwrap_or(false)
        });
        let Some(local_project) = matched else {
            anyhow::bail!("Target repository must be added to the local Projects panel first");
        };

        let server_name = {
            let guard = self.remotes.lock().await;
            guard
                .get(server_id)
                .map(|r| r.config.name.clone())
                .ok_or_else(|| anyhow!("Server not found: {}", server_id))?
        };

        let probe_root = local_canon.clone();
        let (local_repo_root, known_bases) = tokio::task::spawn_blocking(move || -> Result<(PathBuf, Vec<String>)> {
            let repo_root = crate::git::resolve_git_toplevel(&probe_root)?;
            let bases = crate::git::collect_local_known_bases(&repo_root)?;
            Ok((repo_root, bases))
        })
        .await??;

        let remote_val = self
            .remote_rpc(
                server_id,
                "workspace:pull",
                json!({
                    "project_id": req.remote_project_id,
                    "path": req.remote_path,
                    "known_bases": known_bases,
                }),
            )
            .await?;

        let pulled: crate::git::PullGitBundleResponse = serde_json::from_value(remote_val)
            .context("Invalid workspace:pull response from remote server")?;

        if !pulled.changed {
            return Ok(json!({
                "success": true,
                "changed": false,
                "head_sha": pulled.head_sha,
                "branch": pulled.branch,
                "commits_count": 0,
                "dirty_count": 0,
                "commits_summary": [],
                "dirty_files": [],
            }));
        }

        let bundle_temp = if let Some(tid) = pulled.bundle_transfer_id.clone() {
            Some(self.download_remote_transfer_to_file(server_id, &tid).await?)
        } else if let Some(b64) = pulled
            .bundle_b64
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
        {
            Some(
                tokio::task::spawn_blocking(move || -> Result<tempfile::NamedTempFile> {
                    let bytes = base64::Engine::decode(
                        &base64::engine::general_purpose::STANDARD,
                        &b64,
                    )?;
                    let mut tmp = tempfile::NamedTempFile::new()?;
                    tmp.as_file_mut().write_all(&bytes)?;
                    tmp.as_file_mut().flush()?;
                    Ok(tmp)
                })
                .await??,
            )
        } else {
            None
        };

        let worktrees_root = state.data_dir.join("worktrees");
        let project_name = local_project.name.clone();
        let requested_branch = req.branch.clone();
        let requested_worktree_dir = req.worktree_dir.clone();
        let pull_clone = pulled.clone();

        let (wt_path, branch_name) = tokio::task::spawn_blocking(move || {
            let empty_tmp;
            let bundle_path = match &bundle_temp {
                Some(t) => t.path(),
                None => {
                    empty_tmp = tempfile::NamedTempFile::new()?;
                    empty_tmp.path()
                }
            };
            crate::git::apply_pull_bundle_file_to_worktree(
                &local_repo_root,
                bundle_path,
                &pull_clone,
                &server_name,
                &project_name,
                &worktrees_root,
                requested_branch.as_deref(),
                requested_worktree_dir.as_deref(),
            )
        })
        .await??;

        let (project, already_present) = crate::handlers::workspace_handler::add_project_to_workspace(
            state,
            &wt_path.to_string_lossy(),
        )
        .await?;

        if !already_present {
            if let Some(io) = self.io.get() {
                let _ = io.emit("workspace:project-added", &project).await;
            }
        }
        self.broadcast_servers(state).await;

        Ok(json!({
            "success": true,
            "changed": true,
            "worktree_path": wt_path.to_string_lossy(),
            "branch": branch_name,
            "project": project,
            "head_sha": pulled.head_sha,
            "has_wip": pulled.has_wip,
            "commits_count": pulled.commits_count,
            "dirty_count": pulled.dirty_count,
            "commits_summary": pulled.commits_summary,
            "dirty_files": pulled.dirty_files,
        }))
    }

    async fn sync_agent_to_server(
        self: &Arc<Self>,
        state: &AppState,
        server_id: &str,
        params: Value,
    ) -> Result<Value> {
        #[derive(serde::Deserialize)]
        struct HubSyncAgentRequest {
            agent_id: String,
        }

        let req: HubSyncAgentRequest = serde_json::from_value(params)?;
        let requested_id = req.agent_id.trim();
        if requested_id.is_empty() {
            anyhow::bail!("agent_id cannot be empty");
        }

        let cfg_path = agents_config_path();
        if !cfg_path.is_file() {
            anyhow::bail!("Local agents config does not exist");
        }
        let raw = std::fs::read_to_string(&cfg_path)
            .with_context(|| format!("Failed to read {:?}", cfg_path))?;
        let config: AcpAgentsConfigFile =
            serde_json::from_str(&raw).context("Failed to parse local agents config")?;
        let mut agent = config
            .agents
            .iter()
            .find(|a| a.get("id").and_then(|v| v.as_str()) == Some(requested_id))
            .cloned()
            .ok_or_else(|| anyhow!("Agent '{}' not found in local agents config", requested_id))?;

        if server_id == "local" {
            return Ok(json!({
                "success": true,
                "agent": agent,
                "agents": config.agents,
                "installed_from_registry": false,
            }));
        }

        let registry_entries = state.acp_registry.fetch_agents(false).await.unwrap_or_default();
        let registry_id =
            resolve_registry_id_for_agent(&agent, &registry_entries, state.acp_registry.bin_dir());

        let home_dir = dirs::home_dir();
        let profile_dir_names = extract_and_normalize_profile_dirs(&mut agent, home_dir.as_deref());

        let packed_profiles = if profile_dir_names.is_empty() {
            Vec::new()
        } else if let Some(home) = home_dir {
            let profiles_root = home.join(".anycode").join("profiles");
            tokio::task::spawn_blocking(move || -> Result<Vec<Value>> {
                let mut out = Vec::new();
                for dir_name in profile_dir_names {
                    let profile_dir = profiles_root.join(&dir_name);
                    if !profile_dir.is_dir() {
                        continue;
                    }
                    let archive_b64 = pack_profile_archive(&profile_dir)?;
                    out.push(json!({
                        "dir_name": dir_name,
                        "archive_b64": archive_b64,
                    }));
                }
                Ok(out)
            })
            .await??
        } else {
            Vec::new()
        };

        self.remote_rpc(
            server_id,
            "acp:agent:sync",
            json!({
                "agent": agent,
                "registry_id": registry_id,
                "profiles": packed_profiles,
            }),
        )
        .await
    }

    async fn refresh_remote_snapshot(&self, server_id: &str) -> Result<()> {
        if let Ok(ws_state) = self.remote_rpc(server_id, "workspace:state", Value::Null).await {
            if let Ok(projects) = serde_json::from_value::<Vec<crate::workspace::ProjectInfo>>(
                ws_state.get("projects").cloned().unwrap_or(Value::Array(vec![])),
            ) {
                if let Some(r) = self.remotes.lock().await.get_mut(server_id) {
                    r.projects = projects;
                }
            }
        }
        if let Ok(acp_list) = self.remote_rpc(server_id, "acp:list", Value::Null).await {
            if let Ok(agents) = serde_json::from_value::<Vec<NodeAgentSummary>>(
                acp_list.get("agents").cloned().unwrap_or(Value::Array(vec![])),
            ) {
                if let Some(r) = self.remotes.lock().await.get_mut(server_id) {
                    r.agents = agents;
                }
            }
        }
        Ok(())
    }

    async fn remote_rpc(&self, server_id: &str, method: &str, params: Value) -> Result<Value> {
        let req_id = format!("r-{}", self.next_req_id.fetch_add(1, Ordering::Relaxed));
        let (tx, rx) = oneshot::channel::<Result<Value>>();

        let out_tx = {
            let guard = self.remotes.lock().await;
            let runtime = guard
                .get(server_id)
                .ok_or_else(|| anyhow!("Server not found: {}", server_id))?;
            if runtime.status != ServerConnectionStatus::Online {
                anyhow::bail!("Server '{}' is offline", runtime.config.name);
            }
            let Some(out_tx) = runtime.req_tx.clone() else {
                anyhow::bail!("Server '{}' has no active connection", runtime.config.name);
            };
            runtime.pending.lock().await.insert(req_id.clone(), tx);
            out_tx
        };

        let frame = NodeFrame::Req {
            id: req_id.clone(),
            method: method.to_string(),
            params,
        };
        if out_tx.send(frame).is_err() {
            if let Some(r) = self.remotes.lock().await.get(server_id) {
                r.pending.lock().await.remove(&req_id);
            }
            anyhow::bail!("Failed to send request to remote server");
        }

        let timeout_secs = if matches!(
            method,
            "acp:registry:install"
                | "acp:agent:sync"
                | "workspace:clone"
                | "workspace:sync"
                | "workspace:pull"
                | "workspace:worktree:create"
                | "transfer:chunk"
                | "transfer:read"
        ) {
            300
        } else {
            60
        };
        match tokio::time::timeout(Duration::from_secs(timeout_secs), rx).await {
            Ok(Ok(res)) => res,
            Ok(Err(_)) => anyhow::bail!("Remote connection dropped while waiting for {}", method),
            Err(_) => {
                if let Some(r) = self.remotes.lock().await.get(server_id) {
                    r.pending.lock().await.remove(&req_id);
                }
                anyhow::bail!("Timed out waiting for remote '{}'", method)
            }
        }
    }

    async fn spawn_remote_worker(self: &Arc<Self>, state: AppState, cfg: SavedServerConfig) {
        let server_id = cfg.id.clone();
        let cancel = CancellationToken::new();
        let reconnect_notify = Arc::new(Notify::new());
        let pending = Arc::new(Mutex::new(HashMap::new()));

        {
            let mut guard = self.remotes.lock().await;
            if let Some(old) = guard.remove(&server_id) {
                old.cancel.cancel();
            }
            guard.insert(
                server_id.clone(),
                RemoteRuntime {
                    config: cfg.clone(),
                    status: ServerConnectionStatus::Connecting,
                    error: None,
                    ping_ms: None,
                    info: None,
                    projects: Vec::new(),
                    agents: Vec::new(),
                    req_tx: None,
                    pending: pending.clone(),
                    cancel: cancel.clone(),
                    reconnect_notify: reconnect_notify.clone(),
                },
            );
        }

        let hub = self.clone();
        tokio::spawn(async move {
            hub.run_remote_loop(state, cfg, pending, cancel, reconnect_notify)
                .await;
        });
    }

    async fn run_remote_loop(
        self: Arc<Self>,
        state: AppState,
        cfg: SavedServerConfig,
        pending: Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value>>>>>,
        cancel: CancellationToken,
        reconnect_notify: Arc<Notify>,
    ) {
        let mut backoff_secs = 1u64;
        loop {
            if cancel.is_cancelled() {
                break;
            }

            {
                let mut guard = self.remotes.lock().await;
                if let Some(r) = guard.get_mut(&cfg.id) {
                    r.status = ServerConnectionStatus::Connecting;
                }
            }
            self.broadcast_servers(&state).await;

            match self.connect_once(&state, &cfg, &pending, &cancel).await {
                Ok(()) => {
                    backoff_secs = 1;
                }
                Err(err) => {
                    let msg = err.to_string();
                    let is_auth = msg.contains("401") || msg.to_ascii_lowercase().contains("unauthorized");
                    warn!("Remote server '{}' ({}) disconnected: {}", cfg.name, cfg.url, msg);
                    let mut guard = self.remotes.lock().await;
                    if let Some(r) = guard.get_mut(&cfg.id) {
                        r.status = if is_auth {
                            ServerConnectionStatus::AuthError
                        } else {
                            ServerConnectionStatus::Offline
                        };
                        r.error = Some(msg);
                        r.req_tx = None;
                        r.ping_ms = None;
                    }
                }
            }

            // Fail any in-flight requests
            {
                let mut p = pending.lock().await;
                for (_, tx) in p.drain() {
                    let _ = tx.send(Err(anyhow!("Connection closed")));
                }
            }

            self.broadcast_servers(&state).await;

            tokio::select! {
                _ = cancel.cancelled() => break,
                _ = reconnect_notify.notified() => {
                    backoff_secs = 1;
                }
                _ = tokio::time::sleep(Duration::from_secs(backoff_secs)) => {
                    backoff_secs = (backoff_secs * 2).min(15);
                }
            }
        }
    }

    async fn connect_once(
        self: &Arc<Self>,
        state: &AppState,
        cfg: &SavedServerConfig,
        pending: &Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value>>>>>,
        cancel: &CancellationToken,
    ) -> Result<()> {
        let ws_url = build_ws_url(&cfg.url)?;
        let mut req = ws_url
            .into_client_request()
            .context("Failed to build WebSocket request")?;
        if let Some(token) = cfg.token.as_deref().filter(|t| !t.is_empty()) {
            let header_val = format!("Bearer {}", token);
            req.headers_mut().insert(
                "Authorization",
                header_val.parse().context("Invalid token header")?,
            );
        }

        let ws_cfg = WebSocketConfig::default()
            .max_frame_size(Some(MAX_NODE_WS_SIZE))
            .max_message_size(Some(MAX_NODE_WS_SIZE));
        let (ws_stream, _) = connect_async_with_config(req, Some(ws_cfg), false)
            .await
            .context("WebSocket connect failed")?;
        info!("Connected to remote Anycode node '{}' at {}", cfg.name, cfg.url);

        let (mut ws_tx, mut ws_rx) = ws_stream.split();
        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<NodeFrame>();

        {
            let mut guard = self.remotes.lock().await;
            if let Some(r) = guard.get_mut(&cfg.id) {
                r.status = ServerConnectionStatus::Online;
                r.error = None;
                r.req_tx = Some(out_tx.clone());
            }
        }

        let writer = tokio::spawn(async move {
            while let Some(frame) = out_rx.recv().await {
                let Ok(text) = serde_json::to_string(&frame) else {
                    continue;
                };
                if ws_tx.send(Message::Text(text.into())).await.is_err() {
                    break;
                }
            }
        });

        // Initial sync in a helper task so reader loop is already active
        let hub_sync = self.clone();
        let state_sync = state.clone();
        let id_sync = cfg.id.clone();
        tokio::spawn(async move {
            let started = Instant::now();
            if let Ok(info_val) = hub_sync.remote_rpc(&id_sync, "server:info", Value::Null).await {
                let rtt = started.elapsed().as_millis() as u64;
                if let Ok(info) = serde_json::from_value::<NodeServerInfo>(info_val) {
                    if let Some(r) = hub_sync.remotes.lock().await.get_mut(&id_sync) {
                        r.info = Some(info);
                        r.ping_ms = Some(rtt);
                    }
                }
            }
            if let Ok(ws_state) = hub_sync.remote_rpc(&id_sync, "workspace:state", Value::Null).await {
                if let Ok(projects) = serde_json::from_value::<Vec<crate::workspace::ProjectInfo>>(
                    ws_state.get("projects").cloned().unwrap_or(Value::Array(vec![])),
                ) {
                    if let Some(r) = hub_sync.remotes.lock().await.get_mut(&id_sync) {
                        r.projects = projects;
                    }
                }
            }
            if let Ok(acp_reconn) = hub_sync.remote_rpc(&id_sync, "acp:reconnect", Value::Null).await {
                if let Ok(agents) = serde_json::from_value::<Vec<NodeAgentSummary>>(
                    acp_reconn.get("agents").cloned().unwrap_or(Value::Array(vec![])),
                ) {
                    if let Some(r) = hub_sync.remotes.lock().await.get_mut(&id_sync) {
                        r.agents = agents;
                    }
                }
            }
            hub_sync.broadcast_servers(&state_sync).await;
        });

        let mut ping_interval = tokio::time::interval(Duration::from_secs(15));
        ping_interval.tick().await;

        loop {
            tokio::select! {
                _ = cancel.cancelled() => break,
                _ = ping_interval.tick() => {
                    let hub_p = self.clone();
                    let id_p = cfg.id.clone();
                    let state_p = state.clone();
                    tokio::spawn(async move {
                        let started = Instant::now();
                        if hub_p.remote_rpc(&id_p, "ping", Value::Null).await.is_ok() {
                            let rtt = started.elapsed().as_millis() as u64;
                            if let Some(r) = hub_p.remotes.lock().await.get_mut(&id_p) {
                                r.ping_ms = Some(rtt);
                            }
                            let _ = hub_p.refresh_remote_snapshot(&id_p).await;
                            hub_p.broadcast_servers(&state_p).await;
                        }
                    });
                }
                msg_opt = ws_rx.next() => {
                    let Some(msg_res) = msg_opt else {
                        break;
                    };
                    let msg = msg_res.context("WebSocket read error")?;
                    match msg {
                        Message::Text(text) => {
                            let Ok(frame) = serde_json::from_str::<NodeFrame>(&text) else {
                                continue;
                            };
                            match frame {
                                NodeFrame::Res { id, ok, data, error } => {
                                    if let Some(tx) = pending.lock().await.remove(&id) {
                                        let payload = if ok {
                                            Ok(data.unwrap_or(Value::Null))
                                        } else {
                                            Err(anyhow!(error.unwrap_or_else(|| "Remote error".to_string())))
                                        };
                                        let _ = tx.send(payload);
                                    }
                                }
                                NodeFrame::Event { event, data } => {
                                    if event == "workspace:state" {
                                        if let Ok(projects) = serde_json::from_value::<Vec<crate::workspace::ProjectInfo>>(
                                            data.get("projects").cloned().unwrap_or(Value::Array(vec![])),
                                        ) {
                                            if let Some(r) = self.remotes.lock().await.get_mut(&cfg.id) {
                                                r.projects = projects;
                                            }
                                            self.broadcast_servers(state).await;
                                        }
                                    } else {
                                        self.emit_node_event(&cfg.id, &event, data).await;
                                    }
                                }
                                NodeFrame::Req { .. } => {}
                            }
                        }
                        Message::Close(_) => break,
                        Message::Ping(_)
                        | Message::Pong(_)
                        | Message::Binary(_)
                        | Message::Frame(_) => {}
                    }
                }
            }
        }

        drop(out_tx);
        let _ = writer.await;
        Ok(())
    }
}

pub fn build_ws_url(raw: &str) -> Result<String> {
    let trimmed = raw.trim().trim_end_matches('/');
    let with_scheme = if trimmed.starts_with("http://") {
        format!("ws://{}", &trimmed["http://".len()..])
    } else if trimmed.starts_with("https://") {
        format!("wss://{}", &trimmed["https://".len()..])
    } else if trimmed.starts_with("ws://") || trimmed.starts_with("wss://") {
        trimmed.to_string()
    } else {
        format!("ws://{}", trimmed)
    };

    let mut parsed = url::Url::parse(&with_scheme).context("Invalid server URL")?;
    if parsed.path().is_empty() || parsed.path() == "/" {
        parsed.set_path("/ws/node");
    } else if !parsed.path().ends_with("/ws/node") {
        let next_path = format!("{}/ws/node", parsed.path().trim_end_matches('/'));
        parsed.set_path(&next_path);
    }
    Ok(parsed.to_string())
}

pub fn build_open_url(raw: &str, token: Option<&str>) -> Option<String> {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() || trimmed == "local" {
        return None;
    }
    let with_http = if trimmed.starts_with("ws://") {
        format!("http://{}", &trimmed["ws://".len()..])
    } else if trimmed.starts_with("wss://") {
        format!("https://{}", &trimmed["wss://".len()..])
    } else if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("http://{}", trimmed)
    };

    let mut parsed = url::Url::parse(&with_http).ok()?;
    if parsed.path().ends_with("/ws/node") {
        let stripped = parsed.path().trim_end_matches("/ws/node").to_string();
        parsed.set_path(if stripped.is_empty() { "/" } else { &stripped });
    }
    if let Some(tok) = token.map(str::trim).filter(|t| !t.is_empty()) {
        parsed.query_pairs_mut().append_pair("token", tok);
    }
    Some(parsed.to_string())
}

const MAX_NODE_WS_SIZE: usize = 64 * 1024 * 1024;
const MAX_SYNC_ARCHIVE_BYTES: usize = 32 * 1024 * 1024;

struct LimitedWriter {
    buf: Vec<u8>,
    limit: usize,
}

impl LimitedWriter {
    fn new(limit: usize) -> Self {
        Self {
            buf: Vec::new(),
            limit,
        }
    }
}

impl std::io::Write for LimitedWriter {
    fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
        if self.buf.len().saturating_add(data.len()) > self.limit {
            return Err(std::io::Error::new(
                std::io::ErrorKind::FileTooLarge,
                format!("Project archive exceeds {} MB limit", self.limit / (1024 * 1024)),
            ));
        }
        self.buf.extend_from_slice(data);
        Ok(data.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn should_skip_sync_entry(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | "node_modules"
            | "target"
            | ".build"
            | "DerivedData"
            | ".next"
            | ".nuxt"
            | "dist"
            | ".venv"
            | "venv"
            | "__pycache__"
            | ".anycode"
            | ".DS_Store"
    ) || name.ends_with(".anycode_tmp")
}

fn should_skip_sync_rel_path(rel: &std::path::Path) -> bool {
    rel.components().any(|c| match c {
        std::path::Component::Normal(name) => should_skip_sync_entry(&name.to_string_lossy()),
        _ => true,
    })
}

fn list_git_sync_files(root: &std::path::Path) -> Option<Vec<PathBuf>> {
    if !root.join(".git").exists() {
        return None;
    }
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let mut files = Vec::new();
    for raw in output.stdout.split(|&b| b == 0) {
        if raw.is_empty() {
            continue;
        }
        let rel_str = String::from_utf8_lossy(raw);
        let rel = PathBuf::from(rel_str.as_ref());
        if !should_skip_sync_rel_path(&rel) {
            files.push(rel);
        }
    }
    Some(files)
}

fn append_filtered_dir_to_tar<W: std::io::Write, F: Fn(&str) -> bool>(
    builder: &mut tar::Builder<W>,
    root: &Path,
    dir: &Path,
    should_skip: &F,
) -> Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if should_skip(&name_str) {
            continue;
        }
        let meta = std::fs::symlink_metadata(entry.path())?;
        if meta.file_type().is_symlink() {
            continue;
        }
        let path = entry.path();
        let rel = path.strip_prefix(root)?;
        if meta.is_dir() {
            builder.append_dir(rel, &path)?;
            append_filtered_dir_to_tar(builder, root, &path, should_skip)?;
        } else if meta.is_file() {
            builder.append_path_with_name(&path, rel)?;
        }
    }
    Ok(())
}

fn finish_tar_gz_b64(
    builder: tar::Builder<flate2::write::GzEncoder<LimitedWriter>>,
) -> Result<String> {
    use base64::Engine as _;

    let gz = builder.into_inner()?;
    let writer = gz.finish()?;
    Ok(base64::engine::general_purpose::STANDARD.encode(writer.buf))
}

fn pack_project_archive_with_limit(root: &Path, limit: usize) -> Result<String> {
    use flate2::Compression;
    use flate2::write::GzEncoder;

    let gz = GzEncoder::new(LimitedWriter::new(limit), Compression::fast());
    let mut builder = tar::Builder::new(gz);

    if let Some(git_files) = list_git_sync_files(root) {
        for rel in git_files {
            let full_path = root.join(&rel);
            let Ok(meta) = std::fs::symlink_metadata(&full_path) else {
                continue;
            };
            if meta.file_type().is_symlink() || !meta.is_file() {
                continue;
            }
            builder.append_path_with_name(&full_path, &rel)?;
        }
    } else {
        append_filtered_dir_to_tar(&mut builder, root, root, &should_skip_sync_entry)?;
    }

    finish_tar_gz_b64(builder)
}

fn pack_project_archive(root: &Path) -> Result<String> {
    pack_project_archive_with_limit(root, MAX_SYNC_ARCHIVE_BYTES)
}

fn should_skip_profile_entry(name: &str) -> bool {
    matches!(
        name,
        ".DS_Store"
            | "cache"
            | ".cache"
            | "tmp"
            | ".tmp"
            | "logs"
            | "log"
            | "conversations"
            | "brain"
            | "shell_snapshots"
            | "thread-writer-locks"
            | ".remote-plugin-install-staging"
    ) || name.starts_with("logs_")
        || name.ends_with(".sqlite-wal")
        || name.ends_with(".sqlite-shm")
        || name.ends_with(".lock")
        || name.ends_with(".log")
        || name.ends_with(".anycode_tmp")
}

fn pack_profile_archive_with_limit(root: &Path, limit: usize) -> Result<String> {
    use flate2::Compression;
    use flate2::write::GzEncoder;

    let gz = GzEncoder::new(LimitedWriter::new(limit), Compression::fast());
    let mut builder = tar::Builder::new(gz);
    append_filtered_dir_to_tar(&mut builder, root, root, &should_skip_profile_entry)?;
    finish_tar_gz_b64(builder)
}

fn pack_profile_archive(root: &Path) -> Result<String> {
    pack_profile_archive_with_limit(root, MAX_SYNC_ARCHIVE_BYTES)
}

fn resolve_registry_id_for_agent(
    agent: &Value,
    entries: &[AcpRegistryAgentEntry],
    local_bin_dir: &Path,
) -> Option<String> {
    let command = agent
        .get("command")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();

    if !command.is_empty() {
        let cmd_path = Path::new(command);
        if let Ok(rel) = cmd_path.strip_prefix(local_bin_dir) {
            if let Some(std::path::Component::Normal(first)) = rel.components().next() {
                let first_str = first.to_string_lossy();
                if let Some(matched) = entries
                    .iter()
                    .find(|e| e.id == first_str.as_ref() || e.id.replace('/', "_") == first_str.as_ref())
                {
                    return Some(matched.id.clone());
                }
                if !first_str.is_empty() {
                    return Some(first_str.to_string());
                }
            }
        }
    }

    let agent_id = agent
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();

    if !agent_id.is_empty() {
        if let Some(exact) = entries.iter().find(|e| e.id == agent_id) {
            return Some(exact.id.clone());
        }
        let mut best_prefix: Option<&AcpRegistryAgentEntry> = None;
        for entry in entries {
            let prefix = format!("{}-", entry.id);
            if agent_id.starts_with(&prefix) {
                let is_longer = best_prefix
                    .map(|prev| entry.id.len() > prev.id.len())
                    .unwrap_or(true);
                if is_longer {
                    best_prefix = Some(entry);
                }
            }
        }
        if let Some(matched) = best_prefix {
            return Some(matched.id.clone());
        }
    }

    if command.eq_ignore_ascii_case("npx") || command.eq_ignore_ascii_case("npx.cmd") {
        if let Some(args) = agent.get("args").and_then(|v| v.as_array()) {
            let arg_strs: Vec<&str> = args.iter().filter_map(|v| v.as_str()).collect();
            for entry in entries {
                if let Some(ref npx) = entry.distribution.npx {
                    if arg_strs.iter().any(|a| *a == npx.package) {
                        return Some(entry.id.clone());
                    }
                }
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_ws_url_variants() {
        assert_eq!(
            build_ws_url("http://127.0.0.1:3001").unwrap(),
            "ws://127.0.0.1:3001/ws/node"
        );
        assert_eq!(
            build_ws_url("https://srv.example.com/").unwrap(),
            "wss://srv.example.com/ws/node"
        );
        assert_eq!(
            build_ws_url("10.0.0.5:3002").unwrap(),
            "ws://10.0.0.5:3002/ws/node"
        );
        assert_eq!(
            build_ws_url("ws://localhost:3003/custom").unwrap(),
            "ws://localhost:3003/custom/ws/node"
        );
        assert_eq!(
            build_ws_url("wss://localhost:3003/ws/node").unwrap(),
            "wss://localhost:3003/ws/node"
        );
    }

    #[test]
    fn test_build_open_url_with_and_without_token() {
        assert_eq!(
            build_open_url("http://127.0.0.1:3001", Some("secret1")).as_deref(),
            Some("http://127.0.0.1:3001/?token=secret1")
        );
        assert_eq!(
            build_open_url("ws://10.0.0.5:3002/ws/node", Some("tok 1")).as_deref(),
            Some("http://10.0.0.5:3002/?token=tok+1")
        );
        assert_eq!(
            build_open_url("https://srv.example.com", None).as_deref(),
            Some("https://srv.example.com/")
        );
        assert_eq!(build_open_url("local", Some("x")), None);
    }

    #[test]
    fn test_node_frame_roundtrip() {
        let req = NodeFrame::Req {
            id: "r1".to_string(),
            method: "workspace:state".to_string(),
            params: json!({"project_id": "p1"}),
        };
        let encoded = serde_json::to_string(&req).unwrap();
        let decoded: NodeFrame = serde_json::from_str(&encoded).unwrap();
        match decoded {
            NodeFrame::Req { id, method, params } => {
                assert_eq!(id, "r1");
                assert_eq!(method, "workspace:state");
                assert_eq!(params["project_id"], "p1");
            }
            _ => panic!("expected Req variant"),
        }
    }

    #[test]
    fn test_pack_and_unpack_project_archive() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();

        std::fs::create_dir_all(src.path().join("src")).unwrap();
        std::fs::write(src.path().join("src/main.rs"), "fn main() {}\n").unwrap();
        std::fs::create_dir_all(src.path().join("target/debug")).unwrap();
        std::fs::write(src.path().join("target/debug/bin"), "ignored").unwrap();
        std::fs::create_dir_all(src.path().join("node_modules/pkg")).unwrap();
        std::fs::write(src.path().join("node_modules/pkg/index.js"), "ignored").unwrap();

        let archive = pack_project_archive(src.path()).unwrap();
        let target_dir = dst.path().join("proj");
        crate::node_server::unpack_project_archive(&archive, &target_dir).unwrap();

        assert_eq!(
            std::fs::read_to_string(target_dir.join("src/main.rs")).unwrap(),
            "fn main() {}\n"
        );
        assert!(!target_dir.join("target").exists());
        assert!(!target_dir.join("node_modules").exists());
    }

    #[test]
    fn test_pack_git_repo_respects_gitignore_and_skips_git_dir() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();

        let status = std::process::Command::new("git")
            .arg("-C")
            .arg(src.path())
            .arg("init")
            .status()
            .unwrap();
        assert!(status.success());

        std::fs::write(src.path().join(".gitignore"), "*.log\nvideos/\n").unwrap();
        std::fs::create_dir_all(src.path().join("src")).unwrap();
        std::fs::write(src.path().join("src/lib.rs"), "pub fn ok() {}\n").unwrap();
        std::fs::write(src.path().join("debug.log"), "ignored").unwrap();
        std::fs::create_dir_all(src.path().join("videos")).unwrap();
        std::fs::write(src.path().join("videos/demo.mp4"), "ignored").unwrap();

        let archive = pack_project_archive(src.path()).unwrap();
        let target_dir = dst.path().join("repo");
        crate::node_server::unpack_project_archive(&archive, &target_dir).unwrap();

        assert_eq!(
            std::fs::read_to_string(target_dir.join("src/lib.rs")).unwrap(),
            "pub fn ok() {}\n"
        );
        assert!(!target_dir.join("debug.log").exists());
        assert!(!target_dir.join("videos").exists());
        assert!(!target_dir.join(".git").exists());
    }

    #[test]
    fn test_pack_project_archive_aborts_on_size_limit() {
        let src = tempfile::tempdir().unwrap();
        let payload = vec![0xA5u8; 64 * 1024];
        std::fs::write(src.path().join("data.bin"), &payload).unwrap();

        let err = pack_project_archive_with_limit(src.path(), 64).unwrap_err();
        assert!(err.to_string().contains("limit"));
    }

    #[test]
    fn test_resolve_registry_id_for_agent_matches_bin_prefix_and_profile_id() {
        use crate::acp_registry::{AcpRegistryDistribution, AcpRegistryNpxDistribution};

        let entries = vec![
            AcpRegistryAgentEntry {
                id: "antigravity-acp".to_string(),
                name: "Google Antigravity".to_string(),
                version: "1.4.1".to_string(),
                description: String::new(),
                repository: None,
                website: None,
                authors: None,
                license: None,
                license_url: None,
                icon: None,
                distribution: AcpRegistryDistribution {
                    npx: None,
                    binary: None,
                },
            },
            AcpRegistryAgentEntry {
                id: "codex-acp".to_string(),
                name: "Codex".to_string(),
                version: "1.13.1".to_string(),
                description: String::new(),
                repository: None,
                website: None,
                authors: None,
                license: None,
                license_url: None,
                icon: None,
                distribution: AcpRegistryDistribution {
                    npx: Some(AcpRegistryNpxDistribution {
                        package: "@zed-industries/codex-acp".to_string(),
                        args: None,
                        env: None,
                    }),
                    binary: None,
                },
            },
        ];
        let local_bin_dir = Path::new("/home/alice/.local/share/.anycode/bin");

        let agy_profiled = json!({
            "id": "antigravity-acp-work",
            "command": "/home/alice/.local/share/.anycode/bin/antigravity-acp/1.4.1/agent_server.par",
        });
        assert_eq!(
            resolve_registry_id_for_agent(&agy_profiled, &entries, local_bin_dir).as_deref(),
            Some("antigravity-acp")
        );

        let agy_renamed = json!({
            "id": "custom-alias",
            "command": "/home/alice/.local/share/.anycode/bin/antigravity-acp/1.2.1/agent_server.par",
        });
        assert_eq!(
            resolve_registry_id_for_agent(&agy_renamed, &entries, local_bin_dir).as_deref(),
            Some("antigravity-acp")
        );

        let codex_profiled = json!({
            "id": "codex-acp-team",
            "command": "npx",
            "args": ["@zed-industries/codex-acp"],
        });
        assert_eq!(
            resolve_registry_id_for_agent(&codex_profiled, &entries, local_bin_dir).as_deref(),
            Some("codex-acp")
        );
    }

    #[test]
    fn test_extract_and_normalize_profile_dirs() {
        let home = Path::new("/home/alice");
        let mut agent = json!({
            "id": "antigravity-acp-work",
            "env": {
                "GEMINI_HOME": "/home/alice/.anycode/profiles/antigravity-acp-work",
                "CODEX_HOME": "~/.anycode/profiles/codex-acp-team/",
                "AGY_ACP_FORCE_FILE_STORAGE": "1"
            }
        });

        let dirs = extract_and_normalize_profile_dirs(&mut agent, Some(home));
        assert_eq!(
            dirs,
            vec![
                "antigravity-acp-work".to_string(),
                "codex-acp-team".to_string(),
            ]
        );
        assert_eq!(
            agent["env"]["GEMINI_HOME"],
            "~/.anycode/profiles/antigravity-acp-work"
        );
    }

    #[test]
    fn test_pack_profile_archive_skips_heavy_caches_and_conversations() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();

        std::fs::create_dir_all(src.path().join("antigravity-acp/conversations")).unwrap();
        std::fs::create_dir_all(src.path().join(".tmp")).unwrap();
        std::fs::create_dir_all(src.path().join("cache")).unwrap();
        std::fs::write(src.path().join("auth.json"), "{\"ok\":true}\n").unwrap();
        std::fs::write(src.path().join("antigravity-acp/settings.json"), "{}\n").unwrap();
        std::fs::write(src.path().join("antigravity-acp/conversations/chat.pb"), "heavy").unwrap();
        std::fs::write(src.path().join(".tmp/scratch"), "heavy").unwrap();
        std::fs::write(src.path().join("cache/item"), "heavy").unwrap();
        std::fs::write(src.path().join("logs_2.sqlite"), "heavy").unwrap();
        std::fs::write(src.path().join("state_5.sqlite-wal"), "wal").unwrap();

        let archive = pack_profile_archive(src.path()).unwrap();
        crate::node_server::unpack_project_archive(&archive, dst.path()).unwrap();

        assert_eq!(
            std::fs::read_to_string(dst.path().join("auth.json")).unwrap(),
            "{\"ok\":true}\n"
        );
        assert_eq!(
            std::fs::read_to_string(dst.path().join("antigravity-acp/settings.json")).unwrap(),
            "{}\n"
        );
        assert!(!dst.path().join("antigravity-acp/conversations").exists());
        assert!(!dst.path().join(".tmp").exists());
        assert!(!dst.path().join("cache").exists());
        assert!(!dst.path().join("logs_2.sqlite").exists());
        assert!(!dst.path().join("state_5.sqlite-wal").exists());
    }
}

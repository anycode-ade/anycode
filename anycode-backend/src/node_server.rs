use std::collections::{BTreeSet, HashMap};
use std::io::{Read as _, Seek as _, SeekFrom, Write as _};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use axum::extract::ws::{Message, WebSocket};
use axum::extract::{State, WebSocketUpgrade};
use axum::http::{HeaderMap, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::{Mutex, broadcast, mpsc};
use tokio_util::sync::CancellationToken;
use tracing::{error, info, warn};

use crate::acp::AcpMessage;
use crate::acp_registry::{AcpRegistryManager, current_platform_key};
use crate::app_state::AppState;
use crate::handlers::acp_handler::{
    AcpAgentsConfigFile, AcpAuthenticateRequest, AcpCancelRequest, AcpGetToolOutputRequest,
    AcpPromptRequest, AcpQueueMoveRequest, AcpQueueRemoveRequest, AcpQueueSendNowRequest,
    AcpQueueUpdateRequest, AcpSessionsListRequest, AcpSetConfigRequest, AcpStartRequest,
    AcpStopRequest, AcpUndoRequest, agents_config_path, prepare_prompt_attachments,
};
use crate::handlers::acp_registry_handler::{AcpRegistryInstallRequest, AcpRegistryListRequest};
use crate::handlers::auth_handler::extract_token_from_http;
use crate::handlers::workspace_handler::{
    BrowseRequest, ProjectRequest, add_project_to_workspace, browse_workspace_dir,
    workspace_state_snapshot,
};
use crate::node_protocol::{NodeAgentSummary, NodeFrame, NodeServerInfo};

/// Per-connection subscription context for streaming ACP events back over `/ws/node` or local hub.
#[derive(Clone)]
pub struct NodeSubscriptionSink {
    pub event_tx: mpsc::UnboundedSender<NodeFrame>,
    pub subs: Arc<Mutex<HashMap<String, CancellationToken>>>,
}

impl NodeSubscriptionSink {
    pub fn new(event_tx: mpsc::UnboundedSender<NodeFrame>) -> Self {
        Self {
            event_tx,
            subs: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn subscribe_agent(
        &self,
        state: &AppState,
        agent_id: &str,
        msg_rx: broadcast::Receiver<AcpMessage>,
    ) {
        let cancel = CancellationToken::new();
        {
            let mut subs = self.subs.lock().await;
            if let Some(old) = subs.insert(agent_id.to_string(), cancel.clone()) {
                old.cancel();
            }
        }
        let tx = self.event_tx.clone();
        let aid = agent_id.to_string();
        let state_clone = state.clone();
        tokio::spawn(async move {
            forward_node_agent_messages(tx, state_clone, aid, msg_rx, cancel).await;
        });
    }

    pub async fn unsubscribe_agent(&self, agent_id: &str) {
        if let Some(tok) = self.subs.lock().await.remove(agent_id) {
            tok.cancel();
        }
    }

    pub async fn cancel_all(&self) {
        let mut subs = self.subs.lock().await;
        for (_, tok) in subs.drain() {
            tok.cancel();
        }
    }
}

async fn maybe_emit_agent_diff_stats(
    tx: &mpsc::UnboundedSender<NodeFrame>,
    state: &AppState,
    agent_id: &str,
    last_stats: &mut Option<crate::git::WorktreeDiffStats>,
) -> bool {
    let wt_path = state
        .agent_worktrees
        .lock()
        .await
        .get(agent_id)
        .map(|w| w.path.clone());
    let Some(wt_path) = wt_path else {
        return true;
    };
    let wt_for_task = wt_path.clone();
    let Ok(Ok(stats)) = tokio::task::spawn_blocking(move || {
        crate::git::compute_worktree_diff_stats(&wt_for_task)
    })
    .await
    else {
        return true;
    };
    if last_stats.as_ref() == Some(&stats) {
        return true;
    }
    *last_stats = Some(stats.clone());
    let frame = NodeFrame::Event {
        event: "acp:diff_stats".to_string(),
        data: json!({
            "agent_id": agent_id,
            "worktree_path": wt_path.to_string_lossy(),
            "diff_added": stats.added,
            "diff_removed": stats.removed,
            "diff_files": stats.files,
        }),
    };
    tx.send(frame).is_ok()
}

async fn forward_node_agent_messages(
    tx: mpsc::UnboundedSender<NodeFrame>,
    state: AppState,
    agent_id: String,
    mut msg_rx: broadcast::Receiver<AcpMessage>,
    cancel: CancellationToken,
) {
    let mut is_processing = state.acp_manager.lock().await.is_agent_processing(&agent_id);
    let mut last_stats: Option<crate::git::WorktreeDiffStats> = None;
    let _ = maybe_emit_agent_diff_stats(&tx, &state, &agent_id, &mut last_stats).await;

    let mut stats_tick = tokio::time::interval(std::time::Duration::from_secs(2));
    stats_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            _ = stats_tick.tick(), if is_processing => {
                if !maybe_emit_agent_diff_stats(&tx, &state, &agent_id, &mut last_stats).await {
                    break;
                }
            }
            msg = msg_rx.recv() => {
                match msg {
                    Ok(item) => {
                        let prompt_finished = match &item {
                            AcpMessage::PromptState(ps) => {
                                let was_processing = is_processing;
                                is_processing = ps.is_processing;
                                was_processing && !ps.is_processing
                            }
                            _ => false,
                        };
                        let frame = NodeFrame::Event {
                            event: "acp:message".to_string(),
                            data: json!({ "agent_id": agent_id, "item": item }),
                        };
                        if tx.send(frame).is_err() {
                            break;
                        }
                        if prompt_finished {
                            if !maybe_emit_agent_diff_stats(&tx, &state, &agent_id, &mut last_stats).await {
                                break;
                            }
                        }
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        let history = state.acp_manager.lock().await.get_agent_history(&agent_id).await;
                        if let Some(history) = history {
                            let frame = NodeFrame::Event {
                                event: "acp:history".to_string(),
                                data: json!({ "agent_id": agent_id, "history": history }),
                            };
                            if tx.send(frame).is_err() {
                                break;
                            }
                        }
                    }
                }
            }
        }
    }
}

const MAX_NODE_WS_SIZE: usize = 64 * 1024 * 1024;

pub async fn ws_node_handler(
    ws: WebSocketUpgrade,
    headers: HeaderMap,
    uri: Uri,
    State(state): State<AppState>,
) -> Response {
    if state.is_auth_required() {
        let candidate = extract_token_from_http(&headers, &uri);
        if !state.is_token_valid(candidate.as_deref()) {
            warn!("/ws/node rejected: invalid or missing access token");
            return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
        }
    }

    ws.max_frame_size(MAX_NODE_WS_SIZE)
        .max_message_size(MAX_NODE_WS_SIZE)
        .on_upgrade(move |socket| handle_node_socket(socket, state))
}

async fn handle_node_socket(socket: WebSocket, state: AppState) {
    info!("Hub connected to /ws/node");
    let (mut ws_tx, mut ws_rx) = socket.split();
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<NodeFrame>();
    let sink = NodeSubscriptionSink::new(out_tx.clone());

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

    while let Some(msg_res) = ws_rx.next().await {
        let Ok(msg) = msg_res else {
            break;
        };
        match msg {
            Message::Text(text) => {
                let frame = match serde_json::from_str::<NodeFrame>(&text) {
                    Ok(frame) => frame,
                    Err(e) => {
                        warn!("Invalid /ws/node frame: {}", e);
                        continue;
                    }
                };
                if let NodeFrame::Req { id, method, params } = frame {
                    let state_c = state.clone();
                    let sink_c = sink.clone();
                    let out_c = out_tx.clone();
                    tokio::spawn(async move {
                        let res = match dispatch_node_method(&state_c, &method, params, Some(&sink_c)).await {
                            Ok(data) => NodeFrame::Res {
                                id,
                                ok: true,
                                data: Some(data),
                                error: None,
                            },
                            Err(err) => NodeFrame::Res {
                                id,
                                ok: false,
                                data: None,
                                error: Some(err.to_string()),
                            },
                        };
                        let _ = out_c.send(res);
                    });
                }
            }
            Message::Close(_) => break,
            Message::Ping(_) | Message::Pong(_) | Message::Binary(_) => {}
        }
    }

    sink.cancel_all().await;
    drop(out_tx);
    let _ = writer.await;
    info!("Hub disconnected from /ws/node");
}

#[derive(Debug, Deserialize)]
struct CloneProjectRequest {
    url: String,
    #[serde(default)]
    target_dir: Option<String>,
    #[serde(default)]
    branch: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SyncProjectRequest {
    name: String,
    #[serde(default)]
    target_dir: Option<String>,
    #[serde(default)]
    archive_b64: String,
    #[serde(default)]
    git: Option<crate::git::SyncGitPayload>,
}

#[derive(Debug, Deserialize)]
struct ProjectGitInfoRequest {
    #[serde(default)]
    project_id: Option<String>,
    #[serde(default)]
    path: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PullProjectRequest {
    #[serde(default)]
    project_id: Option<String>,
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    known_bases: Vec<String>,
}

fn default_include_dirty() -> bool {
    true
}

#[derive(Debug, Deserialize)]
struct CreateWorktreeRequest {
    #[serde(default)]
    project_id: Option<String>,
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    branch: Option<String>,
    #[serde(default)]
    worktree_dir: Option<String>,
    #[serde(default)]
    worktree_name: Option<String>,
    #[serde(default)]
    base_ref: Option<String>,
    #[serde(default = "default_include_dirty")]
    include_dirty: bool,
    #[serde(default)]
    register_in_workspace: bool,
}

#[derive(Debug, Deserialize)]
struct ListWorktreesRequest {
    #[serde(default)]
    project_id: Option<String>,
    #[serde(default)]
    path: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RemoveWorktreeRequest {
    #[serde(default)]
    project_id: Option<String>,
    #[serde(default)]
    path: Option<String>,
    worktree_path: String,
}

#[derive(Debug, Deserialize)]
struct WorktreeDiffRequest {
    #[serde(default)]
    project_id: Option<String>,
    #[serde(default)]
    path: Option<String>,
    worktree_path: String,
}

#[derive(Debug, Deserialize)]
struct TransferChunkRequest {
    transfer_id: String,
    data_b64: String,
}

#[derive(Debug, Deserialize)]
struct TransferReadRequest {
    transfer_id: String,
    offset: u64,
    #[serde(default)]
    limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
struct TransferCloseRequest {
    transfer_id: String,
}

struct ActiveTransfer {
    file: tempfile::NamedTempFile,
    size: u64,
    updated_at: Instant,
}

const TRANSFER_TTL: Duration = Duration::from_secs(30 * 60);
const REMOTE_WORKTREES_DIR: &str = "remote-worktrees";

fn remote_worktrees_root(state: &AppState) -> PathBuf {
    let modern = state.data_dir.join(REMOTE_WORKTREES_DIR);
    if modern.exists() {
        return modern;
    }
    let legacy = state.data_dir.join("cloud-worktrees");
    if legacy.exists() {
        return legacy;
    }
    modern
}

fn transfer_store() -> &'static std::sync::Mutex<HashMap<String, ActiveTransfer>> {
    static STORE: OnceLock<std::sync::Mutex<HashMap<String, ActiveTransfer>>> = OnceLock::new();
    STORE.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

fn cleanup_expired_transfers(map: &mut HashMap<String, ActiveTransfer>) {
    map.retain(|_, entry| entry.updated_at.elapsed() < TRANSFER_TTL);
}

fn next_transfer_id() -> String {
    static NEXT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let seq = NEXT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("xfer-{}-{}-{}", std::process::id(), ts, seq)
}

fn register_transfer_file(file: tempfile::NamedTempFile) -> anyhow::Result<(String, u64)> {
    let size = file.as_file().metadata()?.len();
    let id = next_transfer_id();
    let mut guard = transfer_store()
        .lock()
        .map_err(|_| anyhow::anyhow!("Transfer store lock poisoned"))?;
    cleanup_expired_transfers(&mut guard);
    guard.insert(
        id.clone(),
        ActiveTransfer {
            file,
            size,
            updated_at: Instant::now(),
        },
    );
    Ok((id, size))
}

fn append_transfer_chunk(transfer_id: &str, bytes: &[u8]) -> anyhow::Result<u64> {
    let mut guard = transfer_store()
        .lock()
        .map_err(|_| anyhow::anyhow!("Transfer store lock poisoned"))?;
    cleanup_expired_transfers(&mut guard);
    let entry = guard
        .get_mut(transfer_id)
        .ok_or_else(|| anyhow::anyhow!("Transfer session not found or expired: {}", transfer_id))?;
    let file = entry.file.as_file_mut();
    file.seek(SeekFrom::End(0))?;
    file.write_all(bytes)?;
    file.flush()?;
    entry.size = file.metadata()?.len();
    entry.updated_at = Instant::now();
    Ok(entry.size)
}

fn read_transfer_chunk(transfer_id: &str, offset: u64, limit: usize) -> anyhow::Result<(Vec<u8>, u64)> {
    let mut guard = transfer_store()
        .lock()
        .map_err(|_| anyhow::anyhow!("Transfer store lock poisoned"))?;
    cleanup_expired_transfers(&mut guard);
    let entry = guard
        .get_mut(transfer_id)
        .ok_or_else(|| anyhow::anyhow!("Transfer session not found or expired: {}", transfer_id))?;
    let max_read = limit.clamp(1, crate::git::TRANSFER_CHUNK_BYTES);
    let file = entry.file.as_file_mut();
    file.seek(SeekFrom::Start(offset))?;
    let mut buf = vec![0u8; max_read];
    let mut total = 0usize;
    while total < max_read {
        let n = file.read(&mut buf[total..])?;
        if n == 0 {
            break;
        }
        total += n;
    }
    buf.truncate(total);
    entry.updated_at = Instant::now();
    Ok((buf, entry.size))
}

fn take_transfer_file(transfer_id: &str) -> anyhow::Result<tempfile::NamedTempFile> {
    let mut guard = transfer_store()
        .lock()
        .map_err(|_| anyhow::anyhow!("Transfer store lock poisoned"))?;
    cleanup_expired_transfers(&mut guard);
    guard
        .remove(transfer_id)
        .map(|entry| entry.file)
        .ok_or_else(|| anyhow::anyhow!("Transfer session not found or expired: {}", transfer_id))
}

#[derive(Debug, Deserialize)]
struct SyncProfilePayload {
    dir_name: String,
    archive_b64: String,
}

#[derive(Debug, Deserialize)]
struct SyncAgentRequest {
    agent: Value,
    #[serde(default)]
    registry_id: Option<String>,
    #[serde(default)]
    profiles: Vec<SyncProfilePayload>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Deserialize)]
struct RemoveAgentRequest {
    agent_id: String,
    #[serde(default = "default_true")]
    remove_profile: bool,
}

static AGENTS_FILE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn agents_file_lock() -> &'static Mutex<()> {
    AGENTS_FILE_LOCK.get_or_init(|| Mutex::new(()))
}

fn sanitize_profile_dir_name(name: &str) -> anyhow::Result<String> {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains('\0')
    {
        anyhow::bail!("Invalid profile directory name: {}", name);
    }
    Ok(trimmed.to_string())
}

pub(crate) fn parse_profile_dir_name(val: &str, home_dir: Option<&Path>) -> Option<(String, bool)> {
    let trimmed = val.trim();
    if let Some(rest) = trimmed
        .strip_prefix("~/.anycode/profiles/")
        .or_else(|| trimmed.strip_prefix("~\\.anycode\\profiles\\"))
    {
        let clean = rest.trim_end_matches(['/', '\\']);
        if !clean.is_empty()
            && clean != "."
            && clean != ".."
            && !clean.contains('/')
            && !clean.contains('\\')
        {
            return Some((clean.to_string(), false));
        }
        return None;
    }

    if let Some(home) = home_dir {
        let profiles_root = home.join(".anycode").join("profiles");
        if let Ok(rel) = Path::new(trimmed).strip_prefix(&profiles_root) {
            let mut comps = rel.components();
            if let (Some(std::path::Component::Normal(first)), None) =
                (comps.next(), comps.next())
            {
                let name = first.to_string_lossy().to_string();
                if !name.is_empty() {
                    return Some((name, true));
                }
            }
        }
    }
    None
}

pub(crate) fn extract_and_normalize_profile_dirs(
    agent: &mut Value,
    home_dir: Option<&Path>,
) -> Vec<String> {
    let mut dirs_found = BTreeSet::new();
    let agent_id = agent
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if let Some(env_obj) = agent.get_mut("env").and_then(|v| v.as_object_mut()) {
        let keys: Vec<String> = env_obj.keys().cloned().collect();
        for key in keys {
            if let Some(val_str) = env_obj.get(&key).and_then(|v| v.as_str()).map(str::to_string) {
                if let Some((dir_name, needs_normalize)) = parse_profile_dir_name(&val_str, home_dir)
                {
                    if needs_normalize {
                        env_obj.insert(key, json!(format!("~/.anycode/profiles/{}", dir_name)));
                    }
                    dirs_found.insert(dir_name);
                }
            }
        }
    }

    if dirs_found.is_empty() && !agent_id.is_empty() {
        let has_profile = agent
            .get("profile")
            .and_then(|v| v.as_str())
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false);
        if has_profile {
            if let Some(template_obj) = agent.get("profileEnv").and_then(|v| v.as_object()).cloned()
            {
                for (_key, val) in template_obj {
                    if let Some(tmpl) = val.as_str() {
                        let resolved = tmpl.replace("${id}", &agent_id);
                        if let Some((dir_name, _)) = parse_profile_dir_name(&resolved, home_dir) {
                            dirs_found.insert(dir_name);
                        }
                    }
                }
            }
        }
    }

    dirs_found.into_iter().collect()
}

fn find_executable_in_path(name: &str, path_var: Option<&str>) -> bool {
    let check_var = |raw: &std::ffi::OsStr| -> bool {
        std::env::split_paths(raw).any(|dir| {
            let candidate = dir.join(name);
            candidate.is_file()
        })
    };
    if let Some(p) = path_var {
        if check_var(std::ffi::OsStr::new(p)) {
            return true;
        }
    }
    if let Some(p) = std::env::var_os("PATH") {
        if check_var(&p) {
            return true;
        }
    }
    false
}

async fn resolve_or_install_registry_preset(
    state: &AppState,
    agent_id: &str,
    reuse_installed: bool,
) -> anyhow::Result<crate::acp_registry::ResolvedAgentPreset> {
    let mut agents = state.acp_registry.fetch_agents(false).await?;
    let mut entry = agents.into_iter().find(|a| a.id == agent_id);
    if entry.is_none() {
        agents = state.acp_registry.fetch_agents(true).await?;
        entry = agents.into_iter().find(|a| a.id == agent_id);
    }
    let entry = entry.ok_or_else(|| anyhow::anyhow!("Agent '{}' not found in registry", agent_id))?;

    let platform_key = current_platform_key();
    let binary_target = entry
        .distribution
        .binary
        .as_ref()
        .and_then(|b| b.get(platform_key));
    if let Some(target) = binary_target {
        let existing = if reuse_installed
            && state
                .acp_registry
                .is_binary_installed(&entry.id, &entry.version, &target.cmd)
        {
            state
                .acp_registry
                .find_installed_binary(&entry.id, &entry.version, &target.cmd)
        } else {
            None
        };
        let installed_path = match existing {
            Some(path) => path,
            None => {
                state
                    .acp_registry
                    .download_and_install_binary(&entry, |_| {})
                    .await?
            }
        };
        Ok(AcpRegistryManager::to_agent_preset(
            &entry,
            Some(installed_path.to_string_lossy().to_string()),
        ))
    } else if entry.distribution.npx.is_some() {
        Ok(AcpRegistryManager::to_agent_preset(&entry, None))
    } else {
        anyhow::bail!(
            "Agent '{}' does not support platform '{}'",
            agent_id,
            platform_key
        )
    }
}

fn upsert_agent_in_config_file(
    path: &Path,
    agent: Value,
) -> anyhow::Result<AcpAgentsConfigFile> {
    let agent_id = agent
        .get("id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow::anyhow!("Agent config must contain a non-empty id"))?
        .to_string();

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let mut config = if path.is_file() {
        let raw = std::fs::read_to_string(path)?;
        serde_json::from_str::<AcpAgentsConfigFile>(&raw).unwrap_or(AcpAgentsConfigFile {
            agents: Vec::new(),
            default_agent_id: None,
        })
    } else {
        AcpAgentsConfigFile {
            agents: Vec::new(),
            default_agent_id: None,
        }
    };

    if let Some(existing) = config
        .agents
        .iter_mut()
        .find(|item| item.get("id").and_then(|v| v.as_str()) == Some(agent_id.as_str()))
    {
        *existing = agent;
    } else {
        config.agents.push(agent);
    }

    let formatted = serde_json::to_string_pretty(&config)?;
    std::fs::write(path, formatted)?;
    Ok(config)
}

fn remove_agent_from_config_file(
    path: &Path,
    agent_id: &str,
    home_dir: Option<&Path>,
) -> anyhow::Result<(bool, AcpAgentsConfigFile, Vec<String>)> {
    if !path.is_file() {
        return Ok((
            false,
            AcpAgentsConfigFile {
                agents: Vec::new(),
                default_agent_id: None,
            },
            Vec::new(),
        ));
    }

    let raw = std::fs::read_to_string(path)?;
    let mut config = serde_json::from_str::<AcpAgentsConfigFile>(&raw).unwrap_or(AcpAgentsConfigFile {
        agents: Vec::new(),
        default_agent_id: None,
    });

    let mut removed_dirs = BTreeSet::new();
    let mut kept = Vec::with_capacity(config.agents.len());
    let mut was_removed = false;

    for mut entry in config.agents.drain(..) {
        if entry.get("id").and_then(|v| v.as_str()) == Some(agent_id) {
            was_removed = true;
            for dir_name in extract_and_normalize_profile_dirs(&mut entry, home_dir) {
                removed_dirs.insert(dir_name);
            }
        } else {
            kept.push(entry);
        }
    }

    if !was_removed {
        config.agents = kept;
        return Ok((false, config, Vec::new()));
    }

    config.agents = kept;
    if config.default_agent_id.as_deref() == Some(agent_id) {
        config.default_agent_id = config
            .agents
            .first()
            .and_then(|a| a.get("id").and_then(|v| v.as_str()))
            .map(str::to_string);
    }

    let formatted = serde_json::to_string_pretty(&config)?;
    std::fs::write(path, formatted)?;

    // Keep any profile dir still referenced by another remaining agent entry.
    let mut still_used = BTreeSet::new();
    for entry in &config.agents {
        let mut copy = entry.clone();
        for dir_name in extract_and_normalize_profile_dirs(&mut copy, home_dir) {
            still_used.insert(dir_name);
        }
    }

    let orphan_dirs: Vec<String> = removed_dirs
        .into_iter()
        .filter(|d| !still_used.contains(d))
        .collect();

    Ok((true, config, orphan_dirs))
}

pub(crate) fn sanitize_project_dir_name(name: &str) -> String {
    let cleaned: String = name
        .trim()
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '\0' => '_',
            _ => c,
        })
        .collect();
    if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
        "project".to_string()
    } else {
        cleaned
    }
}

pub(crate) fn unpack_project_archive(
    archive_b64: &str,
    target_dir: &std::path::Path,
) -> anyhow::Result<()> {
    use base64::Engine as _;
    use flate2::read::GzDecoder;
    use std::path::Component;

    let compressed = base64::engine::general_purpose::STANDARD
        .decode(archive_b64.trim())
        .map_err(|e| anyhow::anyhow!("Invalid sync archive encoding: {}", e))?;
    std::fs::create_dir_all(target_dir)?;

    let gz = GzDecoder::new(&compressed[..]);
    let mut archive = tar::Archive::new(gz);

    for entry in archive.entries()? {
        let mut entry = entry?;
        let rel_path = entry.path()?.into_owned();
        if rel_path.is_absolute()
            || rel_path
                .components()
                .any(|c| matches!(c, Component::ParentDir | Component::RootDir | Component::Prefix(_)))
        {
            anyhow::bail!("Unsafe path in sync archive: {}", rel_path.display());
        }
        if entry.header().entry_type().is_symlink() || entry.header().entry_type().is_hard_link() {
            continue;
        }
        let dest = target_dir.join(&rel_path);
        if entry.header().entry_type().is_dir() {
            std::fs::create_dir_all(&dest)?;
        } else if entry.header().entry_type().is_file() {
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent)?;
            }
            if dest.is_file() {
                let _ = std::fs::remove_file(&dest);
            }
            entry.unpack(&dest)?;
        }
    }
    Ok(())
}

pub fn current_server_info(state: &AppState) -> NodeServerInfo {
    NodeServerInfo {
        name: state.server_name.clone(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

pub async fn collect_agent_summaries(state: &AppState) -> Vec<NodeAgentSummary> {
    let project_ids = state.agent_project_ids.lock().await.clone();
    let worktrees = state.agent_worktrees.lock().await.clone();
    let (agents, queue_map, session_ids, processing_map) = {
        let acp_manager = state.acp_manager.lock().await;
        let agents = acp_manager.list_agents();
        let mut queue_map = std::collections::HashMap::new();
        let mut session_ids = std::collections::HashMap::new();
        let mut processing_map = std::collections::HashMap::new();
        for (id, _) in &agents {
            let queue: Vec<Value> = acp_manager
                .get_agent_queue(id)
                .await
                .unwrap_or_default()
                .into_iter()
                .filter_map(|q| serde_json::to_value(q).ok())
                .collect();
            queue_map.insert(id.clone(), queue);
            if let Some(sid) = acp_manager.get_agent_session_id(id) {
                session_ids.insert(id.clone(), sid.to_string());
            }
            processing_map.insert(id.clone(), acp_manager.is_agent_processing(id));
        }
        (agents, queue_map, session_ids, processing_map)
    };

    let wt_paths: Vec<(String, PathBuf)> = agents
        .iter()
        .filter_map(|(id, _)| worktrees.get(id).map(|w| (id.clone(), w.path.clone())))
        .collect();
    let diff_stats_map: std::collections::HashMap<String, crate::git::WorktreeDiffStats> =
        if wt_paths.is_empty() {
            std::collections::HashMap::new()
        } else {
            tokio::task::spawn_blocking(move || {
                let mut m = std::collections::HashMap::with_capacity(wt_paths.len());
                for (id, path) in wt_paths {
                    if let Ok(stats) = crate::git::compute_worktree_diff_stats(&path) {
                        m.insert(id, stats);
                    }
                }
                m
            })
            .await
            .unwrap_or_default()
        };

    let mut out = Vec::with_capacity(agents.len());
    for (id, name) in agents {
        let wt = worktrees.get(&id);
        let diff_stats = diff_stats_map.get(&id);
        out.push(NodeAgentSummary {
            id: id.clone(),
            project_id: project_ids.get(&id).cloned(),
            name,
            session_id: session_ids.get(&id).cloned(),
            is_processing: processing_map.get(&id).copied().unwrap_or(false),
            queue: queue_map.get(&id).cloned().unwrap_or_default(),
            worktree_path: wt.map(|w| w.path.to_string_lossy().into_owned()),
            worktree_branch: wt.map(|w| w.branch.clone()),
            diff_added: diff_stats.map(|s| s.added),
            diff_removed: diff_stats.map(|s| s.removed),
            diff_files: diff_stats.map(|s| s.files),
        });
    }
    out
}

async fn resolve_registered_project_root(
    state: &AppState,
    project_id: Option<&str>,
    path: Option<&str>,
) -> anyhow::Result<PathBuf> {
    let projects = state.workspace.lock().await.projects();
    if let Some(pid) = project_id.map(str::trim).filter(|s| !s.is_empty()) {
        if let Some(proj) = projects.iter().find(|p| p.id == pid) {
            return Ok(PathBuf::from(&proj.root));
        }
    }
    if let Some(raw_path) = path.map(str::trim).filter(|s| !s.is_empty()) {
        let candidate = std::fs::canonicalize(raw_path).unwrap_or_else(|_| PathBuf::from(raw_path));
        if let Some(proj) = projects.iter().find(|p| {
            std::fs::canonicalize(&p.root)
                .map(|c| c == candidate)
                .unwrap_or_else(|_| PathBuf::from(&p.root) == candidate)
        }) {
            return Ok(PathBuf::from(&proj.root));
        }
        let worktrees = state.agent_worktrees.lock().await;
        if worktrees.values().any(|w| {
            std::fs::canonicalize(&w.path)
                .map(|c| c == candidate)
                .unwrap_or_else(|_| w.path == candidate)
        }) {
            return Ok(candidate);
        }
        let managed_root = remote_worktrees_root(state);
        if let Ok(managed_canon) = std::fs::canonicalize(&managed_root) {
            if candidate.starts_with(&managed_canon) && candidate.is_dir() {
                return Ok(candidate);
            }
        }
    }
    anyhow::bail!("Project is not registered in this server's workspace")
}

pub async fn dispatch_node_method(
    state: &AppState,
    method: &str,
    params: Value,
    sink: Option<&NodeSubscriptionSink>,
) -> anyhow::Result<Value> {
    match method {
        "ping" => Ok(json!({ "pong": true })),
        "server:info" => Ok(serde_json::to_value(current_server_info(state))?),
        "workspace:state" => Ok(workspace_state_snapshot(state, None).await),
        "workspace:browse" => {
            let req: BrowseRequest = if params.is_null() {
                BrowseRequest { path: None }
            } else {
                serde_json::from_value(params)?
            };
            browse_workspace_dir(state, req.path).await
        }
        "workspace:add-project" => {
            let req: BrowseRequest = serde_json::from_value(params)?;
            let path = req
                .path
                .filter(|p| !p.trim().is_empty())
                .ok_or_else(|| anyhow::anyhow!("Choose a server folder first"))?;
            let (project, _) = add_project_to_workspace(state, &path).await?;
            let snapshot = workspace_state_snapshot(state, Some(project.id)).await;
            if let Some(sink) = sink {
                let _ = sink.event_tx.send(NodeFrame::Event {
                    event: "workspace:state".to_string(),
                    data: snapshot.clone(),
                });
            }
            Ok(snapshot)
        }
        "workspace:remove-project" => {
            let req: ProjectRequest = serde_json::from_value(params)?;
            let _lifecycle = state.workspace_lifecycle.lock().await;
            if state
                .agent_project_ids
                .lock()
                .await
                .values()
                .any(|pid| pid == &req.project_id)
            {
                anyhow::bail!("Stop this project's running agents before removing it");
            }
            let project_runtime = state.workspace.lock().await.get(&req.project_id);
            state
                .send_project_watch_command(|reply| {
                    crate::background_tasks::ProjectWatchCommand::Remove(
                        req.project_id.clone(),
                        reply,
                    )
                })
                .await?;
            let project = state.workspace.lock().await.remove_project(&req.project_id)?;
            crate::handlers::workspace_handler::close_terminals_for_project(
                state,
                Some(&req.project_id),
            )
            .await;
            let root = PathBuf::from(&project.root);
            if let Some(runtime) = project_runtime {
                runtime.lsp.lock().await.stop_all().await;
            }
            state
                .file2code
                .lock()
                .await
                .retain(|path, _| !PathBuf::from(path).starts_with(&root));
            let snapshot = workspace_state_snapshot(state, None).await;
            if let Some(sink) = sink {
                let _ = sink.event_tx.send(NodeFrame::Event {
                    event: "workspace:state".to_string(),
                    data: snapshot.clone(),
                });
            }
            Ok(snapshot)
        }
        "workspace:clone" => {
            let req: CloneProjectRequest = serde_json::from_value(params)?;
            let url = req.url.trim().to_string();
            if url.is_empty() {
                anyhow::bail!("Git URL cannot be empty");
            }
            let repo_name = url
                .rsplit('/')
                .next()
                .unwrap_or("project")
                .trim_end_matches(".git")
                .trim();
            let repo_name = if repo_name.is_empty() { "project" } else { repo_name };
            let target_path = match req.target_dir.filter(|s| !s.trim().is_empty()) {
                Some(dir) => PathBuf::from(dir),
                None => state.workspace.lock().await.starting_directory().join(repo_name),
            };
            if target_path.exists() {
                anyhow::bail!("Target directory already exists: {}", target_path.display());
            }
            if let Some(parent) = target_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut cmd = tokio::process::Command::new("git");
            cmd.arg("clone");
            if let Some(branch) = req.branch.as_deref().map(str::trim).filter(|b| !b.is_empty()) {
                cmd.arg("--branch").arg(branch);
            }
            cmd.arg(&url).arg(&target_path);
            let output = cmd.output().await?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                anyhow::bail!("git clone failed: {}", stderr.trim());
            }
            let (project, _) =
                add_project_to_workspace(state, &target_path.to_string_lossy()).await?;
            let snapshot = workspace_state_snapshot(state, Some(project.id)).await;
            if let Some(sink) = sink {
                let _ = sink.event_tx.send(NodeFrame::Event {
                    event: "workspace:state".to_string(),
                    data: snapshot.clone(),
                });
            }
            Ok(snapshot)
        }
        "workspace:sync" => {
            let req: SyncProjectRequest = serde_json::from_value(params)?;
            let dir_name = sanitize_project_dir_name(&req.name);
            let remote_projects_root = state.data_dir.join("remote-projects");
            let legacy_cloud_projects_root = state.data_dir.join("cloud-projects");
            let target_path = match req
                .target_dir
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                Some(dir) => {
                    let candidate = PathBuf::from(dir);
                    let in_workspace = state
                        .workspace
                        .lock()
                        .await
                        .projects()
                        .into_iter()
                        .any(|p| PathBuf::from(&p.root) == candidate);
                    if !in_workspace
                        && !candidate.starts_with(&remote_projects_root)
                        && !candidate.starts_with(&legacy_cloud_projects_root)
                    {
                        anyhow::bail!("Invalid sync target directory");
                    }
                    candidate
                }
                None => remote_projects_root.join(dir_name),
            };
            let unpack_target = target_path.clone();
            if let Some(git_payload) = req.git {
                if let Some(tid) = git_payload.bundle_transfer_id.clone() {
                    let transfer_file = take_transfer_file(&tid)?;
                    tokio::task::spawn_blocking(move || {
                        let res = crate::git::apply_git_sync_from_bundle_file(
                            &unpack_target,
                            transfer_file.path(),
                            &git_payload,
                        );
                        drop(transfer_file);
                        res
                    })
                    .await??;
                } else {
                    tokio::task::spawn_blocking(move || {
                        crate::git::apply_git_sync_payload(&unpack_target, &git_payload)
                    })
                    .await??;
                }
            } else {
                let archive_b64 = req.archive_b64;
                if archive_b64.trim().is_empty() {
                    anyhow::bail!("Sync payload missing both git bundle and project archive");
                }
                tokio::task::spawn_blocking(move || unpack_project_archive(&archive_b64, &unpack_target))
                    .await??;
            }
            let (project, _) =
                add_project_to_workspace(state, &target_path.to_string_lossy()).await?;
            let snapshot = workspace_state_snapshot(state, Some(project.id)).await;
            if let Some(sink) = sink {
                let _ = sink.event_tx.send(NodeFrame::Event {
                    event: "workspace:state".to_string(),
                    data: snapshot.clone(),
                });
            }
            Ok(snapshot)
        }
        "workspace:git-info" => {
            let req: ProjectGitInfoRequest = serde_json::from_value(params)?;
            let root = resolve_registered_project_root(
                state,
                req.project_id.as_deref(),
                req.path.as_deref(),
            )
            .await?;
            let info = tokio::task::spawn_blocking(move || {
                crate::git::inspect_remote_git_state(&root)
            })
            .await??;
            Ok(serde_json::to_value(info)?)
        }
        "workspace:pull" => {
            let req: PullProjectRequest = serde_json::from_value(params)?;
            let root = resolve_registered_project_root(
                state,
                req.project_id.as_deref(),
                req.path.as_deref(),
            )
            .await?;
            let known_bases = req.known_bases;
            let (mut pulled, bundle_file) = tokio::task::spawn_blocking(move || {
                crate::git::build_pull_bundle_to_file(&root, &known_bases)
            })
            .await??;
            if let Some(file) = bundle_file {
                let (tid, size) = register_transfer_file(file)?;
                pulled.bundle_transfer_id = Some(tid);
                pulled.bundle_size = Some(size);
            }
            Ok(serde_json::to_value(pulled)?)
        }
        "workspace:worktree:create" => {
            let req: CreateWorktreeRequest = serde_json::from_value(params)?;
            let root = resolve_registered_project_root(
                state,
                req.project_id.as_deref(),
                req.path.as_deref(),
            )
            .await?;
            let project_name = root
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "project".to_string());
            let worktrees_root = remote_worktrees_root(state);
            let requested_branch = req.branch.clone();
            let requested_dir = req.worktree_dir.clone();
            let requested_name = req.worktree_name.clone();
            let base_ref = req.base_ref.clone();
            let include_dirty = req.include_dirty;
            let (wt_path, branch_name) = tokio::task::spawn_blocking(move || {
                crate::git::create_git_worktree(
                    &root,
                    &worktrees_root,
                    &project_name,
                    crate::git::CreateGitWorktreeOptions {
                        branch: requested_branch.as_deref(),
                        worktree_dir: requested_dir.as_deref(),
                        worktree_name: requested_name.as_deref(),
                        base_ref: base_ref.as_deref(),
                        include_dirty,
                    },
                )
            })
            .await??;
            if req.register_in_workspace {
                let (project, already_present) =
                    add_project_to_workspace(state, &wt_path.to_string_lossy()).await?;
                let mut snapshot = workspace_state_snapshot(state, Some(project.id.clone())).await;
                if let Some(obj) = snapshot.as_object_mut() {
                    obj.insert("worktree_path".to_string(), json!(wt_path.to_string_lossy()));
                    obj.insert("branch".to_string(), json!(branch_name));
                    obj.insert("project".to_string(), serde_json::to_value(&project)?);
                    obj.insert("already_present".to_string(), json!(already_present));
                }
                if let Some(sink) = sink {
                    let _ = sink.event_tx.send(NodeFrame::Event {
                        event: "workspace:state".to_string(),
                        data: snapshot.clone(),
                    });
                }
                Ok(snapshot)
            } else {
                Ok(json!({
                    "worktree_path": wt_path.to_string_lossy(),
                    "branch": branch_name,
                }))
            }
        }
        "workspace:worktree:list" => {
            let req: ListWorktreesRequest = serde_json::from_value(params)?;
            let root = resolve_registered_project_root(
                state,
                req.project_id.as_deref(),
                req.path.as_deref(),
            )
            .await?;
            let worktrees = tokio::task::spawn_blocking(move || {
                crate::git::list_git_worktrees(&root)
            })
            .await??;
            Ok(json!({ "worktrees": worktrees }))
        }
        "workspace:worktree:diff" | "workspace:worktree:diff-stats" => {
            let is_diff_full = method == "workspace:worktree:diff";
            let req: WorktreeDiffRequest = serde_json::from_value(params)?;
            let wt_raw = req.worktree_path.trim().to_string();
            if wt_raw.is_empty() {
                anyhow::bail!("Missing worktree_path");
            }
            let wt_canon = std::fs::canonicalize(&wt_raw)
                .map_err(|e| anyhow::anyhow!("Worktree path does not exist: {} ({})", wt_raw, e))?;

            let mut allowed = {
                let wts = state.agent_worktrees.lock().await;
                wts.values().any(|info| {
                    std::fs::canonicalize(&info.path)
                        .map(|p| p == wt_canon)
                        .unwrap_or_else(|_| info.path == wt_canon)
                })
            };
            if !allowed {
                let root = resolve_registered_project_root(
                    state,
                    req.project_id.as_deref(),
                    req.path.as_deref(),
                )
                .await
                .ok();
                if let Some(root_path) = root {
                    let wt_check = wt_canon.clone();
                    allowed = tokio::task::spawn_blocking(move || {
                        let root_canon = std::fs::canonicalize(&root_path).unwrap_or_else(|_| root_path.clone());
                        if wt_check == root_canon {
                            return true;
                        }
                        crate::git::list_git_worktrees(&root_path)
                            .map(|entries| entries.into_iter().any(|e| Path::new(&e.path) == wt_check))
                            .unwrap_or(false)
                    })
                    .await
                    .unwrap_or(false);
                }
            }
            if !allowed {
                anyhow::bail!("Worktree is not registered on this node: {}", wt_raw);
            }

            if is_diff_full {
                let diff = tokio::task::spawn_blocking(move || {
                    crate::git::collect_worktree_diff(&wt_canon)
                })
                .await??;
                Ok(serde_json::to_value(diff)?)
            } else {
                let stats = tokio::task::spawn_blocking(move || {
                    crate::git::compute_worktree_diff_stats(&wt_canon)
                })
                .await??;
                Ok(serde_json::to_value(stats)?)
            }
        }
        "workspace:worktree:remove" => {
            let req: RemoveWorktreeRequest = serde_json::from_value(params)?;
            let root = resolve_registered_project_root(
                state,
                req.project_id.as_deref(),
                req.path.as_deref(),
            )
            .await?;
            let wt_raw = req.worktree_path.trim().to_string();
            if wt_raw.is_empty() {
                anyhow::bail!("Missing worktree_path");
            }
            let wt_canon = std::fs::canonicalize(&wt_raw).unwrap_or_else(|_| PathBuf::from(&wt_raw));

            // Guard against deleting a worktree still in use by a live ACP session.
            let active_owner = {
                let wts = state.agent_worktrees.lock().await;
                let mut matched_id = None;
                for (aid, info) in wts.iter() {
                    let p = std::fs::canonicalize(&info.path).unwrap_or_else(|_| info.path.clone());
                    if p == wt_canon {
                        matched_id = Some(aid.clone());
                        break;
                    }
                }
                matched_id
            };
            if let Some(aid) = active_owner {
                let running = state.acp_manager.lock().await.get_agent(&aid).is_some();
                if running {
                    anyhow::bail!(
                        "Stop the active agent ({}) running in this worktree before removing it",
                        aid
                    );
                }
            }

            let wt_for_git = wt_canon.clone();
            tokio::task::spawn_blocking(move || {
                crate::git::remove_git_worktree(&root, &wt_for_git)
            })
            .await??;

            state.agent_worktrees.lock().await.retain(|_, info| {
                std::fs::canonicalize(&info.path).unwrap_or_else(|_| info.path.clone()) != wt_canon
            });

            // Clean up legacy workspace entries if this worktree was previously registered top-level.
            let legacy_project_id = {
                let ws = state.workspace.lock().await;
                ws.projects()
                    .into_iter()
                    .find(|p| {
                        std::fs::canonicalize(&p.root)
                            .map(|c| c == wt_canon)
                            .unwrap_or_else(|_| PathBuf::from(&p.root) == wt_canon)
                    })
                    .map(|p| p.id)
            };
            let mut payload = json!({
                "removed": wt_canon.to_string_lossy(),
            });
            if let Some(pid) = legacy_project_id {
                payload["removed_project_id"] = Value::String(pid.clone());
                let mut ws = state.workspace.lock().await;
                let _ = ws.remove_project(&pid);
                drop(ws);
                if let Some(sink) = sink {
                    let snapshot = workspace_state_snapshot(state, None).await;
                    let _ = sink.event_tx.send(NodeFrame::Event {
                        event: "workspace:state".to_string(),
                        data: snapshot,
                    });
                }
            }

            Ok(payload)
        }
        "transfer:begin" => {
            let file = tokio::task::spawn_blocking(tempfile::NamedTempFile::new).await??;
            let (transfer_id, _) = register_transfer_file(file)?;
            Ok(json!({ "transfer_id": transfer_id }))
        }
        "transfer:chunk" => {
            let req: TransferChunkRequest = serde_json::from_value(params)?;
            let transfer_id = req.transfer_id.clone();
            let data_b64 = req.data_b64;
            let size = tokio::task::spawn_blocking(move || -> anyhow::Result<u64> {
                let bytes = base64::Engine::decode(
                    &base64::engine::general_purpose::STANDARD,
                    data_b64.trim(),
                )?;
                append_transfer_chunk(&transfer_id, &bytes)
            })
            .await??;
            Ok(json!({ "transfer_id": req.transfer_id, "size": size }))
        }
        "transfer:read" => {
            let req: TransferReadRequest = serde_json::from_value(params)?;
            let transfer_id = req.transfer_id.clone();
            let offset = req.offset;
            let limit = req.limit.unwrap_or(crate::git::TRANSFER_CHUNK_BYTES);
            let (bytes, total_size) = tokio::task::spawn_blocking(move || {
                read_transfer_chunk(&transfer_id, offset, limit)
            })
            .await??;
            let bytes_read = bytes.len();
            let eof = offset.saturating_add(bytes_read as u64) >= total_size || bytes_read == 0;
            let data_b64 =
                base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
            Ok(json!({
                "transfer_id": req.transfer_id,
                "offset": offset,
                "bytes_read": bytes_read,
                "total_size": total_size,
                "eof": eof,
                "data_b64": data_b64,
            }))
        }
        "transfer:close" => {
            let req: TransferCloseRequest = serde_json::from_value(params)?;
            let _ = take_transfer_file(&req.transfer_id);
            Ok(json!({ "success": true }))
        }
        "acp:agents:get" => {
            let path = agents_config_path();
            if !path.exists() {
                return Ok(json!({
                    "success": true,
                    "exists": false,
                    "agents": [],
                    "default_agent_id": null
                }));
            }
            let content = std::fs::read_to_string(&path)?;
            let config: AcpAgentsConfigFile = serde_json::from_str(&content)?;
            Ok(json!({
                "success": true,
                "exists": true,
                "agents": config.agents,
                "default_agent_id": config.default_agent_id
            }))
        }
        "acp:registry:list" => {
            let req: AcpRegistryListRequest = if params.is_null() {
                AcpRegistryListRequest::default()
            } else {
                serde_json::from_value(params)?
            };
            let agents = state
                .acp_registry
                .list_agent_summaries(req.force_refresh.unwrap_or(false))
                .await?;
            Ok(json!({
                "success": true,
                "platform": current_platform_key(),
                "agents": agents,
            }))
        }
        "acp:registry:install" => {
            let req: AcpRegistryInstallRequest = serde_json::from_value(params)?;
            let preset = resolve_or_install_registry_preset(state, &req.agent_id, false).await?;
            Ok(json!({
                "success": true,
                "agent_id": req.agent_id,
                "preset": preset,
            }))
        }
        "acp:agent:sync" => {
            let req: SyncAgentRequest = serde_json::from_value(params)?;
            let mut agent = req.agent;
            let Some(agent_obj) = agent.as_object_mut() else {
                anyhow::bail!("Agent config must be a JSON object");
            };
            let agent_id = agent_obj
                .get("id")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| anyhow::anyhow!("Agent config must contain a non-empty id"))?
                .to_string();

            // Unpack any synced profile directories under ~/.anycode/profiles/<dir_name>
            if !req.profiles.is_empty() {
                let home = dirs::home_dir()
                    .ok_or_else(|| anyhow::anyhow!("Cannot determine home directory"))?;
                let profiles_root = home.join(".anycode").join("profiles");
                for profile in req.profiles {
                    let dir_name = sanitize_profile_dir_name(&profile.dir_name)?;
                    let target_profile_dir = profiles_root.join(dir_name);
                    let archive_b64 = profile.archive_b64;
                    tokio::task::spawn_blocking(move || {
                        unpack_project_archive(&archive_b64, &target_profile_dir)
                    })
                    .await??;
                }
            }

            // Resolve native executable / runtime on target node rather than keeping host-specific paths
            let mut installed_from_registry = false;
            let prev_cmd = agent_obj
                .get("command")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let prev_is_npx = prev_cmd.eq_ignore_ascii_case("npx")
                || prev_cmd.eq_ignore_ascii_case("npx.cmd");

            if let Some(reg_id) = req
                .registry_id
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                let preset = resolve_or_install_registry_preset(state, reg_id, true).await?;
                let next_is_npx = preset.distribution_type == "npx";
                let switched_runtime = prev_is_npx != next_is_npx;

                agent_obj.insert("command".to_string(), json!(preset.command));
                agent_obj.insert("version".to_string(), json!(preset.version));
                if switched_runtime || !agent_obj.contains_key("args") {
                    agent_obj.insert("args".to_string(), json!(preset.args));
                }
                installed_from_registry = !next_is_npx;
            } else if !prev_cmd.is_empty() {
                let cmd_path = Path::new(&prev_cmd);
                if cmd_path.is_absolute() && !cmd_path.exists() {
                    let basename = cmd_path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .ok_or_else(|| {
                            anyhow::anyhow!("Agent command '{}' does not exist on target server", prev_cmd)
                        })?;
                    let shell_path = crate::path_env::get_async().await;
                    if find_executable_in_path(basename, shell_path.as_deref()) {
                        agent_obj.insert("command".to_string(), json!(basename));
                    } else {
                        anyhow::bail!(
                            "Agent '{}' command '{}' was not found on target server",
                            agent_id,
                            prev_cmd
                        );
                    }
                }
            }

            let config_path = agents_config_path();
            let merged_agent = agent.clone();
            let _lock = agents_file_lock().lock().await;
            let config = tokio::task::spawn_blocking(move || {
                upsert_agent_in_config_file(&config_path, agent)
            })
            .await??;

            Ok(json!({
                "success": true,
                "agent": merged_agent,
                "agents": config.agents,
                "installed_from_registry": installed_from_registry,
            }))
        }
        "acp:agent:remove" => {
            let req: RemoveAgentRequest = serde_json::from_value(params)?;
            let agent_id = req.agent_id.trim().to_string();
            if agent_id.is_empty() {
                anyhow::bail!("agent_id cannot be empty");
            }

            let config_path = agents_config_path();
            let home_dir = dirs::home_dir();
            let _lock = agents_file_lock().lock().await;
            let remove_profile = req.remove_profile;
            let (removed, config, removed_profiles) = tokio::task::spawn_blocking(move || {
                let (removed, config, orphan_dirs) = remove_agent_from_config_file(
                    &config_path,
                    &agent_id,
                    home_dir.as_deref(),
                )?;
                let mut deleted_profiles = Vec::new();
                if remove_profile && !orphan_dirs.is_empty() {
                    if let Some(home) = home_dir {
                        let profiles_root = home.join(".anycode").join("profiles");
                        for dir_name in orphan_dirs {
                            if let Ok(safe_name) = sanitize_profile_dir_name(&dir_name) {
                                let target_dir = profiles_root.join(&safe_name);
                                if target_dir.is_dir() && std::fs::remove_dir_all(&target_dir).is_ok() {
                                    deleted_profiles.push(safe_name);
                                }
                            }
                        }
                    }
                }
                anyhow::Ok((removed, config, deleted_profiles))
            })
            .await??;

            Ok(json!({
                "success": true,
                "removed": removed,
                "removed_profiles": removed_profiles,
                "agents": config.agents,
            }))
        }
        "acp:list" => {
            let agents = collect_agent_summaries(state).await;
            Ok(json!({ "success": true, "agents": agents }))
        }
        "acp:reconnect" => {
            let agents = collect_agent_summaries(state).await;
            if let Some(sink) = sink {
                let mut acp_manager = state.acp_manager.lock().await;
                for agent in &agents {
                    if let Some(history) = acp_manager.get_agent_history(&agent.id).await {
                        if !history.is_empty() {
                            let _ = sink.event_tx.send(NodeFrame::Event {
                                event: "acp:history".to_string(),
                                data: json!({ "agent_id": agent.id, "history": history }),
                            });
                        }
                    }
                    if let Some(queue) = acp_manager.get_agent_queue(&agent.id).await {
                        if !queue.is_empty() {
                            let _ = sink.event_tx.send(NodeFrame::Event {
                                event: "acp:queue".to_string(),
                                data: json!({ "agent_id": agent.id, "queue": queue }),
                            });
                        }
                    }
                    if let Some(rx) = acp_manager.subscribe(&agent.id) {
                        sink.subscribe_agent(state, &agent.id, rx).await;
                    }
                }
            }
            Ok(json!({ "success": true, "agents": agents }))
        }
        "acp:sessions_list" => {
            let req: AcpSessionsListRequest = serde_json::from_value(params)?;
            let project_id = match req.project_id {
                Some(pid) => pid,
                None => state
                    .workspace
                    .lock()
                    .await
                    .default_project_id()
                    .ok_or_else(|| anyhow::anyhow!("Choose a project before listing sessions"))?,
            };
            let project = state
                .workspace
                .lock()
                .await
                .get(&project_id)
                .ok_or_else(|| anyhow::anyhow!("Project is no longer part of this workspace"))?;
            let cwd = PathBuf::from(project.info.root);
            let acp_manager = state.acp_manager.lock().await;
            let sessions = acp_manager.list_sessions(&req.command, &req.args, cwd).await?;
            Ok(json!({ "success": true, "sessions": sessions }))
        }
        "acp:start" => {
            #[derive(Debug, Deserialize)]
            struct NodeAcpStartRequest {
                #[serde(flatten)]
                base: AcpStartRequest,
                #[serde(default)]
                isolate_worktree: bool,
                #[serde(default)]
                worktree_branch: Option<String>,
                #[serde(default)]
                worktree_name: Option<String>,
                #[serde(default)]
                base_ref: Option<String>,
                #[serde(default)]
                worktree_path: Option<String>,
                #[serde(default = "default_include_dirty")]
                include_dirty: bool,
            }
            let node_req: NodeAcpStartRequest = serde_json::from_value(params)?;
            let req = node_req.base;
            let project_id = match req.project_id {
                Some(pid) => pid,
                None => state
                    .workspace
                    .lock()
                    .await
                    .default_project_id()
                    .ok_or_else(|| anyhow::anyhow!("Choose a project before starting an agent"))?,
            };
            let project = state
                .workspace
                .lock()
                .await
                .get(&project_id)
                .ok_or_else(|| anyhow::anyhow!("Project is no longer part of this workspace"))?;
            let base_root = PathBuf::from(&project.info.root);

            let created_worktree = if req.resume_session_id.is_none() {
                if let Some(existing_wt) = node_req
                    .worktree_path
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                {
                    let wt_canon = std::fs::canonicalize(existing_wt)
                        .unwrap_or_else(|_| PathBuf::from(existing_wt));
                    let parent = base_root.clone();
                    let target_wt = wt_canon.clone();
                    let branch_name = tokio::task::spawn_blocking(move || -> anyhow::Result<String> {
                        let worktrees = crate::git::list_git_worktrees(&parent)?;
                        let entry = worktrees.into_iter().find(|w| {
                            std::fs::canonicalize(&w.path)
                                .unwrap_or_else(|_| PathBuf::from(&w.path))
                                == target_wt
                        });
                        let Some(found) = entry else {
                            anyhow::bail!(
                                "Worktree is not registered for this project: {}",
                                target_wt.display()
                            );
                        };
                        Ok(found.branch.unwrap_or_else(|| found.id))
                    })
                    .await??;
                    Some(crate::app_state::AgentWorktreeInfo {
                        path: wt_canon,
                        branch: branch_name,
                    })
                } else if node_req.isolate_worktree {
                    let wt_root_parent = base_root.clone();
                    let project_name = project.info.name.clone();
                    let worktrees_root = remote_worktrees_root(state);
                    let requested_branch = node_req.worktree_branch.clone();
                    let requested_name = node_req.worktree_name.clone();
                    let base_ref = node_req.base_ref.clone();
                    let include_dirty = node_req.include_dirty;
                    let (wt_path, branch_name) = tokio::task::spawn_blocking(move || {
                        crate::git::create_git_worktree(
                            &wt_root_parent,
                            &worktrees_root,
                            &project_name,
                            crate::git::CreateGitWorktreeOptions {
                                branch: requested_branch.as_deref(),
                                worktree_name: requested_name.as_deref(),
                                base_ref: base_ref.as_deref(),
                                include_dirty,
                                ..Default::default()
                            },
                        )
                    })
                    .await??;
                    Some(crate::app_state::AgentWorktreeInfo {
                        path: wt_path,
                        branch: branch_name,
                    })
                } else {
                    None
                }
            } else {
                None
            };

            let agent_cwd = created_worktree
                .as_ref()
                .map(|w| w.path.clone())
                .unwrap_or(base_root);
            let worktree_path_str = created_worktree
                .as_ref()
                .map(|w| w.path.to_string_lossy().into_owned());
            let worktree_branch_str = created_worktree.as_ref().map(|w| w.branch.clone());

            let (start_result, msg_rx) = {
                let mut acp_manager = state.acp_manager.lock().await;
                if acp_manager.get_agent(&req.agent_id).is_some() {
                    anyhow::bail!("Agent {} already running", req.agent_id);
                }
                let start_result = acp_manager
                    .start_agent(
                        req.agent_id.clone(),
                        req.agent_name,
                        &req.command,
                        &req.args,
                        Some(req.env),
                        req.resume_session_id,
                        agent_cwd,
                    )
                    .await;
                let msg_rx = if start_result.is_ok() {
                    acp_manager.subscribe(&req.agent_id)
                } else {
                    None
                };
                (start_result, msg_rx)
            };

            match start_result {
                Ok(crate::acp::AcpStartOutcome::Ready { session_id }) => {
                    state
                        .agent_project_ids
                        .lock()
                        .await
                        .insert(req.agent_id.clone(), project_id.clone());
                    if let Some(wt) = created_worktree {
                        state
                            .agent_worktrees
                            .lock()
                            .await
                            .insert(req.agent_id.clone(), wt);
                    }
                    if let Some(sink) = sink {
                        let history = state
                            .acp_manager
                            .lock()
                            .await
                            .get_agent_history(&req.agent_id)
                            .await;
                        if let Some(history) = history {
                            let _ = sink.event_tx.send(NodeFrame::Event {
                                event: "acp:history".to_string(),
                                data: json!({ "agent_id": req.agent_id, "history": history }),
                            });
                        }
                        if let Some(rx) = msg_rx {
                            sink.subscribe_agent(state, &req.agent_id, rx).await;
                        }
                    }
                    let diff_stats = if let Some(ref wt_path) = worktree_path_str {
                        let p = PathBuf::from(wt_path);
                        tokio::task::spawn_blocking(move || crate::git::compute_worktree_diff_stats(&p))
                            .await
                            .ok()
                            .and_then(|r| r.ok())
                    } else {
                        None
                    };
                    Ok(json!({
                        "success": true,
                        "agent_id": req.agent_id,
                        "project_id": project_id,
                        "session_id": session_id,
                        "worktree_path": worktree_path_str,
                        "worktree_branch": worktree_branch_str,
                        "diff_added": diff_stats.as_ref().map(|s| s.added),
                        "diff_removed": diff_stats.as_ref().map(|s| s.removed),
                        "diff_files": diff_stats.as_ref().map(|s| s.files),
                        "auth_required": false
                    }))
                }
                Ok(crate::acp::AcpStartOutcome::AuthRequired { auth_methods }) => {
                    state
                        .agent_project_ids
                        .lock()
                        .await
                        .insert(req.agent_id.clone(), project_id.clone());
                    if let Some(wt) = created_worktree {
                        state
                            .agent_worktrees
                            .lock()
                            .await
                            .insert(req.agent_id.clone(), wt);
                    }
                    if let Some(sink) = sink {
                        if let Some(rx) = msg_rx {
                            sink.subscribe_agent(state, &req.agent_id, rx).await;
                        }
                    }
                    Ok(json!({
                        "success": true,
                        "agent_id": req.agent_id,
                        "project_id": project_id,
                        "worktree_path": worktree_path_str,
                        "worktree_branch": worktree_branch_str,
                        "auth_required": true,
                        "auth_methods": auth_methods
                    }))
                }
                Err(e) => {
                    error!("Node failed to start ACP agent {}: {}", req.agent_id, e);
                    Err(e)
                }
            }
        }
        "acp:authenticate" => {
            let req: AcpAuthenticateRequest = serde_json::from_value(params)?;
            let reply_rx = state
                .acp_manager
                .lock()
                .await
                .authenticate(&req.agent_id, &req.method_id)
                .await?;
            let bootstrap = reply_rx
                .await
                .map_err(|_| anyhow::anyhow!("Authentication channel dropped"))??;
            state
                .acp_manager
                .lock()
                .await
                .set_session_id(&req.agent_id, bootstrap.session_id.clone());
            Ok(json!({
                "success": true,
                "agent_id": req.agent_id,
                "session_id": bootstrap.session_id.to_string(),
            }))
        }
        "acp:prompt" => {
            let mut req: AcpPromptRequest = serde_json::from_value(params)?;
            let project_root = if let Some(wt) = state
                .agent_worktrees
                .lock()
                .await
                .get(&req.agent_id)
                .cloned()
            {
                wt.path
            } else {
                let project_id = state
                    .agent_project_ids
                    .lock()
                    .await
                    .get(&req.agent_id)
                    .cloned()
                    .ok_or_else(|| anyhow::anyhow!("Agent {} not found", req.agent_id))?;
                let project = state
                    .workspace
                    .lock()
                    .await
                    .get(&project_id)
                    .ok_or_else(|| anyhow::anyhow!("Agent project is no longer available"))?;
                PathBuf::from(project.info.root)
            };
            prepare_prompt_attachments(&req.prompt, &project_root, &mut req.attachments);
            let mut acp_manager = state.acp_manager.lock().await;
            let agent = acp_manager
                .get_agent(&req.agent_id)
                .ok_or_else(|| anyhow::anyhow!("Agent {} not found", req.agent_id))?;
            let queued_id = agent.send_prompt(req.prompt, req.attachments).await?;
            Ok(json!({ "success": true, "id": queued_id }))
        }
        "acp:cancel" => {
            let req: AcpCancelRequest = serde_json::from_value(params)?;
            state.acp_manager.lock().await.cancel_prompt(&req.agent_id).await?;
            Ok(json!({ "success": true }))
        }
        "acp:stop" => {
            let req: AcpStopRequest = serde_json::from_value(params)?;
            if let Some(sink) = sink {
                sink.unsubscribe_agent(&req.agent_id).await;
            }
            {
                let mut sockets_data = state.socket2data.lock().await;
                for socket_data in sockets_data.values_mut() {
                    if let Some(tok) = socket_data.acp_subscribers.remove(&req.agent_id) {
                        tok.cancel();
                    }
                }
            }
            state.acp_manager.lock().await.stop_agent(&req.agent_id).await;
            state.agent_project_ids.lock().await.remove(&req.agent_id);
            state.agent_worktrees.lock().await.remove(&req.agent_id);
            Ok(json!({ "success": true }))
        }
        "acp:set_model" => {
            let req: AcpSetConfigRequest = serde_json::from_value(params)?;
            state
                .acp_manager
                .lock()
                .await
                .set_model(&req.agent_id, req.option)
                .await?;
            Ok(json!({ "success": true }))
        }
        "acp:set_reasoning" => {
            let req: AcpSetConfigRequest = serde_json::from_value(params)?;
            state
                .acp_manager
                .lock()
                .await
                .set_reasoning(&req.agent_id, req.option)
                .await?;
            Ok(json!({ "success": true }))
        }
        "acp:undo" => {
            let req: AcpUndoRequest = serde_json::from_value(params)?;
            let acp_manager = state.acp_manager.lock().await;
            if let Some(checkpoint_id) = req.checkpoint_id {
                acp_manager
                    .restore_to_checkpoint_id(&req.agent_id, &checkpoint_id)
                    .await?;
            } else if let Some(prompt) = req.prompt {
                acp_manager.restore_to_prompt(&req.agent_id, &prompt).await?;
            } else {
                anyhow::bail!("Missing checkpoint_id or prompt");
            }
            Ok(json!({ "success": true }))
        }
        "acp:get_tool_output" => {
            let req: AcpGetToolOutputRequest = serde_json::from_value(params)?;
            let acp_db = state.acp_db.clone();
            let tool_id = req.tool_id.clone();
            let output = tokio::task::spawn_blocking(move || acp_db.get_tool_output(&tool_id))
                .await??;
            match output {
                Some(output) => Ok(json!({
                    "success": true,
                    "tool_id": req.tool_id,
                    "session_id": req.session_id,
                    "output": output
                })),
                None => anyhow::bail!("Tool output not found in database"),
            }
        }
        "acp:queue:update" => {
            let req: AcpQueueUpdateRequest = serde_json::from_value(params)?;
            let success = state
                .acp_manager
                .lock()
                .await
                .update_agent_queued_prompt(&req.agent_id, &req.item_id, req.prompt)
                .await;
            Ok(json!({ "success": success }))
        }
        "acp:queue:remove" => {
            let req: AcpQueueRemoveRequest = serde_json::from_value(params)?;
            let success = state
                .acp_manager
                .lock()
                .await
                .remove_agent_queued_prompt(&req.agent_id, &req.item_id)
                .await;
            Ok(json!({ "success": success }))
        }
        "acp:queue:move" => {
            let req: AcpQueueMoveRequest = serde_json::from_value(params)?;
            let success = state
                .acp_manager
                .lock()
                .await
                .move_agent_queued_prompt(&req.agent_id, &req.item_id, &req.direction)
                .await;
            Ok(json!({ "success": success }))
        }
        "acp:queue:send_now" => {
            let req: AcpQueueSendNowRequest = serde_json::from_value(params)?;
            let success = state
                .acp_manager
                .lock()
                .await
                .send_agent_queued_prompt_now(&req.agent_id, &req.item_id)
                .await;
            Ok(json!({ "success": success }))
        }
        _ => anyhow::bail!("Unknown node method: {}", method),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_profile_dir_name() {
        assert_eq!(
            sanitize_profile_dir_name("alpha-acp-work").unwrap(),
            "alpha-acp-work"
        );
        assert!(sanitize_profile_dir_name("../etc").is_err());
        assert!(sanitize_profile_dir_name("a/b").is_err());
        assert!(sanitize_profile_dir_name("").is_err());
    }

    #[test]
    fn test_upsert_agent_in_config_file_inserts_and_updates() {
        let dir = tempfile::tempdir().unwrap();
        let cfg_path = dir.path().join("agents.json");

        let cfg1 = upsert_agent_in_config_file(
            &cfg_path,
            json!({ "id": "agent-1", "name": "One", "command": "/bin/a" }),
        )
        .unwrap();
        assert_eq!(cfg1.agents.len(), 1);

        let cfg2 = upsert_agent_in_config_file(
            &cfg_path,
            json!({ "id": "agent-2", "name": "Two", "command": "/bin/b" }),
        )
        .unwrap();
        assert_eq!(cfg2.agents.len(), 2);

        let cfg3 = upsert_agent_in_config_file(
            &cfg_path,
            json!({ "id": "agent-1", "name": "One Updated", "command": "/bin/c" }),
        )
        .unwrap();
        assert_eq!(cfg3.agents.len(), 2);
        assert_eq!(cfg3.agents[0]["command"], "/bin/c");
    }

    #[test]
    fn test_remove_agent_from_config_file_respects_shared_profiles() {
        let dir = tempfile::tempdir().unwrap();
        let cfg_path = dir.path().join("agents.json");

        upsert_agent_in_config_file(
            &cfg_path,
            json!({
                "id": "agent-work",
                "command": "/bin/a",
                "env": { "GEMINI_HOME": "~/.anycode/profiles/shared-prof" }
            }),
        )
        .unwrap();
        upsert_agent_in_config_file(
            &cfg_path,
            json!({
                "id": "agent-alias",
                "command": "/bin/a",
                "env": { "GEMINI_HOME": "~/.anycode/profiles/shared-prof" }
            }),
        )
        .unwrap();
        upsert_agent_in_config_file(
            &cfg_path,
            json!({
                "id": "agent-solo",
                "command": "/bin/b",
                "env": { "CODEX_HOME": "~/.anycode/profiles/solo-prof" }
            }),
        )
        .unwrap();

        // Removing agent-work keeps shared-prof because agent-alias still uses it.
        let (removed, cfg_after_first, orphans) =
            remove_agent_from_config_file(&cfg_path, "agent-work", None).unwrap();
        assert!(removed);
        assert_eq!(cfg_after_first.agents.len(), 2);
        assert!(orphans.is_empty());

        // Removing agent-solo marks solo-prof as unreferenced.
        let (removed2, cfg_after_second, orphans2) =
            remove_agent_from_config_file(&cfg_path, "agent-solo", None).unwrap();
        assert!(removed2);
        assert_eq!(cfg_after_second.agents.len(), 1);
        assert_eq!(orphans2, vec!["solo-prof".to_string()]);
    }
}

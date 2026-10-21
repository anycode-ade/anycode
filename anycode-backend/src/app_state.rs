use crate::acp::AcpManager;
use crate::acp_fs;
use crate::code::Code;
use crate::config::Config;
use crate::git::{GitManager, SearchHistorySessionCommand};
use crate::lsp::LspManager;
use crate::search::FileSearchResult;
use crate::terminal::Terminal;
use anyhow::{Result, anyhow};
use lsp_types::PublishDiagnosticsParams;
use socketioxide::extract::{SocketRef, State};
use std::collections::HashSet;
use std::collections::hash_map::{Entry, HashMap};
use std::{collections::VecDeque, sync::Arc};
use tokio::sync::{Mutex, mpsc};
use tokio_util::sync::CancellationToken;
use std::path::PathBuf;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub file2code: Arc<Mutex<HashMap<String, Code>>>,
    pub lsp_manager: Arc<Mutex<LspManager>>,
    pub acp_manager: Arc<Mutex<AcpManager>>,
    pub git_manager: Arc<Mutex<GitManager>>,
    pub acp_registry: Arc<crate::acp_registry::AcpRegistryManager>,
    pub socket2data: Arc<Mutex<HashMap<String, SocketData>>>,
    pub terminals: Arc<Mutex<HashMap<String, TerminalData>>>,
    pub agent_project_ids: Arc<Mutex<HashMap<String, String>>>,
    pub acp_db: Arc<crate::acp_db::AcpDb>,
    pub auth_token: Option<String>,
    pub workspace: Arc<Mutex<crate::workspace::WorkspaceManager>>,
    pub workspace_lifecycle: Arc<Mutex<()>>,
    pub watcher_control: Arc<std::sync::Mutex<Option<tokio::sync::mpsc::UnboundedSender<crate::background_tasks::ProjectWatchCommand>>>>,
}

#[derive(Clone, Default)]
pub struct SocketData {
    pub opened_files: HashSet<String>,
    pub opened_dirs: HashSet<String>,
    pub search_cancel: Option<CancellationToken>,
    pub search_pattern: Option<String>,
    pub search_project_id: Option<String>,
    pub search_last_file_result: Option<FileSearchResult>,
    pub files_search_cancel: Option<CancellationToken>,
    pub git_history_search: Option<ActiveGitHistorySearch>,
    pub active_project_id: Option<String>,
    pub acp_subscribers: HashMap<String, CancellationToken>,
}

impl SocketData {
    pub fn select_project(&mut self, project_id: String) {
        self.active_project_id = Some(project_id);
    }
}

fn active_project_for_socket(data: &mut SocketData, fallback: Option<String>) -> Option<String> {
    if data.active_project_id.is_none() {
        data.active_project_id = fallback;
    }
    data.active_project_id.clone()
}

#[derive(Clone)]
pub struct TerminalData {
    pub terminal: Arc<Terminal>,
    pub sockets: Arc<Mutex<Vec<SocketRef>>>,
    pub buffer: Arc<Mutex<VecDeque<String>>>,
    pub project_id: String,
}

impl AppState {
    pub fn new(
        diagnostic_tx: mpsc::Sender<PublishDiagnosticsParams>,
        acp_fs_tx: mpsc::Sender<acp_fs::AcpFsCommand>,
        auth_token: Option<String>,
    ) -> Self {
        Self::new_with_startup_root(
            diagnostic_tx,
            acp_fs_tx,
            auth_token,
            crate::utils::current_dir(),
        )
    }

    pub fn new_with_startup_root(
        diagnostic_tx: mpsc::Sender<PublishDiagnosticsParams>,
        acp_fs_tx: mpsc::Sender<acp_fs::AcpFsCommand>,
        auth_token: Option<String>,
        startup_root: PathBuf,
    ) -> Self {
        Self::new_with_workspace(
            diagnostic_tx,
            acp_fs_tx,
            auth_token,
            startup_root,
            true,
        )
    }

    pub fn new_for_server(
        diagnostic_tx: mpsc::Sender<PublishDiagnosticsParams>,
        acp_fs_tx: mpsc::Sender<acp_fs::AcpFsCommand>,
        auth_token: Option<String>,
        startup_root: PathBuf,
        add_startup_when_empty: bool,
    ) -> Self {
        Self::new_with_workspace(
            diagnostic_tx,
            acp_fs_tx,
            auth_token,
            startup_root,
            add_startup_when_empty,
        )
    }

    fn new_with_workspace(
        diagnostic_tx: mpsc::Sender<PublishDiagnosticsParams>,
        acp_fs_tx: mpsc::Sender<acp_fs::AcpFsCommand>,
        auth_token: Option<String>,
        startup_root: PathBuf,
        add_startup_when_empty: bool,
    ) -> Self {
        let config = crate::config::get();

        let db_path = dirs::home_dir()
            .unwrap_or_else(|| startup_root.clone())
            .join(".anycode")
            .join("agent.db");
        let acp_db = match crate::acp_db::AcpDb::new(&db_path) {
            Ok(db) => Arc::new(db),
            Err(e) => {
                tracing::error!("Failed to open agent.db: {}, falling back to in-memory", e);
                Arc::new(crate::acp_db::AcpDb::in_memory().expect("in-memory db fallback"))
            }
        };

        let mut lsp_manager = LspManager::new_with_root(config.clone(), startup_root.clone());
        lsp_manager.set_diagnostics_sender(diagnostic_tx.clone());

        let acp_manager = AcpManager::new(acp_fs_tx, Some(acp_db.clone()));
        let acp_registry = crate::acp_registry::AcpRegistryManager::new();
        let workspace = if add_startup_when_empty {
            crate::workspace::WorkspaceManager::new(
                startup_root.clone(),
                config.clone(),
                diagnostic_tx.clone(),
            )
        } else {
            crate::workspace::WorkspaceManager::new_empty(
                startup_root.clone(),
                config.clone(),
                diagnostic_tx,
            )
        };
        let mut git_manager = GitManager::new(startup_root);
        let _ = git_manager.refresh_status_cache();

        Self {
            config: Arc::new(config),
            file2code: Arc::new(Mutex::new(HashMap::new())),
            lsp_manager: Arc::new(Mutex::new(lsp_manager)),
            acp_manager: Arc::new(Mutex::new(acp_manager)),
            git_manager: Arc::new(Mutex::new(git_manager)),
            acp_registry: Arc::new(acp_registry),
            socket2data: Arc::new(Mutex::new(HashMap::new())),
            terminals: Arc::new(Mutex::new(HashMap::new())),
            agent_project_ids: Arc::new(Mutex::new(HashMap::new())),
            acp_db,
            auth_token,
            workspace: Arc::new(Mutex::new(workspace)),
            workspace_lifecycle: Arc::new(Mutex::new(())),
            watcher_control: Arc::new(std::sync::Mutex::new(None)),
        }
    }

    pub fn is_auth_required(&self) -> bool {
        self.auth_token.is_some()
    }

    pub fn is_token_valid(&self, candidate: Option<&str>) -> bool {
        match &self.auth_token {
            None => true,
            Some(expected) => match candidate {
                Some(cand) => cand == expected,
                None => false,
            },
        }
    }

    pub async fn active_project_id(&self, socket_id: &str) -> Option<String> {
        let fallback = self.workspace.lock().await.default_project_id();
        let mut sockets = self.socket2data.lock().await;
        let data = sockets
            .entry(socket_id.to_string())
            .or_insert_with(SocketData::default);
        active_project_for_socket(data, fallback)
    }

    pub async fn project_for_socket(
        &self,
        socket_id: &str,
    ) -> Option<crate::workspace::Project> {
        let project_id = self.active_project_id(socket_id).await?;
        self.workspace.lock().await.get(&project_id)
    }

    pub async fn project_for_path(&self, path: &str) -> Option<crate::workspace::Project> {
        self.workspace
            .lock()
            .await
            .find_project_for_path(std::path::Path::new(path))
    }

    pub async fn resolve_path_for_socket(
        &self,
        socket_id: &str,
        input: &str,
    ) -> Result<String> {
        let requested = PathBuf::from(input);
        let (path, relative_scope) = if requested.is_absolute() {
            (requested, None)
        } else {
            let project = self
                .project_for_socket(socket_id)
                .await
                .ok_or_else(|| anyhow!("Select a project before using relative file paths"))?;
            (
                PathBuf::from(project.info.root).join(requested),
                Some(project.info.id),
            )
        };
        let path = crate::utils::abs_file(&path.to_string_lossy())?;
        let project = self
            .workspace
            .lock()
            .await
            .find_project_for_path(std::path::Path::new(&path))
            .ok_or_else(|| anyhow!("File is not part of an open project"))?;
        if relative_scope.as_deref().is_some_and(|id| id != project.info.id) {
            return Err(anyhow!("File is not part of an open project"));
        }
        Ok(path)
    }

    pub async fn lsp_for_path(
        &self,
        path: &str,
    ) -> Arc<Mutex<LspManager>> {
        self.project_for_path(path)
            .await
            .map(|project| project.lsp)
            .unwrap_or_else(|| self.lsp_manager.clone())
    }

    pub async fn git_for_path(
        &self,
        path: &str,
    ) -> Arc<Mutex<GitManager>> {
        self.project_for_path(path)
            .await
            .map(|project| project.git)
            .unwrap_or_else(|| self.git_manager.clone())
    }

    pub async fn send_project_watch_command(
        &self,
        command: impl FnOnce(tokio::sync::oneshot::Sender<std::result::Result<(), String>>) -> crate::background_tasks::ProjectWatchCommand,
    ) -> Result<()> {
        let (reply, response) = tokio::sync::oneshot::channel();
        if let Ok(control) = self.watcher_control.lock() {
            if let Some(sender) = control.as_ref() {
                sender
                    .send(command(reply))
                    .map_err(|_| anyhow!("Project watcher has stopped"))?;
            } else {
                return Err(anyhow!("Project watcher is not ready"));
            }
        } else {
            return Err(anyhow!("Project watcher is unavailable"));
        }
        response
            .await
            .map_err(|_| anyhow!("Project watcher did not acknowledge the change"))?
            .map_err(|error| anyhow!("{error}"))
    }

    pub async fn shutdown(&self) {
        self.lsp_manager.lock().await.stop_all().await;
        let projects = self.workspace.lock().await.projects();
        for info in projects {
            if let Some(project) = self.workspace.lock().await.get(&info.id) {
                project.lsp.lock().await.stop_all().await;
            }
        }
        self.acp_manager.lock().await.stop_all().await;

        let terminal_handles = self
            .terminals
            .lock()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();

        for terminal in terminal_handles {
            let _ = terminal.terminal.kill().await;
        }
    }

}

#[macro_export]
macro_rules! error_ack {
    ($ack:expr, $path:expr, $msg:expr $(, $args:expr)*) => {{
        let message = format!($msg $(, $args)*);
        error!("{}", message);
        let response = json!({ "error": message, "path": $path, "success": false });
        let _ = $ack.send(&response);
        return;
    }};
}

/// Helper: send response based on Result
/// Used with _impl pattern: handler calls send_response(ack, some_impl())
/// where some_impl() returns anyhow::Result<Value> and can use ? operator with .context()
pub fn send_response(
    ack: socketioxide::extract::AckSender,
    result: anyhow::Result<serde_json::Value>,
) {
    use serde_json::json;
    match result {
        Ok(data) => {
            let mut response = data;
            if let Some(obj) = response.as_object_mut() {
                obj.insert("success".to_string(), json!(true));
            }
            ack.send(&response).ok();
        }
        Err(e) => {
            ack.send(&json!({ "success": false, "error": format!("{:#}", e) }))
                .ok();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{SocketData, active_project_for_socket};

    #[test]
    fn active_project_selection_is_independent_per_socket() {
        let mut first_client = SocketData::default();
        let mut second_client = SocketData::default();
        first_client.select_project("project-b".to_string());

        assert_eq!(
            active_project_for_socket(&mut first_client, Some("project-a".to_string())),
            Some("project-b".to_string())
        );
        assert_eq!(
            active_project_for_socket(&mut second_client, Some("project-a".to_string())),
            Some("project-a".to_string())
        );
    }
}

pub fn get_or_create_code<'a>(
    f2c: &'a mut HashMap<String, Code>,
    path: &str,
    config: &Config,
) -> Result<&'a mut Code> {
    match f2c.entry(path.to_string()) {
        Entry::Occupied(o) => Ok(o.into_mut()),
        Entry::Vacant(v) => {
            let c = Code::from_file(path, config)
                .map_err(|e| anyhow!("Failed to load file {}: {:?}", path, e))?;
            Ok(v.insert(c))
        }
    }
}

/// Check if a language has any opened files across all sockets
pub async fn is_language_opened(lang: &str, state: &State<AppState>) -> bool {
    let sockets_data = state.socket2data.lock().await;
    let all_opened_files: Vec<String> = sockets_data
        .values()
        .flat_map(|data| data.opened_files.iter())
        .cloned()
        .collect();

    let f2c = state.file2code.lock().await;
    all_opened_files.iter().any(|file_path| {
        f2c.get(file_path)
            .map(|code| code.lang == lang)
            .unwrap_or(false)
    })
}

pub async fn is_language_opened_in_project(
    lang: &str,
    project: &crate::workspace::Project,
    state: &State<AppState>,
) -> bool {
    let root = std::path::Path::new(&project.info.root);
    let sockets_data = state.socket2data.lock().await;
    let opened_files = sockets_data
        .values()
        .flat_map(|data| data.opened_files.iter())
        .filter(|path| std::path::Path::new(path).starts_with(root))
        .collect::<Vec<_>>();
    let file2code = state.file2code.lock().await;
    opened_files.iter().any(|path| {
        file2code
            .get(*path)
            .map(|code| code.lang == lang)
            .unwrap_or(false)
    })
}

#[derive(Clone)]
pub struct ActiveGitHistorySearch {
    pub sender: mpsc::UnboundedSender<SearchHistorySessionCommand>,
    pub cancel: CancellationToken,
}

impl SocketData {
    pub fn replace_git_history_search(&mut self, active: ActiveGitHistorySearch) {
        if let Some(active) = self.git_history_search.replace(active) {
            active.cancel.cancel();
            let _ = active.sender.send(SearchHistorySessionCommand::Cancel);
        }
    }

    pub fn cancel_git_history_search(&mut self) -> bool {
        if let Some(active) = self.git_history_search.take() {
            active.cancel.cancel();
            let _ = active.sender.send(SearchHistorySessionCommand::Cancel);
            true
        } else {
            false
        }
    }
}

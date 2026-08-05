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

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub file2code: Arc<Mutex<HashMap<String, Code>>>,
    pub lsp_manager: Arc<Mutex<LspManager>>,
    pub acp_manager: Arc<Mutex<AcpManager>>,
    pub git_manager: Arc<Mutex<GitManager>>,
    pub socket2data: Arc<Mutex<HashMap<String, SocketData>>>,
    pub terminals: Arc<Mutex<HashMap<String, TerminalData>>>,
}

#[derive(Clone, Default)]
pub struct SocketData {
    pub opened_files: HashSet<String>,
    pub opened_dirs: HashSet<String>,
    pub search_cancel: Option<CancellationToken>,
    pub search_pattern: Option<String>,
    pub search_last_file_result: Option<FileSearchResult>,
    pub files_search_cancel: Option<CancellationToken>,
    pub git_history_search: Option<ActiveGitHistorySearch>,
}

#[derive(Clone)]
pub struct TerminalData {
    pub terminal: Arc<Terminal>,
    pub sockets: Arc<Mutex<Vec<SocketRef>>>,
    pub buffer: Arc<Mutex<VecDeque<String>>>,
}

impl AppState {
    pub fn new(
        diagnostic_tx: mpsc::Sender<PublishDiagnosticsParams>,
        acp_fs_tx: mpsc::Sender<acp_fs::AcpFsCommand>,
    ) -> Self {
        let config = crate::config::get();

        let mut lsp_manager = LspManager::new(config.clone());
        lsp_manager.set_diagnostics_sender(diagnostic_tx);

        let acp_manager = AcpManager::new(acp_fs_tx);
        let mut git_manager = GitManager::new(crate::utils::current_dir());
        let _ = git_manager.refresh_status_cache();

        Self {
            config: Arc::new(config),
            file2code: Arc::new(Mutex::new(HashMap::new())),
            lsp_manager: Arc::new(Mutex::new(lsp_manager)),
            acp_manager: Arc::new(Mutex::new(acp_manager)),
            git_manager: Arc::new(Mutex::new(git_manager)),
            socket2data: Arc::new(Mutex::new(HashMap::new())),
            terminals: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn shutdown(&self) {
        self.lsp_manager.lock().await.stop_all().await;
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

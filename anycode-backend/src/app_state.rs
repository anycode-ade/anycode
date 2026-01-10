use std::{collections::VecDeque, sync::Arc};
use tokio::sync::Mutex;
use crate::code::Code;
use crate::config::Config;
use crate::lsp::LspManager;
use crate::acp::AcpManager;
use socketioxide::{extract::{SocketRef, State}};
use std::collections::HashSet;
use tokio_util::sync::CancellationToken;
use crate::terminal::Terminal;
use std::collections::hash_map::{HashMap, Entry};
use anyhow::{Result, anyhow};


#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub file2code: Arc<Mutex<HashMap<String, Code>>>,
    pub lsp_manager: Arc<Mutex<LspManager>>,
    pub acp_manager: Arc<Mutex<AcpManager>>,
    pub socket2data: Arc<Mutex<HashMap<String, SocketData>>>,
    pub terminals: Arc<Mutex<HashMap<String, TerminalData>>>,
}

#[derive(Clone, Default)]
pub struct SocketData {
    pub opened_files: HashSet<String>,
    pub opened_dirs: HashSet<String>,
    pub search_cancel: Option<CancellationToken>,
}

#[derive(Clone)]
pub struct TerminalData {
    pub terminal: Arc<Terminal>,
    pub sockets: Arc<Mutex<Vec<SocketRef>>>,
    pub buffer: Arc<Mutex<VecDeque<String>>>,
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

/// Get languages for files opened by a socket
/// Returns None if socket was not found
pub async fn get_socket_languages(
    socket_id: &str, state: &State<AppState>,
) -> Option<HashSet<String>> {
    let sockets_data = state.socket2data.lock().await;
    let socket_data = sockets_data.get(socket_id)?;
    
    let f2c = state.file2code.lock().await;
    Some(socket_data.opened_files.iter()
        .filter_map(|path| f2c.get(path).map(|code| code.lang.clone()))
        .collect::<HashSet<_>>())
}

/// Check if a language has any opened files across all sockets
pub async fn is_language_opened(
    lang: &str, state: &State<AppState>,
) -> bool {
    let sockets_data = state.socket2data.lock().await;
    let all_opened_files: Vec<String> = sockets_data.values()
        .flat_map(|data| data.opened_files.iter())
        .cloned().collect();
    
    let f2c = state.file2code.lock().await;
    all_opened_files.iter().any(|file_path| {
        f2c.get(file_path)
            .map(|code| code.lang == lang)
            .unwrap_or(false)
    })
}

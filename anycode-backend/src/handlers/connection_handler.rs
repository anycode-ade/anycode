use std::collections::HashSet;

use socketioxide::extract::{SocketRef, State};
use tracing::{error, info};

use crate::app_state::{AppState, is_language_opened};
use crate::handlers::{
    acp_handler::*, git_handler::*, io_handler::*, lsp_handler::*, search_handler::*,
    terminal_handler::*, theme_handler::*,
};

pub async fn handle_connect(socket: SocketRef, _state: State<AppState>) {
    info!("Socket.IO connected: {:?} {:?}", socket.ns(), socket.id);

    socket.on("file:open", handle_file_open);
    socket.on("dir:list", handle_dir_list);
    socket.on("search:files:start", handle_files_search);
    socket.on("search:files:cancel", handle_files_search_cancel);
    socket.on("file:change", handle_file_change);
    socket.on("file:save", handle_file_save);
    socket.on("file:create", handle_create);
    socket.on("file:close", handle_file_close);
    socket.on("file:delete", handle_delete);
    socket.on("file:rename", handle_rename);

    socket.on("lsp:completion", handle_completion);
    socket.on("lsp:definition", handle_definition);
    socket.on("lsp:references", handle_references);
    socket.on("lsp:hover", handle_hover);

    socket.on("search:start", handle_search);
    socket.on("search:cancel", handle_search_cancel);

    socket.on("terminal:start", handle_terminal_start);
    socket.on("terminal:input", handle_terminal_input);
    socket.on("terminal:resize", handle_terminal_resize);
    socket.on("terminal:close", handle_terminal_close);
    socket.on("terminal:reconnect", handle_terminal_reconnect);

    socket.on("acp:start", handle_acp_start);
    socket.on("acp:prompt", handle_acp_prompt);
    socket.on("acp:stop", handle_acp_stop);
    socket.on("acp:cancel", handle_acp_cancel);
    socket.on("acp:set_model", handle_acp_set_model);
    socket.on("acp:set_reasoning", handle_acp_set_reasoning);
    socket.on("acp:list", handle_acp_list);
    socket.on("acp:sessions_list", handle_acp_sessions_list);
    socket.on("acp:reconnect", handle_acp_reconnect);
    socket.on("acp:undo", handle_acp_undo);

    socket.on("git:status", handle_git_status);
    socket.on("git:file-original", handle_git_file_original);
    socket.on("git:history", handle_git_history);
    socket.on("git:history-search", handle_git_history_search);
    socket.on(
        "git:history-search-cancel",
        handle_git_history_search_cancel,
    );
    socket.on("git:history-files", handle_git_history_files);
    socket.on("git:history-file", handle_git_history_file);
    socket.on("git:commit", handle_git_commit);
    socket.on("git:push", handle_git_push);
    socket.on("git:pull", handle_git_pull);
    socket.on("git:branches", handle_git_branches);
    socket.on("git:checkout", handle_git_checkout);
    socket.on("git:revert", handle_git_revert);
    socket.on("git:stage", handle_git_stage);
    socket.on("git:unstage", handle_git_unstage);
    socket.on("git:diff-raw", handle_git_diff_raw);
    socket.on("git:commit-diff-raw", handle_git_commit_diff_raw);

    socket.on("theme:list", handle_theme_list);
    socket.on("theme:get", handle_theme_get);
    socket.on_disconnect(handle_disconnect)
}

pub async fn handle_disconnect(socket: SocketRef, state: State<AppState>) {
    info!("Socket.IO disconnected: {}", socket.id);

    let sid = socket.id.as_str().to_string();

    // Remove per-socket state and cooperatively stop all active searches.
    let opened_files = {
        let mut sockets_data = state.socket2data.lock().await;
        match sockets_data.remove(&sid) {
            Some(mut socket_data) => {
                if let Some(cancel) = socket_data.search_cancel.take() {
                    cancel.cancel();
                }
                if let Some(cancel) = socket_data.files_search_cancel.take() {
                    cancel.cancel();
                }
                socket_data.cancel_git_history_search();
                socket_data.opened_files
            }
            None => return,
        }
    };

    // Get languages for files opened by this socket
    let languages = {
        let f2c = state.file2code.lock().await;
        opened_files
            .iter()
            .filter_map(|path| f2c.get(path).map(|code| code.lang.clone()))
            .collect::<HashSet<_>>()
    };

    // Spawn a delayed task to clean up files and LSP servers (5-second grace period)
    tokio::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;

        // Get all opened files from remaining active sockets
        let all_opened_files: HashSet<String> = {
            let sockets_data = state.socket2data.lock().await;
            sockets_data
                .values()
                .flat_map(|data| data.opened_files.iter())
                .cloned()
                .collect()
        };

        // Clean up files that are no longer opened by any socket
        let files_to_close: Vec<(String, String)> = {
            let f2c = state.file2code.lock().await;
            opened_files
                .iter()
                .filter(|path| !all_opened_files.contains(*path))
                .filter_map(|path| f2c.get(path).map(|code| (path.clone(), code.lang.clone())))
                .collect()
        };

        // Close files (notify LSP didClose)
        if !files_to_close.is_empty() {
            let mut lsp_manager = state.lsp_manager.lock().await;
            for (file_path, lang) in &files_to_close {
                if let Some(lsp) = lsp_manager.get(lang).await {
                    if let Err(e) = lsp.did_close(file_path) {
                        error!("Failed to notify LSP didClose for {}: {:?}", file_path, e);
                    }
                }
            }
        }

        // Stop LSP servers for languages that have no files opened by other active sockets
        for lang in languages {
            if !is_language_opened(&lang, &state).await {
                info!("Lsp autoclose after grace period: '{}'", lang);
                let mut lsp_manager = state.lsp_manager.lock().await;
                lsp_manager.stop(&lang).await;
            }
        }
    });
}

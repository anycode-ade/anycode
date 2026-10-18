use std::collections::HashSet;

use socketioxide::extract::{SocketRef, State};
use tracing::{error, info};

use crate::app_state::AppState;
use crate::handlers::{
    acp_handler::*, acp_registry_handler::*, git_handler::*, io_handler::*, lsp_handler::*, search_handler::*,
    terminal_handler::*, theme_handler::*, workspace_handler::*,
};

pub async fn handle_connect(socket: SocketRef, state: State<AppState>) {
    info!("Socket.IO connected: {:?} {:?}", socket.ns(), socket.id);
    let default_project_id = state.workspace.lock().await.default_project_id();
    state
        .socket2data
        .lock()
        .await
        .entry(socket.id.as_str().to_string())
        .or_default()
        .active_project_id = default_project_id;

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
    socket.on("acp:authenticate", handle_acp_authenticate);
    socket.on("acp:prompt", handle_acp_prompt);
    socket.on("acp:queue:update", handle_acp_queue_update);
    socket.on("acp:queue:remove", handle_acp_queue_remove);
    socket.on("acp:queue:move", handle_acp_queue_move);
    socket.on("acp:stop", handle_acp_stop);
    socket.on("acp:stop_all", handle_acp_stop_all);
    socket.on("acp:cancel", handle_acp_cancel);
    socket.on("acp:set_model", handle_acp_set_model);
    socket.on("acp:set_reasoning", handle_acp_set_reasoning);
    socket.on("acp:list", handle_acp_list);
    socket.on("acp:sessions_list", handle_acp_sessions_list);
    socket.on("acp:reconnect", handle_acp_reconnect);
    socket.on("acp:undo", handle_acp_undo);
    socket.on("acp:get_tool_output", handle_acp_get_tool_output);

    socket.on("acp:registry:list", handle_acp_registry_list);
    socket.on("acp:registry:install", handle_acp_registry_install);
    socket.on("acp:registry:cancel", handle_acp_registry_cancel);
    socket.on("acp:registry:uninstall", handle_acp_registry_uninstall);

    socket.on("acp:agents:get", handle_acp_agents_get);
    socket.on("acp:agents:save", handle_acp_agents_save);

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
    socket.on("git:fetch", handle_git_fetch);
    socket.on("git:branches", handle_git_branches);
    socket.on("git:checkout", handle_git_checkout);
    socket.on("git:create_branch", handle_git_create_branch);
    socket.on("git:revert", handle_git_revert);
    socket.on("git:stage", handle_git_stage);
    socket.on("git:unstage", handle_git_unstage);

    socket.on("workspace:state", handle_workspace_state);
    socket.on("workspace:browse", handle_workspace_browse);
    socket.on("workspace:add-project", handle_workspace_add_project);
    socket.on("workspace:remove-project", handle_workspace_remove_project);
    socket.on("workspace:remove-recent", handle_workspace_remove_recent);
    socket.on("workspace:select-project", handle_workspace_select_project);
    socket.on("workspace:close", handle_workspace_close);
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

        // Close files using the LSP manager that owns each file's project root.
        for (file_path, lang) in &files_to_close {
            let lsp_manager = state.lsp_for_path(file_path).await;
            let mut lsp_manager = lsp_manager.lock().await;
            if let Some(lsp) = lsp_manager.get(lang).await {
                if let Err(e) = lsp.did_close(file_path) {
                    error!("Failed to notify LSP didClose for {}: {:?}", file_path, e);
                }
            }
        }

        // Stop a language server only when that project has no remaining open files.
        let mut project_languages = std::collections::HashMap::<String, HashSet<String>>::new();
        for path in &opened_files {
            let lang = state
                .file2code
                .lock()
                .await
                .get(path)
                .map(|code| code.lang.clone());
            let Some(lang) = lang else { continue };
            if let Some(project) = state.project_for_path(path).await {
                project_languages
                    .entry(project.info.id)
                    .or_default()
                    .insert(lang);
            }
        }
        for (project_id, languages) in project_languages {
            let project = state.workspace.lock().await.get(&project_id);
            let Some(project) = project else { continue };
            for lang in languages {
                let root = std::path::Path::new(&project.info.root);
                let has_open_file = {
                    let sockets_data = state.socket2data.lock().await;
                    let opened: Vec<String> = sockets_data
                        .values()
                        .flat_map(|data| data.opened_files.iter().cloned())
                        .collect();
                    let f2c = state.file2code.lock().await;
                    opened.iter().any(|path| {
                        std::path::Path::new(path).starts_with(root)
                            && f2c.get(path).is_some_and(|code| code.lang == lang)
                    })
                };
                if !has_open_file {
                    info!("Lsp autoclose after grace period: '{}' in {}", lang, project.info.root);
                    project.lsp.lock().await.stop(&lang).await;
                }
            }
        }
    });
}

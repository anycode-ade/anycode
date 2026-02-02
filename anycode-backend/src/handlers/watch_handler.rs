use std::path::PathBuf;
use std::sync::Arc;
use std::collections::HashMap;
use std::time::{Instant, Duration};
use tokio::sync::Mutex;
use tokio::time::sleep;
use serde_json::json;
use tracing::info;
use anyhow::Result;

use crate::app_state::SocketData;
use crate::code::Code;
use crate::diff::compute_text_edits;

#[derive(Clone, Debug, PartialEq)]
enum FileState {
    Exists,
    DoesNotExist,
}

pub struct FileWatchState {
    pub state: FileState,
    pub last_event_time: Instant,
}

async fn is_parent_dir_opened(
    path: &PathBuf,
    socket2data: &Arc<Mutex<HashMap<String, SocketData>>>
) -> bool {
    if let Some(parent) = path.parent() {
        if let Some(parent_str) = parent.to_str() {
            let sockets_data = socket2data.lock().await;
            return sockets_data.values().any(|data| {
                data.opened_dirs.contains(parent_str)
            });
        }
    }
    false
}

async fn is_file_opened(
    path_str: &str,
    socket2data: &Arc<Mutex<HashMap<String, SocketData>>>
) -> bool {
    let sockets_data = socket2data.lock().await;
    sockets_data.values().any(|data| data.opened_files.contains(path_str))
}

async fn handle_create_remove_event(
    path: &PathBuf,
    path_str: &str,
    event_kind: &notify::EventKind,
    socket: &Arc<socketioxide::SocketIo>,
    socket2data: &Arc<Mutex<HashMap<String, SocketData>>>
) {
    if !is_parent_dir_opened(path, socket2data).await {
        return;
    }

    info!("watch event: {:?} for path: {:?}", event_kind, path);

    let event_name = match event_kind {
        notify::EventKind::Create(_) => "watcher:create",
        notify::EventKind::Remove(_) => "watcher:remove",
        _ => return,
    };

    let relative_path = crate::utils::relative_path(path_str);

    let _ = socket.emit(event_name, &json!({
        "path": relative_path,
        "isFile": path.is_file()
    })).await;
}

async fn handle_modify_event(
    path: &PathBuf,
    path_str: &str,
    socket: &Arc<socketioxide::SocketIo>,
    file2code: &Arc<Mutex<HashMap<String, Code>>>,
    socket2data: &Arc<Mutex<HashMap<String, SocketData>>>
) {
    if !is_file_opened(path_str, socket2data).await {
        return;
    }

    info!("watch event: {:?} for path: {:?}", "Modify", path);
    let _ = handle_file_modification(path, socket, file2code).await;
}

pub async fn handle_watch_event(
    path: &PathBuf,
    _event: &notify::Event,
    socket: &Arc<socketioxide::SocketIo>,
    file2code: &Arc<Mutex<HashMap<String, Code>>>,
    socket2data: &Arc<Mutex<HashMap<String, SocketData>>>,
    file_states: &Arc<Mutex<HashMap<String, FileWatchState>>>,
    git_manager: &Arc<Mutex<crate::git::GitManager>>,
) {
    let path_str = match path.to_str() {
        Some(s) => s,
        None => return,
    };

    // Debounce: ignore events if less than 100ms since the last one
    {
        let states = file_states.lock().await;
        if let Some(watch_state) = states.get(path_str) {
            if watch_state.last_event_time.elapsed() < Duration::from_millis(100) {
                info!("Debouncing event for path: {:?}", path);
                return;
            }
        }
    }

    // Wait 100ms before checking the actual state
    sleep(Duration::from_millis(100)).await;

    let current_state = if path.exists() {
        FileState::Exists
    } else {
        FileState::DoesNotExist
    };

    let last_state = {
        let mut states = file_states.lock().await;
        let watch_state = states.entry(path_str.to_string()).or_insert(FileWatchState {
            state: if path.exists() { FileState::Exists } else { FileState::DoesNotExist },
            last_event_time: Instant::now(),
        });
        let last = watch_state.state.clone();
        watch_state.last_event_time = Instant::now();
        last
    };

    info!("File state transition: {:?} -> {:?} for path: {:?}", last_state, current_state, path);

    // Only handle when the state changes
    match (&last_state, &current_state) {
        (&FileState::DoesNotExist, &FileState::Exists) => {
            // File created/restored
            handle_create_remove_event(
                path,
                path_str,
                &notify::EventKind::Create(notify::event::CreateKind::File),
                socket,
                socket2data,
            ).await;
        },
        (&FileState::Exists, &FileState::DoesNotExist) => {
            // File removed
            handle_create_remove_event(
                path,
                path_str,
                &notify::EventKind::Remove(notify::event::RemoveKind::File),
                socket,
                socket2data,
            ).await;
        },
        (&FileState::Exists, &FileState::Exists) => {
            // File exists - treat as modify
            handle_modify_event(path, path_str, socket, file2code, socket2data).await;
        },
        _ => {
            info!("Ignoring state transition: {:?} -> {:?}", last_state, current_state);
        }
    }

    // Update state
    {
        let mut states = file_states.lock().await;
        states.insert(
            path_str.to_string(),
            FileWatchState {
                state: current_state,
                last_event_time: Instant::now(),
            },
        );
    }

    // Check git status
    let should_ignore = {
        let git = git_manager.lock().await;
        git.should_ignore(path_str)
    };

    if !should_ignore {
        let new_status = {
            let mut git = git_manager.lock().await;
            git.check_status_changed()
        };

        if let Some(status) = new_status {
            // Emit to all clients
            let _ = socket.emit("git:status-update", &status.to_json()).await;
        }
    }
}

async fn handle_file_modification(
    path: &PathBuf,
    socket: &Arc<socketioxide::SocketIo>,
    file2code: &Arc<Mutex<HashMap<String, Code>>>
) -> Result<()> {
    
    let path_str = path.to_str().ok_or_else(|| anyhow::anyhow!("Invalid UTF-8 in path"))?;

    let old_text = {
        let mut f2c = file2code.lock().await;
        let code = match f2c.get_mut(path_str) {
            Some(c) => c, None => return Ok(()),
        };

        if code.self_updated {
            code.self_updated = false;
            return Ok(());
        }

        code.text.to_string()
    };

    let new_text = tokio::fs::read_to_string(path).await
        .map_err(|e| anyhow::anyhow!("Failed to read file {:?}: {}", path, e))?;

    if old_text == new_text {
        return Ok(());
    }

    let edits = compute_text_edits(&old_text, &new_text);
    if edits.is_empty() {
        return Ok(());
    }

    let file = crate::utils::relative_path(path_str);

    socket.emit("watcher:edits", &json! {{ "file": file, "edits": edits }}).await
        .map_err(|e| anyhow::anyhow!("Failed to emit edits: {}", e))?;

    Ok(())
}

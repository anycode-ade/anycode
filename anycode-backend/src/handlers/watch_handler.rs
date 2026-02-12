use std::path::PathBuf;
use std::sync::Arc;
use std::collections::HashMap;
use std::time::Duration;
use tokio::sync::{Mutex, Notify};
use serde_json::json;
use tracing::info;
use anyhow::Result;

const DEBOUNCE: Duration = Duration::from_millis(100);

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
    pub notify: Arc<Notify>,
    pub pending: bool,
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

    // For create events, path.is_file() works because the file exists.
    // For remove events, path.is_file() always returns false (file is gone),
    // so we use a heuristic: if the path has a file extension, it's a file.
    let is_file = match event_kind {
        notify::EventKind::Create(_) => path.is_file(),
        notify::EventKind::Remove(_) => path.extension().is_some(),
        _ => false,
    };

    let _ = socket.emit(event_name, &json!({
        "path": relative_path,
        "isFile": is_file
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
        Some(s) => s.to_string(),
        None => return,
    };

    let should_spawn = {
        let mut states = file_states.lock().await;
        let entry = states.entry(path_str.clone()).or_insert_with(|| FileWatchState {
            state: FileState::DoesNotExist, // never seen = didn't exist for us
            notify: Arc::new(Notify::new()),
            pending: false,
        });

        // Signal the existing task to reset its timer
        entry.notify.notify_one();

        if entry.pending {
            // A task is already waiting — it will pick up the new event
            false
        } else {
            entry.pending = true;
            true
        }
    };

    if !should_spawn {
        return;
    }

    // Spawn a single debounce task for this file
    let path = path.clone();
    let socket = socket.clone();
    let file2code = file2code.clone();
    let socket2data = socket2data.clone();
    let file_states = file_states.clone();
    let git_manager = git_manager.clone();

    // Get the notify handle for this file
    let file_notify = {
        let states = file_states.lock().await;
        states.get(&path_str).unwrap().notify.clone()
    };

    tokio::spawn(async move {
        // Wait until events stop arriving (trailing-edge debounce)
        loop {
            match tokio::time::timeout(DEBOUNCE, file_notify.notified()).await {
                Ok(_) => continue,  // new event arrived — reset timer
                Err(_) => break,    // timeout — silence, time to process
            }
        }

        process_watch_event(
            &path, &path_str, &socket, &file2code, &socket2data, &file_states, &git_manager,
        ).await;

        // Mark as not pending so future events spawn a new task
        {
            let mut states = file_states.lock().await;
            if let Some(state) = states.get_mut(&path_str) {
                state.pending = false;
            }
        }
    });
}

async fn process_watch_event(
    path: &PathBuf,
    path_str: &str,
    socket: &Arc<socketioxide::SocketIo>,
    file2code: &Arc<Mutex<HashMap<String, Code>>>,
    socket2data: &Arc<Mutex<HashMap<String, SocketData>>>,
    file_states: &Arc<Mutex<HashMap<String, FileWatchState>>>,
    git_manager: &Arc<Mutex<crate::git::GitManager>>,
) {
    let current_state = if path.exists() {
        FileState::Exists
    } else {
        FileState::DoesNotExist
    };

    let last_state = {
        let states = file_states.lock().await;
        states.get(path_str)
            .map(|s| s.state.clone())
            .unwrap_or(FileState::DoesNotExist) // never seen = didn't exist for us
    };

    info!("File state transition: {:?} -> {:?} for path: {:?}", last_state, current_state, path);

    match (&last_state, &current_state) {
        (&FileState::DoesNotExist, &FileState::Exists) => {
            handle_create_remove_event(
                path,
                path_str,
                &notify::EventKind::Create(notify::event::CreateKind::File),
                socket,
                socket2data,
            ).await;
        },
        (&FileState::Exists, &FileState::DoesNotExist) => {
            handle_create_remove_event(
                path,
                path_str,
                &notify::EventKind::Remove(notify::event::RemoveKind::File),
                socket,
                socket2data,
            ).await;
        },
        (&FileState::Exists, &FileState::Exists) => {
            handle_modify_event(path, path_str, socket, file2code, socket2data).await;
        },
        _ => {
            info!("Ignoring state transition: {:?} -> {:?}", last_state, current_state);
        }
    }

    // Update state (or remove if file was deleted to prevent memory leak)
    {
        let mut states = file_states.lock().await;
        if current_state == FileState::DoesNotExist {
            states.remove(path_str);
        } else if let Some(watch_state) = states.get_mut(path_str) {
            watch_state.state = current_state;
        }
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

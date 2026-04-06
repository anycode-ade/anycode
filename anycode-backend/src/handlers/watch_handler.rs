use anyhow::Result;
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Mutex, watch};
use tracing::info;

const DEBOUNCE: Duration = Duration::from_millis(100);

use crate::app_state::SocketData;
use crate::code::Code;
use crate::diff::compute_text_edits;
use crate::handlers::io_handler::apply_edits_to_code;
use crate::lsp::LspManager;

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
enum FileState {
    Exists,
    DoesNotExist,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
enum WatchAction {
    Create,
    Remove,
    Modify,
    Ignore,
}

pub struct FileWatchState {
    state: FileState,
    sender: watch::Sender<()>,
    pending: bool,
}

async fn is_parent_dir_opened(
    path: &PathBuf,
    socket2data: &Arc<Mutex<HashMap<String, SocketData>>>,
) -> bool {
    if let Some(parent) = path.parent() {
        if let Some(parent_str) = parent.to_str() {
            let sockets_data = socket2data.lock().await;
            return sockets_data
                .values()
                .any(|data| data.opened_dirs.contains(parent_str));
        }
    }
    false
}

async fn is_file_opened(
    path_str: &str,
    socket2data: &Arc<Mutex<HashMap<String, SocketData>>>,
) -> bool {
    let sockets_data = socket2data.lock().await;
    sockets_data
        .values()
        .any(|data| data.opened_files.contains(path_str))
}

fn classify_watch_transition(
    last_state: FileState,
    current_state: FileState,
    is_opened_file: bool,
) -> WatchAction {
    match (last_state, current_state) {
        (FileState::DoesNotExist, FileState::Exists) => {
            if is_opened_file {
                // Atomic saves often surface as create/replace events for files that are
                // already open. For opened files, we want to resync content instead of
                // treating the first observed event as a brand-new file.
                WatchAction::Modify
            } else {
                WatchAction::Create
            }
        }
        (FileState::Exists, FileState::DoesNotExist) => WatchAction::Remove,
        (FileState::Exists, FileState::Exists) => WatchAction::Modify,
        _ => WatchAction::Ignore,
    }
}

async fn handle_create_remove_event(
    path: &PathBuf,
    path_str: &str,
    event_kind: &notify::EventKind,
    socket: &Arc<socketioxide::SocketIo>,
    socket2data: &Arc<Mutex<HashMap<String, SocketData>>>,
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

    // For create events, path.is_file() works because the file exists.
    // For remove events, path.is_file() always returns false (file is gone),
    // so we use a heuristic: if the path has a file extension, it's a file.
    let is_file = match event_kind {
        notify::EventKind::Create(_) => path.is_file(),
        notify::EventKind::Remove(_) => path.extension().is_some(),
        _ => false,
    };

    let _ = socket
        .emit(
            event_name,
            &json!({
                "path": path_str,
                "isFile": is_file
            }),
        )
        .await;
}

async fn handle_modify_event(
    path: &PathBuf,
    path_str: &str,
    socket: &Arc<socketioxide::SocketIo>,
    file2code: &Arc<Mutex<HashMap<String, Code>>>,
    socket2data: &Arc<Mutex<HashMap<String, SocketData>>>,
    lsp_manager: &Arc<Mutex<crate::lsp::LspManager>>,
) {
    if !is_file_opened(path_str, socket2data).await {
        return;
    }

    info!("watch event: {:?} for path: {:?}", "Modify", path);
    let _ = handle_file_modification(path, socket, file2code, lsp_manager).await;
}

pub async fn handle_watch_event(
    path: &PathBuf,
    _event: &notify::Event,
    socket: &Arc<socketioxide::SocketIo>,
    file2code: &Arc<Mutex<HashMap<String, Code>>>,
    socket2data: &Arc<Mutex<HashMap<String, SocketData>>>,
    file_states: &Arc<Mutex<HashMap<String, FileWatchState>>>,
    git_manager: &Arc<Mutex<crate::git::GitManager>>,
    lsp_manager: &Arc<Mutex<LspManager>>,
) {
    let path_str = match path.to_str() {
        Some(s) => s.to_string(),
        None => return,
    };

    let (should_spawn, rx) = {
        let mut states = file_states.lock().await;
        let entry = states.entry(path_str.clone()).or_insert_with(|| {
            let (tx, _) = watch::channel(());
            FileWatchState {
                state: FileState::DoesNotExist,
                sender: tx,
                pending: false,
            }
        });

        let _ = entry.sender.send(());

        if entry.pending {
            (false, None)
        } else {
            entry.pending = true;
            let receiver = entry.sender.subscribe();
            (true, Some(receiver))
        }
    };

    if !should_spawn {
        return;
    }

    let mut rx = rx.unwrap();

    // Spawn a single debounce task for this file
    let path = path.clone();
    let socket = socket.clone();
    let file2code = file2code.clone();
    let socket2data = socket2data.clone();
    let file_states = file_states.clone();
    let git_manager = git_manager.clone();
    let lsp_manager = lsp_manager.clone();
    let path_str_key = path_str.clone();

    tokio::spawn(async move {
        // Wait until events stop arriving (trailing-edge debounce)
        loop {
            // Mark as seen so we wait for *new* changes
            let _ = rx.borrow_and_update();
            match tokio::time::timeout(DEBOUNCE, rx.changed()).await {
                Ok(_) => continue, // new event arrived — reset timer
                Err(_) => break,   // timeout — silence, time to process
            }
        }

        process_watch_event(
            &path,
            &path_str_key,
            &socket,
            &file2code,
            &socket2data,
            &file_states,
            &git_manager,
            &lsp_manager,
        )
        .await;

        // Mark as not pending so future events spawn a new task

        let mut states = file_states.lock().await;
        if let Some(state) = states.get_mut(&path_str_key) {
            state.pending = false;
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
    lsp_manager: &Arc<Mutex<LspManager>>,
) {
    let current_state = if path.exists() {
        FileState::Exists
    } else {
        FileState::DoesNotExist
    };

    let last_state = {
        let states = file_states.lock().await;
        states
            .get(path_str)
            .map(|s| s.state.clone())
            .unwrap_or(FileState::DoesNotExist) // never seen = didn't exist for us
    };
    let is_opened_file = is_file_opened(path_str, socket2data).await;

    info!(
        "File state transition: {:?} -> {:?} for path: {:?}",
        last_state, current_state, path
    );

    match classify_watch_transition(last_state, current_state, is_opened_file) {
        WatchAction::Create => {
            handle_create_remove_event(
                path,
                path_str,
                &notify::EventKind::Create(notify::event::CreateKind::File),
                socket,
                socket2data,
            )
            .await;
        }
        WatchAction::Remove => {
            handle_create_remove_event(
                path,
                path_str,
                &notify::EventKind::Remove(notify::event::RemoveKind::File),
                socket,
                socket2data,
            )
            .await;
        }
        WatchAction::Modify => {
            handle_modify_event(path, path_str, socket, file2code, socket2data, lsp_manager).await;
        }
        WatchAction::Ignore => {
            info!(
                "Ignoring state transition: {:?} -> {:?}",
                last_state, current_state
            );
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
    file2code: &Arc<Mutex<HashMap<String, Code>>>,
    lsp_manager: &Arc<Mutex<LspManager>>,
) -> Result<()> {
    let path_str = path
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("Invalid UTF-8 in path"))?;

    // Read new content from disk first (before locking)
    let new_text = tokio::fs::read_to_string(path)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to read file {:?}: {}", path, e))?;

    // Lock file2code, check self_updated, compute diff, apply edits
    let (edits, lsp_changes, lang) = {
        let mut f2c = file2code.lock().await;
        let code = match f2c.get_mut(path_str) {
            Some(c) => c,
            None => return Ok(()),
        };

        if code.self_updated {
            code.self_updated = false;
            return Ok(());
        }

        let old_text = code.get_content();

        if old_text == new_text {
            return Ok(());
        }

        let edits = compute_text_edits(&old_text, &new_text);
        if edits.is_empty() {
            return Ok(());
        }

        // Apply edits to in-memory Code (with undo history)
        let lsp_changes = apply_edits_to_code(code, &edits, true);

        // Disk already has the correct content, so mark as unchanged
        code.changed = false;

        let lang = code.lang.clone();
        (edits, lsp_changes, lang)
    };
    // file2code lock released here

    // Notify frontend using the absolute path to keep editor identity consistent.
    let file = path_str.to_string();
    socket
        .emit("watcher:edits", &json! {{ "file": file, "edits": edits }})
        .await
        .map_err(|e| anyhow::anyhow!("Failed to emit edits: {}", e))?;

    // Sync LSP
    if !lsp_changes.is_empty() {
        let mut lsp = lsp_manager.lock().await;
        if let Some(lsp) = lsp.get(&lang).await {
            lsp.did_change_multi(path_str, lsp_changes).await;
            lsp.did_save(path_str, Some(&new_text));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unopened_new_file_is_classified_as_create() {
        assert_eq!(
            classify_watch_transition(FileState::DoesNotExist, FileState::Exists, false,),
            WatchAction::Create
        );
    }

    #[test]
    fn opened_newly_observed_file_is_treated_as_modify() {
        assert_eq!(
            classify_watch_transition(FileState::DoesNotExist, FileState::Exists, true,),
            WatchAction::Modify
        );
    }

    #[test]
    fn existing_file_changes_are_modifications() {
        assert_eq!(
            classify_watch_transition(FileState::Exists, FileState::Exists, true,),
            WatchAction::Modify
        );
    }
}

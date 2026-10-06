use anyhow::Result;
use serde_json::json;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Mutex, watch};
use tokio_util::sync::CancellationToken;
use tracing::{error, info};

use crate::app_state::SocketData;
use crate::code::Code;
use crate::diff::compute_text_edits;
use crate::git::GitManager;
use crate::handlers::io_handler::apply_edits_to_code;
use crate::lsp::LspManager;
use crate::search::search_file_result;
use crate::utils::{format_path, normalize_watch_path, FileMeta};

const DEBOUNCE: Duration = Duration::from_millis(100);

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
    if sockets_data
        .values()
        .any(|data| data.opened_files.contains(path_str))
    {
        return true;
    }
    if let Ok(abs) = crate::utils::abs_file(path_str) {
        if sockets_data
            .values()
            .any(|data| data.opened_files.contains(&abs))
        {
            return true;
        }
    }
    false
}

async fn is_file_cached(path_str: &str, file2code: &Arc<Mutex<HashMap<String, Code>>>) -> bool {
    let f2c = file2code.lock().await;
    if f2c.contains_key(path_str) {
        return true;
    }
    if let Ok(abs) = crate::utils::abs_file(path_str) {
        if f2c.contains_key(&abs) {
            return true;
        }
    }
    false
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

pub async fn handle_watch_event(
    path: &PathBuf,
    event: &notify::Event,
    socket: &Arc<socketioxide::SocketIo>,
    file2code: &Arc<Mutex<HashMap<String, Code>>>,
    socket2data: &Arc<Mutex<HashMap<String, SocketData>>>,
    file_states: &Arc<Mutex<HashMap<String, FileWatchState>>>,
    git_manager: &Arc<Mutex<GitManager>>,
    lsp_manager: &Arc<Mutex<LspManager>>,
) {
    let normalized_path = normalize_watch_path(path);
    let path_str = normalized_path.to_string_lossy().to_string();

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

    // Spawn a single debounce task for this file
    let mut rx = rx.unwrap();
    let path = normalized_path.clone();
    let socket = socket.clone();
    let file2code = file2code.clone();
    let socket2data = socket2data.clone();
    let file_states = file_states.clone();
    let git_manager = git_manager.clone();
    let lsp_manager = lsp_manager.clone();
    let path_str_key = path_str.clone();
    let event_kind = event.kind.clone();

    tokio::spawn(async move {
        // Wait until events stop arriving (trailing-edge debounce)
        loop {
            // Mark as seen so we wait for *new* changes
            let _ = rx.borrow_and_update();
            match tokio::time::timeout(DEBOUNCE, rx.changed()).await {
                Ok(_) => continue,
                Err(_) => break,
            }
        }

        process_watch_event(
            &path,
            &path_str_key,
            &event_kind,
            &socket,
            &file2code,
            &socket2data,
            &file_states,
            &lsp_manager,
        )
        .await;

        handle_search_update(&path, &socket, &socket2data).await;
        handle_changes_update(&path, &socket, &git_manager).await;

        let mut states = file_states.lock().await;
        if let Some(state) = states.get_mut(&path_str_key) {
            state.pending = false;
        }
    });
}

async fn process_watch_event(
    path: &PathBuf,
    path_str: &str,
    event_kind: &notify::EventKind,
    socket: &Arc<socketioxide::SocketIo>,
    file2code: &Arc<Mutex<HashMap<String, Code>>>,
    socket2data: &Arc<Mutex<HashMap<String, SocketData>>>,
    file_states: &Arc<Mutex<HashMap<String, FileWatchState>>>,
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
            .unwrap_or(FileState::DoesNotExist)
    };
    let is_opened_file = is_file_opened(path_str, socket2data).await;
    let is_cached_in_file2code = is_file_cached(path_str, file2code).await;
    let is_parent_opened = is_parent_dir_opened(path, socket2data).await;

    let watch_action = classify_watch_transition(last_state, current_state, is_opened_file);
    info!("watch action:  {:?} for path: {:?}", watch_action, path);

    match watch_action {
        WatchAction::Create => {
            if is_parent_opened {
                let is_file = match event_kind {
                    notify::EventKind::Create(notify::event::CreateKind::File) => true,
                    notify::EventKind::Create(notify::event::CreateKind::Folder) => false,
                    _ => path.is_file(),
                };
                let data = &json!({"path": format_path(path_str), "isFile": is_file});
                let _ = socket.emit("watcher:create", data).await;
            }
        }
        WatchAction::Remove => {
            if is_parent_opened {
                let is_file = match event_kind {
                    notify::EventKind::Remove(notify::event::RemoveKind::File) => true,
                    notify::EventKind::Remove(notify::event::RemoveKind::Folder) => false,
                    _ => path.extension().is_some(),
                };
                let data = &json!({"path": format_path(path_str), "isFile": is_file});
                let _ = socket.emit("watcher:remove", data).await;
            }
        }
        WatchAction::Modify => {
            if is_opened_file || is_cached_in_file2code {
                let _ =
                    handle_file_modification(path, socket, file2code, lsp_manager, is_opened_file)
                        .await;
            }
        }
        WatchAction::Ignore => {}
    }

    // Update state (or remove if file was deleted to prevent memory leak)
    let mut states = file_states.lock().await;
    if current_state == FileState::DoesNotExist {
        states.remove(path_str);
    } else if let Some(watch_state) = states.get_mut(path_str) {
        watch_state.state = current_state;
    }
}

async fn handle_search_update(
    path: &Path,
    socket: &Arc<socketioxide::SocketIo>,
    socket2data: &Arc<Mutex<HashMap<String, SocketData>>>,
) {
    if path.exists() && !path.is_file() {
        return;
    }
    if !path.exists() && path.extension().is_none() {
        return;
    }

    let searches = {
        let sockets_data = socket2data.lock().await;
        sockets_data
            .iter()
            .filter_map(|(sid, data)| {
                let pattern = data.search_pattern.as_ref()?;
                if pattern.trim().is_empty() {
                    return None;
                }
                Some((
                    sid.clone(),
                    pattern.clone(),
                    data.search_last_file_result.clone(),
                ))
            })
            .collect::<Vec<_>>()
    };

    if searches.is_empty() {
        return;
    }

    for (sid, pattern, last_file_result) in searches {
        let cancel = CancellationToken::new();
        if let Some(file_result) = search_file_result(path, &pattern, cancel).await {
            if last_file_result.as_ref() == Some(&file_result) {
                continue;
            }

            {
                let mut sockets_data = socket2data.lock().await;
                if let Some(data) = sockets_data.get_mut(&sid) {
                    data.search_last_file_result = Some(file_result.clone());
                }
            }

            let _ = socket
                .emit("search:results", &json!({ "results": [file_result] }))
                .await;
        }
    }
}

async fn handle_changes_update(
    path: &Path,
    socket: &Arc<socketioxide::SocketIo>,
    git_manager: &Arc<Mutex<crate::git::GitManager>>,
) {
    let update = {
        let mut git = git_manager.lock().await;
        if git.should_ignore(path) {
            return;
        }
        git.check_status_changed_for_paths(&[path.to_path_buf()])
    };

    if let Some(update) = update {
        let _ = socket.emit("git:update", &update.to_json()).await;
    }
}

async fn handle_file_modification(
    path: &PathBuf,
    socket: &Arc<socketioxide::SocketIo>,
    file2code: &Arc<Mutex<HashMap<String, Code>>>,
    lsp_manager: &Arc<Mutex<LspManager>>,
    sync_lsp: bool,
) -> Result<()> {
    let path_str = path
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("Invalid UTF-8 in path"))?;

    let current_file_meta = FileMeta::query(path);

    // Read new content from disk first (before locking)
    let new_text = tokio::fs::read_to_string(path)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to read file {:?}: {}", path, e))?;

    // Lock file2code, check file_meta, compute diff, apply edits
    let (edits, lsp_changes, lang) = {
        let mut f2c = file2code.lock().await;
        let code = match f2c.get_mut(path_str) {
            Some(c) => c,
            None => {
                if let Ok(abs) = crate::utils::abs_file(path_str) {
                    match f2c.get_mut(&abs) {
                        Some(c) => c,
                        None => return Ok(()),
                    }
                } else {
                    return Ok(());
                }
            }
        };

        // If current mtime and size match our last save, this event was triggered
        // by Anycode's own save. Ignore it.
        if let (Some(current), Some(saved)) = (current_file_meta, code.file_meta) {
            if current == saved {
                code.self_updated = false;
                return Ok(());
            }
        }

        let old_text = code.get_content();

        if old_text == new_text {
            code.self_updated = false;
            code.file_meta = current_file_meta;
            return Ok(());
        }

        let edits = compute_text_edits(&old_text, &new_text);
        if edits.is_empty() {
            code.self_updated = false;
            code.file_meta = current_file_meta;
            return Ok(());
        }

        // Apply edits to in-memory Code (with undo history)
        let lsp_changes = apply_edits_to_code(code, &edits, true);

        // Disk already has the correct content, so mark as unchanged
        code.changed = false;
        code.self_updated = false;
        code.file_meta = current_file_meta;

        let lang = code.lang.clone();
        (edits, lsp_changes, lang)
    };
    // file2code lock released here

    // Notify frontend using the absolute path to keep editor identity consistent.
    let file = path_str.to_string();
    socket
        .emit("watcher:edits", &json! {{ "file": format_path(&file), "edits": edits }})
        .await
        .map_err(|e| anyhow::anyhow!("Failed to emit edits: {}", e))?;

    // Sync LSP only when file is opened by at least one live socket.
    if sync_lsp && !lsp_changes.is_empty() {
        let mut lsp = lsp_manager.lock().await;
        if let Some(lsp) = lsp.get(&lang).await {
            if let Err(e) = lsp.did_change(path_str, lsp_changes).await {
                error!("Failed to notify LSP didChange for {}: {:?}", path_str, e);
            }
            if let Err(e) = lsp.did_save(path_str) {
                error!("Failed to notify LSP didSave for {}: {:?}", path_str, e);
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::current_dir;
    use std::path::Path;

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

    #[test]
    fn watcher_paths_are_normalized_before_comparison() {
        let cwd = current_dir();
        let normalized = normalize_watch_path(Path::new("./test.js"));
        assert_eq!(normalized, cwd.join("test.js"));

        let normalized = normalize_watch_path(Path::new(&cwd.join("./test.js")));
        assert_eq!(normalized, cwd.join("test.js"));
    }

    #[tokio::test]
    async fn test_external_modification_after_self_save_is_not_dropped() -> Result<()> {
        let temp_dir = tempfile::tempdir()?;
        let file_path = temp_dir.path().join("test.txt");
        std::fs::write(&file_path, "initial text\n")?;

        let (_layer, io) = socketioxide::SocketIo::builder().build_layer();
        io.ns("/", |_socket: socketioxide::extract::SocketRef| async {});
        let socket = Arc::new(io);
        let config = crate::config::Config::default();
        let mut code = Code::from_file(file_path.to_str().unwrap(), &config)?;

        // Simulate Anycode modifying and saving the file (triggers self_updated = true)
        code.changed = true;
        code.save_file()?;
        assert!(code.self_updated, "code should be marked self_updated after save");

        let path_str = file_path.to_str().unwrap().to_string();
        let file2code = Arc::new(Mutex::new(HashMap::new()));
        file2code.lock().await.insert(path_str.clone(), code);

        let lsp_manager = Arc::new(Mutex::new(LspManager::new(config)));

        // External editor (e.g. VS Code) modifies the file on disk
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        std::fs::write(&file_path, "modified by vs code\n")?;

        // Watcher receives the modification event
        handle_file_modification(&file_path, &socket, &file2code, &lsp_manager, false).await?;

        // The in-memory code MUST have the updated content from VS Code!
        let f2c = file2code.lock().await;
        let updated_code = f2c.get(&path_str).unwrap();
        assert_eq!(
            updated_code.get_content(),
            "modified by vs code\n",
            "External modification must be applied, not dropped by self_updated!"
        );

        Ok(())
    }

    #[tokio::test]
    async fn test_self_save_is_ignored_when_file_meta_matches() -> Result<()> {
        let temp_dir = tempfile::tempdir()?;
        let file_path = temp_dir.path().join("test_self.txt");
        std::fs::write(&file_path, "initial text\n")?;

        let (_layer, io) = socketioxide::SocketIo::builder().build_layer();
        io.ns("/", |_socket: socketioxide::extract::SocketRef| async {});
        let socket = Arc::new(io);
        let config = crate::config::Config::default();
        let mut code = Code::from_file(file_path.to_str().unwrap(), &config)?;

        // Simulate Anycode modifying and saving the file
        code.changed = true;
        code.save_file()?;

        let path_str = file_path.to_str().unwrap().to_string();
        let file2code = Arc::new(Mutex::new(HashMap::new()));
        file2code.lock().await.insert(path_str.clone(), code);

        let lsp_manager = Arc::new(Mutex::new(LspManager::new(config)));

        // Watcher receives the event triggered by Anycode's own save (disk was not modified externally)
        handle_file_modification(&file_path, &socket, &file2code, &lsp_manager, false).await?;

        // File meta matches, so it returns Ok(()) cleanly without changing history or text
        let f2c = file2code.lock().await;
        let unchanged_code = f2c.get(&path_str).unwrap();
        assert_eq!(unchanged_code.get_content(), "initial text\n");

        Ok(())
    }
}

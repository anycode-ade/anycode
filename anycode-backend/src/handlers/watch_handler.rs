use std::path::PathBuf;
use std::sync::Arc;
use std::collections::HashMap;
use tokio::sync::Mutex;
use serde_json::json;
use tracing::info;
use notify::Event;
use anyhow::Result;

use crate::app_state::SocketData;
use crate::code::Code;
use crate::utils::is_ignored_dir;
use crate::diff::compute_text_edits;

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
    event: &notify::Event,
    socket: &Arc<socketioxide::SocketIo>,
    file2code: &Arc<Mutex<HashMap<String, Code>>>,
    socket2data: &Arc<Mutex<HashMap<String, SocketData>>>
) {
    let path_str = match path.to_str() {
        Some(s) => s,
        None => return,
    };

    match event.kind {
        notify::EventKind::Create(_) | notify::EventKind::Remove(_) => {
            handle_create_remove_event(path, path_str, &event.kind, socket, socket2data).await;
        },
        notify::EventKind::Modify(notify::event::ModifyKind::Data(_)) |
        notify::EventKind::Modify(notify::event::ModifyKind::Name(_)) => {
            handle_modify_event(path, path_str, socket, file2code, socket2data).await;
        }
        _ => {},
    };
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

    let edits = compute_text_edits(&old_text, &new_text);

    let file = crate::utils::relative_path(path_str);

    socket.emit("watcher:edits", &json! {{ "file": file, "edits": edits }}).await
        .map_err(|e| anyhow::anyhow!("Failed to emit edits: {}", e))?;

    Ok(())
}


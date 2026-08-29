use crate::app_state::*;
use crate::code::{Edit, Operation};
use crate::error_ack;
use crate::handlers::git_handler::is_file_tracked;
use crate::utils::{abs_file, format_path, is_ignored_path};
use crate::{
    app_state::{AppState, SocketData},
    code::Code,
};
use lsp_types::{Position, Range, TextDocumentContentChangeEvent};
use serde::{Deserialize, Serialize};
use serde_json::{self, json};
use socketioxide::extract::{AckSender, Data, SocketRef, State};
use std::path::{Component, Path, PathBuf};
use tracing::{debug, error, info, warn};

/// Apply edits to a Code instance and return LSP change events.
/// If `use_history` is true, wraps edits in tx()/commit() for undo support.
pub fn apply_edits_to_code(
    code: &mut Code,
    edits: &[Edit],
    use_history: bool,
) -> Vec<TextDocumentContentChangeEvent> {
    let mut lsp_changes = Vec::new();

    if use_history {
        code.tx();
    }

    for e in edits.iter() {
        match e.operation {
            Operation::Insert => {
                let start_char = code.utf16_to_char_offset(e.start);
                let (line, col_utf16) = code.char_to_position(start_char);
                code.insert_text(&e.text, start_char);

                lsp_changes.push(TextDocumentContentChangeEvent {
                    range: Some(Range {
                        start: Position::new(line as u32, col_utf16 as u32),
                        end: Position::new(line as u32, col_utf16 as u32),
                    }),
                    range_length: None,
                    text: e.text.clone(),
                });
            }
            Operation::Remove => {
                let start_char = code.utf16_to_char_offset(e.start);
                let end_char = code.utf16_to_char_offset(e.start + e.text.encode_utf16().count());
                let (start_line, start_col_utf16) = code.char_to_position(start_char);
                let (end_line, end_col_utf16) = code.char_to_position(end_char);

                code.remove_text(start_char, end_char);

                lsp_changes.push(TextDocumentContentChangeEvent {
                    range: Some(Range {
                        start: Position::new(start_line as u32, start_col_utf16 as u32),
                        end: Position::new(end_line as u32, end_col_utf16 as u32),
                    }),
                    range_length: None,
                    text: String::new(),
                });
            }
        }
    }

    if use_history {
        code.commit();
    }

    lsp_changes
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileOpenRequest {
    pub path: String,
}

#[derive(Debug, Serialize)]
struct FileOriginalPayload {
    content: String,
    #[serde(rename = "isNew")]
    is_new: bool,
    status: &'static str,
}

pub async fn handle_file_open(
    socket: SocketRef,
    Data(request): Data<FileOpenRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("Received file:open: {:?}", request);

    let abs_path = match abs_file(&request.path) {
        Ok(p) => p,
        Err(e) => error_ack!(ack, &request.path, "Failed to resolve file: {:?}", e),
    };

    let file_exists = std::path::Path::new(&abs_path).exists();
    if !file_exists && is_file_tracked(&abs_path, &state).await {
        let mut f2c = state.file2code.lock().await;
        f2c.entry(abs_path.clone())
            .or_insert_with(|| Code::new_empty(&abs_path, &state.config));
    }

    let (content, lang, history) = {
        let mut f2c = state.file2code.lock().await;
        let code = match get_or_create_code(&mut f2c, &abs_path, &state.config) {
            Ok(c) => c,
            Err(e) => error_ack!(ack, &abs_path, "{:?}", e),
        };

        (
            code.text.to_string(),
            code.lang.clone(),
            code.history.clone(),
        )
    };

    {
        let sid = socket.id.as_str().to_string();
        let mut sockets_data = state.socket2data.lock().await;
        let data = sockets_data.entry(sid).or_insert_with(SocketData::default);
        data.opened_files.insert(abs_path.clone());
    }

    let original = {
        let git = state.git_manager.lock().await;
        match git.file_original(&abs_path) {
            Ok(file) => {
                let status = if file.is_new { "new" } else { "ok" };
                FileOriginalPayload {
                    content: file.content,
                    is_new: file.is_new,
                    status,
                }
            }
            Err(err) => {
                warn!(
                    "Failed to resolve original content for {}: {}",
                    abs_path, err
                );
                FileOriginalPayload {
                    content: String::new(),
                    is_new: false,
                    status: "error",
                }
            }
        }
    };

    ack.send(&json!({
        "content": content,
        "original": original,
        "path": format_path(&request.path),
        "success": true,
        "history": history,
    }))
    .ok();

    // LSP startup can take several seconds. Keep it out of the file-open
    // response path so one slow language server cannot block other opens.
    let lsp_manager = state.lsp_manager.clone();
    tokio::spawn(async move {
        let mut lsp_manager = lsp_manager.lock().await;
        if let Some(lsp) = lsp_manager.get(&lang).await {
            if let Err(e) = lsp.did_open(&lang, &abs_path, &content) {
                error!("Failed to notify LSP didOpen for {}: {:?}", abs_path, e);
            }
        }
    });
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DirOpenRequest {
    pub path: String,
}

pub async fn handle_dir_list(
    socket: SocketRef,
    Data(request): Data<DirOpenRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("Received dir:list: {:?}", request);

    let dir = match request.path.as_str().trim() {
        "" | "." | "./" => crate::utils::current_dir().to_string_lossy().into_owned(),
        d => d.to_string(),
    };

    let abs_path = match abs_file(&dir) {
        Ok(p) => p,
        Err(e) => error_ack!(ack, &dir, "Failed to resolve directory: {:?}", e),
    };

    let name = crate::utils::file_name(&dir);
    let mut relative_path = crate::utils::relative_path(&dir);
    if relative_path.is_empty() {
        relative_path = ".".to_string();
    }

    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(e) => error_ack!(ack, &dir, "Failed to open directory: {:?}", e),
    };

    let mut files = Vec::new();
    let mut dirs = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();

        if is_ignored_path(&path) {
            continue;
        }

        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if path.is_dir() {
                dirs.push(name.to_string());
            } else {
                files.push(name.to_string());
            }
        }
    }

    dirs.sort();
    files.sort();

    let message = json!({
        "files": files,
        "dirs": dirs,
        "name": name,
        "fullpath": format_path(&dir),
        "relative_path": relative_path,
    });

    // Track opened directories
    let sid = socket.id.as_str().to_string();
    let mut sockets_data = state.socket2data.lock().await;
    let data = sockets_data.entry(sid).or_insert_with(SocketData::default);
    data.opened_dirs.insert(abs_path.clone());

    if let Err(err) = ack.send(&message) {
        error!("Failed to send acknowledgment: {:?}", err);
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileCloseRequest {
    pub file: String,
}

pub async fn handle_file_close(
    socket: SocketRef,
    Data(request): Data<FileCloseRequest>,
    state: State<AppState>,
    ack: AckSender,
) {
    info!("Received file:close: {}", request.file.replace('\\', "/"));

    let sid = socket.id.as_str().to_string();

    let abs_path = match abs_file(&request.file) {
        Ok(p) => p,
        Err(e) => error_ack!(ack, &request, "Failed to resolve file: {:?}", e),
    };

    let lang = {
        let mut f2c = state.file2code.lock().await;
        let code = match get_or_create_code(&mut f2c, &abs_path, &state.config) {
            Ok(c) => c,
            Err(e) => error_ack!(ack, &abs_path, "{:?}", e),
        };
        code.lang.clone()
    };

    // Close file in LSP
    {
        let mut lsp_manager = state.lsp_manager.lock().await;
        if let Some(lsp) = lsp_manager.get(&lang).await {
            if let Err(e) = lsp.did_close(&abs_path) {
                error!("Failed to notify LSP didClose for {}: {:?}", abs_path, e);
            }
        }
    }

    // Remove from current socket's opened_files
    let is_still_opened = {
        let mut sockets_data = state.socket2data.lock().await;
        let data = sockets_data.entry(sid).or_insert_with(SocketData::default);
        data.opened_files.remove(&abs_path);

        // Check if file is still opened by other sockets
        sockets_data
            .values()
            .any(|data| data.opened_files.contains(&abs_path))
    };

    // Remove from file2code if no other sockets have it open
    if !is_still_opened {
        let mut f2c = state.file2code.lock().await;
        f2c.remove(&abs_path);
        info!(
            "Removed file from file2code: {}",
            request.file.replace('\\', "/")
        );
    }

    // Lsp autoclose
    if !is_language_opened(&lang, &state).await {
        let mut lsp_manager = state.lsp_manager.lock().await;
        lsp_manager.stop(&lang).await;
        info!("Lsp autoclose: '{}'", lang);
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileChange {
    pub file: String,
    pub edits: Vec<Edit>,
    #[serde(rename = "isUndo")]
    pub is_undo: Option<bool>,
    #[serde(rename = "isRedo")]
    pub is_redo: Option<bool>,
}

pub async fn handle_file_change(
    socket: SocketRef,
    Data(change): Data<FileChange>,
    state: State<AppState>,
    _ack: AckSender,
) {
    info!(
        "Received file:change: edits={} file={}",
        change.edits.len(),
        change.file
    );

    let abs_path = match abs_file(&change.file) {
        Ok(p) => p,
        Err(e) => {
            tracing::error!("Failed to resolve file: {:?}", e);
            return;
        }
    };

    let edits = change.edits.clone();
    let (lsp_changes, lang, did_autosave) = {
        let mut f2c = state.file2code.lock().await;
        let code = match get_or_create_code(&mut f2c, &abs_path, &state.config) {
            Ok(c) => c,
            Err(e) => {
                tracing::error!("Failed to get code: {:?}", e);
                return;
            }
        };

        let mut apply_tx = true;

        if let Some(true) = change.is_undo {
            let _undo = code.undo_change();
            apply_tx = false;
        }

        if let Some(true) = change.is_redo {
            let _redo = code.redo_change();
            apply_tx = false;
        }

        // Apply all edits to code and collect LSP changes
        let lsp_changes = apply_edits_to_code(code, &edits, apply_tx);
        let lang = code.lang.clone();
        let did_autosave = match code.save_file() {
            Ok(()) => true,
            Err(e) => {
                error!("Autosave failed for {}: {:?}", abs_path, e);
                false
            }
        };

        (lsp_changes, lang, did_autosave)
    };

    // Send all changes to LSP in a single notification, then notify save after autosave.
    if !lsp_changes.is_empty() || did_autosave {
        let mut lsp_manager = state.lsp_manager.lock().await;
        if let Some(lsp) = lsp_manager.get(&lang).await {
            if !lsp_changes.is_empty() {
                if let Err(e) = lsp.did_change(&abs_path, lsp_changes).await {
                    error!("Failed to notify LSP didChange for {}: {:?}", abs_path, e);
                }
            }

            if did_autosave {
                if let Err(e) = lsp.did_save(&abs_path) {
                    error!("Failed to notify LSP didSave for {}: {:?}", abs_path, e);
                }
            }
        }
    }

    // Broadcast as a single message for other clients if needed
    socket.broadcast().emit("file:change", &change).await.ok();
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileSaveRequest {
    pub path: String,
}

pub async fn handle_file_save(
    _socket: SocketRef,
    Data(request): Data<FileSaveRequest>,
    state: State<AppState>,
    ack: AckSender,
) {
    info!("Received file:save: {:?}", request.path);

    let abs_path = match abs_file(&request.path) {
        Ok(p) => p,
        Err(e) => error_ack!(ack, &request.path, "Failed to resolve file: {:?}", e),
    };

    let mut f2c = state.file2code.lock().await;
    let code = match get_or_create_code(&mut f2c, &abs_path, &state.config) {
        Ok(c) => c,
        Err(e) => error_ack!(ack, &abs_path, "{:?}", e),
    };

    if let Err(e) = code.save_file() {
        error_ack!(ack, &abs_path, "Failed to save file: {:?}", e);
    }

    info!("File saved successfully: {}", abs_path);

    let mut lsp_manager = state.lsp_manager.lock().await;
    if let Some(lsp) = lsp_manager.get(&code.lang).await {
        if let Err(e) = lsp.did_save(&abs_path) {
            error!("Failed to notify LSP didSave for {}: {:?}", abs_path, e);
        }
    }

    ack.send(&json!({ "success": true })).ok();
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CreateRequest {
    pub parent_path: String,
    pub name: String,
    pub is_file: bool,
    pub content_base64: Option<String>,
    pub to_temp_dir: Option<bool>,
}

pub async fn handle_create(
    socket: SocketRef,
    Data(request): Data<CreateRequest>,
    state: State<AppState>,
    ack: AckSender,
) {
    info!("Received create: {:?}", request);

    let parent_path = &request.parent_path;
    let name = &request.name;
    let is_file = request.is_file;
    let is_temp = request.to_temp_dir.unwrap_or(false);

    let mut name_components = Path::new(name).components();
    if name.is_empty()
        || !matches!(name_components.next(), Some(Component::Normal(_)))
        || name_components.next().is_some()
    {
        error_ack!(ack, &request.name, "Name must be a single path component");
    }

    let full_path = if is_temp {
        std::env::temp_dir().join(name)
    } else {
        // Build path using PathBuf for cross-platform compatibility
        let fp = if parent_path.is_empty() || parent_path == "." || parent_path == "./" {
            PathBuf::from(name)
        } else {
            PathBuf::from(parent_path).join(name)
        };

        // For relative paths, we need to join with current directory
        if fp.is_absolute() {
            fp
        } else {
            // Relative path, join with current directory
            let current_dir = std::env::current_dir().unwrap_or_default();
            current_dir.join(&fp)
        }
    };

    let full_path_str = full_path.to_string_lossy().to_string();
    let wire_full_path = format_path(&full_path_str);
    if full_path.exists() {
        error_ack!(ack, &request.name, "Destination path already exists");
    }

    // Create parent directories if they don't exist
    if let Some(parent) = full_path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            error_ack!(
                ack,
                &request.name,
                "Failed to create parent directories: {:?}",
                e
            );
        }
    }

    if is_file {
        let bytes = if let Some(b64) = &request.content_base64 {
            use base64::Engine;
            match base64::engine::general_purpose::STANDARD.decode(b64) {
                Ok(b) => b,
                Err(e) => error_ack!(ack, &request.name, "Failed to decode base64 data: {:?}", e),
            }
        } else {
            Vec::new()
        };

        match std::fs::write(&full_path, bytes) {
            Ok(_) => {
                if is_temp {
                    debug!("Temporary file created successfully: {}", full_path_str);
                } else {
                    info!("File created successfully: {}", full_path_str);
                }
                if !is_temp {
                    let mut f2c = state.file2code.lock().await;
                    f2c.entry(full_path_str.clone())
                        .or_insert_with(|| Code::new_empty(&full_path_str, &state.config));

                    socket
                        .broadcast()
                        .emit("file:created", &wire_full_path)
                        .await
                        .ok();
                }
                ack.send(&json!({ "success": true, "file": wire_full_path, "is_file": true }))
                    .ok();
            }
            Err(e) => {
                error_ack!(ack, &request.name, "Failed to create file: {:?}", e);
            }
        }
    } else {
        // Create directory
        match std::fs::create_dir(&full_path) {
            Ok(_) => {
                if is_temp {
                    debug!(
                        "Temporary directory created successfully: {}",
                        full_path_str
                    );
                } else {
                    info!("Directory created successfully: {}", full_path_str);
                }
                if !is_temp {
                    socket
                        .broadcast()
                        .emit("dir:created", &wire_full_path)
                        .await
                        .ok();
                }
                ack.send(&json!({ "success": true, "dir": wire_full_path, "is_file": false }))
                    .ok();
            }
            Err(e) => {
                error_ack!(ack, &request.name, "Failed to create directory: {:?}", e);
            }
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DeleteRequest {
    pub path: String,
}

pub async fn handle_delete(
    _socket: SocketRef,
    Data(request): Data<DeleteRequest>,
    state: State<AppState>,
    ack: AckSender,
) {
    info!("Received delete request: {:?}", request);

    let abs_path = match abs_file(&request.path) {
        Ok(p) => p,
        Err(e) => error_ack!(ack, &request.path, "Failed to resolve path: {:?}", e),
    };

    let path = std::path::Path::new(&abs_path);
    if !path.exists() {
        error_ack!(ack, &request.path, "Path does not exist");
    }

    let result = if path.is_file() {
        std::fs::remove_file(path)
    } else {
        std::fs::remove_dir_all(path)
    };

    match result {
        Ok(_) => {
            info!("Deleted successfully: {}", abs_path);

            let prefix = format!("{}/", abs_path);

            let files_to_close: Vec<(String, String)> = {
                let f2c = state.file2code.lock().await;
                f2c.iter()
                    .filter(|(k, _)| **k == abs_path || k.starts_with(&prefix))
                    .map(|(k, code)| (k.clone(), code.lang.clone()))
                    .collect()
            };

            if !files_to_close.is_empty() {
                let mut lsp_manager = state.lsp_manager.lock().await;
                for (file_path, lang) in &files_to_close {
                    if let Some(lsp) = lsp_manager.get(lang).await {
                        if let Err(e) = lsp.did_close(file_path) {
                            error!(
                                "Failed to notify LSP didClose for deleted file {}: {:?}",
                                file_path, e
                            );
                        }
                    }
                }
            }

            {
                let mut f2c = state.file2code.lock().await;
                f2c.retain(|k, _| k != &abs_path && !k.starts_with(&prefix));
            }

            {
                let mut sockets_data = state.socket2data.lock().await;
                for data in sockets_data.values_mut() {
                    data.opened_files
                        .retain(|k| k != &abs_path && !k.starts_with(&prefix));
                }
            }

            ack.send(&json!({ "success": true })).ok();
        }
        Err(e) => {
            error_ack!(ack, &request.path, "Failed to delete: {:?}", e);
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RenameRequest {
    pub old_path: String,
    pub new_path: String,
}

pub async fn handle_rename(
    socket: SocketRef,
    Data(request): Data<RenameRequest>,
    state: State<AppState>,
    ack: AckSender,
) {
    info!("Received rename request: {:?}", request);

    let old_abs_path = match abs_file(&request.old_path) {
        Ok(p) => p,
        Err(e) => error_ack!(
            ack,
            &request.old_path,
            "Failed to resolve old path: {:?}",
            e
        ),
    };

    let new_abs_path = match abs_file(&request.new_path) {
        Ok(p) => p,
        Err(e) => error_ack!(
            ack,
            &request.new_path,
            "Failed to resolve new path: {:?}",
            e
        ),
    };

    let old_path = std::path::Path::new(&old_abs_path);
    if !old_path.exists() {
        error_ack!(ack, &request.old_path, "Old path does not exist");
    }
    if old_abs_path == new_abs_path {
        ack.send(&json!({ "success": true, "old": old_abs_path, "new": new_abs_path }))
            .ok();
        return;
    }
    if std::path::Path::new(&new_abs_path).exists() {
        error_ack!(ack, &request.new_path, "Destination path already exists");
    }

    let result = std::fs::rename(&old_abs_path, &new_abs_path);

    match result {
        Ok(_) => {
            info!("Renamed successfully: {} -> {}", old_abs_path, new_abs_path);

            let old_prefix = format!("{}/", old_abs_path);
            let new_prefix = format!("{}/", new_abs_path);

            let mut files_to_rename = Vec::new();
            {
                let f2c = state.file2code.lock().await;
                for (k, code) in f2c.iter() {
                    if *k == old_abs_path {
                        let new_lang = Code::new_empty(&new_abs_path, &state.config).lang;
                        files_to_rename.push((
                            k.clone(),
                            new_abs_path.clone(),
                            code.lang.clone(),
                            new_lang,
                            code.get_content(),
                        ));
                    } else if k.starts_with(&old_prefix) {
                        let sub_path = k.strip_prefix(&old_prefix).unwrap();
                        let new_sub_path = format!("{}{}", new_prefix, sub_path);
                        let new_lang = Code::new_empty(&new_sub_path, &state.config).lang;
                        files_to_rename.push((
                            k.clone(),
                            new_sub_path,
                            code.lang.clone(),
                            new_lang,
                            code.get_content(),
                        ));
                    }
                }
            }

            if !files_to_rename.is_empty() {
                let mut lsp_manager = state.lsp_manager.lock().await;

                for (old_path, _, old_lang, _, _) in &files_to_rename {
                    if let Some(lsp) = lsp_manager.get(old_lang).await {
                        let _ = lsp.did_close(old_path);
                    }
                }

                {
                    let mut f2c = state.file2code.lock().await;
                    for (old_path, new_path, _, new_lang, _) in &files_to_rename {
                        if let Some(mut code) = f2c.remove(old_path) {
                            code.abs_path = new_path.clone();
                            code.file_name = crate::utils::file_name(new_path);
                            code.lang = new_lang.clone();
                            f2c.insert(new_path.clone(), code);
                        }
                    }
                }

                {
                    let mut sockets_data = state.socket2data.lock().await;
                    for data in sockets_data.values_mut() {
                        for (old_path, new_path, _, _, _) in &files_to_rename {
                            if data.opened_files.remove(old_path) {
                                data.opened_files.insert(new_path.clone());
                            }
                        }
                    }
                }

                for (_, new_path, _, new_lang, content) in &files_to_rename {
                    if let Some(lsp) = lsp_manager.get(new_lang).await {
                        let _ = lsp.did_open(new_lang, new_path, content);
                    }
                }
            }

            let _ = socket.emit(
                "file:renamed",
                &json!({ "old": format_path(&request.old_path), "new": format_path(&request.new_path) }),
            );

            socket
                .broadcast()
                .emit(
                    "file:renamed",
                    &json!({ "old": format_path(&request.old_path), "new": format_path(&request.new_path) }),
                )
                .await
                .ok();
            ack.send(&json!({ "success": true })).ok();
        }
        Err(e) => {
            error_ack!(ack, &request.old_path, "Failed to rename: {:?}", e);
        }
    }
}

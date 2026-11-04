use crate::app_state::AppState;
use crate::app_state::*;
use crate::error_ack;
use lsp_types::Range;
use serde::{Deserialize, Serialize};
use serde_json::{self, json};
use socketioxide::extract::{AckSender, Data, SocketRef, State};
use tracing::{error, info};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CompletionRequest {
    pub file: String,
    pub row: usize,
    pub column: usize,
}

pub async fn handle_completion(
    socket: SocketRef,
    Data(request): Data<CompletionRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("handle_completion {:?}", request);
    let CompletionRequest { file, row, column } = request;

    let abs_path = match state
        .resolve_path_for_socket(socket.id.as_str(), &file)
        .await
    {
        Ok(p) => p,
        Err(e) => error_ack!(ack, &file, "Failed to resolve file: {:?}", e),
    };

    let mut f2c = state.file2code.lock().await;
    let code = match get_or_create_code(&mut f2c, &abs_path, &state.config) {
        Ok(c) => c,
        Err(e) => error_ack!(ack, &abs_path, "{:?}", e),
    };

    let lsp_manager = state.lsp_for_path(&abs_path).await;
    let mut lsp_manager = lsp_manager.lock().await;

    let result = match lsp_manager.get(&code.lang).await {
        Some(lsp) => lsp
            .completion(&abs_path, row, column)
            .await
            .ok()
            .unwrap_or_else(|| Vec::new()),
        None => Vec::new(),
    };

    // If native LSP gave no completions, or in addition, query extension host
    if result.is_empty() {
        if let Some(ext_host) = state.ext_host_manager.read().await.as_ref() {
            let uri = crate::utils::abs_file(&abs_path).unwrap_or_else(|_| format!("file://{}", abs_path));
            if let Ok(ext_items) = ext_host.provide_completions(&uri, row, column).await {
                if !ext_items.is_empty() {
                    ack.send(&ext_items).ok();
                    return;
                }
            }
        }
    }

    ack.send(&result).ok();
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HoverRequest {
    pub file: String,
    pub row: usize,
    pub column: usize,
}

pub async fn handle_hover(
    socket: SocketRef,
    Data(request): Data<HoverRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("handle_hover {}", request.file);
    let HoverRequest { file, row, column } = request;

    let abs_path = match state
        .resolve_path_for_socket(socket.id.as_str(), &file)
        .await
    {
        Ok(p) => p,
        Err(e) => error_ack!(ack, &file, "Failed to resolve file: {:?}", e),
    };

    let mut f2c = state.file2code.lock().await;
    let code = match get_or_create_code(&mut f2c, &abs_path, &state.config) {
        Ok(c) => c,
        Err(e) => error_ack!(ack, &abs_path, "{:?}", e),
    };

    let lsp_manager = state.lsp_for_path(&abs_path).await;
    let mut lsp_manager = lsp_manager.lock().await;

    if let Some(lsp) = lsp_manager.get(&code.lang).await {
        if let Ok(hover) = lsp.hover(&abs_path, row, column).await {
            ack.send(&hover).ok();
            return;
        }
    }

    // Fallback to extension host
    if let Some(ext_host) = state.ext_host_manager.read().await.as_ref() {
        let uri = crate::utils::abs_file(&abs_path).unwrap_or_else(|_| format!("file://{}", abs_path));
        if let Ok(Some(hover)) = ext_host.provide_hover(&uri, row, column).await {
            ack.send(&hover).ok();
            return;
        }
    }

    ack.send(&json!(null)).ok();
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DefinitionRequest {
    pub file: String,
    pub row: usize,
    pub column: usize,
}

pub async fn handle_definition(
    socket: SocketRef,
    Data(request): Data<DefinitionRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("handle_definition {}", request.file);
    let DefinitionRequest { file, row, column } = request;

    let abs_path = match state
        .resolve_path_for_socket(socket.id.as_str(), &file)
        .await
    {
        Ok(p) => p,
        Err(e) => error_ack!(ack, &file, "Failed to resolve file: {:?}", e),
    };

    let mut f2c = state.file2code.lock().await;
    let code = match get_or_create_code(&mut f2c, &abs_path, &state.config) {
        Ok(c) => c,
        Err(e) => error_ack!(ack, &abs_path, "{:?}", e),
    };

    let lsp_manager = state.lsp_for_path(&abs_path).await;
    let mut lsp_manager = lsp_manager.lock().await;

    let result = match lsp_manager.get(&code.lang).await {
        Some(lsp) => lsp
            .definition(&abs_path, row, column)
            .await
            .ok()
            .unwrap_or_else(|| Vec::new()),
        None => Vec::new(),
    };

    if !result.is_empty() {
        ack.send(&result).ok();
        return;
    }

    // Fallback to extension host
    if let Some(ext_host) = state.ext_host_manager.read().await.as_ref() {
        let uri = crate::utils::abs_file(&abs_path).unwrap_or_else(|_| format!("file://{}", abs_path));
        if let Ok(locations) = ext_host.provide_definition(&uri, row, column).await {
            if !locations.is_empty() {
                ack.send(&locations).ok();
                return;
            }
        }
    }

    ack.send(&json!([])).ok();
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReferencesRequest {
    pub file: String,
    pub row: usize,
    pub column: usize,
}

pub async fn handle_references(
    socket: SocketRef,
    Data(request): Data<ReferencesRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("handle_references {}", request.file);
    let ReferencesRequest { file, row, column } = request;

    let abs_path = match state
        .resolve_path_for_socket(socket.id.as_str(), &file)
        .await
    {
        Ok(p) => p,
        Err(e) => error_ack!(ack, &file, "Failed to resolve file: {:?}", e),
    };

    let mut f2c = state.file2code.lock().await;
    let code = match get_or_create_code(&mut f2c, &abs_path, &state.config) {
        Ok(c) => c,
        Err(e) => error_ack!(ack, &abs_path, "{:?}", e),
    };

    let lsp_manager = state.lsp_for_path(&abs_path).await;
    let result = match lsp_manager.lock().await.get(&code.lang).await {
        Some(lsp) => lsp
            .references(&abs_path, row, column)
            .await
            .ok()
            .unwrap_or_else(|| Vec::new()),
        None => Vec::new(),
    };

    ack.send(&json!({ "items": result })).ok();
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CodeActionRequest {
    pub file: String,
    pub range: Range,
    #[serde(default)]
    pub context: Option<serde_json::Value>,
}

pub async fn handle_code_actions(
    socket: SocketRef,
    Data(request): Data<CodeActionRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    let abs_path = match state.resolve_path_for_socket(socket.id.as_str(), &request.file).await {
        Ok(p) => p,
        Err(e) => error_ack!(ack, &request.file, "Failed to resolve file: {:?}", e),
    };
    let uri = crate::utils::abs_file(&abs_path).unwrap_or_else(|_| format!("file://{}", abs_path));

    if let Some(ext_host) = state.ext_host_manager.read().await.as_ref() {
        if let Ok(actions) = ext_host.provide_code_actions(&uri, request.range, request.context).await {
            ack.send(&actions).ok();
            return;
        }
    }

    ack.send(&json!([])).ok();
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FormatRequest {
    pub file: String,
    #[serde(default)]
    pub options: Option<serde_json::Value>,
}

pub async fn handle_formatting(
    socket: SocketRef,
    Data(request): Data<FormatRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    let abs_path = match state.resolve_path_for_socket(socket.id.as_str(), &request.file).await {
        Ok(p) => p,
        Err(e) => error_ack!(ack, &request.file, "Failed to resolve file: {:?}", e),
    };
    let uri = crate::utils::abs_file(&abs_path).unwrap_or_else(|_| format!("file://{}", abs_path));
    let options = request.options.unwrap_or_else(|| json!({ "tabSize": 2, "insertSpaces": true }));

    if let Some(ext_host) = state.ext_host_manager.read().await.as_ref() {
        if let Ok(edits) = ext_host.provide_formatting(&uri, options).await {
            ack.send(&edits).ok();
            return;
        }
    }

    ack.send(&json!([])).ok();
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RenameRequest {
    pub file: String,
    pub row: usize,
    pub column: usize,
    #[serde(rename = "newName")]
    pub new_name: String,
}

pub async fn handle_lsp_rename(
    socket: SocketRef,
    Data(request): Data<RenameRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    let abs_path = match state.resolve_path_for_socket(socket.id.as_str(), &request.file).await {
        Ok(p) => p,
        Err(e) => error_ack!(ack, &request.file, "Failed to resolve file: {:?}", e),
    };
    let uri = crate::utils::abs_file(&abs_path).unwrap_or_else(|_| format!("file://{}", abs_path));

    if let Some(ext_host) = state.ext_host_manager.read().await.as_ref() {
        let resp = ext_host.send_request("commands/executeCommand", json!({
            "command": "vscode.executeDocumentRenameProvider",
            "args": [uri, { "line": request.row, "character": request.column }, request.new_name]
        })).await;
        if let Ok(edits) = resp {
            ack.send(&edits).ok();
            return;
        }
    }

    ack.send(&json!({ "changes": {} })).ok();
}

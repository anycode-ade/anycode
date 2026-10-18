use crate::app_state::AppState;
use crate::app_state::*;
use crate::error_ack;
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
        match lsp.hover(&abs_path, row, column).await {
            Ok(hover) => {
                ack.send(&hover).ok();
            }
            Err(e) => {
                ack.send(&json!({ "error": format!("Hover request failed: {}", e) }))
                    .ok();
            }
        }
    }
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

    ack.send(&result).ok();
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

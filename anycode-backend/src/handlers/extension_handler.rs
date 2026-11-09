use axum::{
    body::Body,
    extract::{Path as AxumPath, Query as AxumQuery, State as AxumState},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::{Value, json};
use socketioxide::extract::{AckSender, Data, SocketRef, State};
use std::fs;
use tracing::{error, info, warn};

use crate::app_state::AppState;

#[derive(Debug, Deserialize)]
pub struct ExtSearchRequest {
    pub query: String,
    #[serde(default)]
    pub offset: Option<usize>,
    #[serde(default)]
    pub size: Option<usize>,
}

#[derive(Debug, Deserialize)]
pub struct ExtInstallRequest {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(rename = "vsixPath", default)]
    pub vsix_path: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ExtIdRequest {
    pub id: String,
}

#[derive(Debug, Deserialize)]
pub struct ExtToggleRequest {
    pub id: String,
    pub enabled: bool,
}

#[derive(Debug, Deserialize)]
pub struct ExtExecuteCommandRequest {
    pub command: String,
    #[serde(default)]
    pub args: Option<serde_json::Value>,
}

pub async fn handle_ext_search(
    _socket: SocketRef,
    Data(req): Data<ExtSearchRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("ext:search: query={}", req.query);
    let offset = req.offset.unwrap_or(0);
    let size = req.size.unwrap_or(20);

    match state.extension_manager.search_openvsx(&req.query, offset, size).await {
        Ok(result) => {
            ack.send(&json!({ "success": true, "data": result })).ok();
        }
        Err(e) => {
            error!("ext:search failed: {:?}", e);
            ack.send(&json!({ "success": false, "error": e.to_string() })).ok();
        }
    }
}

pub async fn handle_ext_list(
    _socket: SocketRef,
    ack: AckSender,
    state: State<AppState>,
) {
    let list = state.extension_manager.list_installed().await;
    ack.send(&list).ok();
}

pub async fn handle_ext_install(
    _socket: SocketRef,
    Data(req): Data<ExtInstallRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("ext:install: {:?}", req);
    if let Some(vsix_path) = req.vsix_path {
        let path = std::path::PathBuf::from(vsix_path);
        match state.extension_manager.install_from_vsix_file(&path).await {
            Ok(installed) => {
                if let Some(ext_host) = state.ext_host_manager.read().await.as_ref() {
                    ext_host.register_manifest(&installed.manifest).await;
                    let events = &installed.manifest.activation_events;
                    if events.iter().any(|e| e == "*" || e == "onStartupFinished") {
                        let _ = ext_host.activate_if_needed(&installed.id, &installed.dir, &installed.manifest).await;
                    }
                }
                ack.send(&json!({ "success": true, "id": installed.id, "version": installed.version })).ok();
            }
            Err(e) => {
                error!("ext:install from vsix failed: {:?}", e);
                ack.send(&json!({ "success": false, "error": e.to_string() })).ok();
            }
        }
        return;
    }

    if let Some(id) = req.id {
        match state.extension_manager.install_from_openvsx(&id, req.version.as_deref()).await {
            Ok(installed) => {
                if let Some(ext_host) = state.ext_host_manager.read().await.as_ref() {
                    ext_host.register_manifest(&installed.manifest).await;
                    let events = &installed.manifest.activation_events;
                    if events.iter().any(|e| e == "*" || e == "onStartupFinished") {
                        let _ = ext_host.activate_if_needed(&installed.id, &installed.dir, &installed.manifest).await;
                    }
                }
                ack.send(&json!({ "success": true, "id": installed.id, "version": installed.version })).ok();
            }
            Err(e) => {
                error!("ext:install from openvsx failed: {:?}", e);
                ack.send(&json!({ "success": false, "error": e.to_string() })).ok();
            }
        }
        return;
    }

    ack.send(&json!({ "success": false, "error": "Either id or vsixPath must be provided" })).ok();
}

pub async fn handle_ext_uninstall(
    _socket: SocketRef,
    Data(req): Data<ExtIdRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("ext:uninstall: id={}", req.id);
    match state.extension_manager.uninstall(&req.id).await {
        Ok(_) => {
            ack.send(&json!({ "success": true })).ok();
        }
        Err(e) => {
            error!("ext:uninstall failed: {:?}", e);
            ack.send(&json!({ "success": false, "error": e.to_string() })).ok();
        }
    }
}

pub async fn handle_ext_toggle(
    _socket: SocketRef,
    Data(req): Data<ExtToggleRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("ext:toggle: id={}, enabled={}", req.id, req.enabled);
    match state.extension_manager.toggle(&req.id, req.enabled).await {
        Ok(_) => {
            ack.send(&json!({ "success": true })).ok();
        }
        Err(e) => {
            error!("ext:toggle failed: {:?}", e);
            ack.send(&json!({ "success": false, "error": e.to_string() })).ok();
        }
    }
}

pub async fn handle_ext_commands_list(
    _socket: SocketRef,
    ack: AckSender,
    state: State<AppState>,
) {
    let commands = state.extension_manager.get_all_commands().await;
    ack.send(&commands).ok();
}

pub async fn handle_ext_command_execute(
    _socket: SocketRef,
    Data(req): Data<ExtExecuteCommandRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("ext:command:execute: command={}", req.command);
    if let Some(ext_host) = state.ext_host_manager.read().await.as_ref() {
        let installed = state.extension_manager.storage.load_installed().unwrap_or_default();
        if req.command == "vscode.openWith" {
            if let Some(ref args) = req.args {
                if let Some(view_id) = args.get(1).and_then(|v| v.as_str()) {
                    ext_host.check_custom_editor_activation(view_id, &installed).await;
                }
            }
        }
        ext_host.check_command_activation(&req.command, &installed).await;
        match ext_host.execute_command(&req.command, req.args).await {
            Ok(result) => {
                ack.send(&json!({ "success": true, "result": result })).ok();
                return;
            }
            Err(e) => {
                warn!("ext_host execute_command failed: {:?}", e);
                ack.send(&json!({ "success": false, "error": e.to_string() })).ok();
                return;
            }
        }
    }

    ack.send(&json!({ "success": false, "error": "Extension host is not running" })).ok();
}

#[derive(Debug, Deserialize)]
pub struct ExtTreeViewChildrenRequest {
    #[serde(rename = "viewId")]
    pub view_id: String,
    #[serde(rename = "elementId", default)]
    pub element_id: Option<String>,
}

pub async fn handle_ext_treeview_children(
    _socket: SocketRef,
    Data(req): Data<ExtTreeViewChildrenRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    if let Some(ext_host) = state.ext_host_manager.read().await.as_ref() {
        let resp = ext_host
            .send_request(
                "treeView/getChildren",
                json!({
                    "viewId": req.view_id,
                    "elementId": req.element_id
                }),
            )
            .await;
        if let Ok(children) = resp {
            ack.send(&children).ok();
            return;
        }
    }
    ack.send(&json!([])).ok();
}

#[derive(Debug, Deserialize)]
pub struct ExtQuickPickReply {
    #[serde(rename = "requestId")]
    pub request_id: String,
    pub selected: Option<Value>,
}

pub async fn handle_ext_quick_pick_reply(
    _socket: SocketRef,
    Data(req): Data<ExtQuickPickReply>,
    state: State<AppState>,
) {
    if let Ok(id) = req.request_id.parse::<u64>() {
        if let Some(ext_host) = state.ext_host_manager.read().await.as_ref() {
            let _ = ext_host.send_response(id, req.selected, None).await;
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct ExtInputBoxReply {
    #[serde(rename = "requestId")]
    pub request_id: String,
    pub value: Option<Value>,
}

pub async fn handle_ext_input_box_reply(
    _socket: SocketRef,
    Data(req): Data<ExtInputBoxReply>,
    state: State<AppState>,
) {
    if let Ok(id) = req.request_id.parse::<u64>() {
        if let Some(ext_host) = state.ext_host_manager.read().await.as_ref() {
            let _ = ext_host.send_response(id, req.value, None).await;
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct ExtWindowMessageReply {
    #[serde(rename = "requestId")]
    pub request_id: String,
    pub selected: Option<Value>,
}

pub async fn handle_ext_window_message_reply(
    _socket: SocketRef,
    Data(req): Data<ExtWindowMessageReply>,
    state: State<AppState>,
) {
    if let Ok(id) = req.request_id.parse::<u64>() {
        if let Some(ext_host) = state.ext_host_manager.read().await.as_ref() {
            let _ = ext_host.send_response(id, req.selected, None).await;
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct ExtWebviewIncomingMessage {
    #[serde(rename = "panelId")]
    pub panel_id: String,
    pub message: Value,
}

/// Forwards a message from a webview iframe to the extension host.
///
/// Socket.IO runs each event handler in its own task, so back-to-back messages can be
/// handled out of order. The ack is sent only after the message is written to the ext host,
/// so the frontend can wait for it before sending the next message.
pub async fn handle_ext_webview_message(
    _socket: SocketRef,
    Data(req): Data<ExtWebviewIncomingMessage>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("[backend:ext] ext:webview:message panel_id='{}' message={:?}", req.panel_id, req.message);
    if let Some(ext_host) = state.ext_host_manager.read().await.as_ref() {
        let _ = ext_host
            .send_notification(
                "webview/onMessage",
                json!({
                    "panelId": req.panel_id,
                    "message": req.message
                }),
            )
            .await;
    }
    ack.send(&json!({})).ok();
}

#[derive(Debug, Deserialize)]
pub struct ExtWebviewDisposeMessage {
    #[serde(rename = "panelId")]
    pub panel_id: String,
}

pub async fn handle_ext_webview_dispose(
    _socket: SocketRef,
    Data(req): Data<ExtWebviewDisposeMessage>,
    state: State<AppState>,
) {
    info!("[backend:ext] ext:webview:dispose panel_id='{}'", req.panel_id);
    if let Some(ext_host) = state.ext_host_manager.read().await.as_ref() {
        let _ = ext_host
            .send_notification(
                "webview/didDispose",
                json!({
                    "panelId": req.panel_id,
                }),
            )
            .await;
    }
}

#[derive(Debug, Deserialize)]
pub struct ExtWebviewViewResolveRequest {
    #[serde(rename = "viewId")]
    pub view_id: String,
    #[serde(rename = "panelId")]
    pub panel_id: String,
}

pub async fn handle_ext_webview_view_resolve(
    _socket: SocketRef,
    Data(req): Data<ExtWebviewViewResolveRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("[backend:ext] ext:webview_view:resolve view_id='{}' panel_id='{}'", req.view_id, req.panel_id);
    if let Some(ext_host) = state.ext_host_manager.read().await.as_ref() {
        // Ensure any extension providing this view is activated first
        let installed = state.extension_manager.storage.load_installed().unwrap_or_default();
        for ext in &installed {
            if !ext.enabled {
                continue;
            }
            let has_view = ext.manifest.contributes.as_ref().and_then(|c| c.views.as_ref()).map_or(false, |v| {
                if let Some(obj) = v.as_object() {
                    obj.values().any(|arr| {
                        arr.as_array().map_or(false, |list| {
                            list.iter().any(|item| item.get("id").and_then(|id| id.as_str()) == Some(&req.view_id))
                        })
                    })
                } else {
                    false
                }
            });
            if has_view {
                let _ = ext_host.activate_if_needed(&ext.id, &ext.dir, &ext.manifest).await;
            }
        }

        let resp = ext_host
            .send_request(
                "webviewView/resolve",
                json!({
                    "viewId": req.view_id,
                    "panelId": req.panel_id
                }),
            )
            .await;
        if let Ok(res) = resp {
            let success = match res {
                Value::Bool(b) => b,
                Value::Object(ref map) => map.get("success").and_then(|v| v.as_bool()).unwrap_or(true),
                _ => true,
            };
            let html = if let Value::Object(ref map) = res {
                map.get("html").cloned()
            } else {
                None
            };
            if success {
                ack.send(&json!({ "success": true, "html": html })).ok();
            } else {
                ack.send(&json!({ "success": false, "error": format!("View provider not ready or failed to initialize for {}", req.view_id) })).ok();
            }
            return;
        }
    }
    ack.send(&json!({ "success": false, "error": "Extension host is unavailable or failed to resolve view" })).ok();
}

#[derive(Debug, Deserialize)]
pub struct ExtFileQuery {
    pub path: String,
}

pub async fn ext_file_query_handler(
    AxumState(state): AxumState<AppState>,
    AxumQuery(query): AxumQuery<ExtFileQuery>,
) -> Response {
    serve_ext_file(&state, &query.path).await
}

pub async fn ext_file_path_handler(
    AxumState(state): AxumState<AppState>,
    AxumPath(path): AxumPath<String>,
) -> Response {
    let full_path = if path.starts_with('/') {
        path
    } else {
        format!("/{}", path)
    };
    serve_ext_file(&state, &full_path).await
}

async fn serve_ext_file(state: &AppState, raw_path: &str) -> Response {
    let decoded_path = percent_encoding::percent_decode_str(raw_path)
        .decode_utf8_lossy()
        .to_string();
    let p = std::path::PathBuf::from(&decoded_path);

    let ext_root = &state.extension_manager.storage.root_dir;
    let allowed = if let (Ok(can_path), Ok(can_root)) = (p.canonicalize(), ext_root.canonicalize()) {
        can_path.starts_with(can_root)
    } else {
        false
    };

    if !allowed {
        return StatusCode::FORBIDDEN.into_response();
    }

    if let Ok(bytes) = fs::read(&p) {
        let mime = mime_guess::from_path(&p)
            .first_or_octet_stream()
            .to_string();

        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, mime)
            .header(header::CACHE_CONTROL, "public, max-age=3600")
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(Body::from(bytes))
            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response());
    }

    StatusCode::NOT_FOUND.into_response()
}

/// HTTP handler to serve static assets from installed extension directories
pub async fn ext_asset_handler(
    AxumState(state): AxumState<AppState>,
    AxumPath((ext_id, path)): AxumPath<(String, String)>,
) -> Response {
    if let Some(asset_file) = state.extension_manager.get_asset_path(&ext_id, &path) {
        if let Ok(bytes) = fs::read(&asset_file) {
            let mime = mime_guess::from_path(&asset_file)
                .first_or_octet_stream()
                .to_string();

            let resp = Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, mime)
                .header(header::CACHE_CONTROL, "public, max-age=3600")
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .body(Body::from(bytes))
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response());
            return resp;
        }
    }

    StatusCode::NOT_FOUND.into_response()
}

#[derive(Debug, Deserialize)]
pub struct ExtHandleUriRequest {
    pub uri: String,
}

pub async fn handle_ext_handle_uri(
    _socket: SocketRef,
    Data(req): Data<ExtHandleUriRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("[backend:ext] ext:handle_uri uri='{}'", req.uri);
    if let Some(ext_host) = state.ext_host_manager.read().await.as_ref() {
        let _ = ext_host.send_notification("window/handleUri", json!({ "uri": req.uri })).await;
    }
    ack.send(&json!({ "success": true })).ok();
}

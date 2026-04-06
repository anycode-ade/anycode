use crate::app_state::{AppState, send_response};
use serde::{Deserialize, Serialize};
use serde_json::json;
use socketioxide::extract::{AckSender, Data, State};
use tracing::info;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitFileOriginalRequest {
    pub path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitCommitRequest {
    pub files: Vec<String>,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitRevertRequest {
    pub path: String,
}

pub async fn handle_git_status(ack: AckSender, state: State<AppState>) {
    info!("Received git:status");
    let result = {
        let git = state.git_manager.lock().await;
        git.status().map(|s| s.to_json())
    };
    send_response(ack, result);
}

pub async fn handle_git_file_original(
    Data(request): Data<GitFileOriginalRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("Received git:file-original: {:?}", request.path);
    let result = {
        let git = state.git_manager.lock().await;
        git.file_original(&request.path).map(|f| {
            json!({
                "content": f.content,
                "is_new": f.is_new
            })
        })
    };
    send_response(ack, result);
}

pub async fn handle_git_commit(
    Data(request): Data<GitCommitRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("Received git:commit: {} files", request.files.len());
    let result = {
        let git = state.git_manager.lock().await;
        git.commit(&request.files, &request.message)
            .map(|_| json!({}))
    };
    send_response(ack, result);
}

pub async fn handle_git_push(ack: AckSender, state: State<AppState>) {
    info!("Received git:push");
    let result = {
        let git = state.git_manager.lock().await;
        git.push().map(|_| json!({}))
    };
    send_response(ack, result);
}

pub async fn handle_git_pull(ack: AckSender, state: State<AppState>) {
    info!("Received git:pull");
    let result = {
        let git = state.git_manager.lock().await;
        git.pull().map(|r| r.to_json())
    };
    send_response(ack, result);
}

pub async fn handle_git_revert(
    Data(request): Data<GitRevertRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("Received git:revert: {:?}", request.path);
    let result = {
        let git = state.git_manager.lock().await;
        git.revert(&request.path).map(|_| json!({}))
    };
    send_response(ack, result);
}

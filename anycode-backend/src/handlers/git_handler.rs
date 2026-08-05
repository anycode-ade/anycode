use crate::app_state::{AppState, send_response};
use crate::git::GitHistorySearchMode;
use serde::{Deserialize, Serialize};
use serde_json::json;
use socketioxide::extract::{AckSender, Data, SocketRef, State};
use tracing::info;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitFileOriginalRequest {
    pub path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitCommitRequest {
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitRevertRequest {
    pub path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitCheckoutRequest {
    pub branch: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitHistoryRequest {
    #[serde(default)]
    pub offset: usize,
    #[serde(default = "default_history_limit")]
    pub limit: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitHistorySearchRequest {
    pub mode: GitHistorySearchMode,
    pub query: String,
    #[serde(default)]
    pub offset: usize,
    #[serde(default = "default_history_limit")]
    pub limit: usize,
}

fn default_history_limit() -> usize {
    50
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitHistoryCommitRequest {
    pub hash: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitHistoryFileRequest {
    pub hash: String,
    pub path: String,
    #[serde(default)]
    pub old_path: Option<String>,
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

pub async fn handle_git_history(
    Data(request): Data<GitHistoryRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!(
        "Received git:history: offset={}, limit={}",
        request.offset, request.limit
    );
    let result = {
        let git = state.git_manager.lock().await;
        git.history(request.offset, request.limit).map(|page| {
            json!({
                "commits": page.commits,
                "has_more": page.has_more,
            })
        })
    };
    send_response(ack, result);
}

pub async fn handle_git_history_search(
    Data(request): Data<GitHistorySearchRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!(
        "Received git:history-search: mode={:?}, offset={}, limit={}",
        request.mode, request.offset, request.limit
    );
    let result = {
        let git = state.git_manager.lock().await;
        git.search_history(request.mode, &request.query, request.offset, request.limit)
            .map(|page| json!({ "commits": page.commits, "has_more": page.has_more }))
    };
    send_response(ack, result);
}

pub async fn handle_git_history_files(
    Data(request): Data<GitHistoryCommitRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("Received git:history-files: {}", request.hash);
    let result = {
        let git = state.git_manager.lock().await;
        git.history_files(&request.hash)
            .map(|files| json!({ "files": files }))
    };
    send_response(ack, result);
}

pub async fn handle_git_history_file(
    Data(request): Data<GitHistoryFileRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!(
        "Received git:history-file: {} {:?}",
        request.hash, request.path
    );
    let result = {
        let git = state.git_manager.lock().await;
        git.history_file_content(&request.hash, &request.path, request.old_path.as_deref())
            .map(|content| json!(content))
    };
    send_response(ack, result);
}

pub async fn handle_git_commit(
    socket: SocketRef,
    Data(request): Data<GitCommitRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("Received git:commit");

    let (result, changes_update) = {
        let mut git = state.git_manager.lock().await;
        match git.commit(&request.message) {
            Ok(_) => {
                let status = git.refresh_status_cache().map(|s| s.to_json());
                (Ok(json!({})), status.ok())
            }
            Err(e) => (Err(e), None),
        }
    };

    send_response(ack, result);

    if let Some(update) = changes_update {
        let _ = socket.emit("git:update", &update);
        let _ = socket.broadcast().emit("git:update", &update).await;
    }
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

pub async fn handle_git_branches(ack: AckSender, state: State<AppState>) {
    info!("Received git:branches");
    let result = {
        let git = state.git_manager.lock().await;
        git.list_branches()
            .map(|branches| json!({ "branches": branches }))
    };
    send_response(ack, result);
}

pub async fn handle_git_checkout(
    Data(request): Data<GitCheckoutRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("Received git:checkout: {}", request.branch);
    let result = {
        let mut git = state.git_manager.lock().await;
        git.checkout_branch(&request.branch)
            .and_then(|_| git.refresh_status_cache().map(|_| json!({})))
    };
    send_response(ack, result);
}

pub async fn handle_git_revert(
    socket: SocketRef,
    Data(request): Data<GitRevertRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("Received git:revert: {:?}", request.path);
    let (result, status_update) = {
        let mut git = state.git_manager.lock().await;
        match git.revert(&request.path).and_then(|_| {
            git.refresh_status_cache()
                .map(|status| (json!({}), status.to_json()))
        }) {
            Ok((response, status)) => (Ok(response), Some(status)),
            Err(error) => (Err(error), None),
        }
    };
    send_response(ack, result);

    if let Some(status) = status_update {
        let _ = socket.emit("git:update", &status);
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitStageRequest {
    pub path: String,
}

pub async fn handle_git_stage(
    Data(request): Data<GitStageRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("Received git:stage: {:?}", request.path);
    let result = {
        let git = state.git_manager.lock().await;
        git.stage(&request.path).map(|_| json!({}))
    };
    send_response(ack, result);
}

pub async fn handle_git_unstage(
    Data(request): Data<GitStageRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("Received git:unstage: {:?}", request.path);
    let result = {
        let git = state.git_manager.lock().await;
        git.unstage(&request.path).map(|_| json!({}))
    };
    send_response(ack, result);
}

pub async fn is_file_tracked(abs_path: &str, state: &AppState) -> bool {
    let git = state.git_manager.lock().await;
    match git.file_original(abs_path) {
        Ok(file) => !file.is_new,
        Err(_) => false,
    }
}

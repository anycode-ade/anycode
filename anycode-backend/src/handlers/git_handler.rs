use crate::app_state::{ActiveGitHistorySearch, AppState, SocketData, send_response};
use crate::git::{
    GitHistorySearchMode, GitHistorySearchOutcome, SearchHistorySession,
    SearchHistorySessionCommand,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use socketioxide::extract::{AckSender, Data, SocketRef, State};
use tokio::sync::{mpsc, oneshot};
use tokio_util::sync::CancellationToken;
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
    pub request_id: u64,
    pub mode: GitHistorySearchMode,
    pub query: String,
    #[serde(default)]
    pub offset: usize,
    #[serde(default = "default_history_limit")]
    pub limit: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitHistorySearchCancelRequest {
    #[serde(default)]
    pub request_id: Option<u64>,
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
    socket: SocketRef,
    Data(request): Data<GitHistorySearchRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!(
        "Received git:history-search: request_id={}, mode={:?}, offset={}, limit={}",
        request.request_id, request.mode, request.offset, request.limit
    );

    let sid = socket.id.as_str().to_string();
    let query = request.query.trim().to_string();
    let (sender, new_worker) = {
        let mut sockets_data = state.socket2data.lock().await;
        let data = sockets_data
            .entry(sid.clone())
            .or_insert_with(SocketData::default);
        if request.offset > 0 {
            if let Some(active) = data.git_history_search.as_ref() {
                (active.sender.clone(), None)
            } else {
                let _ = ack.send(&json!({
                    "success": true,
                    "request_id": request.request_id,
                    "commits": [],
                    "streamed": true,
                    "has_more": false,
                }));
                return;
            }
        } else {
            let cancel = CancellationToken::new();
            let (sender, receiver) = mpsc::unbounded_channel();
            let session = SearchHistorySession::new(
                crate::utils::current_dir(),
                request.mode,
                query.clone(),
                cancel.clone(),
            );
            data.replace_git_history_search(ActiveGitHistorySearch {
                sender: sender.clone(),
                cancel,
            });
            (sender, Some((session, receiver)))
        }
    };

    if let Some((session, receiver)) = new_worker {
        tokio::task::spawn_blocking(move || session.run(receiver));
    }

    let request_id = request.request_id;
    let (batch_tx, mut batch_rx) = mpsc::unbounded_channel();
    let (response_tx, response_rx) = oneshot::channel();

    if sender.send(SearchHistorySessionCommand::NextPage {
            limit: request.limit,
            batches: Some(batch_tx),
            response: response_tx,
    }).is_err() {
        let _ = ack.send(&json!({
            "success": false,
            "request_id": request_id,
            "error": "Git history search session stopped",
        }));
        return;
    }

    let socket_for_batches = socket.clone();
    while let Some(commits) = batch_rx.recv().await {
        let _ = socket_for_batches.emit(
            "git:history-search:results",
            &json!({
                "request_id": request_id,
                "commits": commits,
            }),
        );
    }
    let outcome = response_rx.await;
    match outcome {
        Ok(Ok(GitHistorySearchOutcome::Complete(page))) => {
            let _ = ack.send(&json!({
                "success": true,
                "request_id": request_id,
                "commits": [],
                "streamed": true,
                "has_more": page.has_more,
            }));
        }
        Ok(Ok(GitHistorySearchOutcome::Cancelled)) => {
            let _ = ack.send(&json!({
                "success": false,
                "cancelled": true,
                "request_id": request_id,
            }));
        }
        Ok(Err(error)) => {
            let _ = ack.send(&json!({
                "success": false,
                "request_id": request_id,
                "error": format!("{error:#}"),
            }));
        }
        Err(_) => {
            let _ = ack.send(&json!({
                "success": false,
                "request_id": request_id,
                "error": "Git history search session stopped",
            }));
        }
    }
}

pub async fn handle_git_history_search_cancel(
    socket: SocketRef,
    Data(request): Data<GitHistorySearchCancelRequest>,
    state: State<AppState>,
) {
    let sid = socket.id.as_str();
    let cancelled = {
        let mut sockets_data = state.socket2data.lock().await;
        sockets_data
            .get_mut(sid)
            .is_some_and(SocketData::cancel_git_history_search)
    };
    info!(
        "Git history search cancel for socket {} request_id={:?}: {}",
        sid, request.request_id, cancelled
    );
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

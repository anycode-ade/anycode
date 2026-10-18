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
use std::sync::Arc;
use tokio::sync::Mutex;

async fn project_git_for_request(
    socket: &SocketRef,
    state: &AppState,
    project_id: Option<&str>,
) -> anyhow::Result<Arc<Mutex<crate::git::GitManager>>> {
    let project = match project_id {
        Some(project_id) => state.workspace.lock().await.get(project_id),
        None => state.project_for_socket(socket.id.as_str()).await,
    };
    project
        .map(|project| project.git)
        .ok_or_else(|| anyhow::anyhow!("No project is selected or the project was removed"))
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitFileOriginalRequest {
    pub path: String,
    #[serde(default)]
    pub project_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitCommitRequest {
    pub message: String,
    #[serde(default)]
    pub project_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitRevertRequest {
    pub path: String,
    #[serde(default)]
    pub project_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitCheckoutRequest {
    pub branch: String,
    #[serde(default)]
    pub project_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitHistoryRequest {
    #[serde(default)]
    pub offset: usize,
    #[serde(default = "default_history_limit")]
    pub limit: usize,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
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
    #[serde(default)]
    pub project_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitHistorySearchCancelRequest {
    #[serde(default)]
    pub request_id: Option<u64>,
}

fn default_history_limit() -> usize {
    50
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct GitProjectRequest {
    #[serde(default)]
    pub project_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitHistoryCommitRequest {
    pub hash: String,
    #[serde(default)]
    pub project_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitHistoryFileRequest {
    pub hash: String,
    pub path: String,
    #[serde(default)]
    pub old_path: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
}

pub async fn handle_git_status(
    socket: SocketRef,
    Data(request): Data<GitProjectRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("Received git:status");
    let git_manager = match project_git_for_request(&socket, &state, request.project_id.as_deref()).await {
        Ok(git) => git,
        Err(error) => return send_response(ack, Err(error)),
    };
    let result = {
        let git = git_manager.lock().await;
        git.status().map(|s| s.to_json())
    };
    let mut result = result;
    if let (Some(project_id), Ok(value)) = (request.project_id, result.as_mut()) {
        value["project_id"] = serde_json::json!(project_id);
    }
    send_response(ack, result);
}

pub async fn handle_git_file_original(
    socket: SocketRef,
    Data(request): Data<GitFileOriginalRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("Received git:file-original: {:?}", request.path);
    let git_manager = match project_git_for_request(&socket, &state, request.project_id.as_deref()).await {
        Ok(git) => git,
        Err(error) => return send_response(ack, Err(error)),
    };
    let result = {
        let git = git_manager.lock().await;
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
    socket: SocketRef,
    Data(request): Data<GitHistoryRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!(
        "Received git:history: offset={}, limit={}, path={:?}",
        request.offset, request.limit, request.path
    );
    let git_manager = match project_git_for_request(&socket, &state, request.project_id.as_deref()).await {
        Ok(git) => git,
        Err(error) => return send_response(ack, Err(error)),
    };
    let result = {
        let git = git_manager.lock().await;
        request
            .path
            .as_deref()
            .map_or_else(
                || git.history(request.offset, request.limit),
                |path| git.file_history(path, request.offset, request.limit),
            )
            .map(|page| {
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

    let project = match request.project_id.as_deref() {
        Some(project_id) => state.workspace.lock().await.get(project_id),
        None => state.project_for_socket(socket.id.as_str()).await,
    };
    let project = match project {
        Some(project) => project,
        None => {
            let _ = ack.send(&json!({ "success": false, "error": "No project is selected" }));
            return;
        }
    };
    let project_id = project.info.id.clone();
    let project_root = std::path::PathBuf::from(&project.info.root);
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
                project_root,
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
                "project_id": project_id.clone(),
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
                "project_id": project_id.clone(),
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
    socket: SocketRef,
    Data(request): Data<GitHistoryCommitRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("Received git:history-files: {}", request.hash);
    let git_manager = match project_git_for_request(&socket, &state, request.project_id.as_deref()).await {
        Ok(git) => git,
        Err(error) => return send_response(ack, Err(error)),
    };
    let result = {
        let git = git_manager.lock().await;
        git.history_files(&request.hash)
            .map(|files| json!({ "files": files }))
    };
    send_response(ack, result);
}

pub async fn handle_git_history_file(
    socket: SocketRef,
    Data(request): Data<GitHistoryFileRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!(
        "Received git:history-file: {} {:?}",
        request.hash, request.path
    );
    let git_manager = match project_git_for_request(&socket, &state, request.project_id.as_deref()).await {
        Ok(git) => git,
        Err(error) => return send_response(ack, Err(error)),
    };
    let result = {
        let git = git_manager.lock().await;
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

    let git_manager = match project_git_for_request(&socket, &state, request.project_id.as_deref()).await {
        Ok(git) => git,
        Err(error) => return send_response(ack, Err(error)),
    };
    let project_id = request.project_id.clone().or(state.active_project_id(socket.id.as_str()).await);
    let (result, changes_update) = {
        let mut git = git_manager.lock().await;
        match git.commit(&request.message) {
            Ok(_) => {
                let status = git.refresh_status_cache().map(|s| s.to_json());
                (Ok(json!({})), status.ok())
            }
            Err(e) => (Err(e), None),
        }
    };

    send_response(ack, result);

    if let Some(mut update) = changes_update {
        if let Some(object) = update.as_object_mut() {
            object.insert("project_id".to_string(), json!(project_id));
        }
        let _ = socket.emit("git:update", &update);
        let _ = socket.broadcast().emit("git:update", &update).await;
    }
}

pub async fn handle_git_push(
    socket: SocketRef,
    Data(request): Data<GitProjectRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("Received git:push");
    let git_manager = match project_git_for_request(&socket, &state, request.project_id.as_deref()).await {
        Ok(git) => git,
        Err(error) => return send_response(ack, Err(error)),
    };
    let result = {
        let git = git_manager.lock().await;
        git.push().map(|status| json!({ "status": status }))
    };
    send_response(ack, result);
}

pub async fn handle_git_pull(
    socket: SocketRef,
    Data(request): Data<GitProjectRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("Received git:pull");
    let git_manager = match project_git_for_request(&socket, &state, request.project_id.as_deref()).await {
        Ok(git) => git,
        Err(error) => return send_response(ack, Err(error)),
    };
    let result = {
        let git = git_manager.lock().await;
        git.pull().map(|r| r.to_json())
    };
    send_response(ack, result);
}

pub async fn handle_git_fetch(
    socket: SocketRef,
    Data(request): Data<GitProjectRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("Received git:fetch");
    let git_manager = match project_git_for_request(&socket, &state, request.project_id.as_deref()).await {
        Ok(git) => git,
        Err(error) => return send_response(ack, Err(error)),
    };
    let result = {
        let git = git_manager.lock().await;
        git.fetch().map(|_| json!({ "status": "success" }))
    };
    send_response(ack, result);
}


pub async fn handle_git_branches(
    socket: SocketRef,
    Data(request): Data<GitProjectRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("Received git:branches");
    let git_manager = match project_git_for_request(&socket, &state, request.project_id.as_deref()).await {
        Ok(git) => git,
        Err(error) => return send_response(ack, Err(error)),
    };
    let result = {
        let git = git_manager.lock().await;
        git.list_branches()
            .map(|branches| json!({ "branches": branches }))
    };
    send_response(ack, result);
}

pub async fn handle_git_checkout(
    socket: SocketRef,
    Data(request): Data<GitCheckoutRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("Received git:checkout: {}", request.branch);
    let git_manager = match project_git_for_request(&socket, &state, request.project_id.as_deref()).await {
        Ok(git) => git,
        Err(error) => return send_response(ack, Err(error)),
    };
    let result = {
        let mut git = git_manager.lock().await;
        git.checkout_branch(&request.branch)
            .and_then(|_| git.refresh_status_cache().map(|_| json!({})))
    };
    send_response(ack, result);
}

pub async fn handle_git_create_branch(
    socket: SocketRef,
    Data(request): Data<GitCheckoutRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("Received git:create_branch: {}", request.branch);
    let git_manager = match project_git_for_request(&socket, &state, request.project_id.as_deref()).await {
        Ok(git) => git,
        Err(error) => return send_response(ack, Err(error)),
    };
    let result = {
        let mut git = git_manager.lock().await;
        git.create_branch(&request.branch)
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
    let git_manager = match project_git_for_request(&socket, &state, request.project_id.as_deref()).await {
        Ok(git) => git,
        Err(error) => return send_response(ack, Err(error)),
    };
    let project_id = request.project_id.clone().or(state.active_project_id(socket.id.as_str()).await);
    let (result, status_update) = {
        let mut git = git_manager.lock().await;
        match git.revert(&request.path).and_then(|_| {
            git.refresh_status_cache()
                .map(|status| (json!({}), status.to_json()))
        }) {
            Ok((response, status)) => (Ok(response), Some(status)),
            Err(error) => (Err(error), None),
        }
    };
    send_response(ack, result);

    if let Some(mut status) = status_update {
        if let Some(object) = status.as_object_mut() {
            object.insert("project_id".to_string(), json!(project_id));
        }
        let _ = socket.emit("git:update", &status);
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitStageRequest {
    pub path: String,
    #[serde(default)]
    pub project_id: Option<String>,
}

pub async fn handle_git_stage(
    socket: SocketRef,
    Data(request): Data<GitStageRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("Received git:stage: {:?}", request.path);
    let git_manager = match project_git_for_request(&socket, &state, request.project_id.as_deref()).await {
        Ok(git) => git,
        Err(error) => return send_response(ack, Err(error)),
    };
    let result = {
        let git = git_manager.lock().await;
        git.stage(&request.path).map(|_| json!({}))
    };
    send_response(ack, result);
}

pub async fn handle_git_unstage(
    socket: SocketRef,
    Data(request): Data<GitStageRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("Received git:unstage: {:?}", request.path);
    let git_manager = match project_git_for_request(&socket, &state, request.project_id.as_deref()).await {
        Ok(git) => git,
        Err(error) => return send_response(ack, Err(error)),
    };
    let result = {
        let git = git_manager.lock().await;
        git.unstage(&request.path).map(|_| json!({}))
    };
    send_response(ack, result);
}

pub async fn is_file_tracked(abs_path: &str, state: &AppState) -> bool {
    let project = state
        .workspace
        .lock()
        .await
        .find_project_for_path(std::path::Path::new(abs_path));
    let Some(project) = project else { return false };
    let git = project.git.lock().await;
    match git.file_original(abs_path) {
        Ok(file) => !file.is_new,
        Err(_) => false,
    }
}

use crate::app_state::{AppState, SocketData, send_response};
use crate::workspace::{canonical_directory, list_directory_entries, project_info_for_path};
use serde::Deserialize;
use serde_json::{Value, json};
use socketioxide::extract::{AckSender, Data, SocketRef, State};
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
pub struct BrowseRequest {
    #[serde(default)]
    pub path: Option<String>,
}

pub async fn handle_workspace_state(
    socket: SocketRef,
    ack: AckSender,
    state: State<AppState>,
) {
    send_response(ack, workspace_state(&socket, &state).await);
}

pub async fn handle_workspace_add_project(
    socket: SocketRef,
    Data(request): Data<BrowseRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    let Some(path) = request.path else {
        send_response(ack, Err(anyhow::anyhow!("Choose a server folder first")));
        return;
    };

    let _lifecycle = state.workspace_lifecycle.lock().await;
    let project_root = state.workspace.lock().await.starting_directory();
    let requested_path = PathBuf::from(&path);
    let requested_path = if requested_path.is_absolute() {
        requested_path
    } else {
        project_root.join(requested_path)
    };
    let canonical_path = match canonical_directory(&requested_path) {
        Ok(path) => path,
        Err(error) => {
            send_response(ack, Err(error));
            return;
        }
    };
    let already_present = state
        .workspace
        .lock()
        .await
        .get(&canonical_path.to_string_lossy())
        .is_some();
    let project_info = match project_info_for_path(&canonical_path) {
        Ok(info) => info,
        Err(error) => {
            send_response(ack, Err(error));
            return;
        }
    };
    if let Err(error) = state
        .send_project_watch_command(|reply| {
            crate::background_tasks::ProjectWatchCommand::Add(project_info, reply)
        })
        .await
    {
        send_response(ack, Err(error));
        return;
    }
    let info = {
        let mut workspace = state.workspace.lock().await;
        workspace.add_project(&canonical_path)
    };
    match info {
        Ok(project) => {
            let sid = socket.id.as_str().to_string();
            state
                .socket2data
                .lock()
                .await
                .entry(sid)
                .or_insert_with(SocketData::default)
                .select_project(project.id.clone());
            if !already_present {
                let _ = socket
                    .broadcast()
                    .emit("workspace:project-added", &project);
            }
            send_response(ack, workspace_state(&socket, &state).await);
        }
        Err(error) => {
            if !already_present {
                let _ = state
                    .send_project_watch_command(|reply| {
                        crate::background_tasks::ProjectWatchCommand::Remove(
                            canonical_path.to_string_lossy().into_owned(),
                            reply,
                        )
                    })
                    .await;
            }
            send_response(ack, Err(error));
        }
    }
}

pub async fn handle_workspace_remove_project(
    socket: SocketRef,
    Data(request): Data<ProjectRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    let _lifecycle = state.workspace_lifecycle.lock().await;
    let has_running_terminal = state
        .terminals
        .lock()
        .await
        .values()
        .any(|terminal| terminal.project_id == request.project_id);
    if has_running_terminal {
        send_response(
            ack,
            Err(anyhow::anyhow!(
                "Close this project's running terminals before removing it"
            )),
        );
        return;
    }
    if state
        .agent_project_ids
        .lock()
        .await
        .values()
        .any(|project_id| project_id == &request.project_id)
    {
        send_response(
            ack,
            Err(anyhow::anyhow!(
                "Stop this project's running agents before removing it"
            )),
        );
        return;
    }
    let project_runtime = state.workspace.lock().await.get(&request.project_id);
    let watcher_result = state
        .send_project_watch_command(|reply| {
            crate::background_tasks::ProjectWatchCommand::Remove(
                request.project_id.clone(),
                reply,
            )
        })
        .await;
    if let Err(error) = watcher_result {
        send_response(ack, Err(error));
        return;
    }
    let result = {
        let mut workspace = state.workspace.lock().await;
        workspace.remove_project(&request.project_id)
    };
    match result {
        Ok(project) => {
            let root = PathBuf::from(&project.root);
            if let Some(project_runtime) = project_runtime {
                project_runtime.lsp.lock().await.stop_all().await;
            }
            state
                .file2code
                .lock()
                .await
                .retain(|path, _| !PathBuf::from(path).starts_with(&root));
            let mut sockets = state.socket2data.lock().await;
            for data in sockets.values_mut() {
                if data.active_project_id.as_deref() == Some(request.project_id.as_str()) {
                    data.active_project_id = None;
                }
                data.opened_files
                    .retain(|path| !PathBuf::from(path).starts_with(&root));
                data.opened_dirs
                    .retain(|path| !PathBuf::from(path).starts_with(&root));
                if data.search_project_id.as_deref() == Some(request.project_id.as_str()) {
                    if let Some(cancel) = data.search_cancel.take() {
                        cancel.cancel();
                    }
                    data.search_project_id = None;
                    data.search_pattern = None;
                    data.search_last_file_result = None;
                }
            }
            let _ = socket
                .broadcast()
                .emit("workspace:project-removed", &json!({ "project_id": request.project_id }));
            send_response(ack, workspace_state(&socket, &state).await);
        }
        Err(error) => send_response(ack, Err(error)),
    }
}

#[derive(Debug, Deserialize)]
pub struct ProjectRequest {
    pub project_id: String,
}

pub async fn handle_workspace_select_project(
    socket: SocketRef,
    Data(request): Data<ProjectRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    let _lifecycle = state.workspace_lifecycle.lock().await;
    let exists = state.workspace.lock().await.get(&request.project_id).is_some();
    if !exists {
        send_response(
            ack,
            Err(anyhow::anyhow!(
                "Project is no longer part of this workspace"
            )),
        );
        return;
    }
    let sid = socket.id.as_str().to_string();
    state
        .socket2data
        .lock()
        .await
        .entry(sid)
        .or_insert_with(SocketData::default)
        .select_project(request.project_id);
    send_response(ack, workspace_state(&socket, &state).await);
}

pub async fn handle_workspace_close(
    socket: SocketRef,
    ack: AckSender,
    state: State<AppState>,
) {
    let _lifecycle = state.workspace_lifecycle.lock().await;
    if !state.terminals.lock().await.is_empty() {
        send_response(
            ack,
            Err(anyhow::anyhow!(
                "Close running terminals before closing this workspace"
            )),
        );
        return;
    }
    if !state.agent_project_ids.lock().await.is_empty() {
        send_response(
            ack,
            Err(anyhow::anyhow!(
                "Stop running agents before closing this workspace"
            )),
        );
        return;
    }

    let runtime_projects = {
        let workspace = state.workspace.lock().await;
        workspace
            .projects()
            .into_iter()
            .filter_map(|info| workspace.get(&info.id))
            .collect::<Vec<_>>()
    };
    let project_ids = runtime_projects
        .iter()
        .map(|project| project.info.id.clone())
        .collect::<Vec<_>>();
    let mut unwatched: Vec<String> = Vec::new();
    for project_id in &project_ids {
        if let Err(error) = state
            .send_project_watch_command(|reply| {
                crate::background_tasks::ProjectWatchCommand::Remove(project_id.clone(), reply)
            })
            .await
        {
            for removed_id in unwatched {
                if let Some(project) = state.workspace.lock().await.get(&removed_id) {
                    if let Err(restore_error) = state
                        .send_project_watch_command(|reply| {
                            crate::background_tasks::ProjectWatchCommand::Add(project.info, reply)
                        })
                        .await
                    {
                        tracing::error!(
                            "Could not restore project watcher after failed workspace close: {restore_error}"
                        );
                    }
                }
            }
            send_response(ack, Err(error));
            return;
        }
        unwatched.push(project_id.clone());
    }

    let removed = match state
        .workspace
        .lock()
        .await
        .remove_projects(&project_ids)
    {
        Ok(removed) => removed,
        Err(error) => {
            for project in &runtime_projects {
                let _ = state
                    .send_project_watch_command(|reply| {
                        crate::background_tasks::ProjectWatchCommand::Add(project.info.clone(), reply)
                    })
                    .await;
            }
            send_response(ack, Err(error));
            return;
        }
    };
    for project in &runtime_projects {
        project.lsp.lock().await.stop_all().await;
    }

    let roots = removed
        .iter()
        .map(|project| PathBuf::from(&project.root))
        .collect::<Vec<_>>();
    state
        .file2code
        .lock()
        .await
        .retain(|path, _| !roots.iter().any(|root| PathBuf::from(path).starts_with(root)));
    {
        let mut sockets = state.socket2data.lock().await;
        for data in sockets.values_mut() {
            if data
                .active_project_id
                .as_deref()
                .is_some_and(|id| project_ids.iter().any(|removed_id| removed_id == id))
            {
                data.active_project_id = None;
            }
            data.opened_files
                .retain(|path| !roots.iter().any(|root| PathBuf::from(path).starts_with(root)));
            data.opened_dirs
                .retain(|path| !roots.iter().any(|root| PathBuf::from(path).starts_with(root)));
            if data
                .search_project_id
                .as_deref()
                .is_some_and(|id| project_ids.iter().any(|removed_id| removed_id == id))
            {
                if let Some(cancel) = data.search_cancel.take() {
                    cancel.cancel();
                }
                data.search_project_id = None;
                data.search_pattern = None;
                data.search_last_file_result = None;
            }
        }
    }

    let _ = socket.broadcast().emit(
        "workspace:closed",
        &json!({ "project_ids": project_ids }),
    );
    send_response(ack, workspace_state(&socket, &state).await);
}

pub async fn handle_workspace_browse(
    Data(request): Data<BrowseRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    let default_path = state.workspace.lock().await.starting_directory();
    let requested = request
        .path
        .filter(|path| !path.trim().is_empty())
        .map(|path| {
            let path = PathBuf::from(path);
            if path.is_absolute() {
                path
            } else {
                default_path.join(path)
            }
        })
        .unwrap_or(default_path);
    let path = match canonical_directory(&requested) {
        Ok(path) => path,
        Err(error) => {
            send_response(ack, Err(error));
            return;
        }
    };
    let (directories, _) = match list_directory_entries(&path) {
        Ok(entries) => entries,
        Err(error) => {
            send_response(ack, Err(error));
            return;
        }
    };
    let parent = path
        .parent()
        .filter(|parent| *parent != path)
        .map(|parent| parent.to_string_lossy().into_owned());
    let result = json!({
        "path": path.to_string_lossy(),
        "name": path.file_name().and_then(|name| name.to_str()).unwrap_or("/"),
        "parent": parent,
        "directories": directories
            .into_iter()
            .map(|(name, path)| json!({ "name": name, "path": path }))
            .collect::<Vec<_>>(),
    });
    send_response(ack, Ok(result));
}

#[derive(Debug, Deserialize)]
pub struct RecentWorkspaceRequest {
    pub path: String,
}

pub async fn handle_workspace_remove_recent(
    Data(request): Data<RecentWorkspaceRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    let recent_workspaces = state
        .workspace
        .lock()
        .await
        .remove_recent_workspace(&request.path);
    send_response(ack, Ok(json!({ "recent_workspaces": recent_workspaces })));
}

async fn workspace_state(socket: &SocketRef, state: &State<AppState>) -> anyhow::Result<Value> {
    let (projects, recent_workspaces, default_project_id) = {
        let workspace = state.workspace.lock().await;
        (
            workspace.projects(),
            workspace.recent_workspaces().to_vec(),
            workspace.default_project_id(),
        )
    };
    let recent = recent_workspaces
        .iter()
        .map(|item| {
            json!({
                "path": item.path,
                "name": item.name,
                "last_opened": item.last_opened,
            })
        })
        .collect::<Vec<_>>();
    let active_project_id = state
        .active_project_id(socket.id.as_str())
        .await
        .or(default_project_id);
    Ok(json!({
        "projects": projects,
        "active_project_id": active_project_id,
        "recent_workspaces": recent,
    }))
}

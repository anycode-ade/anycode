use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Result;
use lsp_types::PublishDiagnosticsParams;
use notify::{Event, RecursiveMode, Watcher, recommended_watcher};
use socketioxide::SocketIo;
use tokio::sync::mpsc::Receiver;
use tokio::sync::{Mutex, mpsc};
use tokio::time::{self, Duration};

use crate::acp_fs;
use crate::app_state::AppState;
use crate::handlers::watch_handler::handle_watch_event;
use crate::workspace::ProjectInfo;

fn register_project_watch(
    watcher: &mut notify::RecommendedWatcher,
    watched: &mut HashMap<String, String>,
    project: &ProjectInfo,
) -> std::result::Result<(), String> {
    if watched.contains_key(&project.id) {
        return Ok(());
    }
    watcher
        .watch(
            std::path::Path::new(&project.root),
            RecursiveMode::Recursive,
        )
        .map_err(|error| error.to_string())?;
    watched.insert(project.id.clone(), project.root.clone());
    Ok(())
}

fn unregister_project_watch(
    watcher: &mut notify::RecommendedWatcher,
    watched: &mut HashMap<String, String>,
    project_id: &str,
) -> std::result::Result<(), String> {
    if let Some(root) = watched.get(project_id).cloned() {
        watcher
            .unwatch(std::path::Path::new(&root))
            .map_err(|error| error.to_string())?;
        watched.remove(project_id);
    }
    Ok(())
}

pub enum ProjectWatchCommand {
    Add(ProjectInfo, tokio::sync::oneshot::Sender<std::result::Result<(), String>>),
    Remove(
        String,
        tokio::sync::oneshot::Sender<std::result::Result<(), String>>,
    ),
}

/// Spawns all background tasks: ACP filesystem loop, LSP diagnostics forwarding,
/// and file system watcher.
///
pub async fn spawn_all(
    state: &AppState,
    io: &Arc<SocketIo>,
    diagnostics_rx: Receiver<PublishDiagnosticsParams>,
    acp_fs_rx: Receiver<acp_fs::AcpFsCommand>,
) -> Result<()> {
    spawn_acp_fs(state, io, acp_fs_rx);
    spawn_diagnostics(io, state.workspace.clone(), diagnostics_rx);
    spawn_git_status_watcher(state, io);
    spawn_tool_outputs_cleanup(state.acp_db.clone());
    spawn_file_watcher(state, io).await
}

fn spawn_tool_outputs_cleanup(acp_db: Arc<crate::acp_db::AcpDb>) {
    tokio::spawn(async move {
        // Initial cleanup at startup (7 days TTL, max 500 records)
        let _ = acp_db.cleanup_old_outputs(7 * 86400, 500);

        let mut ticker = time::interval(Duration::from_secs(3600));
        ticker.set_missed_tick_behavior(time::MissedTickBehavior::Skip);

        loop {
            ticker.tick().await;
            let _ = acp_db.cleanup_old_outputs(7 * 86400, 500);
        }
    });
}

fn spawn_git_status_watcher(state: &AppState, io: &Arc<SocketIo>) {
    let workspace = state.workspace.clone();
    let socket = io.clone();

    tokio::spawn(async move {
        let mut ticker = time::interval(Duration::from_secs(2));
        ticker.set_missed_tick_behavior(time::MissedTickBehavior::Skip);

        loop {
            ticker.tick().await;

            let projects = workspace.lock().await.projects();
            for info in projects {
                let project = workspace.lock().await.get(&info.id);
                let Some(project) = project else { continue };
                let update = {
                    let mut git = project.git.lock().await;
                    git.check_status_changed().map(|status| status.to_json())
                };
                if let Some(mut status_update) = update {
                    if workspace.lock().await.get(&info.id).is_none() {
                        continue;
                    }
                    if let Some(object) = status_update.as_object_mut() {
                        object.insert("project_id".to_string(), serde_json::json!(info.id));
                    }
                    if let Err(error) = socket.emit("git:update", &status_update).await {
                        tracing::error!("error while sending git:update {}", error);
                    }
                }
            }
        }
    });
}

fn spawn_acp_fs(state: &AppState, io: &Arc<SocketIo>, acp_fs_rx: Receiver<acp_fs::AcpFsCommand>) {
    let file2code = state.file2code.clone();
    let lsp_manager = state.lsp_manager.clone();
    let workspace = state.workspace.clone();
    let config = state.config.as_ref().clone();
    let io = io.clone();

    tokio::spawn(acp_fs::run_acp_fs_loop(
        acp_fs_rx,
        file2code,
        lsp_manager,
        workspace,
        config,
        io,
    ));
}

fn spawn_diagnostics(
    io: &Arc<SocketIo>,
    workspace: Arc<Mutex<crate::workspace::WorkspaceManager>>,
    mut diagnostics_rx: Receiver<PublishDiagnosticsParams>,
) {
    let socket = io.clone();
    tokio::spawn(async move {
        while let Some(diagnostic_message) = diagnostics_rx.recv().await {
            let project_path = url::Url::parse(&diagnostic_message.uri.to_string())
                .ok()
                .and_then(|uri| uri.to_file_path().ok());
            let project_id = if let Some(path) = project_path {
                workspace
                    .lock()
                    .await
                    .find_project_for_path(&path)
                    .map(|project| project.info.id)
            } else {
                None
            };
            let mut payload = serde_json::to_value(&diagnostic_message).unwrap_or_default();
            if let (Some(project_id), Some(object)) = (project_id, payload.as_object_mut()) {
                object.insert("project_id".to_string(), serde_json::json!(project_id));
            }
            let send_result = socket.emit("lsp:diagnostics", &payload).await;
            if let Err(e) = send_result {
                tracing::error!("error while sending lsp:diagnostics {}", e);
            }
        }
    });
}

async fn spawn_file_watcher(state: &AppState, io: &Arc<SocketIo>) -> Result<()> {
    let file2code = state.file2code.clone();
    let socket2data = state.socket2data.clone();
    let workspace = state.workspace.clone();

    let (watch_tx, mut watch_rx) = mpsc::channel::<notify::Result<Event>>(32);
    let mut watcher = recommended_watcher(move |res| {
        let _ = watch_tx.blocking_send(res);
    })?;

    let (control_tx, mut control_rx) = mpsc::unbounded_channel::<ProjectWatchCommand>();
    if let Ok(mut control) = state.watcher_control.lock() {
        *control = Some(control_tx);
    }

    let file_states = Arc::new(Mutex::new(HashMap::new()));
    let socket = io.clone();
    let initial_projects = workspace.lock().await.projects();
    let mut watched = HashMap::new();
    for project in &initial_projects {
        if let Err(error) = register_project_watch(&mut watcher, &mut watched, project) {
            tracing::error!("Could not watch project {}: {}", project.root, error);
        }
    }

    tokio::spawn(async move {
        loop {
            tokio::select! {
                Some(command) = control_rx.recv() => {
                    match command {
                        ProjectWatchCommand::Add(project, reply) => {
                            match register_project_watch(&mut watcher, &mut watched, &project) {
                                Ok(()) => { let _ = reply.send(Ok(())); }
                                Err(error) => {
                                    tracing::error!("Could not watch project {}: {}", project.root, error);
                                    let _ = reply.send(Err(error));
                                }
                            }
                        }
                        ProjectWatchCommand::Remove(project_id, reply) => {
                            if let Err(error) = unregister_project_watch(&mut watcher, &mut watched, &project_id) {
                                tracing::warn!("Could not stop watching removed project {}: {}", project_id, error);
                                let _ = reply.send(Err(error));
                            } else {
                                let _ = reply.send(Ok(()));
                            }
                        }
                    }
                }
                Some(res) = watch_rx.recv() => {
                    match res {
                        Ok(event) => {
                            for path in &event.paths {
                                if crate::utils::is_ignored_path(path) {
                                    continue;
                                }
                                let project = workspace.lock().await.find_project_for_path(path);
                                let Some(project) = project else { continue };
                                if !watched.contains_key(&project.info.id) {
                                    continue;
                                }
                                handle_watch_event(
                                    path,
                                    &event,
                                    &project.info.id,
                                    std::path::Path::new(&project.info.root),
                                    &socket,
                                    &file2code,
                                    &socket2data,
                                    &file_states,
                                    &project.git,
                                    &project.lsp,
                                    &workspace,
                                ).await;
                            }
                        }
                        Err(error) => tracing::error!("File watcher error: {error:?}"),
                    }
                }
                else => break,
            }
        }
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{register_project_watch, unregister_project_watch};
    use crate::workspace::ProjectInfo;
    use notify::recommended_watcher;
    use std::collections::HashMap;
    use std::time::{Duration, Instant};

    #[test]
    fn external_changes_are_observed_for_two_independent_project_roots() {
        let root_a = tempfile::tempdir().unwrap();
        let root_b = tempfile::tempdir().unwrap();
        let startup_dir = std::env::current_dir().unwrap();
        assert!(!root_a.path().starts_with(&startup_dir));
        assert!(!root_b.path().starts_with(&startup_dir));
        let root_a_path = root_a.path().canonicalize().unwrap();
        let root_b_path = root_b.path().canonicalize().unwrap();

        let project_a = ProjectInfo {
            id: root_a_path.to_string_lossy().to_string(),
            name: "root-a".to_string(),
            root: root_a_path.to_string_lossy().to_string(),
        };
        let project_b = ProjectInfo {
            id: root_b_path.to_string_lossy().to_string(),
            name: "root-b".to_string(),
            root: root_b_path.to_string_lossy().to_string(),
        };
        let (events_tx, events_rx) = std::sync::mpsc::channel();
        let mut watcher = recommended_watcher(move |event| {
            let _ = events_tx.send(event);
        })
        .unwrap();
        let mut watched = HashMap::new();
        register_project_watch(&mut watcher, &mut watched, &project_a).unwrap();
        register_project_watch(&mut watcher, &mut watched, &project_b).unwrap();

        let file_a = root_a_path.join("same.txt");
        let file_b = root_b_path.join("same.txt");
        std::fs::write(&file_a, "root A").unwrap();
        std::fs::write(&file_b, "root B").unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        let (mut saw_a, mut saw_b) = (false, false);
        while Instant::now() < deadline && !(saw_a && saw_b) {
            if let Ok(Ok(event)) = events_rx.recv_timeout(Duration::from_millis(250)) {
                for path in event.paths {
                    saw_a |= path == file_a;
                    saw_b |= path == file_b;
                }
            }
        }
        assert!(saw_a && saw_b, "watcher did not report changes from both roots");

        unregister_project_watch(&mut watcher, &mut watched, &project_a.id).unwrap();
        let file_b_updated = root_b_path.join("second.txt");
        std::fs::write(&file_b_updated, "still watched").unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut saw_b_after_removal = false;
        while Instant::now() < deadline && !saw_b_after_removal {
            if let Ok(Ok(event)) = events_rx.recv_timeout(Duration::from_millis(250)) {
                saw_b_after_removal |= event.paths.iter().any(|path| path == &file_b_updated);
            }
        }
        assert!(saw_b_after_removal, "removing one project stopped the other project's watcher");
    }
}

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

/// Spawns all background tasks: ACP filesystem loop, LSP diagnostics forwarding,
/// and file system watcher.
///
/// The returned `notify::RecommendedWatcher` must be kept alive for the duration
/// of the program — dropping it stops file watching.
pub fn spawn_all(
    state: &AppState,
    io: &Arc<SocketIo>,
    diagnostics_rx: Receiver<PublishDiagnosticsParams>,
    acp_fs_rx: Receiver<acp_fs::AcpFsCommand>,
) -> Result<notify::RecommendedWatcher> {
    spawn_acp_fs(state, io, acp_fs_rx);
    spawn_diagnostics(io, diagnostics_rx);
    spawn_git_status_watcher(state, io);
    let watcher = spawn_file_watcher(state, io)?;
    Ok(watcher)
}

fn spawn_git_status_watcher(state: &AppState, io: &Arc<SocketIo>) {
    let git_manager = state.git_manager.clone();
    let socket = io.clone();

    tokio::spawn(async move {
        let mut ticker = time::interval(Duration::from_secs(2));
        ticker.set_missed_tick_behavior(time::MissedTickBehavior::Skip);

        loop {
            ticker.tick().await;

            let update = {
                let mut git = git_manager.lock().await;
                git.check_status_changed().map(|status| status.to_json())
            };

            if let Some(status_update) = update {
                let send_result = socket.emit("git:update", &status_update).await;
                if let Err(e) = send_result {
                    tracing::error!("error while sending git:update {}", e);
                }
            }
        }
    });
}

fn spawn_acp_fs(state: &AppState, io: &Arc<SocketIo>, acp_fs_rx: Receiver<acp_fs::AcpFsCommand>) {
    let file2code = state.file2code.clone();
    let lsp_manager = state.lsp_manager.clone();
    let config = state.config.as_ref().clone();
    let io = io.clone();

    tokio::spawn(acp_fs::run_acp_fs_loop(
        acp_fs_rx,
        file2code,
        lsp_manager,
        config,
        io,
    ));
}

fn spawn_diagnostics(io: &Arc<SocketIo>, mut diagnostics_rx: Receiver<PublishDiagnosticsParams>) {
    let socket = io.clone();
    tokio::spawn(async move {
        while let Some(diagnostic_message) = diagnostics_rx.recv().await {
            let send_result = socket.emit("lsp:diagnostics", &diagnostic_message).await;
            if let Err(e) = send_result {
                tracing::error!("error while sending lsp:diagnostics {}", e);
            }
        }
    });
}

fn spawn_file_watcher(state: &AppState, io: &Arc<SocketIo>) -> Result<notify::RecommendedWatcher> {
    let file2code = state.file2code.clone();
    let socket2data = state.socket2data.clone();
    let git_manager = state.git_manager.clone();
    let lsp_manager = state.lsp_manager.clone();

    let (watch_tx, mut watch_rx) = mpsc::channel::<notify::Result<Event>>(32);
    let mut watcher = recommended_watcher(move |res| {
        let _ = watch_tx.blocking_send(res);
    })?;

    let dir = std::path::Path::new(".");
    watcher.watch(dir, RecursiveMode::Recursive)?;

    let file_states = Arc::new(Mutex::new(HashMap::new()));
    let socket = io.clone();
    tokio::spawn(async move {
        while let Some(res) = watch_rx.recv().await {
            match res {
                Ok(event) => {
                    for path in &event.paths {
                        if crate::utils::is_ignored_path(path) {
                            continue;
                        } else {
                            handle_watch_event(
                                path,
                                &event,
                                &socket,
                                &file2code,
                                &socket2data,
                                &file_states,
                                &git_manager,
                                &lsp_manager,
                            )
                            .await
                        }
                    }
                }
                Err(e) => eprintln!("watch error: {:?}", e),
            }
        }
    });

    Ok(watcher)
}

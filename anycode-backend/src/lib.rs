use anyhow::Result;
use lsp_types::PublishDiagnosticsParams;
use socketioxide::SocketIo;
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot};
use tower::ServiceBuilder;
use tower_http::cors::CorsLayer;
use tracing::info;

pub mod acp;
pub mod acp_db;
pub mod acp_fs;
pub mod acp_history;
pub mod acp_registry;
pub mod acp_terminal;
pub mod app_state;
pub mod background_tasks;
pub mod code;
pub mod config;
pub mod diff;
pub mod ext_host;
pub mod extensions;
pub mod git;
pub mod handlers;
pub mod history;
pub mod lsp;
pub mod search;
pub mod terminal;
pub mod updater;
pub mod utils;
pub mod workspace;

#[cfg(test)]
mod windows_path_tests;

use app_state::AppState;
use handlers::auth_handler::auth_middleware;
use handlers::connection_handler::handle_connect;
use handlers::static_handler::{local_image_handler, static_handler};
use socketioxide::handler::ConnectHandler;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone)]
pub struct ServerOptions {
    pub host: String,
    pub port: u16,
    pub token: Option<String>,
    pub initial_workspace: Option<std::path::PathBuf>,
}

impl Default for ServerOptions {
    fn default() -> Self {
        Self {
            host: "0.0.0.0".to_string(),
            port: 3000,
            token: None,
            initial_workspace: None,
        }
    }
}

pub async fn start_server(
    options: ServerOptions,
    ready_tx: Option<oneshot::Sender<u16>>,
    shutdown_token: Option<CancellationToken>,
) -> Result<()> {
    let (diagnostic_tx, diagnostic_rx) = mpsc::channel::<PublishDiagnosticsParams>(1);
    let (acp_fs_tx, acp_fs_rx) = mpsc::channel::<acp_fs::AcpFsCommand>(32);
    let startup_root = options
        .initial_workspace
        .clone()
        .unwrap_or_else(crate::utils::current_dir);
    let state = AppState::new_for_server(
        diagnostic_tx.clone(),
        acp_fs_tx,
        options.token.clone(),
        startup_root.clone(),
        options.initial_workspace.is_some(),
    );

    let (layer, io) = SocketIo::builder().with_state(state.clone()).build_layer();
    let cors = ServiceBuilder::new()
        .layer(CorsLayer::permissive())
        .layer(layer);

    let io = Arc::new(io);

    // Watcher must be kept alive — dropping it stops file watching
    background_tasks::spawn_all(&state, &io, diagnostic_rx, acp_fs_rx).await?;

    // Spawn Extension Host
    let ext_diagnostic_tx = diagnostic_tx.clone();
    let ext_startup_root = startup_root.clone();
    let ext_state = state.clone();
    let ext_io = io.clone();
    tokio::spawn(async move {
        match ext_host::ExtHostManager::spawn(&ext_startup_root, ext_diagnostic_tx).await {
            Ok(ext_host) => {
                ext_host.set_socket_io(ext_io);
                let installed = ext_state.extension_manager.storage.load_installed().unwrap_or_default();
                for ext in &installed {
                    if ext.enabled {
                        ext_host.register_manifest(&ext.manifest).await;
                        if ext.manifest.activation_events.iter().any(|e| e == "*" || e == "onStartupFinished") {
                            let _ = ext_host.activate_if_needed(&ext.id, &ext.dir, &ext.manifest).await;
                        }
                    }
                }
                *ext_state.ext_host_manager.write().await = Some(ext_host);
                info!("Extension host spawned successfully");
            }
            Err(e) => {
                tracing::warn!("Could not spawn extension host (running without sidecar): {:#}", e);
            }
        }
    });

    io.ns("/", handle_connect.with(auth_middleware));

    let app = axum::Router::new()
        .route("/api/local-image", axum::routing::get(local_image_handler))
        .route("/api/ext-file", axum::routing::get(handlers::extension_handler::ext_file_query_handler))
        .route("/api/ext-file/{*path}", axum::routing::get(handlers::extension_handler::ext_file_path_handler))
        .route("/api/ext-asset/{ext_id}/{*path}", axum::routing::get(handlers::extension_handler::ext_asset_handler))
        .fallback(static_handler)
        .with_state(state.clone())
        .layer(cors);

    let bind_addr = format!("{}:{}", options.host, options.port);
    let listener = tokio::net::TcpListener::bind(&bind_addr).await?;
    let bound_port = listener.local_addr()?.port();

    info!("Starting anycode at http://{}:{}", options.host, bound_port);
    if options.token.is_some() {
        info!("Access token protection enabled.");
    }

    if let Some(tx) = ready_tx {
        let _ = tx.send(bound_port);
    }

    let cancel = shutdown_token.unwrap_or_default();

    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {},
                _ = cancel.cancelled() => {},
            }
        })
        .await?;

    state.shutdown().await;

    Ok(())
}

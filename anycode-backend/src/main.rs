use std::sync::Arc;
use anyhow::Result;
use lsp_types::PublishDiagnosticsParams;
use socketioxide::SocketIo;
use tokio::sync::mpsc;
use tower::ServiceBuilder;
use tower_http::cors::CorsLayer;
use tracing::info;

mod acp;
mod acp_fs;
mod acp_history;
mod app_state;
mod background_tasks;
mod code;
mod config;
mod diff;
mod git;
mod handlers;
mod history;
mod lsp;
mod search;
mod terminal;
mod utils;

use app_state::AppState;
use handlers::connection_handler::handle_connect;
use handlers::static_handler::static_handler;

#[tokio::main]
async fn main() -> Result<()> {
    config::handle_early_cli_flags();

    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::new("info"))
        .init();

    let (diagnostic_tx, diagnostic_rx) = mpsc::channel::<PublishDiagnosticsParams>(1);
    let (acp_fs_tx, acp_fs_rx) = mpsc::channel::<acp_fs::AcpFsCommand>(32);
    let state = AppState::new(diagnostic_tx, acp_fs_tx);

    let (layer, io) = SocketIo::builder().with_state(state.clone()).build_layer();
    let cors = ServiceBuilder::new()
        .layer(CorsLayer::permissive())
        .layer(layer);

    let io = Arc::new(io);

    // Watcher must be kept alive — dropping it stops file watching
    let _watcher = background_tasks::spawn_all(&state, &io, diagnostic_rx, acp_fs_rx)?;

    io.ns("/", handle_connect);

    let app = axum::Router::new()
        .fallback(static_handler)
        .with_state(io.clone())
        .layer(cors);

    let port = config::resolve_server_port()?;
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port)).await?;

    info!("Starting anycode at http://localhost:{}", port);

    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;

    state.shutdown().await;

    Ok(())
}

use anyhow::Result;
use lsp_types::PublishDiagnosticsParams;
use socketioxide::SocketIo;
use std::sync::Arc;
use tokio::sync::mpsc;
use tower::ServiceBuilder;
use tower_http::cors::CorsLayer;
use tracing::info;

mod acp;
pub mod acp_db;
mod acp_fs;
mod acp_history;
pub mod acp_registry;
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
use handlers::auth_handler::auth_middleware;
use handlers::connection_handler::handle_connect;
use handlers::static_handler::{local_image_handler, static_handler};
use socketioxide::handler::ConnectHandler;

#[tokio::main]
async fn main() -> Result<()> {
    config::handle_early_cli_flags();

    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::new("info"))
        .init();

    let server_options = config::resolve_server_options()?;
    let port = server_options.port;
    let auth_token = server_options.token;

    let (diagnostic_tx, diagnostic_rx) = mpsc::channel::<PublishDiagnosticsParams>(1);
    let (acp_fs_tx, acp_fs_rx) = mpsc::channel::<acp_fs::AcpFsCommand>(32);
    let state = AppState::new(diagnostic_tx, acp_fs_tx, auth_token.clone());

    let (layer, io) = SocketIo::builder().with_state(state.clone()).build_layer();
    let cors = ServiceBuilder::new()
        .layer(CorsLayer::permissive())
        .layer(layer);

    let io = Arc::new(io);

    // Watcher must be kept alive — dropping it stops file watching
    let _watcher = background_tasks::spawn_all(&state, &io, diagnostic_rx, acp_fs_rx)?;

    io.ns("/", handle_connect.with(auth_middleware));

    let app = axum::Router::new()
        .route("/api/local-image", axum::routing::get(local_image_handler))
        .fallback(static_handler)
        .with_state(state.clone())
        .layer(cors);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port)).await?;

    info!("Starting anycode at http://localhost:{}", port);
    if auth_token.is_some() {
        info!("Access token protection enabled.");
    }

    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;

    state.shutdown().await;

    Ok(())
}

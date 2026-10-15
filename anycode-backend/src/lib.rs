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
pub mod app_state;
pub mod background_tasks;
pub mod code;
pub mod config;
pub mod diff;
pub mod git;
pub mod handlers;
pub mod history;
pub mod lsp;
pub mod search;
pub mod terminal;
pub mod utils;

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
}

impl Default for ServerOptions {
    fn default() -> Self {
        Self {
            host: "0.0.0.0".to_string(),
            port: 3000,
            token: None,
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
    let state = AppState::new(diagnostic_tx, acp_fs_tx, options.token.clone());

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

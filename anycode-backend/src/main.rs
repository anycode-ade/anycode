use anyhow::Result;
use axum::{
    http::{StatusCode, Uri, header},
    response::{Html, IntoResponse, Response},
};
use socketioxide::{
    SocketIo,
    extract::{SocketRef, State},
};
use tower::ServiceBuilder;
use tower_http::cors::CorsLayer;
use tracing::info;

mod acp;
mod acp_history;
mod code;
mod config;
mod git;
mod lsp;
mod utils;
use acp::{AcpManager, AcpPermissionMode};
use git::GitManager;
use lsp::LspManager;

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio::sync::{Mutex, mpsc::Receiver};

mod app_state;
use app_state::*;

mod diff;

mod handlers;
use handlers::{
    acp_handler::*, git_handler::*, io_handler::*, lsp_handler::*, search_handler::*,
    terminal_handler::*, watch_handler::handle_watch_event,
};

mod history;
mod search;
mod terminal;

use lsp_types::PublishDiagnosticsParams;
use notify::{Event, RecursiveMode, Watcher, recommended_watcher};

async fn on_connect(socket: SocketRef, state: State<AppState>) {
    info!("Socket.IO connected: {:?} {:?}", socket.ns(), socket.id);

    socket.on("file:open", handle_file_open);
    socket.on("dir:list", handle_dir_list);
    socket.on("file:change", handle_file_change);
    socket.on("file:save", handle_file_save);
    socket.on("file:create", handle_create);
    socket.on("file:close", handle_file_close);

    socket.on("lsp:completion", handle_completion);
    socket.on("lsp:definition", handle_definition);
    socket.on("lsp:references", handle_references);
    socket.on("lsp:hover", handle_hover);

    socket.on("search:start", handle_search);
    socket.on("search:cancel", handle_search_cancel);

    socket.on("terminal:start", handle_terminal_start);
    socket.on("terminal:input", handle_terminal_input);
    socket.on("terminal:resize", handle_terminal_resize);
    socket.on("terminal:close", handle_terminal_close);
    socket.on("terminal:reconnect", handle_terminal_reconnect);

    socket.on("acp:start", handle_acp_start);
    socket.on("acp:prompt", handle_acp_prompt);
    socket.on("acp:stop", handle_acp_stop);
    socket.on("acp:cancel", handle_acp_cancel);
    socket.on("acp:set_model", handle_acp_set_model);
    socket.on("acp:set_reasoning", handle_acp_set_reasoning);
    socket.on("acp:list", handle_acp_list);
    socket.on("acp:sessions_list", handle_acp_sessions_list);
    socket.on("acp:reconnect", handle_acp_reconnect);
    socket.on("acp:permission_response", handle_acp_permission_response);
    socket.on("acp:set_permission_mode", handle_acp_permission_mode);
    socket.on("acp:undo", handle_acp_undo);

    socket.on("git:status", handle_git_status);
    socket.on("git:file-original", handle_git_file_original);
    socket.on("git:commit", handle_git_commit);
    socket.on("git:push", handle_git_push);
    socket.on("git:pull", handle_git_pull);
    socket.on("git:revert", handle_git_revert);

    socket.on_disconnect(on_disconnect)
}

async fn on_disconnect(socket: SocketRef, state: State<AppState>) {
    info!("Socket.IO disconnected: {}", socket.id);

    let sid = socket.id.as_str().to_string();

    // Get opened files for this socket before removing socket data
    let opened_files = {
        let sockets_data = state.socket2data.lock().await;
        match sockets_data.get(&sid) {
            Some(socket_data) => socket_data.opened_files.clone(),
            None => return,
        }
    };

    // Get languages for files opened by this socket
    let languages = {
        let f2c = state.file2code.lock().await;
        opened_files
            .iter()
            .filter_map(|path| f2c.get(path).map(|code| code.lang.clone()))
            .collect::<HashSet<_>>()
    };

    // Remove socket data
    let mut sockets_data = state.socket2data.lock().await;
    sockets_data.remove(&sid);
    drop(sockets_data);

    // Get all opened files from remaining sockets
    let all_opened_files: HashSet<String> = {
        let sockets_data = state.socket2data.lock().await;
        sockets_data
            .values()
            .flat_map(|data| data.opened_files.iter())
            .cloned()
            .collect()
    };

    // Clean up files that are no longer opened by any socket
    let files_to_close: Vec<(String, String)> = {
        let f2c = state.file2code.lock().await;
        opened_files
            .iter()
            .filter(|path| !all_opened_files.contains(*path))
            .filter_map(|path| f2c.get(path).map(|code| (path.clone(), code.lang.clone())))
            .collect()
    };

    // Close files
    {
        let mut lsp_manager = state.lsp_manager.lock().await;
        // let mut f2c = state.file2code.lock().await;

        for (file_path, lang) in &files_to_close {
            if let Some(lsp) = lsp_manager.get(lang).await {
                lsp.did_close(file_path);
                // f2c.remove(file_path);
            }
        }
    }

    // Stop LSP servers for languages that have no files opened by other sockets
    for lang in languages {
        if !is_language_opened(&lang, &state).await {
            info!("Lsp autoclose: '{}'", lang);
            let mut lsp_manager = state.lsp_manager.lock().await;
            lsp_manager.stop(&lang).await;
        }
    }
}

fn build_app_state() -> (AppState, Receiver<PublishDiagnosticsParams>) {
    let config = crate::config::get();
    let acp_permission_mode = AcpPermissionMode::from_env();

    let (diagnostic_send, diagnostic_recv) = mpsc::channel::<PublishDiagnosticsParams>(1);
    let mut lsp_manager = LspManager::new(config.clone());
    lsp_manager.set_diagnostics_sender(diagnostic_send);

    let lsp_manager = Arc::new(Mutex::new(lsp_manager));
    let acp_manager = Arc::new(Mutex::new(AcpManager::new(acp_permission_mode)));
    let git_manager = Arc::new(Mutex::new(GitManager::new(crate::utils::current_dir())));

    let file2code = Arc::new(Mutex::new(HashMap::new()));
    let socket2data = Arc::new(Mutex::new(HashMap::new()));
    let terminals = Arc::new(Mutex::new(HashMap::new()));

    let state = AppState {
        config,
        file2code,
        lsp_manager,
        acp_manager,
        git_manager: git_manager.clone(),
        socket2data,
        terminals,
    };

    (state, diagnostic_recv)
}

static INDEX_HTML: &str = "index.html";

async fn static_handler(uri: Uri) -> impl IntoResponse {
    info!("static handler {:?}", uri.path());

    let path = uri.path().trim_start_matches('/');

    if path.is_empty() || path == INDEX_HTML {
        return index_html().await;
    }

    match crate::config::Dist::get(path) {
        Some(content) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            ([(header::CONTENT_TYPE, mime.as_ref())], content.data).into_response()
        }
        None => {
            if path.contains('.') {
                return not_found().await;
            }

            index_html().await
        }
    }
}

async fn index_html() -> Response {
    match crate::config::Dist::get(INDEX_HTML) {
        Some(content) => Html(content.data).into_response(),
        None => not_found().await,
    }
}

async fn not_found() -> Response {
    (StatusCode::NOT_FOUND, "404").into_response()
}

fn print_help() {
    println!("anycode - Code editor server");
    println!();
    println!("USAGE:");
    println!("    anycode [OPTIONS]");
    println!();
    println!("OPTIONS:");
    println!("    -h, --help       Print help information");
    println!("    --version        Print version information");
    println!();
    println!("ENVIRONMENT:");
    println!("    ANYCODE_PORT     Port to listen on (default: 3000)");
    println!("    ANYCODE_HOME     Path to configuration directory");
    println!("    ANYCODE_ACP_PERMISSION_MODE  ACP permission mode: full_access (default) or ask");
    println!();
    println!("Start the anycode server. The server will be available at http://localhost:<port>");
}

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();

    if args.len() > 1 {
        match args[1].as_str() {
            "--help" | "-h" => {
                print_help();
                return Ok(());
            }
            "--version" | "-V" => {
                println!("anycode {}", env!("CARGO_PKG_VERSION"));
                return Ok(());
            }
            _ => {
                eprintln!("Unknown option: {}", args[1]);
                eprintln!("Run 'anycode --help' for usage information.");
                std::process::exit(1);
            }
        }
    }

    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::new("info"))
        .init();

    let (state, mut diagnostics_channel) = build_app_state();
    let file2code = state.file2code.clone();
    let socket2data = state.socket2data.clone();
    let git_manager = state.git_manager.clone();

    let (layer, io) = SocketIo::builder().with_state(state).build_layer();
    let cors = ServiceBuilder::new()
        .layer(CorsLayer::permissive())
        .layer(layer);

    let io = Arc::new(io);

    // Spawn a task to handle diagnostics
    let socket = io.clone();
    tokio::spawn(async move {
        while let Some(diagnostic_message) = diagnostics_channel.recv().await {
            // log2::debug!("diagnostic_message_json {}", diagnostic_message_json);
            let send_result = socket.emit("lsp:diagnostics", &diagnostic_message).await;
            match send_result {
                Ok(_) => {}
                Err(e) => {
                    tracing::error!("error while sending lsp:diagnostics {}", e);
                }
            }
        }
    });

    // Spawn a task to watch files and dirs changes and send events to the socket
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
                        if crate::utils::is_ignored_dir(path) {
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
                            )
                            .await
                        }
                    }
                }
                Err(e) => eprintln!("watch error: {:?}", e),
            }
        }
    });

    io.ns("/", on_connect);

    let app = axum::Router::new()
        .fallback(static_handler)
        .with_state(io.clone())
        .layer(cors);

    let port = std::env::var("ANYCODE_PORT").unwrap_or("3000".to_string());
    let url = format!("0.0.0.0:{}", port);
    let listener = tokio::net::TcpListener::bind(url).await?;

    println!("Starting anycode at http://localhost:{}", port);

    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;

    Ok(())
}

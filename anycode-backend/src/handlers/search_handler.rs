use crate::app_state::{AppState, SocketData};
use crate::search::{FileSearchResult, global_search};
use crate::utils::{abs_file, is_ignored_path, relative_to_current_dir};
use serde::{Deserialize, Serialize};
use serde_json::{self, json};
use socketioxide::extract::{Data, SocketRef, State};
use std::path::PathBuf;
use tokio::sync::mpsc;
use tokio::time::{self, Duration, MissedTickBehavior};
use tokio_util::sync::CancellationToken;
use tracing::info;

const SEARCH_RESULT_BATCH_INTERVAL: Duration = Duration::from_millis(200);
const FILES_SEARCH_RESULT_BATCH_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchRequest {
    pub pattern: String,
}

#[derive(Debug, Serialize)]
struct SearchResultsBatch {
    results: Vec<FileSearchResult>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FilesSearchRequest {
    pub query: String,
    pub request_id: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
struct FilesSearchResult {
    name: String,
    path: String,
    display_path: String,
    #[serde(rename = "type")]
    kind: &'static str,
}

fn file_name_matches_query(name: &str, relative_path: &str, query: &str) -> bool {
    let name = name.to_lowercase();
    let relative_path = relative_path.to_lowercase();
    let query = query.to_lowercase();

    // Support backslashes/slashes mismatch on Windows/Unix
    let query = query.replace('\\', "/");
    let relative_path = relative_path.replace('\\', "/");

    if query.contains('*') || query.contains('?') {
        return wildcard_match(&name, &query) || wildcard_match(&relative_path, &query);
    }

    name.contains(&query) || relative_path.contains(&query)
}

fn wildcard_match(value: &str, pattern: &str) -> bool {
    let value_chars: Vec<char> = value.chars().collect();
    let pattern_chars: Vec<char> = pattern.chars().collect();

    let mut value_index = 0;
    let mut pattern_index = 0;
    let mut star_index: Option<usize> = None;
    let mut star_match_index = 0;

    while value_index < value_chars.len() {
        if pattern_index < pattern_chars.len()
            && (pattern_chars[pattern_index] == '?'
                || pattern_chars[pattern_index] == value_chars[value_index])
        {
            value_index += 1;
            pattern_index += 1;
        } else if pattern_index < pattern_chars.len() && pattern_chars[pattern_index] == '*' {
            star_index = Some(pattern_index);
            star_match_index = value_index;
            pattern_index += 1;
        } else if let Some(star) = star_index {
            pattern_index = star + 1;
            star_match_index += 1;
            value_index = star_match_index;
        } else {
            return false;
        }
    }

    while pattern_index < pattern_chars.len() && pattern_chars[pattern_index] == '*' {
        pattern_index += 1;
    }

    pattern_index == pattern_chars.len()
}

fn search_files_by_name(
    root_path: PathBuf,
    query: String,
    cancel: CancellationToken,
    result_tx: mpsc::Sender<FilesSearchResult>,
) {
    let mut dirs = vec![root_path];

    while let Some(dir) = dirs.pop() {
        if cancel.is_cancelled() {
            break;
        }

        let entries = match std::fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            if cancel.is_cancelled() {
                break;
            }

            let path = entry.path();

            if is_ignored_path(&path) {
                continue;
            }

            if path.is_dir() {
                dirs.push(path);
                continue;
            }

            let name = match path.file_name().and_then(|name| name.to_str()) {
                Some(name) => name,
                None => continue,
            };

            let display_path = relative_to_current_dir(&path)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| path.to_string_lossy().to_string());

            if file_name_matches_query(name, &display_path, &query)
                && result_tx
                    .blocking_send(FilesSearchResult {
                        name: name.to_string(),
                        path: path.to_string_lossy().to_string(),
                        display_path,
                        kind: "file",
                    })
                    .is_err()
            {
                return;
            }
        }
    }
}

pub async fn handle_search(
    socket: SocketRef,
    Data(search_request): Data<SearchRequest>,
    state: State<AppState>,
) {
    info!("Received handle_search {}", search_request.pattern);

    let sid = socket.id.as_str();
    let mut sockets_data = state.socket2data.lock().await;

    // Get the socket data
    let data = sockets_data
        .entry(sid.to_string())
        .or_insert_with(|| SocketData::default());

    // Cancel the previous search if any
    if let Some(cancel) = &data.search_cancel {
        cancel.cancel();
    }

    // Create the cancellation token
    let cancel = CancellationToken::new();
    // Save the cancel in the socket data
    data.search_cancel = Some(cancel.clone());
    data.search_pattern = Some(search_request.pattern.clone());
    data.search_last_file_result = None;

    // Prepare search, get the current directory and create channel to collect results
    let current_dir = std::env::current_dir().unwrap();
    let (result_tx, mut result_rx) = mpsc::channel::<FileSearchResult>(1000);
    let socket_clone = socket.clone();

    let start = std::time::Instant::now();

    // Start the search in the background
    tokio::spawn(async move {
        let search_result =
            global_search(&current_dir, &search_request.pattern, cancel, result_tx).await;

        if let Err(err) = search_result {
            let _ = socket_clone.emit(
                "search:error",
                &json!({
                    "error": "Search failed", "message": err.to_string()
                }),
            );
        }
    });

    // Collect results and send them to the socket
    tokio::spawn(async move {
        let mut matches = 0;
        let mut batch = Vec::new();
        let mut batch_interval = time::interval(SEARCH_RESULT_BATCH_INTERVAL);
        batch_interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
        batch_interval.tick().await;

        // In cancel case, the loop will be ended automatically
        loop {
            tokio::select! {
                maybe_file_result = result_rx.recv() => {
                    match maybe_file_result {
                        Some(file_result) => {
                            matches += file_result.matches.len();
                            batch.push(file_result);
                        }
                        None => break,
                    }
                }
                _ = batch_interval.tick() => {
                    if !batch.is_empty() {
                        let results = std::mem::take(&mut batch);
                        let _ = socket.emit("search:results", &SearchResultsBatch { results });
                    }
                }
            }
        }

        if !batch.is_empty() {
            let results = std::mem::take(&mut batch);
            let _ = socket.emit("search:results", &SearchResultsBatch { results });
        }

        let _ = socket.emit(
            "search:end",
            &json!({
                "elapsed": start.elapsed().as_millis(),
                "matches": matches
            }),
        );
    });
}

pub async fn handle_search_cancel(socket: SocketRef, state: State<AppState>) {
    info!("Received handle_search_cancel");

    let sid = socket.id.as_str();
    let mut sockets_data = state.socket2data.lock().await;

    // Get the socket data
    if let Some(data) = sockets_data.get_mut(sid) {
        // Cancel the current search if any
        if let Some(cancel) = &data.search_cancel {
            cancel.cancel();
            info!("Search cancelled for socket {}", sid);
        }
        // Clear the cancel token
        data.search_cancel = None;
        data.search_pattern = None;
        data.search_last_file_result = None;
    }
}

pub async fn handle_files_search(
    socket: SocketRef,
    Data(request): Data<FilesSearchRequest>,
    state: State<AppState>,
) {
    info!("Received search:files:start: {:?}", request);

    let sid = socket.id.as_str();
    let mut sockets_data = state.socket2data.lock().await;
    let data = sockets_data
        .entry(sid.to_string())
        .or_insert_with(SocketData::default);

    if let Some(cancel) = &data.files_search_cancel {
        cancel.cancel();
    }

    let cancel = CancellationToken::new();
    data.files_search_cancel = Some(cancel.clone());
    drop(sockets_data);

    let query = request.query.trim().to_lowercase();
    if query.is_empty() {
        let _ = socket.emit(
            "search:files:end",
            &json!({
                "query": query,
                "request_id": request.request_id,
                "elapsed": 0,
                "matches": 0,
            }),
        );
        return;
    }

    let root = crate::utils::current_dir().to_string_lossy().into_owned();

    let root_path = match abs_file(&root) {
        Ok(path) => PathBuf::from(path),
        Err(e) => {
            let _ = socket.emit(
                "search:files:error",
                &json!({
                    "error": "Search failed",
                    "query": query,
                    "request_id": request.request_id,
                    "message": format!("Failed to resolve search root: {:?}", e),
                }),
            );
            return;
        }
    };

    let (result_tx, mut result_rx) = mpsc::channel::<FilesSearchResult>(1000);
    let search_cancel = cancel.clone();
    let socket_for_search = socket.clone();
    let query_for_search = query.clone();
    let query_for_events = query.clone();
    let request_id_for_events = request.request_id.clone();
    let start = std::time::Instant::now();

    tokio::task::spawn_blocking(move || {
        search_files_by_name(root_path, query_for_search, search_cancel, result_tx);
    });

    tokio::spawn(async move {
        let mut matches = 0;
        let mut batch = Vec::new();
        let mut batch_interval = time::interval(FILES_SEARCH_RESULT_BATCH_INTERVAL);
        batch_interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
        batch_interval.tick().await;

        loop {
            tokio::select! {
                maybe_result = result_rx.recv() => {
                    match maybe_result {
                        Some(result) => {
                            matches += 1;
                            batch.push(result);
                        }
                        None => break,
                    }
                }
                _ = batch_interval.tick() => {
                    if !batch.is_empty() {
                        let results = std::mem::take(&mut batch);
                        let _ = socket_for_search.emit(
                            "search:files:results",
                            &json!({
                                "query": query_for_events.clone(),
                                "request_id": request_id_for_events.clone(),
                                "results": results,
                            }),
                        );
                    }
                }
            }
        }

        if !batch.is_empty() {
            let results = std::mem::take(&mut batch);
            let _ = socket_for_search.emit(
                "search:files:results",
                &json!({
                    "query": query_for_events.clone(),
                    "request_id": request_id_for_events.clone(),
                    "results": results,
                }),
            );
        }

        let _ = socket_for_search.emit(
            "search:files:end",
            &json!({
                "query": query_for_events.clone(),
                "request_id": request_id_for_events.clone(),
                "elapsed": start.elapsed().as_millis(),
                "matches": matches,
            }),
        );
    });
}

pub async fn handle_files_search_cancel(socket: SocketRef, state: State<AppState>) {
    info!("Received search:files:cancel");

    let sid = socket.id.as_str();
    let mut sockets_data = state.socket2data.lock().await;

    if let Some(data) = sockets_data.get_mut(sid) {
        if let Some(cancel) = &data.files_search_cancel {
            cancel.cancel();
            info!("Files search cancelled for socket {}", sid);
        }
        data.files_search_cancel = None;
    }
}

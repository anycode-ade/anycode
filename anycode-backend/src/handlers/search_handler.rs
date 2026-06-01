use crate::app_state::{AppState, SocketData};
use crate::search::FileSearchResult;
use serde::{Deserialize, Serialize};
use serde_json::{self, json};
use socketioxide::extract::{Data, SocketRef, State};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tracing::info;
use std::sync::Arc;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use fff_search::{GrepMode, GrepSearchOptions, QueryParser, AiGrepConfig};

use crate::config::use_fff_search;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchRequest {
    pub pattern: String,
    pub preview: Option<bool>,
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

    // Prepare search, get the current directory and create channel to collect results
    let (result_tx, mut result_rx) = mpsc::channel::<FileSearchResult>(1000);
    let socket_clone = socket.clone();

    let start = std::time::Instant::now();

    let state_clone = state.clone();
    let cancel_clone = cancel.clone();
    let cancel_rx = cancel.clone();
    // Start the search in the background
    tokio::spawn(async move {
        let run_search = async {
            if use_fff_search() {
                let parser = QueryParser::new(AiGrepConfig);
                let parsed_query = parser.parse(&search_request.pattern);

                let abort_signal = Arc::new(AtomicBool::new(false));
                let abort_signal_clone = abort_signal.clone();
                
                tokio::spawn(async move {
                    cancel_clone.cancelled().await;
                    abort_signal_clone.store(true, Ordering::Release);
                });

                let grep_options = GrepSearchOptions {
                    max_file_size: 10 * 1024 * 1024,
                    max_matches_per_file: 100,
                    smart_case: true,
                    file_offset: 0,
                    page_limit: 10000,
                    mode: GrepMode::PlainText,
                    time_budget_ms: 0,
                    before_context: 0,
                    after_context: 0,
                    classify_definitions: false,
                    trim_whitespace: true,
                    abort_signal: Some(abort_signal),
                };

                let grep_start = std::time::Instant::now();
                let (matches, base_path, paths) = {
                    let picker_guard = state_clone.fff_picker.read()
                        .map_err(|e| anyhow::anyhow!("Failed to lock file picker: {:?}", e))?;
                    let picker = picker_guard.as_ref()
                        .ok_or_else(|| anyhow::anyhow!("File picker not initialized"))?;

                    let grep_results = picker.grep(&parsed_query, &grep_options);
                    
                    let paths: Vec<String> = grep_results.files.iter()
                        .map(|f| f.relative_path(picker).to_string())
                        .collect();
                    
                    (grep_results.matches, picker.base_path().to_path_buf(), paths)
                };
                let grep_elapsed = grep_start.elapsed();
                info!("picker.grep found {} matches in {} files in {:?}", matches.len(), paths.len(), grep_elapsed);

                let group_start = std::time::Instant::now();
                // Group flat matches by file
                let mut file_matches: HashMap<usize, Vec<crate::search::SearchResult>> = HashMap::new();
                for m in matches {
                    file_matches.entry(m.file_index).or_default().push(crate::search::SearchResult {
                        line: m.line_number as usize - 1, // 0-indexed in Anycode
                        column: m.col,
                        preview: Some(m.line_content.clone()),
                    });
                }
                let group_elapsed = group_start.elapsed();
                info!("Grouping matches took {:?}", group_elapsed);

                let send_start = std::time::Instant::now();
                // Send results
                for (file_idx, matches) in file_matches {
                    if cancel.is_cancelled() {
                        break;
                    }
                    let display_path = paths[file_idx].clone();
                    let absolute_path = base_path.join(&display_path);
                    
                    let file_result = FileSearchResult {
                        file_path: absolute_path.to_string_lossy().to_string(),
                        display_path,
                        matches,
                    };
                    
                    if result_tx.send(file_result).await.is_err() {
                        break; // receiver dropped
                    }
                }
                let send_elapsed = send_start.elapsed();
                info!("Sending results to channel took {:?}", send_elapsed);
            } else {
                let current_dir = std::env::current_dir().unwrap();
                crate::search::global_search(
                    &current_dir, &search_request.pattern, cancel.clone(), result_tx
                ).await?;
            }

            Ok::<(), anyhow::Error>(())
        };

        if let Err(err) = run_search.await {
            let _ = socket_clone.emit(
                "search:error",
                &json!({
                    "error": "Search failed", "message": err.to_string()
                }),
            );
        }
    });

    // Collect results, batch them every 1000ms and send them to the socket
    tokio::spawn(async move {
        let mut matches = 0;
        let mut buffer = Vec::new();
        let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(1000));
        
        // Skip first immediate tick
        interval.tick().await;

        loop {
            if cancel_rx.is_cancelled() {
                break;
            }
            tokio::select! {
                file_result_opt = result_rx.recv() => {
                    match file_result_opt {
                        Some(file_result) => {
                            if cancel_rx.is_cancelled() {
                                break;
                            }
                            matches += file_result.matches.len();
                            buffer.push(file_result);
                        }
                        None => {
                            break; // Channel closed, sender finished
                        }
                    }
                }
                _ = interval.tick() => {
                    if cancel_rx.is_cancelled() {
                        break;
                    }
                    if !buffer.is_empty() {
                        let _ = socket.emit("search:result", &buffer);
                        buffer.clear();
                    }
                }
            }
        }

        if !cancel_rx.is_cancelled() {
            if !buffer.is_empty() {
                let _ = socket.emit("search:result", &buffer);
            }

            let _ = socket.emit(
                "search:end",
                &json!({
                    "elapsed": start.elapsed().as_millis(),
                    "matches": matches
                }),
            );
        }
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
    }
}

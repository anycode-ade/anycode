use crate::acp::AcpMessage;
use crate::acp::AcpPromptAttachment;
use crate::acp::AcpSelectOption;
use crate::app_state::AppState;
use crate::error_ack;
use serde::{Deserialize, Serialize};
use serde_json::{self, json};
use socketioxide::extract::{AckSender, Data, SocketRef, State};
use tokio::sync::broadcast;
use tracing::{error, info};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AcpStartRequest {
    pub agent_id: String,
    pub agent_name: String,
    pub command: String,
    pub args: Vec<String>,
    pub resume_session_id: Option<String>,
}

pub async fn handle_acp_start(
    socket: SocketRef,
    Data(request): Data<AcpStartRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("handle_acp_start {:?}", request);
    let AcpStartRequest {
        agent_id,
        agent_name,
        command,
        args,
        resume_session_id,
    } = request;
    let (start_result, msg_rx) = {
        let mut acp_manager = state.acp_manager.lock().await;

        // Check if agent already exists
        if acp_manager.get_agent(&agent_id).is_some() {
            error_ack!(ack, &agent_id, "Agent {} already running", agent_id);
        }

        let start_result = acp_manager
            .start_agent(
                agent_id.clone(),
                agent_name,
                &command,
                &args,
                resume_session_id,
            )
            .await;

        let msg_rx = if start_result.is_ok() {
            acp_manager.subscribe(&agent_id)
        } else {
            None
        };

        (start_result, msg_rx)
    };

    match start_result {
        Ok(session_id) => {
            info!("ACP agent {} started successfully", agent_id);

            send_agent_history(&socket, &state, &agent_id).await;

            // Set up message forwarding
            if let Some(msg_rx) = msg_rx {
                let agent_id = agent_id.clone();
                let state = state.0.clone();
                tokio::spawn(async move {
                    forward_agent_messages(socket, state, agent_id, msg_rx).await;
                });
            }

            ack.send(&json!({ "success": true, "agent_id": agent_id, "session_id": session_id }))
                .ok();
        }
        Err(e) => {
            error!("Failed to start ACP agent {}: {}", agent_id, e);
            let _ = socket.emit(
                "acp:message",
                &json!({
                    "agent_id": agent_id,
                    "item": {
                        "role": "error",
                        "message": format!("Failed to start agent: {}", e),
                    }
                }),
            );
            error_ack!(ack, &agent_id, "Failed to start agent: {}", e);
        }
    }
}

/// Forward new agent messages to the socket
pub(crate) async fn forward_agent_messages(
    socket: SocketRef,
    state: AppState,
    agent_id: String,
    mut msg_rx: broadcast::Receiver<AcpMessage>,
) {
    loop {
        match msg_rx.recv().await {
            Ok(item) => {
                let data = json!({ "agent_id": agent_id, "item": item });
                let result = socket.emit("acp:message", &data);
                if result.is_err() {
                    error!(
                        "Failed to forward agent message for agent {}: {} to socket {}",
                        agent_id,
                        result.err().unwrap(),
                        socket.id
                    );
                    break; // Socket disconnected
                }
            }
            Err(broadcast::error::RecvError::Closed) => {
                error!("Channel closed for agent {}: {}", agent_id, socket.id);
                break; // Channel closed
            }
            Err(broadcast::error::RecvError::Lagged(skipped)) => {
                error!(
                    "Lagged behind for agent {}: {} (skipped {} messages), sending full history resync",
                    agent_id, socket.id, skipped
                );
                send_agent_history(&socket, &State(state.clone()), &agent_id).await;
                continue; // Lagged behind, continue
            }
        }
    }
}

async fn send_agent_history(socket: &SocketRef, state: &State<AppState>, agent_id: &str) {
    let mut acp_manager = state.acp_manager.lock().await;
    if let Some(history) = acp_manager.get_agent_history(agent_id).await {
        let data = json!({ "agent_id": agent_id, "history": history });
        if let Err(err) = socket.emit("acp:history", &data) {
            error!(
                "Failed to send ACP history for agent {} to socket {}: {}",
                agent_id, socket.id, err
            );
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AcpPromptRequest {
    pub agent_id: String,
    pub prompt: String,
    #[serde(default)]
    pub attachments: Vec<AcpPromptAttachment>,
}

use std::path::{Path, PathBuf};

fn get_mime_type(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "webm" => "audio/webm",
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "txt" => "text/plain",
        "md" => "text/markdown",
        "json" => "application/json",
        "rs" => "text/x-rust",
        "js" => "text/javascript",
        "ts" => "text/typescript",
        "tsx" => "text/tsx",
        _ => "application/octet-stream",
    }
}

fn find_local_paths(text: &str) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let extensions = [
        ".png", ".jpg", ".jpeg", ".gif", ".webp", ".webm", ".wav", ".mp3", ".m4a", ".txt", ".md",
        ".json", ".rs", ".js", ".ts", ".tsx", ".toml", ".yml", ".yaml",
    ];

    for ext in extensions {
        let mut start_idx = 0;
        while start_idx + ext.len() <= text.len() {
            if text.as_bytes()[start_idx] != b'.' {
                start_idx += 1;
                continue;
            }

            let match_found = if let Some(sub) = text.get(start_idx..start_idx + ext.len()) {
                sub.eq_ignore_ascii_case(ext)
            } else {
                false
            };

            if match_found {
                let abs_idx = start_idx;
                let end_idx = abs_idx + ext.len();
                start_idx = end_idx;

                let mut best_path: Option<PathBuf> = None;
                let min_back = if abs_idx > 512 { abs_idx - 512 } else { 0 };

                for back_len in 4..=(abs_idx - min_back) {
                    let start = abs_idx - back_len;
                    if text.is_char_boundary(start) {
                        if let Some(candidate) = text.get(start..end_idx) {
                            let candidate_clean = candidate.strip_prefix("file://").unwrap_or(candidate);
                            let candidate_bytes = candidate_clean.as_bytes();
                            let is_absolute = candidate_clean.starts_with('/')
                                || (candidate_bytes.len() >= 3
                                    && candidate_bytes[0].is_ascii_alphabetic()
                                    && candidate_bytes[1] == b':'
                                    && (candidate_bytes[2] == b'\\' || candidate_bytes[2] == b'/'));

                            if is_absolute {
                                let path = Path::new(candidate_clean);
                                if path.is_file() {
                                    best_path = Some(path.to_path_buf());
                                }
                            }
                        }
                    }
                }

                if let Some(p) = best_path {
                    if !paths.contains(&p) {
                        paths.push(p);
                    }
                }
            } else {
                start_idx += 1;
            }
        }
    }
    paths
}

pub async fn handle_acp_prompt(
    Data(request): Data<AcpPromptRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("handle_acp_prompt {:?}", request);
    let AcpPromptRequest {
        agent_id,
        prompt,
        mut attachments,
    } = request;

    // Detect and load any local file paths mentioned in the prompt text
    let detected_paths = find_local_paths(&prompt);
    for path in detected_paths {
        info!("Detected local file path in prompt: {:?}", path);
        if let Ok(bytes) = std::fs::read(&path) {
            use base64::Engine;
            let data_base64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "file".to_string());
            let ext = path
                .extension()
                .map(|e| e.to_string_lossy().to_string())
                .unwrap_or_default();
            let mime_type = get_mime_type(&ext).to_string();
            let size = Some(bytes.len() as u64);

            if !attachments.iter().any(|att| att.name == name) {
                attachments.push(AcpPromptAttachment {
                    name,
                    mime_type,
                    data_base64,
                    size,
                });
            }
        }
    }

    let mut acp_manager = state.acp_manager.lock().await;

    let agent = match acp_manager.get_agent(&agent_id) {
        Some(agent) => agent,
        None => {
            error_ack!(ack, &agent_id, "Agent {} not found", agent_id);
        }
    };

    match agent.send_prompt(prompt, attachments).await {
        Ok(_) => {
            info!("ACP prompt sent for agent {}", agent_id);
            ack.send(&json!({ "success": true })).ok();
        }
        Err(e) => {
            error!("ACP prompt failed for agent {}: {}", agent_id, e);
            error_ack!(ack, &agent_id, "Prompt failed: {}", e);
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AcpStopRequest {
    pub agent_id: String,
}

pub async fn handle_acp_stop(
    Data(request): Data<AcpStopRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("handle_acp_stop {:?}", request);
    let AcpStopRequest { agent_id } = request;

    let mut acp_manager = state.acp_manager.lock().await;
    acp_manager.stop_agent(&agent_id).await;

    ack.send(&json!({ "success": true })).ok();
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AcpCancelRequest {
    pub agent_id: String,
}

pub async fn handle_acp_cancel(
    Data(request): Data<AcpCancelRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("handle_acp_cancel {:?}", request);
    let AcpCancelRequest { agent_id } = request;

    let acp_manager = state.acp_manager.lock().await;
    match acp_manager.cancel_prompt(&agent_id).await {
        Ok(_) => {
            info!("ACP prompt cancelled for agent {}", agent_id);
            ack.send(&json!({ "success": true })).ok();
        }
        Err(e) => {
            error!("ACP cancel failed for agent {}: {}", agent_id, e);
            error_ack!(ack, &agent_id, "Cancel failed: {}", e);
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AcpSetConfigRequest {
    pub agent_id: String,
    pub option: AcpSelectOption,
}

pub async fn handle_acp_set_model(
    Data(request): Data<AcpSetConfigRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("handle_acp_set_model {:?}", request);
    let AcpSetConfigRequest { agent_id, option } = request;

    let acp_manager = state.acp_manager.lock().await;
    match acp_manager.set_model(&agent_id, option).await {
        Ok(_) => ack.send(&json!({ "success": true })).ok(),
        Err(err) => {
            error!("Failed to set ACP model for {}: {}", agent_id, err);
            error_ack!(ack, &agent_id, "Failed to set model: {}", err);
        }
    };
}

pub async fn handle_acp_set_reasoning(
    Data(request): Data<AcpSetConfigRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("handle_acp_set_reasoning {:?}", request);
    let AcpSetConfigRequest { agent_id, option } = request;

    let acp_manager = state.acp_manager.lock().await;
    match acp_manager.set_reasoning(&agent_id, option).await {
        Ok(_) => ack.send(&json!({ "success": true })).ok(),
        Err(err) => {
            error!("Failed to set ACP reasoning for {}: {}", agent_id, err);
            error_ack!(ack, &agent_id, "Failed to set thinking: {}", err);
        }
    };
}

pub async fn handle_acp_list(ack: AckSender, state: State<AppState>) {
    info!("handle_acp_list");

    let acp_manager = state.acp_manager.lock().await;
    let agents = acp_manager.list_agents();

    let agents_json: Vec<serde_json::Value> = agents
        .iter()
        .map(|(id, name)| json!({ "id": id, "name": name }))
        .collect();

    ack.send(&json!({ "success": true, "agents": agents_json }))
        .ok();
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AcpSessionsListRequest {
    pub command: String,
    pub args: Vec<String>,
}

pub async fn handle_acp_sessions_list(
    Data(request): Data<AcpSessionsListRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("handle_acp_sessions_list {:?}", request);
    let AcpSessionsListRequest { command, args } = request;
    let cwd = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));

    let acp_manager = state.acp_manager.lock().await;
    match acp_manager.list_sessions(&command, &args, cwd).await {
        Ok(sessions) => {
            ack.send(&json!({ "success": true, "sessions": sessions }))
                .ok();
        }
        Err(err) => {
            error!("Failed to list ACP sessions: {}", err);
            error_ack!(ack, &command, "Failed to list ACP sessions: {}", err);
        }
    }
}

pub async fn handle_acp_reconnect(socket: SocketRef, ack: AckSender, state: State<AppState>) {
    info!("handle_acp_reconnect for socket {}", socket.id);

    let mut acp_manager = state.acp_manager.lock().await;
    let agents = acp_manager.list_agents();

    // Re-subscribe to all running agents
    for (agent_id, _) in &agents {
        // Get history and send it if not empty
        if let Some(history) = acp_manager.get_agent_history(agent_id).await {
            if !history.is_empty() {
                // Send agent history to the socket
                let data = json!({ "agent_id": agent_id, "history": history });
                let result = socket.emit("acp:history", &data);
                if result.is_err() {
                    continue; // Socket disconnected, skip this agent
                }
            }
        }

        // Subscribe to new messages in a separate task
        if let Some(msg_rx) = acp_manager.subscribe(agent_id) {
            let socket_clone = socket.clone();
            let agent_id_clone = agent_id.clone();
            let state_clone = state.0.clone();
            tokio::spawn(async move {
                forward_agent_messages(socket_clone, state_clone, agent_id_clone, msg_rx).await;
            });
        }
    }

    let agents_json: Vec<serde_json::Value> = agents
        .iter()
        .map(|(id, name)| json!({ "id": id, "name": name }))
        .collect();

    ack.send(&json!({ "success": true, "agents": agents_json }))
        .ok();
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AcpUndoRequest {
    pub agent_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checkpoint_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
}

pub async fn handle_acp_undo(
    Data(request): Data<AcpUndoRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("handle_acp_undo {:?}", request);
    let AcpUndoRequest {
        agent_id,
        checkpoint_id,
        prompt,
    } = request;

    let acp_manager = state.acp_manager.lock().await;

    let result = if let Some(checkpoint_id) = checkpoint_id {
        acp_manager
            .restore_to_checkpoint_id(&agent_id, &checkpoint_id)
            .await
    } else if let Some(prompt) = prompt {
        acp_manager.restore_to_prompt(&agent_id, &prompt).await
    } else {
        Err(anyhow::anyhow!("Missing checkpoint_id or prompt"))
    };

    match result {
        Ok(_) => {
            info!("Restored agent {} to checkpoint", agent_id);
            ack.send(&json!({ "success": true })).ok();
        }
        Err(e) => {
            error!("Undo failed for agent {}: {}", agent_id, e);
            error_ack!(ack, &agent_id, "Undo failed: {}", e);
        }
    }
}

#[cfg(test)]
#[path = "../tests/acp_handler.rs"]
mod tests;

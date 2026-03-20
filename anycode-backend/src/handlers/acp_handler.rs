use crate::acp::{AcpMessage, AcpPermissionMode};
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
}

pub async fn handle_acp_prompt(
    Data(request): Data<AcpPromptRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("handle_acp_prompt {:?}", request);
    let AcpPromptRequest { agent_id, prompt } = request;

    let mut acp_manager = state.acp_manager.lock().await;

    let agent = match acp_manager.get_agent(&agent_id) {
        Some(agent) => agent,
        None => {
            error_ack!(ack, &agent_id, "Agent {} not found", agent_id);
        }
    };

    match agent.send_prompt(prompt).await {
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AcpPermissionResponseRequest {
    pub agent_id: String,
    pub permission_id: String,
    pub option_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AcpPermissionModeRequest {
    pub mode: String,
}

pub async fn handle_acp_permission_response(
    Data(request): Data<AcpPermissionResponseRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("handle_acp_permission_response {:?}", request);
    let AcpPermissionResponseRequest {
        agent_id,
        permission_id,
        option_id,
    } = request;

    let mut acp_manager = state.acp_manager.lock().await;

    let agent = match acp_manager.get_agent(&agent_id) {
        Some(agent) => agent,
        None => {
            error_ack!(ack, &agent_id, "Agent {} not found", agent_id);
        }
    };

    match agent
        .send_permission_response(&permission_id, option_id)
        .await
    {
        Ok(true) => {
            info!(
                "Permission response sent for agent {} permission {}",
                agent_id, permission_id
            );
            ack.send(&json!({ "success": true })).ok();
        }
        Ok(false) => {
            error!(
                "Permission {} not found for agent {}",
                permission_id, agent_id
            );
            error_ack!(ack, &agent_id, "Permission {} not found", permission_id);
        }
        Err(e) => {
            error!("Permission response failed for agent {}: {}", agent_id, e);
            error_ack!(ack, &agent_id, "Permission response failed: {}", e);
        }
    }
}

pub async fn handle_acp_permission_mode(
    Data(request): Data<AcpPermissionModeRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    info!("handle_acp_permission_mode {:?}", request);
    let AcpPermissionModeRequest { mode } = request;

    let permission_mode = match AcpPermissionMode::from_str(&mode) {
        Some(mode) => mode,
        None => {
            error!("Invalid ACP permission mode requested: {}", mode);
            error_ack!(ack, &mode, "Invalid ACP permission mode: {}", mode);
        }
    };

    let acp_manager = state.acp_manager.lock().await;
    acp_manager.set_permission_mode(permission_mode);

    ack.send(&json!({ "success": true, "mode": permission_mode.as_str() }))
        .ok();
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

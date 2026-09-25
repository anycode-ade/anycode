use crate::acp_registry::{current_platform_key, AcpRegistryManager};
use crate::app_state::AppState;
use serde::Deserialize;
use serde_json::json;
use socketioxide::extract::{AckSender, Data, SocketRef, State};
use tracing::{error, info};

#[derive(Debug, Deserialize, Default)]
pub struct AcpRegistryListRequest {
    #[serde(default)]
    pub force_refresh: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct AcpRegistryInstallRequest {
    pub agent_id: String,
}

#[derive(Debug, Deserialize)]
pub struct AcpRegistryCancelRequest {
    pub agent_id: String,
}

#[derive(Debug, Deserialize)]
pub struct AcpRegistryUninstallRequest {
    pub agent_id: String,
}

pub async fn handle_acp_registry_list(
    _socket: SocketRef,
    Data(request): Data<Option<AcpRegistryListRequest>>,
    ack: AckSender,
    state: State<AppState>,
) {
    let force = request.and_then(|r| r.force_refresh).unwrap_or(false);
    match state.acp_registry.list_agent_summaries(force).await {
        Ok(agents) => {
            let resp = json!({
                "success": true,
                "platform": current_platform_key(),
                "agents": agents,
            });
            let _ = ack.send(&resp);
        }
        Err(e) => {
            error!("Failed to list ACP registry: {}", e);
            let resp = json!({
                "success": false,
                "error": e.to_string(),
            });
            let _ = ack.send(&resp);
        }
    }
}

pub async fn handle_acp_registry_install(
    socket: SocketRef,
    Data(request): Data<AcpRegistryInstallRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    let agent_id = request.agent_id;
    info!("handle_acp_registry_install: {}", agent_id);

    // Fetch agents to locate the entry
    let agents = match state.acp_registry.fetch_agents(false).await {
        Ok(a) => a,
        Err(e) => {
            let _ = ack.send(&json!({
                "success": false,
                "error": format!("Failed to fetch registry: {}", e),
            }));
            return;
        }
    };

    let agent_entry = match agents.into_iter().find(|a| a.id == agent_id) {
        Some(a) => a,
        None => {
            let _ = ack.send(&json!({
                "success": false,
                "error": format!("Agent '{}' not found in registry", agent_id),
            }));
            return;
        }
    };

    let platform_key = current_platform_key();
    let has_binary = agent_entry
        .distribution
        .binary
        .as_ref()
        .and_then(|b| b.get(platform_key))
        .is_some();

    if has_binary {
        let registry = state.acp_registry.clone();
        let socket_clone = socket.clone();
        let target_agent_id = agent_id.clone();

        tokio::spawn(async move {
            let sock = socket_clone.clone();
            let aid = target_agent_id.clone();

            let result = registry
                .download_and_install_binary(&agent_entry, move |progress| {
                    let _ = sock.emit(
                        "acp:registry:progress",
                        &json!({
                            "agent_id": aid,
                            "progress": progress,
                            "status": "downloading",
                        }),
                    );
                })
                .await;

            match result {
                Ok(installed_path) => {
                    let preset = AcpRegistryManager::to_agent_preset(
                        &agent_entry,
                        Some(installed_path.to_string_lossy().to_string()),
                    );
                    let _ = socket_clone.emit(
                        "acp:registry:progress",
                        &json!({
                            "agent_id": target_agent_id,
                            "progress": 1.0,
                            "status": "completed",
                        }),
                    );
                    let _ = ack.send(&json!({
                        "success": true,
                        "agent_id": target_agent_id,
                        "preset": preset,
                    }));
                }
                Err(e) => {
                    error!("Failed to download/install binary for {}: {}", target_agent_id, e);
                    let _ = socket_clone.emit(
                        "acp:registry:progress",
                        &json!({
                            "agent_id": target_agent_id,
                            "progress": 0.0,
                            "status": "failed",
                            "error": e.to_string(),
                        }),
                    );
                    let _ = ack.send(&json!({
                        "success": false,
                        "agent_id": target_agent_id,
                        "error": e.to_string(),
                    }));
                }
            }
        });
    } else if agent_entry.distribution.npx.is_some() {
        let preset = AcpRegistryManager::to_agent_preset(&agent_entry, None);
        let _ = ack.send(&json!({
            "success": true,
            "agent_id": agent_id,
            "preset": preset,
        }));
    } else {
        let _ = ack.send(&json!({
            "success": false,
            "error": format!("Agent '{}' does not support current platform '{}'", agent_id, platform_key),
        }));
    }
}

pub async fn handle_acp_registry_cancel(
    _socket: SocketRef,
    Data(request): Data<AcpRegistryCancelRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    let cancelled = state.acp_registry.cancel_install(&request.agent_id).await;
    let _ = ack.send(&json!({
        "success": true,
        "agent_id": request.agent_id,
        "cancelled": cancelled,
    }));
}

pub async fn handle_acp_registry_uninstall(
    _socket: SocketRef,
    Data(request): Data<AcpRegistryUninstallRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    match state.acp_registry.uninstall_agent(&request.agent_id) {
        Ok(_) => {
            let _ = ack.send(&json!({
                "success": true,
                "agent_id": request.agent_id,
            }));
        }
        Err(e) => {
            error!("Failed to uninstall agent {}: {}", request.agent_id, e);
            let _ = ack.send(&json!({
                "success": false,
                "agent_id": request.agent_id,
                "error": e.to_string(),
            }));
        }
    }
}

use serde::Deserialize;
use serde_json::{Value, json};
use socketioxide::extract::{AckSender, Data, State};

use crate::app_state::AppState;

#[derive(Debug, Deserialize)]
pub struct AddServerRequest {
    #[serde(default)]
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub token: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ServerIdRequest {
    pub server_id: String,
}

#[derive(Debug, Deserialize)]
pub struct RemoteRpcRequest {
    pub server_id: String,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

pub async fn handle_remote_servers_list(ack: AckSender, state: State<AppState>) {
    let servers = state.node_hub.list_servers(&state).await;
    let _ = ack.send(&json!({ "success": true, "servers": servers }));
}

pub async fn handle_remote_servers_add(
    Data(req): Data<AddServerRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    match state
        .node_hub
        .add_server(state.0.clone(), req.name, req.url, req.token)
        .await
    {
        Ok(server) => {
            let _ = ack.send(&json!({ "success": true, "server": server }));
        }
        Err(err) => {
            let _ = ack.send(&json!({ "success": false, "error": err.to_string() }));
        }
    }
}

pub async fn handle_remote_servers_remove(
    Data(req): Data<ServerIdRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    match state.node_hub.remove_server(&state, &req.server_id).await {
        Ok(()) => {
            let _ = ack.send(&json!({ "success": true }));
        }
        Err(err) => {
            let _ = ack.send(&json!({ "success": false, "error": err.to_string() }));
        }
    }
}

pub async fn handle_remote_servers_reconnect(
    Data(req): Data<ServerIdRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    match state.node_hub.reconnect_server(&req.server_id).await {
        Ok(()) => {
            let _ = ack.send(&json!({ "success": true }));
        }
        Err(err) => {
            let _ = ack.send(&json!({ "success": false, "error": err.to_string() }));
        }
    }
}

pub async fn handle_remote_rpc(
    Data(req): Data<RemoteRpcRequest>,
    ack: AckSender,
    state: State<AppState>,
) {
    match state
        .node_hub
        .rpc(&state, &req.server_id, &req.method, req.params)
        .await
    {
        Ok(data) => {
            let _ = ack.send(&json!({ "success": true, "data": data }));
        }
        Err(err) => {
            let _ = ack.send(&json!({ "success": false, "error": err.to_string() }));
        }
    }
}

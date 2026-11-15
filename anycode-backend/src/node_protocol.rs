use serde::{Deserialize, Serialize};
use serde_json::Value;

/// JSON envelope exchanged over `/ws/node` between a Hub and a worker Anycode node.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NodeFrame {
    Req {
        id: String,
        method: String,
        #[serde(default)]
        params: Value,
    },
    Res {
        id: String,
        ok: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        data: Option<Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    Event {
        event: String,
        #[serde(default)]
        data: Value,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeServerInfo {
    pub name: String,
    pub os: String,
    pub arch: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedServerConfig {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ServerConnectionStatus {
    Connecting,
    Online,
    Offline,
    AuthError,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeAgentSummary {
    pub id: String,
    #[serde(default)]
    pub project_id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub is_processing: bool,
    #[serde(default)]
    pub queue: Vec<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree_branch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diff_added: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diff_removed: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diff_files: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteServerView {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub open_url: Option<String>,
    pub is_local: bool,
    pub status: ServerConnectionStatus,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub ping_ms: Option<u64>,
    #[serde(default)]
    pub info: Option<NodeServerInfo>,
    #[serde(default)]
    pub projects: Vec<crate::workspace::ProjectInfo>,
    #[serde(default)]
    pub agents: Vec<NodeAgentSummary>,
}

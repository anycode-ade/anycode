use crate::acp_history::AcpHistoryManager;
use crate::utils::relative_to_current_dir;
use agent_client_protocol::{self as acp, Agent as _, Client};
use agent_client_protocol_schema::{ProtocolVersion, SessionId};
use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use tokio::io::{self, AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::{Mutex, RwLock, broadcast, mpsc, oneshot::Sender};
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};
use tracing::{debug, error, info};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum AcpPermissionMode {
    Ask = 0,
    FullAccess = 1,
}

impl AcpPermissionMode {
    pub fn from_env() -> Self {
        let raw = std::env::var("ANYCODE_ACP_PERMISSION_MODE")
            .unwrap_or_else(|_| "full_access".to_string());
        Self::from_str(&raw).unwrap_or_else(|| {
            error!(
                "Unknown ANYCODE_ACP_PERMISSION_MODE value '{}', defaulting to full_access",
                raw
            );
            Self::FullAccess
        })
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value.to_lowercase().as_str() {
            "ask" => Some(Self::Ask),
            "full_access" | "full-access" | "fullaccess" => Some(Self::FullAccess),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ask => "ask",
            Self::FullAccess => "full_access",
        }
    }

    pub fn is_full_access(self) -> bool {
        matches!(self, Self::FullAccess)
    }

    pub fn as_atomic(self) -> u8 {
        self as u8
    }

    pub fn from_atomic(value: u8) -> Self {
        match value {
            0 => Self::Ask,
            1 => Self::FullAccess,
            _ => Self::FullAccess,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpUserMessage {
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checkpoint_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpAssistantMessage {
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_chunk: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpThought {
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_chunk: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpLocation {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpToolCall {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    pub arguments: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locations: Option<Vec<AcpLocation>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpToolResult {
    pub id: String,
    pub result: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpToolUpdate {
    pub id: String,
    pub update: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpPromptState {
    pub is_processing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpPermissionOption {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpPermissionRequest {
    pub id: String,
    pub tool_call: AcpToolCall,
    pub options: Vec<AcpPermissionOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpError {
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpOpenFile {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpSessionSummary {
    pub session_id: String,
    pub cwd: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "role")]
pub enum AcpMessage {
    #[serde(rename = "user")]
    User(AcpUserMessage),
    #[serde(rename = "assistant")]
    Assistant(AcpAssistantMessage),
    #[serde(rename = "thought")]
    Thought(AcpThought),
    #[serde(rename = "tool_call")]
    ToolCall(AcpToolCall),
    #[serde(rename = "tool_result")]
    ToolResult(AcpToolResult),
    #[serde(rename = "tool_update")]
    ToolUpdate(AcpToolUpdate),
    #[serde(rename = "prompt_state")]
    PromptState(AcpPromptState),
    #[serde(rename = "permission_request")]
    PermissionRequest(AcpPermissionRequest),
    #[serde(rename = "error")]
    Error(AcpError),
    #[serde(rename = "open_file")]
    OpenFile(AcpOpenFile),
}

/// Response to a permission request from frontend
#[derive(Debug, Clone)]
pub struct PermissionResponse {
    pub permission_id: String,
    pub option_id: String,
}

struct AcpClientImpl {
    agent_id: String,
    permission_mode: Arc<AtomicU8>,
    message_sender: broadcast::Sender<AcpMessage>,
    history: Arc<tokio::sync::Mutex<Vec<AcpMessage>>>,
    /// Pending permission requests waiting for user response
    pending_permissions: Arc<Mutex<HashMap<String, Sender<PermissionResponse>>>>,
}

#[async_trait::async_trait(?Send)]
impl Client for AcpClientImpl {
    async fn request_permission(
        &self,
        args: acp::RequestPermissionRequest,
    ) -> acp::Result<acp::RequestPermissionResponse> {
        info!(
            "request_permission called for agent {}: {:?}",
            self.agent_id, args
        );

        let permission_mode =
            AcpPermissionMode::from_atomic(self.permission_mode.load(Ordering::Relaxed));
        if permission_mode.is_full_access() {
            let selected_option = args
                .options
                .iter()
                .find(|opt| {
                    let name = opt.name.to_lowercase();
                    name.contains("allow")
                        || name.contains("approve")
                        || name.contains("accept")
                        || name.contains("grant")
                        || name.contains("yes")
                        || name.contains("continue")
                        || name.contains("proceed")
                })
                .or_else(|| args.options.first());

            if let Some(option) = selected_option {
                info!(
                    "Auto-approving permission for agent {} in full_access mode: {}",
                    self.agent_id, option.name
                );
                let selected_outcome =
                    acp::SelectedPermissionOutcome::new(option.option_id.clone());
                return Ok(acp::RequestPermissionResponse::new(
                    acp::RequestPermissionOutcome::Selected(selected_outcome),
                ));
            }

            error!(
                "Full access mode but no permission options were returned for agent {}",
                self.agent_id
            );
            return Ok(acp::RequestPermissionResponse::new(
                acp::RequestPermissionOutcome::Cancelled,
            ));
        }

        // Handle tool_call if present
        let tool_call_update = &args.tool_call;
        // Extract tool call information from ToolCallUpdate
        let tool_call_id = tool_call_update.tool_call_id.to_string();
        let (tool_name, tool_command) = tool_call_update
            .fields
            .title
            .as_ref()
            .map(|s| {
                let name = Self::extract_tool_name(s);
                let command = Self::extract_tool_command(s);
                (name, command)
            })
            .unwrap_or_else(|| ("unknown".to_string(), None));

        // Try to extract arguments from raw_input or content
        let arguments = if let Some(raw_input) = &tool_call_update.fields.raw_input {
            raw_input.clone()
        } else if let Some(content) = &tool_call_update.fields.content {
            // Try to extract from content
            serde_json::to_value(content).unwrap_or_else(|_| serde_json::json!({}))
        } else {
            serde_json::json!({})
        };

        // Extract locations from tool call update (use relative path if possible)
        let locations = tool_call_update.fields.locations.as_ref().map(|locs| {
            locs.iter()
                .map(|loc| AcpLocation {
                    path: relative_to_current_dir(&loc.path)
                        .map(|p| p.to_string_lossy().to_string())
                        .unwrap_or_else(|| loc.path.to_string_lossy().to_string()),
                    line: loc.line,
                })
                .collect()
        });

        let acp_tool_call = AcpToolCall {
            id: tool_call_id.clone(),
            name: tool_name,
            command: tool_command,
            arguments,
            locations,
        };

        // Generate unique permission request ID
        let permission_id = format!("perm_{}", tool_call_id);

        // Convert options to our format
        let permission_options: Vec<AcpPermissionOption> = args
            .options
            .iter()
            .map(|opt| AcpPermissionOption {
                id: opt.option_id.to_string(),
                name: opt.name.clone(),
            })
            .collect();

        // Create permission request message
        let permission_request = AcpPermissionRequest {
            id: permission_id.clone(),
            tool_call: acp_tool_call.clone(),
            options: permission_options,
        };

        // Add to history
        {
            let mut history = self.history.lock().await;
            history.push(AcpMessage::PermissionRequest(permission_request.clone()));
        }

        // Create oneshot channel for response
        let (response_tx, response_rx) = tokio::sync::oneshot::channel::<PermissionResponse>();

        // Register pending permission
        {
            let mut pending = self.pending_permissions.lock().await;
            pending.insert(permission_id.clone(), response_tx);
        }

        // Send permission request to frontend
        self.send_message(AcpMessage::PermissionRequest(permission_request))
            .await;

        // Wait for user response
        match response_rx.await {
            Ok(response) => {
                info!(
                    "Permission response received for agent {}: option_id={}",
                    self.agent_id, response.option_id
                );

                // Find the matching option from original args
                if let Some(option) = args
                    .options
                    .iter()
                    .find(|opt| opt.option_id.to_string() == response.option_id)
                {
                    let selected_outcome =
                        acp::SelectedPermissionOutcome::new(option.option_id.clone());
                    Ok(acp::RequestPermissionResponse::new(
                        acp::RequestPermissionOutcome::Selected(selected_outcome),
                    ))
                } else {
                    // If option not found, treat as cancelled
                    error!(
                        "Invalid option_id {} for agent {}",
                        response.option_id, self.agent_id
                    );
                    Ok(acp::RequestPermissionResponse::new(
                        acp::RequestPermissionOutcome::Cancelled,
                    ))
                }
            }
            Err(_) => {
                // Channel was dropped (e.g., agent stopped)
                error!(
                    "Permission request channel closed for agent {}",
                    self.agent_id
                );
                Ok(acp::RequestPermissionResponse::new(
                    acp::RequestPermissionOutcome::Cancelled,
                ))
            }
        }
    }

    async fn write_text_file(
        &self,
        args: acp::WriteTextFileRequest,
    ) -> acp::Result<acp::WriteTextFileResponse> {
        info!(
            "write_text_file called for agent {}: path={:?}, content_len={}",
            self.agent_id,
            args.path,
            args.content.len()
        );

        // Send open_file message to UI for follow mode
        let relative_path = relative_to_current_dir(&args.path)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| args.path.to_string_lossy().to_string());

        self.send_message(AcpMessage::OpenFile(AcpOpenFile {
            path: relative_path,
            line: None,
        }))
        .await;

        // Write file to filesystem
        let path = args.path.as_path();
        match tokio::fs::write(path, &args.content).await {
            Ok(_) => {
                info!(
                    "Successfully wrote file for agent {}: {:?} ({} bytes)",
                    self.agent_id,
                    args.path,
                    args.content.len()
                );
                Ok(acp::WriteTextFileResponse::new())
            }
            Err(e) => {
                error!(
                    "Failed to write file {:?} for agent {}: {}",
                    args.path, self.agent_id, e
                );
                Err(acp::Error::internal_error())
            }
        }
    }

    async fn read_text_file(
        &self,
        args: acp::ReadTextFileRequest,
    ) -> acp::Result<acp::ReadTextFileResponse> {
        info!(
            "read_text_file called for agent {}: path={:?}",
            self.agent_id, args.path
        );

        // Send open_file message to UI for follow mode
        let relative_path = relative_to_current_dir(&args.path)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| args.path.to_string_lossy().to_string());

        self.send_message(AcpMessage::OpenFile(AcpOpenFile {
            path: relative_path,
            line: None,
        }))
        .await;

        // Read file from filesystem
        let path = args.path.as_path();
        match tokio::fs::read_to_string(path).await {
            Ok(content) => {
                info!(
                    "Successfully read file for agent {}: {:?} ({} bytes)",
                    self.agent_id,
                    args.path,
                    content.len()
                );
                Ok(acp::ReadTextFileResponse::new(content))
            }
            Err(e) => {
                error!(
                    "Failed to read file {:?} for agent {}: {}",
                    args.path, self.agent_id, e
                );
                Err(acp::Error::internal_error())
            }
        }
    }

    async fn create_terminal(
        &self,
        _args: acp::CreateTerminalRequest,
    ) -> acp::Result<acp::CreateTerminalResponse> {
        info!(
            "create_terminal called for agent {}: {:?}",
            self.agent_id, _args
        );
        Err(acp::Error::method_not_found())
    }

    async fn terminal_output(
        &self,
        _args: acp::TerminalOutputRequest,
    ) -> acp::Result<acp::TerminalOutputResponse> {
        info!(
            "terminal_output called for agent {}: {:?}",
            self.agent_id, _args
        );
        Err(acp::Error::method_not_found())
    }

    async fn release_terminal(
        &self,
        _args: acp::ReleaseTerminalRequest,
    ) -> acp::Result<acp::ReleaseTerminalResponse> {
        info!(
            "release_terminal called for agent {}: {:?}",
            self.agent_id, _args
        );
        Err(acp::Error::method_not_found())
    }

    async fn wait_for_terminal_exit(
        &self,
        _args: acp::WaitForTerminalExitRequest,
    ) -> acp::Result<acp::WaitForTerminalExitResponse> {
        info!(
            "wait_for_terminal_exit called for agent {}: {:?}",
            self.agent_id, _args
        );
        Err(acp::Error::method_not_found())
    }

    async fn kill_terminal_command(
        &self,
        _args: acp::KillTerminalCommandRequest,
    ) -> acp::Result<acp::KillTerminalCommandResponse> {
        info!(
            "kill_terminal_command called for agent {}: {:?}",
            self.agent_id, _args
        );
        Err(acp::Error::method_not_found())
    }

    async fn session_notification(&self, args: acp::SessionNotification) -> acp::Result<()> {
        info!(
            "session_notification received for agent {}: {:?}",
            self.agent_id, args.update
        );
        match args.update {
            acp::SessionUpdate::AgentMessageChunk(chunk) => {
                self.handle_agent_message_chunk(chunk).await?;
            }
            acp::SessionUpdate::ToolCall(tool_call) => {
                self.handle_tool_call(tool_call).await;
            }
            acp::SessionUpdate::UserMessageChunk(chunk) => {
                info!("UserMessageChunk received for agent {}", self.agent_id);
                self.handle_user_message_chunk(chunk).await?;
            }
            acp::SessionUpdate::AgentThoughtChunk(chunk) => {
                debug!(
                    "AgentThoughtChunk received for agent {}: {:?}",
                    self.agent_id, chunk
                );
                self.handle_agent_thought_chunk(chunk).await?;
            }
            acp::SessionUpdate::ToolCallUpdate(update) => {
                self.handle_tool_call_update(update).await;
            }
            acp::SessionUpdate::Plan(_) => {
                info!("Plan received for agent {}", self.agent_id);
            }
            acp::SessionUpdate::CurrentModeUpdate { .. } => {
                info!("CurrentModeUpdate received for agent {}", self.agent_id);
            }
            acp::SessionUpdate::AvailableCommandsUpdate { .. } => {
                info!(
                    "AvailableCommandsUpdate received for agent {}",
                    self.agent_id
                );
            }
            _ => {
                info!(
                    "Other session update received for agent {}: {:?}",
                    self.agent_id, args.update
                );
            }
        }
        Ok(())
    }

    async fn ext_method(&self, _args: acp::ExtRequest) -> acp::Result<acp::ExtResponse> {
        info!("ext_method called for agent {}: {:?}", self.agent_id, _args);
        Err(acp::Error::method_not_found())
    }

    async fn ext_notification(&self, _args: acp::ExtNotification) -> acp::Result<()> {
        info!(
            "ext_notification called for agent {}: {:?}",
            self.agent_id, _args
        );
        Err(acp::Error::method_not_found())
    }
}

impl AcpClientImpl {
    async fn handle_user_message_chunk(&self, chunk: acp::ContentChunk) -> acp::Result<()> {
        let text = Self::extract_text_from_content(&chunk.content);
        info!(
            "Received user message chunk from agent {}: {}",
            self.agent_id, text
        );

        let mut history = self.history.lock().await;
        let is_chunk = Self::is_last_message_user(&history);

        if is_chunk {
            Self::append_to_last_user_message(&mut history, &text);
        } else {
            let new_message = AcpMessage::User(AcpUserMessage {
                content: text.clone(),
                checkpoint_id: None,
            });
            history.push(new_message);
        }
        drop(history);

        let message = AcpMessage::User(AcpUserMessage {
            content: text,
            checkpoint_id: None,
        });

        self.send_message(message).await;

        Ok(())
    }

    async fn handle_agent_message_chunk(&self, chunk: acp::ContentChunk) -> acp::Result<()> {
        let text = Self::extract_text_from_content(&chunk.content);
        info!(
            "Received message chunk from agent {}: {}",
            self.agent_id, text
        );

        let mut history = self.history.lock().await;
        let is_chunk = Self::is_last_message_assistant(&history);

        if is_chunk {
            Self::append_to_last_assistant_message(&mut history, &text);
        } else {
            let new_message = AcpMessage::Assistant(AcpAssistantMessage {
                content: text.clone(),
                is_chunk: None,
            });
            history.push(new_message);
        }
        drop(history);

        let message = AcpMessage::Assistant(AcpAssistantMessage {
            content: text.clone(),
            is_chunk: if is_chunk { Some(true) } else { None },
        });

        // Send message to clients
        self.send_message(message).await;

        Ok(())
    }

    async fn handle_agent_thought_chunk(&self, chunk: acp::ContentChunk) -> acp::Result<()> {
        let text = Self::extract_text_from_content(&chunk.content);
        info!(
            "💭 Received thought chunk from agent {}: {}",
            self.agent_id, text
        );

        let mut history = self.history.lock().await;
        let is_chunk = Self::is_last_message_thought(&history);

        if is_chunk {
            Self::append_to_last_thought_message(&mut history, &text);
        } else {
            let new_message = AcpMessage::Thought(AcpThought {
                content: text.clone(),
                is_chunk: None,
            });
            history.push(new_message);
        }
        drop(history);

        let message = AcpMessage::Thought(AcpThought {
            content: text.clone(),
            is_chunk: if is_chunk { Some(true) } else { None },
        });

        // Send message to clients
        self.send_message(message).await;

        Ok(())
    }

    async fn handle_tool_call(&self, tool_call: acp::ToolCall) {
        info!(
            "Received tool call from agent {}: title={}, tool_call_id={:?}",
            self.agent_id, tool_call.title, tool_call.tool_call_id
        );
        debug!("Full tool_call structure: {:?}", tool_call);

        // Convert acp::ToolCall to our AcpToolCall format
        let tool_call_id = tool_call.tool_call_id.to_string();
        let (tool_name, mut tool_command) = Self::extract_tool_name_and_command(&tool_call.title);

        // Extract arguments from tool_call - try to serialize the whole tool_call and extract arguments
        // The tool_call might have different field names, so we try multiple approaches
        let arguments = serde_json::to_value(&tool_call)
            .and_then(|v| {
                // Try to extract arguments field if it exists
                if let Some(args) = v.get("arguments") {
                    Ok(args.clone())
                } else if let Some(args) = v.get("params") {
                    Ok(args.clone())
                } else if let Some(args) = v.get("input") {
                    Ok(args.clone())
                } else {
                    // If no arguments field found, include the whole tool_call structure
                    // but remove fields we already have (id, name/title)
                    let mut result = v.clone();
                    if result.is_object() {
                        if let Some(obj) = result.as_object_mut() {
                            obj.remove("tool_call_id");
                            obj.remove("title");
                        }
                    }
                    Ok(result)
                }
            })
            .unwrap_or_else(|_| {
                // Fallback: create a JSON object with debug info
                serde_json::json!({
                    "_debug": format!("{:?}", tool_call)
                })
            });

        if let Some(raw_input) = tool_call.raw_input.as_ref() {
            if let Some(cmd) = raw_input.get("cmd").and_then(|value| value.as_str()) {
                tool_command = Some(cmd.to_string());
            } else if let Some(command) = raw_input.get("command").and_then(|value| value.as_str()) {
                tool_command = Some(command.to_string());
            }
        }

        // Extract locations from tool call (use relative path if possible)
        let locations = if tool_call.locations.is_empty() {
            None
        } else {
            Some(
                tool_call
                    .locations
                    .iter()
                    .map(|loc| AcpLocation {
                        path: relative_to_current_dir(&loc.path)
                            .map(|p| p.to_string_lossy().to_string())
                            .unwrap_or_else(|| loc.path.to_string_lossy().to_string()),
                        line: loc.line,
                    })
                    .collect(),
            )
        };

        let acp_tool_call = AcpToolCall {
            id: tool_call_id,
            name: tool_name,
            command: tool_command,
            arguments,
            locations,
        };

        // Add to history
        let mut history = self.history.lock().await;
        history.push(AcpMessage::ToolCall(acp_tool_call.clone()));

        // Send message to clients
        self.send_message(AcpMessage::ToolCall(acp_tool_call)).await;
    }

    async fn handle_tool_call_update(&self, update: acp::ToolCallUpdate) {
        info!(
            "ToolCallUpdate received for agent {}: tool_call_id={:?}, status={:?}",
            self.agent_id, update.tool_call_id, update.fields.status
        );

        let tool_call_id = update.tool_call_id.to_string();

        let payload = Self::normalize_tool_call_update_payload(&update);

        match update.fields.status {
            Some(acp::ToolCallStatus::Completed) => {
                let acp_tool_result = AcpToolResult {
                    id: tool_call_id,
                    result: payload,
                };

                // Add to history only when completed
                {
                    let mut history = self.history.lock().await;
                    history.push(AcpMessage::ToolResult(acp_tool_result.clone()));
                }
                self.send_message(AcpMessage::ToolResult(acp_tool_result))
                    .await;
            }
            Some(_) => {
                let acp_tool_update = AcpToolUpdate {
                    id: tool_call_id,
                    update: payload,
                };
                {
                    let mut history = self.history.lock().await;
                    history.push(AcpMessage::ToolUpdate(acp_tool_update.clone()));
                }
                self.send_message(AcpMessage::ToolUpdate(acp_tool_update))
                    .await;
            }
            None => {}
        }
    }

    fn extract_tool_name(title: &str) -> String {
        // If title ends with description in parentheses, extract it
        // Example: "python3 -c \"...\" (Calculate time remaining)" -> "Calculate time remaining"
        if let Some(last_paren) = title.rfind('(') {
            if let Some(close_paren) = title[last_paren..].find(')') {
                let description = title[last_paren + 1..last_paren + close_paren].trim();
                if !description.is_empty() {
                    return description.to_string();
                }
            }
        }

        // Otherwise, extract the first part of the command (before first space or quote)
        // Example: "python3 -c \"...\"" -> "python3"
        if let Some(first_space) = title.find(' ') {
            title[..first_space].trim().to_string()
        } else {
            title.trim().to_string()
        }
    }

    fn extract_tool_command(title: &str) -> Option<String> {
        // Extract the command part (everything before the description in parentheses)
        // Example: "python3 -c \"...\" (Calculate time remaining)" -> "python3 -c \"...\""
        if let Some(last_paren) = title.rfind('(') {
            let command = title[..last_paren].trim();
            if !command.is_empty() && command != title.trim() {
                return Some(command.to_string());
            }
        }
        // If no parentheses, return the full title as command
        let trimmed = title.trim();
        if !trimmed.is_empty() {
            Some(trimmed.to_string())
        } else {
            None
        }
    }

    fn extract_tool_name_and_command(title: &str) -> (String, Option<String>) {
        let name = Self::extract_tool_name(title);
        let command = Self::extract_tool_command(title);
        (name, command)
    }

    fn extract_text_from_content(content: &acp::ContentBlock) -> String {
        match content {
            acp::ContentBlock::Text(text_content) => text_content.text.clone(),
            acp::ContentBlock::Image(_) => "<image>".into(),
            acp::ContentBlock::Audio(_) => "<audio>".into(),
            acp::ContentBlock::ResourceLink(resource_link) => resource_link.uri.clone(),
            acp::ContentBlock::Resource(_) => "<resource>".into(),
            _ => "<unknown content>".into(),
        }
    }

    fn normalize_tool_call_update_payload(update: &acp::ToolCallUpdate) -> Value {
        let fields = &update.fields;
        serde_json::json!({
            "tool_call_id": update.tool_call_id.to_string(),
            "kind": fields.kind,
            "status": fields.status,
            "title": fields.title,
            "content": fields.content,
            "locations": fields.locations,
            "raw_input": fields.raw_input,
            "raw_output": fields.raw_output,
            "meta": update.meta,
        })
    }

    fn extract_text_from_tool_call_content_vec(contents: &[acp::ToolCallContent]) -> String {
        contents
            .iter()
            .filter_map(|tool_content| {
                // Serialize ToolCallContent to JSON and extract text
                // Based on the log structure: Content { content: Text(TextContent { text: "..." }) }
                if let Ok(json_value) = serde_json::to_value(tool_content) {
                    // Try various paths to find text
                    // Path 1: content.Text.text (enum variant serialized as object with variant name as key)
                    if let Some(text) = json_value
                        .get("content")
                        .and_then(|c| c.get("Text"))
                        .and_then(|t| t.get("text"))
                        .and_then(|t| t.as_str())
                    {
                        return Some(text.to_string());
                    }
                    // Path 2: content.text (if content is directly an object with text field)
                    if let Some(text) = json_value
                        .get("content")
                        .and_then(|c| c.get("text"))
                        .and_then(|t| t.as_str())
                    {
                        return Some(text.to_string());
                    }
                    // Path 3: text (direct field)
                    if let Some(text) = json_value.get("text").and_then(|t| t.as_str()) {
                        return Some(text.to_string());
                    }
                    // Path 4: content array
                    if let Some(content_array) =
                        json_value.get("content").and_then(|c| c.as_array())
                    {
                        let texts: Vec<String> = content_array
                            .iter()
                            .filter_map(|item| {
                                // Try Text.text, text, or content.text
                                item.get("Text")
                                    .and_then(|t| t.get("text"))
                                    .or_else(|| item.get("text"))
                                    .or_else(|| item.get("content").and_then(|c| c.get("text")))
                                    .and_then(|t| t.as_str())
                                    .map(|s| s.to_string())
                            })
                            .collect();
                        if !texts.is_empty() {
                            return Some(texts.join(""));
                        }
                    }
                    None
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join("")
    }

    fn is_last_message_assistant(history: &[AcpMessage]) -> bool {
        history
            .last()
            .map(|item| matches!(item, AcpMessage::Assistant(_)))
            .unwrap_or(false)
    }

    fn is_last_message_user(history: &[AcpMessage]) -> bool {
        history
            .last()
            .map(|item| matches!(item, AcpMessage::User(_)))
            .unwrap_or(false)
    }

    fn is_last_message_thought(history: &[AcpMessage]) -> bool {
        history
            .last()
            .map(|item| matches!(item, AcpMessage::Thought(_)))
            .unwrap_or(false)
    }

    fn append_to_last_user_message(history: &mut Vec<AcpMessage>, text: &str) {
        if let Some(last_idx) = history.len().checked_sub(1) {
            if let AcpMessage::User(AcpUserMessage {
                content,
                checkpoint_id,
            }) = &history[last_idx]
            {
                let mut updated_content = content.clone();
                updated_content.push_str(text);
                history[last_idx] = AcpMessage::User(AcpUserMessage {
                    content: updated_content,
                    checkpoint_id: checkpoint_id.clone(),
                });
            }
        }
    }

    fn append_to_last_assistant_message(history: &mut Vec<AcpMessage>, text: &str) {
        if let Some(last_idx) = history.len().checked_sub(1) {
            if let AcpMessage::Assistant(AcpAssistantMessage { content, .. }) = &history[last_idx] {
                let mut updated_content = content.clone();
                updated_content.push_str(text);
                history[last_idx] = AcpMessage::Assistant(AcpAssistantMessage {
                    content: updated_content,
                    is_chunk: Some(true),
                });
            }
        }
    }

    fn append_to_last_thought_message(history: &mut Vec<AcpMessage>, text: &str) {
        if let Some(last_idx) = history.len().checked_sub(1) {
            if let AcpMessage::Thought(AcpThought { content, .. }) = &history[last_idx] {
                let mut updated_content = content.clone();
                updated_content.push_str(text);
                history[last_idx] = AcpMessage::Thought(AcpThought {
                    content: updated_content,
                    is_chunk: Some(true),
                });
            }
        }
    }

    async fn send_message(&self, message: AcpMessage) {
        match self.message_sender.send(message) {
            Ok(receiver_count) => {
                if receiver_count == 0 {
                    debug!(
                        "Message sent to agent {} but no receivers connected (stored in history)",
                        self.agent_id
                    );
                } else {
                    debug!(
                        "Message sent to agent {} with {} receivers",
                        self.agent_id, receiver_count
                    );
                }
            }
            Err(e) => {
                debug!(
                    "No active ACP subscribers for agent {}, message kept only in history: {}",
                    self.agent_id, e
                );
            }
        }
    }
}

/// Type alias for pending permissions map
pub type PendingPermissionsMap =
    Arc<tokio::sync::Mutex<HashMap<String, tokio::sync::oneshot::Sender<PermissionResponse>>>>;

enum RestoreSessionOutcome {
    Restored(acp::SessionId),
    Failed {
        load_err: acp::Error,
        resume_err: acp::Error,
    },
}

pub struct AcpAgent {
    agent_id: String,
    agent_name: String,
    permission_mode: Arc<AtomicU8>,
    connection: Option<acp::ClientSideConnection>,
    session_id: Option<acp::SessionId>,
    ready: Arc<AtomicBool>,
    message_sender: Option<broadcast::Sender<AcpMessage>>,
    prompt_sender: Option<mpsc::Sender<String>>,
    cancel_sender: Arc<tokio::sync::Mutex<Option<mpsc::Sender<()>>>>,
    process_handle: Option<tokio::task::JoinHandle<()>>,
    io_handle: Option<tokio::task::JoinHandle<()>>,
    history: Arc<tokio::sync::Mutex<Vec<AcpMessage>>>,
    pending_permissions: PendingPermissionsMap,
    /// History manager for undo/redo support
    history_manager: Arc<RwLock<AcpHistoryManager>>,
}

impl AcpAgent {
    pub fn new(agent_id: String, agent_name: String, permission_mode: Arc<AtomicU8>) -> Self {
        // Initialize history manager with current working directory and agent ID
        let project_root = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let mut history_manager = AcpHistoryManager::new(&project_root, &agent_id);
        if let Err(e) = history_manager.init() {
            error!("Failed to initialize history manager: {}", e);
        }

        Self {
            agent_id,
            agent_name,
            permission_mode,
            connection: None,
            session_id: None,
            ready: Arc::new(AtomicBool::new(false)),
            message_sender: None,
            prompt_sender: None,
            cancel_sender: Arc::new(tokio::sync::Mutex::new(None)),
            process_handle: None,
            io_handle: None,
            history: Arc::new(tokio::sync::Mutex::new(Vec::new())),
            pending_permissions: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            history_manager: Arc::new(RwLock::new(history_manager)),
        }
    }

    pub async fn start(
        &mut self,
        cmd: &str,
        args: &[String],
        resume_session_id: Option<String>,
    ) -> Result<String> {
        // Setup channels
        let (history_tx, _) = broadcast::channel::<AcpMessage>(1000);
        self.message_sender = Some(history_tx.clone());

        let (prompt_tx, prompt_rx) = mpsc::channel::<String>(100);
        self.prompt_sender = Some(prompt_tx.clone());

        let (cancel_tx, cancel_rx) = mpsc::channel::<()>(10);
        {
            let mut cancel_sender_guard = self.cancel_sender.lock().await;
            *cancel_sender_guard = Some(cancel_tx.clone());
        }

        let (session_tx, mut session_rx) = mpsc::channel::<acp::SessionId>(1);

        // Spawn agent process
        let (mut child, stdin, stdout, stderr) = Self::spawn_agent_process(cmd, args)?;

        // Setup connection and run in LocalSet
        let ready_clone = self.ready.clone();
        let agent_id_clone = self.agent_id.clone();
        let history_clone = self.history.clone();
        let message_sender_clone = history_tx.clone();
        let pending_permissions_clone = self.pending_permissions.clone();
        let permission_mode_clone = self.permission_mode.clone();

        let local_set_handle = tokio::task::spawn_blocking(move || {
            tokio::runtime::Handle::current().block_on(async {
                let local_set = tokio::task::LocalSet::new();
                local_set
                    .run_until(async move {
                        Self::run_agent(
                            agent_id_clone,
                            ready_clone,
                            history_clone,
                            message_sender_clone,
                            pending_permissions_clone,
                            permission_mode_clone,
                            stdin,
                            stdout,
                            stderr,
                            prompt_rx,
                            cancel_rx,
                            session_tx,
                            resume_session_id,
                        )
                        .await;
                    })
                    .await;
            })
        });

        self.io_handle = Some(local_set_handle);
        self.connection = None;

        let process_handle = tokio::spawn(async move {
            let _ = child.wait().await;
            debug!("ACP agent process ended");
        });
        self.process_handle = Some(process_handle);

        match tokio::time::timeout(tokio::time::Duration::from_secs(15), session_rx.recv()).await {
            Ok(Some(session_id)) => {
                self.session_id = Some(session_id.clone());
                Ok(session_id.to_string())
            }
            Ok(None) => {
                self.stop().await;
                Err(anyhow!(
                    "ACP agent session channel closed before initialization"
                ))
            }
            Err(_) => {
                self.stop().await;
                Err(anyhow!(
                    "Timed out while waiting for ACP session initialization"
                ))
            }
        }
    }

    fn spawn_agent_process(
        cmd: &str,
        args: &[String],
    ) -> io::Result<(
        tokio::process::Child,
        tokio::process::ChildStdin,
        tokio::process::ChildStdout,
        tokio::process::ChildStderr,
    )> {
        let mut child = Command::new(cmd)
            .args(args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()?;

        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();

        Ok((child, stdin, stdout, stderr))
    }

    async fn run_agent(
        agent_id: String,
        ready: Arc<AtomicBool>,
        history: Arc<tokio::sync::Mutex<Vec<AcpMessage>>>,
        message_sender: broadcast::Sender<AcpMessage>,
        pending_permissions: PendingPermissionsMap,
        permission_mode: Arc<AtomicU8>,
        stdin: tokio::process::ChildStdin,
        stdout: tokio::process::ChildStdout,
        stderr: tokio::process::ChildStderr,
        mut prompt_rx: mpsc::Receiver<String>,
        mut cancel_rx: mpsc::Receiver<()>,
        session_tx: mpsc::Sender<acp::SessionId>,
        resume_session_id: Option<String>,
    ) {
        // Clone history before moving client_impl
        let history_for_stderr = history.clone();
        let history_for_prompt = history.clone();

        // Create client implementation
        let client_impl = AcpClientImpl {
            agent_id: agent_id.clone(),
            permission_mode,
            message_sender: message_sender.clone(),
            history,
            pending_permissions,
        };

        // Create connection inside LocalSet
        let (conn, handle_io) = acp::ClientSideConnection::new(
            client_impl,
            stdin.compat_write(),
            stdout.compat(),
            |fut| {
                tokio::task::spawn_local(fut);
            },
        );

        // Wrap connection in Rc to allow sharing for cancellation
        let conn = std::rc::Rc::new(conn);

        // Handle I/O in the background
        tokio::task::spawn_local(handle_io);

        // Read stderr for debugging
        Self::spawn_stderr_reader(stderr, message_sender.clone(), history_for_stderr);

        // Initialize connection and create session
        let session_id =
            match Self::initialize_connection(&conn, &agent_id, resume_session_id).await {
                Ok(session_id) => {
                    let _ = session_tx.send(session_id.clone()).await;
                    ready.store(true, Ordering::SeqCst);
                    Some(session_id)
                }
                Err(e) => {
                    error!("Failed to initialize ACP agent {}: {}", agent_id, e);
                    None
                }
            };

        // Handle prompts in a loop
        if let Some(session_id) = session_id {
            Self::run_prompt_loop(
                &conn,
                &agent_id,
                &message_sender,
                history_for_prompt,
                session_id,
                &mut prompt_rx,
                &mut cancel_rx,
            )
            .await;
        } else {
            error!(
                "No session ID for agent {}, cannot handle prompts",
                agent_id
            );
            // Keep the connection alive if no session
            loop {
                tokio::time::sleep(tokio::time::Duration::from_secs(3600)).await;
            }
        }
    }

    fn spawn_stderr_reader(
        stderr: tokio::process::ChildStderr,
        message_sender: broadcast::Sender<AcpMessage>,
        history: Arc<tokio::sync::Mutex<Vec<AcpMessage>>>,
    ) {
        tokio::task::spawn_local(async move {
            use tokio::io::{AsyncBufReadExt, BufReader};
            let mut reader = BufReader::new(stderr);
            let mut buf = String::new();
            while reader.read_line(&mut buf).await.is_ok() && !buf.is_empty() {
                let error_msg = buf.trim().to_string();
                error!("ACP stderr: {}", error_msg);

                // Create error message
                let error_message = AcpMessage::Error(AcpError { message: error_msg });

                // Save to history
                {
                    let mut history = history.lock().await;
                    history.push(error_message.clone());
                }

                // Send error message to UI
                let _ = message_sender.send(error_message);

                buf.clear();
            }
        });
    }

    async fn initialize_agent_connection(
        conn: &std::rc::Rc<acp::ClientSideConnection>,
        agent_id: &str,
    ) -> Result<()> {
        let client_info = acp::Implementation::new("anycode", "1.0.0").title("Anycode Editor");

        // Define client capabilities
        let fs_capabilities = acp::FileSystemCapability::new()
            .read_text_file(true)
            .write_text_file(true);

        let client_capabilities = acp::ClientCapabilities::new().fs(fs_capabilities);

        let init_message = acp::InitializeRequest::new(ProtocolVersion::V1)
            .client_info(client_info)
            .client_capabilities(client_capabilities);

        info!(
            "Initializing ACP agent {} with capabilities: fs.readTextFile=true, fs.writeTextFile=true",
            agent_id
        );

        let init_response = conn
            .initialize(init_message)
            .await
            .map_err(|e| anyhow!("Failed to initialize: {}", e))?;

        info!(
            "ACP agent {} initialized successfully. Agent capabilities: {:?}",
            agent_id, init_response.agent_capabilities
        );
        Ok(())
    }

    async fn initialize_connection(
        conn: &std::rc::Rc<acp::ClientSideConnection>,
        agent_id: &str,
        resume_session_id: Option<String>,
    ) -> Result<acp::SessionId> {
        Self::initialize_agent_connection(conn, agent_id).await?;

        let cwd = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
        let session_id = Self::create_or_resume_session(conn, resume_session_id, cwd).await?;

        info!("Session ready for agent {}: {}", agent_id, session_id);
        Ok(session_id)
    }

    async fn create_or_resume_session(
        conn: &std::rc::Rc<acp::ClientSideConnection>,
        resume_session_id: Option<String>,
        cwd: PathBuf,
    ) -> Result<acp::SessionId> {
        if let Some(resume_session_id) = resume_session_id.as_deref() {
            match Self::restore_session(conn, resume_session_id, &cwd).await? {
                RestoreSessionOutcome::Restored(session_id) => return Ok(session_id),
                RestoreSessionOutcome::Failed {
                    load_err,
                    resume_err,
                } => {
                    error!(
                        "Failed to restore ACP session {}. load_session error: {}. resume_session error: {}. Falling back to creating a new session.",
                        resume_session_id,
                        load_err,
                        resume_err
                    );
                }
            }
        }

        let response = conn
            .new_session(acp::NewSessionRequest::new(cwd))
            .await
            .map_err(|e| anyhow!("Failed to create session: {}", e))?;

        Ok(response.session_id)
    }

    async fn restore_session(
        conn: &std::rc::Rc<acp::ClientSideConnection>,
        resume_session_id: &str,
        cwd: &PathBuf,
    ) -> Result<RestoreSessionOutcome> {
        let requested_session_id = SessionId::new(resume_session_id.to_string());
        let load_result = conn
            .load_session(acp::LoadSessionRequest::new(
                requested_session_id.clone(),
                cwd.clone(),
            ))
            .await;

        if load_result.is_ok() {
            return Ok(RestoreSessionOutcome::Restored(requested_session_id));
        }

        let load_err = match load_result {
            Ok(_) => unreachable!("successful load handled above"),
            Err(err) => err,
        };

        let resume_result = conn
            .resume_session(acp::ResumeSessionRequest::new(
                requested_session_id.clone(),
                cwd.clone(),
            ))
            .await;

        if resume_result.is_ok() {
            return Ok(RestoreSessionOutcome::Restored(requested_session_id));
        }

        let resume_err = match resume_result {
            Ok(_) => unreachable!("successful resume handled above"),
            Err(err) => err,
        };

        Ok(RestoreSessionOutcome::Failed {
            load_err,
            resume_err,
        })
    }

    async fn run_prompt_loop(
        conn: &std::rc::Rc<acp::ClientSideConnection>,
        agent_id: &str,
        message_sender: &broadcast::Sender<AcpMessage>,
        history: Arc<tokio::sync::Mutex<Vec<AcpMessage>>>,
        session_id: acp::SessionId,
        prompt_rx: &mut mpsc::Receiver<String>,
        cancel_rx: &mut mpsc::Receiver<()>,
    ) {
        info!(
            "Starting prompt handling loop for agent {} with session {}",
            agent_id, session_id
        );

        loop {
            match prompt_rx.recv().await {
                Some(prompt) => {
                    info!("Sending prompt to agent {}: {}", agent_id, prompt);

                    // Send prompt state: processing started
                    let _ = message_sender.send(AcpMessage::PromptState(AcpPromptState {
                        is_processing: true,
                    }));

                    // Handle prompt with cancellation support
                    Self::handle_prompt_with_cancellation(
                        conn,
                        agent_id,
                        message_sender,
                        &history,
                        &session_id,
                        prompt,
                        cancel_rx,
                    )
                    .await;

                    // Send prompt state: processing finished
                    let _ = message_sender.send(AcpMessage::PromptState(AcpPromptState {
                        is_processing: false,
                    }));

                    // Drain any remaining cancel signals before processing next prompt
                    while cancel_rx.try_recv().is_ok() {}
                }
                None => {
                    info!("Prompt channel closed for agent {}", agent_id);
                    break; // Channel closed
                }
            }
        }
    }

    async fn handle_prompt_with_cancellation(
        conn: &std::rc::Rc<acp::ClientSideConnection>,
        agent_id: &str,
        message_sender: &broadcast::Sender<AcpMessage>,
        history: &Arc<tokio::sync::Mutex<Vec<AcpMessage>>>,
        session_id: &acp::SessionId,
        prompt: String,
        cancel_rx: &mut mpsc::Receiver<()>,
    ) {
        // Create prompt request
        let prompt_request = acp::PromptRequest::new(session_id.clone(), vec![prompt.into()]);

        // Clone connection for cancellation
        let conn_for_prompt = std::rc::Rc::clone(conn);
        let conn_for_cancel = std::rc::Rc::clone(conn);

        // Pin the prompt future
        let mut prompt_fut =
            std::pin::pin!(async move { conn_for_prompt.prompt(prompt_request).await });

        // Track if we've sent cancel notification
        let mut cancel_sent = false;

        // Wait for prompt completion or cancel signal
        loop {
            tokio::select! {
                result = &mut prompt_fut => {
                    match result {
                        Ok(response) => {
                            info!("Prompt ended successfully for agent {}, response: {:?}", agent_id, response);
                        }
                        Err(e) => {
                            error!("Failed to end prompt for agent {}, error: {}", agent_id, e);
                            // Create error message
                            let error_message = AcpMessage::Error(AcpError {
                                message: e.to_string(),
                            });

                            // Save to history
                            {
                                let mut hist = history.lock().await;
                                hist.push(error_message.clone());
                            }

                            // Send error message to UI
                            let _ = message_sender.send(error_message);
                        }
                    }
                    break;
                }
                _ = cancel_rx.recv() => {
                    if !cancel_sent {
                        cancel_sent = true;
                        info!("Cancelling current prompt for agent {}", agent_id);
                        // Send cancel notification to agent via ACP protocol
                        if let Err(e) = conn_for_cancel
                            .cancel(acp::CancelNotification::new(session_id.clone()))
                            .await
                        {
                            error!("Failed to send cancel notification for agent {}: {}", agent_id, e);
                        }
                    }
                }
            }
        }
    }

    pub async fn list_sessions_for_command(
        cmd: &str,
        args: &[String],
        cwd: PathBuf,
    ) -> Result<Vec<AcpSessionSummary>> {
        let cmd = cmd.to_string();
        let args = args.to_vec();

        tokio::task::spawn_blocking(move || {
            tokio::runtime::Handle::current().block_on(async move {
                let local_set = tokio::task::LocalSet::new();
                local_set
                    .run_until(async move {
                        let (mut child, stdin, stdout, stderr) =
                            Self::spawn_agent_process(&cmd, &args).map_err(|e| {
                                anyhow!("Failed to spawn ACP agent for session listing: {}", e)
                            })?;

                        tokio::task::spawn_local(async move {
                            let mut reader = BufReader::new(stderr);
                            let mut buf = String::new();
                            loop {
                                match reader.read_line(&mut buf).await {
                                    Ok(0) => break,
                                    Ok(_) => {
                                        debug!("ACP sessions stderr: {}", buf.trim());
                                        buf.clear();
                                    }
                                    Err(err) => {
                                        debug!("Failed to read ACP sessions stderr: {}", err);
                                        break;
                                    }
                                }
                            }
                        });

                        let (message_sender, _) = broadcast::channel::<AcpMessage>(1);
                        let client_impl = AcpClientImpl {
                            agent_id: "session-list".to_string(),
                            permission_mode: Arc::new(AtomicU8::new(
                                AcpPermissionMode::FullAccess.as_atomic(),
                            )),
                            message_sender,
                            history: Arc::new(tokio::sync::Mutex::new(Vec::new())),
                            pending_permissions: Arc::new(Mutex::new(HashMap::new())),
                        };

                        let (conn, handle_io) = acp::ClientSideConnection::new(
                            client_impl,
                            stdin.compat_write(),
                            stdout.compat(),
                            |fut| {
                                tokio::task::spawn_local(fut);
                            },
                        );
                        let conn = std::rc::Rc::new(conn);

                        tokio::task::spawn_local(handle_io);

                        Self::initialize_agent_connection(&conn, "session-list").await?;

                        let mut all_sessions = Vec::new();
                        let mut cursor = None;

                        loop {
                            let response = conn
                                .list_sessions(
                                    acp::ListSessionsRequest::new()
                                        .cwd(cwd.clone())
                                        .cursor(cursor.clone()),
                                )
                                .await
                                .map_err(|e| anyhow!("Failed to list sessions: {}", e))?;

                            all_sessions.extend(response.sessions.into_iter().map(|session| {
                                AcpSessionSummary {
                                    session_id: session.session_id.to_string(),
                                    cwd: session.cwd.to_string_lossy().to_string(),
                                    title: session.title,
                                    updated_at: session.updated_at,
                                }
                            }));

                            if response.next_cursor.is_none() {
                                break;
                            }
                            cursor = response.next_cursor;
                        }

                        all_sessions.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));

                        let _ = child.kill().await;
                        let _ = child.wait().await;

                        Ok(all_sessions)
                    })
                    .await
            })
        })
        .await
        .map_err(|e| anyhow!("Failed to join ACP session listing task: {}", e))?
    }

    pub async fn stop(&mut self) {
        self.ready.store(false, Ordering::SeqCst);
        if let Some(handle) = self.process_handle.take() {
            handle.abort();
        }
        if let Some(handle) = self.io_handle.take() {
            handle.abort();
        }
        self.connection = None;
        self.session_id = None;
    }

    pub async fn send_prompt(&mut self, prompt: String) -> Result<String> {
        let prompt_tx = match &self.prompt_sender {
            Some(tx) => tx,
            None => return Err(anyhow!("Prompt sender not initialized")),
        };

        // Create checkpoint before processing the message
        let mut manager = self.history_manager.write().await;
        let checkpoint_id = match manager.create_checkpoint(&prompt) {
            Ok(id) => Some(id),
            Err(e) => {
                error!("Failed to create checkpoint: {}", e);
                None
            }
        };
        drop(manager);

        let user_message = AcpMessage::User(AcpUserMessage {
            content: prompt.clone(),
            checkpoint_id,
        });

        // Save user message to history
        let mut history = self.history.lock().await;
        history.push(user_message.clone());

        // Send user message to all connected clients (non-blocking)
        if let Some(message_sender) = &self.message_sender {
            if let Err(e) = message_sender.send(user_message.clone()) {
                error!(
                    "Failed to broadcast user message for agent {}: {}",
                    self.agent_id, e
                );
                // Continue anyway - message is in history and will be sent on reconnect
            }
        }

        // Send prompt to agent
        prompt_tx.send(prompt).await?;

        Ok(String::new())
    }

    /// Restore project to state before a specific prompt was processed
    pub async fn restore_to_prompt(&self, prompt: &str) -> Result<()> {
        let manager = self.history_manager.read().await;
        manager.restore_to_checkpoint(prompt)?;

        info!("Restored project to state before prompt");
        Ok(())
    }

    /// Restore project to state at a checkpoint id (commit hash)
    pub async fn restore_to_checkpoint_id(&self, checkpoint_id: &str) -> Result<()> {
        let manager = self.history_manager.read().await;
        manager.restore_to_commit(checkpoint_id)?;

        info!("Restored project to checkpoint {}", checkpoint_id);
        Ok(())
    }

    /// Get all available checkpoints
    pub async fn get_checkpoints(&self) -> Vec<String> {
        let manager = self.history_manager.read().await;
        manager
            .get_all_checkpoints()
            .iter()
            .map(|cp| cp.prompt.clone())
            .collect()
    }

    pub async fn cancel_prompt(&self) -> Result<()> {
        let cancel_sender_guard = self.cancel_sender.lock().await;
        let cancel_tx = match cancel_sender_guard.as_ref() {
            Some(tx) => tx,
            None => return Err(anyhow!("Cancel sender not initialized")),
        };

        // Send cancel signal to agent
        cancel_tx.send(()).await?;
        Ok(())
    }

    pub fn agent_name(&self) -> &str {
        &self.agent_name
    }

    pub async fn get_history(&self) -> Vec<AcpMessage> {
        self.history.lock().await.clone()
    }

    /// Get the message sender for subscribing to agent messages.
    /// Returns None if the agent hasn't been started yet.
    pub fn get_message_sender(&self) -> Option<broadcast::Sender<AcpMessage>> {
        self.message_sender.clone()
    }

    /// Send permission response for a pending permission request.
    /// Returns Ok(true) if the permission was found and response sent, Ok(false) if not found.
    pub async fn send_permission_response(
        &self,
        permission_id: &str,
        option_id: String,
    ) -> Result<bool> {
        let mut pending = self.pending_permissions.lock().await;
        if let Some(sender) = pending.remove(permission_id) {
            let response = PermissionResponse {
                permission_id: permission_id.to_string(),
                option_id,
            };
            // Send response (ignore error if receiver dropped)
            let _ = sender.send(response);
            Ok(true)
        } else {
            Ok(false)
        }
    }
}

pub struct AcpManager {
    agents: HashMap<String, AcpAgent>,
    permission_mode: Arc<AtomicU8>,
}

impl AcpManager {
    pub fn new(permission_mode: AcpPermissionMode) -> Self {
        Self {
            agents: HashMap::new(),
            permission_mode: Arc::new(AtomicU8::new(permission_mode.as_atomic())),
        }
    }

    pub fn get_permission_mode(&self) -> AcpPermissionMode {
        AcpPermissionMode::from_atomic(self.permission_mode.load(Ordering::Relaxed))
    }

    pub fn set_permission_mode(&self, mode: AcpPermissionMode) {
        self.permission_mode
            .store(mode.as_atomic(), Ordering::Relaxed);
    }

    /// Start agent by agent_id and agent_name. Returns an error if the agent already exists.
    pub async fn start_agent(
        &mut self,
        agent_id: String,
        agent_name: String,
        cmd: &str,
        args: &[String],
        resume_session_id: Option<String>,
    ) -> Result<String> {
        if self.agents.contains_key(&agent_id) {
            return Err(anyhow::anyhow!("Agent {} already running", agent_id));
        }

        let mut agent = AcpAgent::new(
            agent_id.clone(),
            agent_name.clone(),
            self.permission_mode.clone(),
        );

        info!(
            "Starting ACP agent {} with command: {} {:?}",
            agent_id, cmd, args
        );
        let session_id = agent.start(cmd, args, resume_session_id).await?;

        self.agents.insert(agent_id, agent);

        Ok(session_id)
    }

    /// Stop agent by agent_id.
    pub async fn stop_agent(&mut self, agent_id: &str) {
        if let Some(mut agent) = self.agents.remove(agent_id) {
            agent.stop().await;
        }
    }

    /// Cancel current prompt for agent by agent_id.
    pub async fn cancel_prompt(&self, agent_id: &str) -> Result<()> {
        if let Some(agent) = self.agents.get(agent_id) {
            agent.cancel_prompt().await
        } else {
            Err(anyhow::anyhow!("Agent {} not found", agent_id))
        }
    }

    /// Get agent by agent_id. Returns None if the agent doesn't exist.
    pub fn get_agent(&mut self, agent_id: &str) -> Option<&mut AcpAgent> {
        self.agents.get_mut(agent_id)
    }

    /// Subscribe to agent messages. Returns a receiver for the agent's message channel.
    /// Returns None if the agent doesn't exist or hasn't been started yet.
    pub fn subscribe(&self, agent_id: &str) -> Option<broadcast::Receiver<AcpMessage>> {
        self.agents
            .get(agent_id)?
            .get_message_sender()
            .map(|sender| sender.subscribe())
    }

    /// Get agent history. Returns None if the agent doesn't exist.
    pub async fn get_agent_history(&mut self, agent_id: &str) -> Option<Vec<AcpMessage>> {
        if let Some(agent) = self.agents.get_mut(agent_id) {
            Some(agent.get_history().await)
        } else {
            None
        }
    }

    /// List all agents. Returns a vector of (agent_id, agent_name).
    pub fn list_agents(&self) -> Vec<(String, String)> {
        self.agents
            .iter()
            .map(|(id, agent)| (id.clone(), agent.agent_name().to_string()))
            .collect()
    }

    pub async fn list_sessions(
        &self,
        cmd: &str,
        args: &[String],
        cwd: PathBuf,
    ) -> Result<Vec<AcpSessionSummary>> {
        AcpAgent::list_sessions_for_command(cmd, args, cwd).await
    }

    /// Restore agent's project to state before a specific prompt was processed
    pub async fn restore_to_prompt(&self, agent_id: &str, prompt: &str) -> Result<()> {
        let agent = self
            .agents
            .get(agent_id)
            .ok_or_else(|| anyhow!("Agent {} not found", agent_id))?;

        agent.restore_to_prompt(prompt).await
    }

    /// Restore agent's project to state at a checkpoint id (commit hash)
    pub async fn restore_to_checkpoint_id(
        &self,
        agent_id: &str,
        checkpoint_id: &str,
    ) -> Result<()> {
        let agent = self
            .agents
            .get(agent_id)
            .ok_or_else(|| anyhow!("Agent {} not found", agent_id))?;

        agent.restore_to_checkpoint_id(checkpoint_id).await
    }

    /// Get all checkpoints for an agent. Returns Vec of prompts
    pub async fn get_checkpoints(&self, agent_id: &str) -> Result<Vec<String>> {
        let agent = self
            .agents
            .get(agent_id)
            .ok_or_else(|| anyhow!("Agent {} not found", agent_id))?;

        Ok(agent.get_checkpoints().await)
    }
}

use crate::acp_fs::AcpFsCommand;
use crate::acp_history::AcpHistoryManager;
use agent_client_protocol::schema::v1 as acp;
use agent_client_protocol::schema::v1::{
    RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse,
    SelectedPermissionOutcome,
};
use agent_client_protocol::{ByteStreams, Client, ConnectionTo};
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::SessionId;
use anyhow::{Context, Result, anyhow};
use base64::Engine as _;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::io::{self, AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::{Notify, RwLock, broadcast, mpsc, oneshot};
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};
use tracing::{debug, error, info, warn};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpUserMessage {
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checkpoint_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachments: Option<Vec<AcpPromptAttachment>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpPromptState {
    pub is_processing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpPromptAttachment {
    pub name: String,
    pub mime_type: String,
    pub data_base64: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpSelectOption {
    pub config_id: String,
    pub value: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpAuthMethodInfo {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status")]
pub enum AcpStartOutcome {
    #[serde(rename = "ready")]
    Ready {
        session_id: String,
    },
    #[serde(rename = "auth_required")]
    AuthRequired {
        auth_methods: Vec<AcpAuthMethodInfo>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpModelSelector {
    pub current_value: String,
    pub options: Vec<AcpSelectOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpReasoningSelector {
    pub current_value: String,
    pub options: Vec<AcpSelectOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpError {
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpRawUpdate {
    pub agent_id: String,
    #[serde(default)]
    pub session_id: Option<String>,
    pub ts: String,
    pub update: serde_json::Value,
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
pub struct AcpQueuedMessage {
    pub id: String,
    pub prompt: String,
    #[serde(default)]
    pub attachments: Vec<AcpPromptAttachment>,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpQueueUpdate {
    pub queue: Vec<AcpQueuedMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "role")]
pub enum AcpMessage {
    #[serde(rename = "user")]
    User(AcpUserMessage),
    #[serde(rename = "prompt_state")]
    PromptState(AcpPromptState),
    #[serde(rename = "session_model_selector")]
    SessionModelSelector(AcpModelSelector),
    #[serde(rename = "session_reasoning_selector")]
    SessionReasoningSelector(AcpReasoningSelector),
    #[serde(rename = "error")]
    Error(AcpError),
    #[serde(rename = "raw_update")]
    RawUpdate(AcpRawUpdate),
    #[serde(rename = "queue_update")]
    QueueUpdate(AcpQueueUpdate),
}

struct AcpClientImpl {
    agent_id: String,
    message_sender: broadcast::Sender<AcpMessage>,
    history: Arc<tokio::sync::Mutex<Vec<AcpMessage>>>,
    /// Channel to send file operations to the ACP filesystem background task
    fs_sender: Option<mpsc::Sender<AcpFsCommand>>,
    acp_db: Option<Arc<crate::acp_db::AcpDb>>,
}

impl AcpClientImpl {
    async fn request_permission(
        &self,
        args: RequestPermissionRequest,
    ) -> acp::Result<RequestPermissionResponse> {
        info!(
            "request_permission called for agent {}: {:?}",
            self.agent_id, args
        );

        static KEYWORDS: &[&str] = &[
            "allow", "approve", "accept", "grant", "yes", "continue", "proceed",
        ];

        let outcome = args
            .options
            .iter()
            .find(|opt| {
                let name = opt.name.to_lowercase();
                KEYWORDS.iter().any(|&k| name.contains(k))
            })
            .or(args.options.first())
            .map(|opt| {
                info!(
                    "Auto-approving permission for agent {}: {}",
                    self.agent_id, opt.name
                );
                RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(
                    opt.option_id.clone(),
                ))
            })
            .unwrap_or_else(|| {
                error!(
                    "No permission options were returned for agent {}",
                    self.agent_id
                );
                RequestPermissionOutcome::Cancelled
            });

        Ok(RequestPermissionResponse::new(outcome))
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

        let fs_sender = match &self.fs_sender {
            Some(s) => s,
            None => {
                error!("No fs_sender available for agent {}", self.agent_id);
                return Err(acp::Error::internal_error());
            }
        };

        let (resp_tx, resp_rx) = tokio::sync::oneshot::channel();
        let cmd = AcpFsCommand::WriteTextFile {
            agent_id: self.agent_id.clone(),
            path: args.path.to_path_buf(),
            content: args.content.clone(),
            resp: resp_tx,
        };

        if fs_sender.send(cmd).await.is_err() {
            error!("ACP fs channel closed for agent {}", self.agent_id);
            return Err(acp::Error::internal_error());
        }

        match resp_rx.await {
            Ok(Ok(())) => {
                info!(
                    "Successfully wrote file for agent {}: {:?} ({} bytes)",
                    self.agent_id,
                    args.path,
                    args.content.len()
                );
                Ok(acp::WriteTextFileResponse::new())
            }
            Ok(Err(e)) => {
                error!(
                    "Failed to write file {:?} for agent {}: {}",
                    args.path, self.agent_id, e
                );
                Err(acp::Error::internal_error())
            }
            Err(_) => {
                error!(
                    "ACP fs response channel dropped for agent {}",
                    self.agent_id
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

        let fs_sender = match &self.fs_sender {
            Some(s) => s,
            None => {
                error!("No fs_sender available for agent {}", self.agent_id);
                return Err(acp::Error::internal_error());
            }
        };

        let (resp_tx, resp_rx) = tokio::sync::oneshot::channel();
        let cmd = AcpFsCommand::ReadTextFile {
            agent_id: self.agent_id.clone(),
            path: args.path.to_path_buf(),
            resp: resp_tx,
        };

        if fs_sender.send(cmd).await.is_err() {
            error!("ACP fs channel closed for agent {}", self.agent_id);
            return Err(acp::Error::internal_error());
        }

        match resp_rx.await {
            Ok(Ok(content)) => {
                info!(
                    "Successfully read file for agent {}: {:?} ({} bytes)",
                    self.agent_id,
                    args.path,
                    content.len()
                );
                Ok(acp::ReadTextFileResponse::new(content))
            }
            Ok(Err(e)) => {
                error!(
                    "Failed to read file {:?} for agent {}: {}",
                    args.path, self.agent_id, e
                );
                Err(acp::Error::internal_error())
            }
            Err(_) => {
                error!(
                    "ACP fs response channel dropped for agent {}",
                    self.agent_id
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
        _args: acp::KillTerminalRequest,
    ) -> acp::Result<acp::KillTerminalResponse> {
        info!(
            "kill_terminal_command called for agent {}: {:?}",
            self.agent_id, _args
        );
        Err(acp::Error::method_not_found())
    }

    async fn session_notification(&self, args: acp::SessionNotification) -> acp::Result<()> {
        let session_id = args.session_id.to_string();
        info!(
            "session_notification received for agent {} (session {}): {:?}",
            self.agent_id, session_id, args.update
        );
        let mut update_value = serde_json::to_value(&args.update)?;
        self.maybe_offload_tool_output(&session_id, &mut update_value);

        let item = AcpMessage::RawUpdate(AcpRawUpdate {
            agent_id: self.agent_id.clone(),
            session_id: Some(session_id),
            ts: Utc::now().to_rfc3339(),
            update: update_value,
        });

        let mut hist = self.history.lock().await;
        if !Self::append_to_previous_raw_chunk(&mut hist, &args.update) {
            hist.push(item.clone());
        }
        drop(hist);

        self.send_message(item).await;
        Ok(())
    }

    fn maybe_offload_tool_output(&self, session_id: &str, update: &mut Value) {
        const OUTPUT_TRUNCATE_THRESHOLD: usize = 4096;

        let obj = match update.as_object_mut() {
            Some(map) => map,
            None => return,
        };

        let (kind, target_map) = if let Some(kind_val) = obj.get("sessionUpdate").or_else(|| obj.get("session_update")) {
            (kind_val.as_str().unwrap_or("").to_string(), obj)
        } else if obj.len() == 1 {
            let key = obj.keys().next().cloned().unwrap();
            if let Some(inner) = obj.get_mut(&key).and_then(Value::as_object_mut) {
                (key, inner)
            } else {
                return;
            }
        } else {
            return;
        };

        let is_tool_event = kind == "tool_call"
            || kind == "tool_call_update"
            || kind == "toolCall"
            || kind == "toolCallUpdate";
        if !is_tool_event {
            return;
        }

        let tool_id = target_map
            .get("toolCallId")
            .or_else(|| target_map.get("tool_call_id"))
            .or_else(|| target_map.get("id"))
            .or_else(|| {
                target_map
                    .get("fields")
                    .and_then(|f| f.get("toolCallId").or_else(|| f.get("tool_call_id")))
            })
            .and_then(Value::as_str)
            .map(|s| s.to_string());

        let tool_id = match tool_id {
            Some(id) if !id.is_empty() => id,
            _ => return,
        };

        let command = target_map
            .get("rawInput")
            .or_else(|| target_map.get("raw_input"))
            .and_then(|i| i.get("cmd").or_else(|| i.get("command")))
            .and_then(Value::as_str)
            .map(|s| s.to_string());

        Self::check_and_truncate_output_field(
            target_map,
            &tool_id,
            session_id,
            &self.agent_id,
            command.as_deref(),
            self.acp_db.as_ref(),
            OUTPUT_TRUNCATE_THRESHOLD,
        );

        if let Some(fields) = target_map.get_mut("fields").and_then(Value::as_object_mut) {
            Self::check_and_truncate_output_field(
                fields,
                &tool_id,
                session_id,
                &self.agent_id,
                command.as_deref(),
                self.acp_db.as_ref(),
                OUTPUT_TRUNCATE_THRESHOLD,
            );
        }
    }

    fn check_and_truncate_output_field(
        container: &mut serde_json::Map<String, Value>,
        tool_id: &str,
        session_id: &str,
        agent_id: &str,
        command: Option<&str>,
        acp_db: Option<&Arc<crate::acp_db::AcpDb>>,
        threshold: usize,
    ) {
        let output_keys = ["rawOutput", "raw_output", "output", "stdout", "formatted_output", "aggregated_output"];
        let mut truncated_len: Option<usize> = None;

        for key in output_keys {
            if let Some(val) = container.get_mut(key) {
                if let Some(text) = val.as_str() {
                    if text.len() > threshold {
                        if let Some(db) = acp_db {
                            if let Err(e) = db.save_tool_output(tool_id, Some(session_id), agent_id, command, text) {
                                warn!("Failed to save tool output to SQLite: {}", e);
                            }
                        }

                        let original_len = text.len();
                        let preview = Self::create_truncated_preview(text, original_len);

                        *val = Value::String(preview);
                        truncated_len = Some(original_len);
                    }
                } else if let Some(rec) = val.as_object_mut() {
                    for subkey in ["stdout", "output", "formatted_output", "stderr"] {
                        if let Some(subval) = rec.get_mut(subkey) {
                            if let Some(text) = subval.as_str() {
                                if text.len() > threshold {
                                    if let Some(db) = acp_db {
                                        let _ = db.save_tool_output(tool_id, Some(session_id), agent_id, command, text);
                                    }
                                    let original_len = text.len();
                                    *subval = Value::String(Self::create_truncated_preview(text, original_len));
                                    rec.insert("has_full_output".to_string(), Value::Bool(true));
                                    rec.insert("full_output_bytes".to_string(), Value::Number(serde_json::Number::from(original_len)));
                                    rec.insert("is_truncated".to_string(), Value::Bool(true));
                                    rec.insert("session_id".to_string(), Value::String(session_id.to_string()));
                                    truncated_len = Some(original_len);
                                }
                            }
                        }
                    }
                }
            }
        }

        if let Some(content_val) = container.get_mut("content") {
            if let Some(arr) = content_val.as_array_mut() {
                for item in arr.iter_mut() {
                    if let Some(text_val) = item.get_mut("text") {
                        if let Some(text) = text_val.as_str() {
                            if text.len() > threshold {
                                if let Some(db) = acp_db {
                                    if let Err(e) = db.save_tool_output(tool_id, Some(session_id), agent_id, command, text) {
                                        warn!("Failed to save tool output to SQLite: {}", e);
                                    }
                                }
                                let original_len = text.len();
                                *text_val = Value::String(Self::create_truncated_preview(text, original_len));
                                truncated_len = Some(original_len);
                            }
                        }
                    }
                }
            }
        }

        if let Some(len) = truncated_len {
            container.insert("has_full_output".to_string(), Value::Bool(true));
            container.insert("full_output_bytes".to_string(), Value::Number(serde_json::Number::from(len)));
            container.insert("is_truncated".to_string(), Value::Bool(true));
            container.insert("tool_id".to_string(), Value::String(tool_id.to_string()));
            container.insert("session_id".to_string(), Value::String(session_id.to_string()));
        }
    }


    fn create_truncated_preview(text: &str, byte_size: usize) -> String {
        let lines: Vec<&str> = text.lines().collect();
        if lines.len() <= 60 {
            if text.len() > 4096 {
                let prefix: String = text.chars().take(2000).collect();
                let suffix: String = text
                    .chars()
                    .rev()
                    .take(2000)
                    .collect::<String>()
                    .chars()
                    .rev()
                    .collect();
                format!(
                    "{}\n\n... [Output truncated ({} bytes). Click to load full output from disk] ...\n\n{}",
                    prefix, byte_size, suffix
                )
            } else {
                text.to_string()
            }
        } else {
            let head = lines[..25].join("\n");
            let tail = lines[lines.len() - 25..].join("\n");
            format!(
                "{}\n\n... [Output truncated ({} bytes / {} lines). Click to load full output from disk] ...\n\n{}",
                head,
                byte_size,
                lines.len(),
                tail
            )
        }
    }

    fn append_to_previous_raw_chunk(
        history: &mut [AcpMessage],
        update: &acp::SessionUpdate,
    ) -> bool {
        let (expected_kind, chunk_text) = match update {
            acp::SessionUpdate::AgentMessageChunk(chunk) => {
                let acp::ContentBlock::Text(text) = &chunk.content else {
                    return false;
                };
                ("agent_message_chunk", text.text.as_str())
            }
            acp::SessionUpdate::AgentThoughtChunk(chunk) => {
                let acp::ContentBlock::Text(text) = &chunk.content else {
                    return false;
                };
                ("agent_thought_chunk", text.text.as_str())
            }
            _ => return false,
        };

        if let Some(AcpMessage::RawUpdate(raw_update)) = history.last_mut() {
            if raw_update
                .update
                .get("sessionUpdate")
                .and_then(Value::as_str)
                == Some(expected_kind)
            {
                if let Some(Value::String(previous_text)) =
                    raw_update.update.pointer_mut("/content/text")
                {
                    previous_text.push_str(chunk_text);
                    return true;
                }
            }
        }

        false
    }

    fn append_or_push_error_message(history: &mut Vec<AcpMessage>, text: &str) -> AcpMessage {
        if let Some(last_idx) = history.len().checked_sub(1) {
            if let AcpMessage::Error(AcpError { message }) = &history[last_idx] {
                let mut merged = message.clone();
                if !merged.is_empty() {
                    merged.push('\n');
                }
                merged.push_str(text);
                let merged_error = AcpMessage::Error(AcpError { message: merged });
                history[last_idx] = merged_error.clone();
                return merged_error;
            }
        }

        let error = AcpMessage::Error(AcpError {
            message: text.to_string(),
        });
        history.push(error.clone());
        error
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

enum RestoreSessionOutcome {
    Restored(SessionBootstrap),
    Failed {
        load_err: acp::Error,
        resume_err: acp::Error,
    },
}

#[derive(Debug, Clone)]
pub struct SessionBootstrap {
    pub session_id: acp::SessionId,
    pub model_selector: Option<AcpModelSelector>,
    pub reasoning_selector: Option<AcpReasoningSelector>,
    pub prompt_capabilities: acp::PromptCapabilities,
}

#[derive(Debug, Clone)]
enum SessionBootstrapOutcome {
    Ready(SessionBootstrap),
    AuthRequired {
        auth_methods: Vec<AcpAuthMethodInfo>,
        prompt_capabilities: acp::PromptCapabilities,
        cwd: PathBuf,
    },
}

#[derive(Debug, Clone)]
struct SessionConfigSelectors {
    model_selector: Option<AcpModelSelector>,
    reasoning_selector: Option<AcpReasoningSelector>,
}

#[derive(Debug)]
struct PendingConfigUpdate {
    option: AcpSelectOption,
    response_tx: tokio::sync::oneshot::Sender<Result<SessionConfigSelectors, String>>,
}

pub struct AcpAgent {
    agent_id: String,
    agent_name: String,
    connection: Option<ConnectionTo<agent_client_protocol::Agent>>,
    session_id: Option<acp::SessionId>,
    ready: Arc<AtomicBool>,
    is_processing: Arc<AtomicBool>,
    message_sender: Option<broadcast::Sender<AcpMessage>>,
    config_sender: Option<mpsc::Sender<PendingConfigUpdate>>,
    cancel_sender: Arc<tokio::sync::Mutex<Option<mpsc::Sender<()>>>>,
    auth_sender: Arc<tokio::sync::Mutex<Option<mpsc::Sender<(String, oneshot::Sender<Result<SessionBootstrap>>)>>>>,
    shutdown_sender: Option<mpsc::Sender<()>>,
    process_handle: Option<tokio::task::JoinHandle<()>>,
    io_handle: Option<tokio::task::JoinHandle<()>>,
    history: Arc<tokio::sync::Mutex<Vec<AcpMessage>>>,
    /// History manager for undo/redo support
    history_manager: Arc<RwLock<AcpHistoryManager>>,
    /// Channel to send file operations to the ACP filesystem background task
    fs_sender: mpsc::Sender<AcpFsCommand>,
    queue: Arc<tokio::sync::Mutex<Vec<AcpQueuedMessage>>>,
    queue_notify: Arc<Notify>,
    pub acp_db: Option<Arc<crate::acp_db::AcpDb>>,
}

impl AcpAgent {
    pub fn new(
        agent_id: String,
        agent_name: String,
        fs_sender: mpsc::Sender<AcpFsCommand>,
        acp_db: Option<Arc<crate::acp_db::AcpDb>>,
    ) -> Self {
        let project_root = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        Self::new_with_project_root(agent_id, agent_name, project_root, fs_sender, acp_db)
    }

    pub fn new_with_project_root(
        agent_id: String,
        agent_name: String,
        project_root: PathBuf,
        fs_sender: mpsc::Sender<AcpFsCommand>,
        acp_db: Option<Arc<crate::acp_db::AcpDb>>,
    ) -> Self {
        // Initialize history manager with given working directory and agent ID
        let mut history_manager = AcpHistoryManager::new(&project_root, &agent_id);
        if let Err(e) = history_manager.init() {
            error!("Failed to initialize history manager: {}", e);
        }

        Self {
            agent_id,
            agent_name,
            connection: None,
            session_id: None,
            ready: Arc::new(AtomicBool::new(false)),
            is_processing: Arc::new(AtomicBool::new(false)),
            message_sender: None,
            config_sender: None,
            cancel_sender: Arc::new(tokio::sync::Mutex::new(None)),
            auth_sender: Arc::new(tokio::sync::Mutex::new(None)),
            shutdown_sender: None,
            process_handle: None,
            io_handle: None,
            history: Arc::new(tokio::sync::Mutex::new(Vec::new())),
            history_manager: Arc::new(RwLock::new(history_manager)),
            fs_sender,
            queue: Arc::new(tokio::sync::Mutex::new(Vec::new())),
            queue_notify: Arc::new(Notify::new()),
            acp_db,
        }
    }

    pub async fn get_auth_sender(&self) -> Option<mpsc::Sender<(String, oneshot::Sender<Result<SessionBootstrap>>)>> {
        let guard = self.auth_sender.lock().await;
        guard.clone()
    }

    pub fn set_session_id(&mut self, session_id: acp::SessionId) {
        self.session_id = Some(session_id);
    }

    #[cfg(test)]
    pub fn init_message_sender_for_test(&mut self) -> broadcast::Receiver<AcpMessage> {
        let (tx, rx) = broadcast::channel(100);
        self.message_sender = Some(tx);
        rx
    }

    pub async fn start(
        &mut self,
        cmd: &str,
        args: &[String],
        env: Option<HashMap<String, String>>,
        resume_session_id: Option<String>,
    ) -> Result<AcpStartOutcome> {
        // Setup channels
        let (history_tx, _) = broadcast::channel::<AcpMessage>(1000);
        self.message_sender = Some(history_tx.clone());

        let (config_tx, config_rx) = mpsc::channel::<PendingConfigUpdate>(32);
        self.config_sender = Some(config_tx);

        let (cancel_tx, cancel_rx) = mpsc::channel::<()>(10);
        {
            let mut cancel_sender_guard = self.cancel_sender.lock().await;
            *cancel_sender_guard = Some(cancel_tx.clone());
        }

        let (auth_tx, auth_rx) = mpsc::channel::<(String, oneshot::Sender<Result<SessionBootstrap>>)>(1);
        {
            let mut auth_sender_guard = self.auth_sender.lock().await;
            *auth_sender_guard = Some(auth_tx);
        }

        let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);
        self.shutdown_sender = Some(shutdown_tx);

        let (bootstrap_tx, bootstrap_rx) = oneshot::channel::<Result<SessionBootstrapOutcome>>();

        // Spawn agent process
        let (mut child, stdin, stdout, stderr) = Self::spawn_agent_process(cmd, args, env.as_ref())?;

        // Setup connection and run in LocalSet
        let ready_clone = self.ready.clone();
        let is_processing_clone = self.is_processing.clone();
        let agent_id_clone = self.agent_id.clone();
        let history_clone = self.history.clone();
        let message_sender_clone = history_tx.clone();
        let fs_sender_clone = self.fs_sender.clone();
        let queue_clone = self.queue.clone();
        let queue_notify_clone = self.queue_notify.clone();
        let history_manager_clone = self.history_manager.clone();
        let acp_db_clone = self.acp_db.clone();

        let local_set_handle = tokio::task::spawn_blocking(move || {
            tokio::runtime::Handle::current().block_on(async {
                let local_set = tokio::task::LocalSet::new();
                local_set
                    .run_until(async move {
                        Self::run_agent(
                            agent_id_clone,
                            ready_clone,
                            is_processing_clone,
                            history_clone,
                            history_manager_clone,
                            queue_clone,
                            queue_notify_clone,
                            message_sender_clone,
                            fs_sender_clone,
                            stdin,
                            stdout,
                            stderr,
                            config_rx,
                            cancel_rx,
                            auth_rx,
                            bootstrap_tx,
                            resume_session_id,
                            acp_db_clone,
                        )
                        .await;
                    })
                    .await;
            })
        });

        self.io_handle = Some(local_set_handle);
        self.connection = None;

        let process_handle = tokio::spawn(async move {
            tokio::select! {
                result = child.wait() => {
                    if let Err(err) = result {
                        debug!("ACP agent process wait failed: {}", err);
                    }
                    debug!("ACP agent process ended");
                }
                _ = shutdown_rx.recv() => {
                    if let Err(err) = child.kill().await {
                        debug!("ACP agent process kill failed: {}", err);
                    }
                    let _ = child.wait().await;
                    debug!("ACP agent process stopped manually");
                }
            }
        });
        self.process_handle = Some(process_handle);

        match tokio::time::timeout(tokio::time::Duration::from_secs(30), bootstrap_rx).await {
            Ok(Ok(Ok(SessionBootstrapOutcome::Ready(bootstrap)))) => {
                self.session_id = Some(bootstrap.session_id.clone());
                Ok(AcpStartOutcome::Ready {
                    session_id: bootstrap.session_id.to_string(),
                })
            }
            Ok(Ok(Ok(SessionBootstrapOutcome::AuthRequired { auth_methods, .. }))) => {
                Ok(AcpStartOutcome::AuthRequired { auth_methods })
            }
            Ok(Ok(Err(e))) => {
                self.stop().await;
                Err(e)
            }
            Ok(Err(_)) => {
                self.stop().await;
                Err(anyhow!(
                    "ACP agent initialization channel closed before initialization"
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
        env: Option<&HashMap<String, String>>,
    ) -> io::Result<(
        tokio::process::Child,
        tokio::process::ChildStdin,
        tokio::process::ChildStdout,
        tokio::process::ChildStderr,
    )> {
        let mut command = Self::agent_command(cmd);
        command.args(args);
        if let Some(env_map) = env {
            for (key, val) in env_map {
                let resolved_val = if val.starts_with("~/") {
                    if let Some(home) = dirs::home_dir() {
                        home.join(&val[2..]).to_string_lossy().to_string()
                    } else {
                        val.clone()
                    }
                } else {
                    val.clone()
                };

                if key.ends_with("_HOME") || key.ends_with("_DIR") {
                    let _ = std::fs::create_dir_all(&resolved_val);
                }

                command.env(key, resolved_val);
            }
        }
        let mut child = command
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

    fn agent_command(cmd: &str) -> Command {
        #[cfg(windows)]
        {
            // npm installs CLI entrypoints such as codex-acp as `.cmd` shims
            // on Windows. Run them through cmd.exe so they work with the
            // same agent configuration used on Unix-like platforms.
            let mut command = Command::new("cmd.exe");
            command.arg("/D").arg("/S").arg("/C").arg(cmd);
            command
        }

        #[cfg(not(windows))]
        {
            Command::new(cmd)
        }
    }

    async fn run_agent(
        agent_id: String,
        ready: Arc<AtomicBool>,
        is_processing: Arc<AtomicBool>,
        history: Arc<tokio::sync::Mutex<Vec<AcpMessage>>>,
        history_manager: Arc<RwLock<AcpHistoryManager>>,
        queue: Arc<tokio::sync::Mutex<Vec<AcpQueuedMessage>>>,
        queue_notify: Arc<Notify>,
        message_sender: broadcast::Sender<AcpMessage>,
        fs_sender: mpsc::Sender<AcpFsCommand>,
        stdin: tokio::process::ChildStdin,
        stdout: tokio::process::ChildStdout,
        stderr: tokio::process::ChildStderr,
        mut config_rx: mpsc::Receiver<PendingConfigUpdate>,
        mut cancel_rx: mpsc::Receiver<()>,
        mut auth_rx: mpsc::Receiver<(String, oneshot::Sender<Result<SessionBootstrap>>)>,
        bootstrap_tx: oneshot::Sender<Result<SessionBootstrapOutcome>>,
        resume_session_id: Option<String>,
        acp_db: Option<Arc<crate::acp_db::AcpDb>>,
    ) {
        // Clone history before moving client_impl
        let history_for_prompt = history.clone();

        // Create client implementation
        let client_impl = Arc::new(AcpClientImpl {
            agent_id: agent_id.clone(),
            message_sender: message_sender.clone(),
            history,
            fs_sender: Some(fs_sender),
            acp_db,
        });

        // Read stderr for debugging
        let stderr_tail = Arc::new(tokio::sync::Mutex::new(std::collections::VecDeque::<String>::new()));
        Self::spawn_stderr_reader(
            agent_id.clone(),
            stderr,
            stderr_tail.clone(),
        );

        let transport = ByteStreams::new(stdin.compat_write(), stdout.compat());
        let client_impl_for_permission = client_impl.clone();
        let client_impl_for_write = client_impl.clone();
        let client_impl_for_read = client_impl.clone();
        let client_impl_for_create_terminal = client_impl.clone();
        let client_impl_for_terminal_output = client_impl.clone();
        let client_impl_for_release_terminal = client_impl.clone();
        let client_impl_for_wait_terminal = client_impl.clone();
        let client_impl_for_kill_terminal = client_impl.clone();
        let client_impl_for_session_notification = client_impl.clone();

        let agent_id_for_conn = agent_id.clone();
        let agent_id_for_error = agent_id.clone();
        let is_processing_for_conn = is_processing.clone();
        let run_result = Client
            .builder()
            .name(format!("anycode-{}", agent_id))
            .on_receive_request(
                async move |req: acp::RequestPermissionRequest, responder, _cx| {
                    responder.respond(client_impl_for_permission.request_permission(req).await?)
                },
                agent_client_protocol::on_receive_request!(),
            )
            .on_receive_request(
                async move |req: acp::WriteTextFileRequest, responder, _cx| {
                    responder.respond(client_impl_for_write.write_text_file(req).await?)
                },
                agent_client_protocol::on_receive_request!(),
            )
            .on_receive_request(
                async move |req: acp::ReadTextFileRequest, responder, _cx| {
                    responder.respond(client_impl_for_read.read_text_file(req).await?)
                },
                agent_client_protocol::on_receive_request!(),
            )
            .on_receive_request(
                async move |req: acp::CreateTerminalRequest, responder, _cx| {
                    responder.respond(client_impl_for_create_terminal.create_terminal(req).await?)
                },
                agent_client_protocol::on_receive_request!(),
            )
            .on_receive_request(
                async move |req: acp::TerminalOutputRequest, responder, _cx| {
                    responder.respond(client_impl_for_terminal_output.terminal_output(req).await?)
                },
                agent_client_protocol::on_receive_request!(),
            )
            .on_receive_request(
                async move |req: acp::ReleaseTerminalRequest, responder, _cx| {
                    responder.respond(
                        client_impl_for_release_terminal
                            .release_terminal(req)
                            .await?,
                    )
                },
                agent_client_protocol::on_receive_request!(),
            )
            .on_receive_request(
                async move |req: acp::WaitForTerminalExitRequest, responder, _cx| {
                    responder.respond(
                        client_impl_for_wait_terminal
                            .wait_for_terminal_exit(req)
                            .await?,
                    )
                },
                agent_client_protocol::on_receive_request!(),
            )
            .on_receive_request(
                async move |req: acp::KillTerminalRequest, responder, _cx| {
                    responder.respond(
                        client_impl_for_kill_terminal
                            .kill_terminal_command(req)
                            .await?,
                    )
                },
                agent_client_protocol::on_receive_request!(),
            )
            .on_receive_notification(
                async move |notif: acp::SessionNotification, _cx| {
                    client_impl_for_session_notification
                        .session_notification(notif)
                        .await
                },
                agent_client_protocol::on_receive_notification!(),
            )
            .connect_with(transport, async move |conn| {
                let outcome = match Self::initialize_connection(&conn, &agent_id_for_conn, resume_session_id).await {
                    Ok(value) => value,
                    Err(e) => {
                        let recent_stderr = {
                            let tail = stderr_tail.lock().await;
                            tail.iter().cloned().collect::<Vec<_>>().join("\n")
                        };
                        let err_msg = if recent_stderr.is_empty() {
                            format!("Failed to initialize ACP agent {}: {}", agent_id_for_conn, e)
                        } else {
                            format!(
                                "Failed to initialize ACP agent {}: {}\nAgent stderr:\n{}",
                                agent_id_for_conn, e, recent_stderr
                            )
                        };
                        let err = anyhow!(err_msg);
                        let _ = bootstrap_tx.send(Err(err));
                        return Err(acp::Error::internal_error().data(format!("{e:#}")));
                    }
                };

                let bootstrap = match outcome {
                    SessionBootstrapOutcome::Ready(bootstrap) => {
                        let _ = bootstrap_tx.send(Ok(SessionBootstrapOutcome::Ready(bootstrap.clone())));
                        bootstrap
                    }
                    SessionBootstrapOutcome::AuthRequired { auth_methods, prompt_capabilities, cwd } => {
                        let _ = bootstrap_tx.send(Ok(SessionBootstrapOutcome::AuthRequired {
                            auth_methods,
                            prompt_capabilities: prompt_capabilities.clone(),
                            cwd: cwd.clone(),
                        }));

                        let mut authenticated_bootstrap = None;
                        while let Some((method_id, reply_tx)) = auth_rx.recv().await {
                            info!("ACP agent {} authenticating with method '{}'", agent_id_for_conn, method_id);
                            let auth_result = conn
                                .send_request(acp::AuthenticateRequest::new(acp::AuthMethodId::new(method_id.clone())))
                                .block_task()
                                .await;

                            match auth_result {
                                Ok(_) => {
                                    info!("Authentication succeeded for agent {}, creating new session...", agent_id_for_conn);
                                    let new_session_res = conn
                                        .send_request(acp::NewSessionRequest::new(cwd.clone()).mcp_servers(vec![]))
                                        .block_task()
                                        .await;

                                    match new_session_res {
                                        Ok(response) => {
                                            match Self::build_session_bootstrap(response.session_id, response.config_options.as_deref()) {
                                                Ok(mut b) => {
                                                    b.prompt_capabilities = prompt_capabilities.clone();
                                                    let _ = reply_tx.send(Ok(b.clone()));
                                                    authenticated_bootstrap = Some(b);
                                                    break;
                                                }
                                                Err(e) => {
                                                    let _ = reply_tx.send(Err(e));
                                                }
                                            }
                                        }
                                        Err(err) => {
                                            let _ = reply_tx.send(Err(anyhow!("Failed to create session after authentication: {}", err)));
                                        }
                                    }
                                }
                                Err(err) => {
                                    let _ = reply_tx.send(Err(anyhow!("Authentication failed: {}", err)));
                                }
                            }
                        }

                        match authenticated_bootstrap {
                            Some(b) => b,
                            None => {
                                info!("ACP agent {} auth channel closed without successful authentication", agent_id_for_conn);
                                return Ok(());
                            }
                        }
                    }
                };

                ready.store(true, Ordering::SeqCst);

                Self::emit_session_config_messages(
                    &message_sender,
                    &history_for_prompt,
                    bootstrap.model_selector.clone(),
                    bootstrap.reasoning_selector.clone(),
                )
                .await;

                Self::run_prompt_loop(
                    &conn,
                    &agent_id,
                    &is_processing_for_conn,
                    &message_sender,
                    history_for_prompt,
                    history_manager,
                    queue,
                    queue_notify,
                    bootstrap.session_id,
                    bootstrap.prompt_capabilities,
                    &mut config_rx,
                    &mut cancel_rx,
                )
                .await;
                Ok(())
            })
            .await;

        if let Err(e) = run_result {
            error!(
                "ACP agent {} connection ended with error: {}",
                agent_id_for_error, e
            );
        }
        is_processing.store(false, Ordering::SeqCst);
    }

    fn spawn_stderr_reader(
        agent_id: String,
        stderr: tokio::process::ChildStderr,
        stderr_tail: Arc<tokio::sync::Mutex<std::collections::VecDeque<String>>>,
    ) {
        tokio::task::spawn_local(async move {
            use tokio::io::{AsyncBufReadExt, BufReader};
            let mut reader = BufReader::new(stderr);
            let mut buf = String::new();
            while reader.read_line(&mut buf).await.is_ok() && !buf.is_empty() {
                let log_msg = buf.trim().to_string();
                warn!("ACP [{}] stderr: {}", agent_id, log_msg);

                let mut tail = stderr_tail.lock().await;
                if tail.len() >= 50 {
                    tail.pop_front();
                }
                tail.push_back(log_msg);

                buf.clear();
            }
        });
    }

    async fn initialize_agent_connection(
        conn: &ConnectionTo<agent_client_protocol::Agent>,
        agent_id: &str,
    ) -> Result<(acp::PromptCapabilities, Vec<acp::AuthMethod>)> {
        let client_info = acp::Implementation::new("anycode", "1.0.0").title("Anycode Editor");

        // Define client capabilities
        let fs_capabilities = acp::FileSystemCapabilities::new()
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
            .send_request(init_message)
            .block_task()
            .await
            .map_err(|e| anyhow!("Failed to initialize: {}", e))?;

        info!(
            "ACP agent {} initialized successfully. Agent capabilities: {:?}, auth methods: {:?}",
            agent_id, init_response.agent_capabilities, init_response.auth_methods
        );
        Ok((
            init_response.agent_capabilities.prompt_capabilities,
            init_response.auth_methods,
        ))
    }

    async fn initialize_connection(
        conn: &ConnectionTo<agent_client_protocol::Agent>,
        agent_id: &str,
        resume_session_id: Option<String>,
    ) -> Result<SessionBootstrapOutcome> {
        let (prompt_capabilities, auth_methods) = Self::initialize_agent_connection(conn, agent_id).await?;

        let cwd = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));

        if let Some(resume_session_id) = resume_session_id.as_deref() {
            match Self::restore_session(conn, resume_session_id, &cwd).await? {
                RestoreSessionOutcome::Restored(mut bootstrap) => {
                    bootstrap.prompt_capabilities = prompt_capabilities;
                    info!("Session restored for agent {}: {}", agent_id, bootstrap.session_id);
                    return Ok(SessionBootstrapOutcome::Ready(bootstrap));
                }
                RestoreSessionOutcome::Failed { load_err, resume_err } => {
                    info!(
                        "Session restoration failed for agent {} (load: {}, resume: {}), falling back to new session",
                        agent_id, load_err, resume_err
                    );
                }
            }
        }

        let session_result = conn
            .send_request(acp::NewSessionRequest::new(cwd.clone()).mcp_servers(vec![]))
            .block_task()
            .await;

        match session_result {
            Ok(response) => {
                let mut bootstrap = Self::build_session_bootstrap(response.session_id, response.config_options.as_deref())?;
                bootstrap.prompt_capabilities = prompt_capabilities;
                info!("Session ready for agent {}: {}", agent_id, bootstrap.session_id);
                Ok(SessionBootstrapOutcome::Ready(bootstrap))
            }
            Err(err) if err.code == acp::ErrorCode::AuthRequired => {
                info!("ACP agent {} requires authentication. Advertised auth methods: {:?}", agent_id, auth_methods);
                let auth_methods_info = auth_methods
                    .into_iter()
                    .map(|m| AcpAuthMethodInfo {
                        id: m.id().0.to_string(),
                        name: m.name().to_string(),
                        description: m.description().map(|d| d.to_string()),
                    })
                    .collect();
                Ok(SessionBootstrapOutcome::AuthRequired {
                    auth_methods: auth_methods_info,
                    prompt_capabilities,
                    cwd,
                })
            }
            Err(err) => Err(anyhow!("Failed to create session: {}", err)),
        }
    }

    async fn restore_session(
        conn: &ConnectionTo<agent_client_protocol::Agent>,
        resume_session_id: &str,
        cwd: &PathBuf,
    ) -> Result<RestoreSessionOutcome> {
        let requested_session_id = SessionId::new(resume_session_id.to_string());
        let load_result = conn
            .send_request(
                acp::LoadSessionRequest::new(
                    requested_session_id.clone(),
                    cwd.clone(),
                )
                .mcp_servers(vec![]),
            )
            .block_task()
            .await;

        if let Ok(response) = load_result {
            return Ok(RestoreSessionOutcome::Restored(
                Self::build_session_bootstrap(
                    requested_session_id,
                    response.config_options.as_deref(),
                )?,
            ));
        }

        let load_err = match load_result {
            Ok(_) => unreachable!("successful load handled above"),
            Err(err) => err,
        };

        let resume_result = conn
            .send_request(
                acp::ResumeSessionRequest::new(
                    requested_session_id.clone(),
                    cwd.clone(),
                )
                .mcp_servers(vec![]),
            )
            .block_task()
            .await;

        if let Ok(response) = resume_result {
            return Ok(RestoreSessionOutcome::Restored(
                Self::build_session_bootstrap(
                    requested_session_id,
                    response.config_options.as_deref(),
                )?,
            ));
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

    fn build_session_bootstrap(
        session_id: acp::SessionId,
        config_options: Option<&[acp::SessionConfigOption]>,
    ) -> Result<SessionBootstrap> {
        Ok(SessionBootstrap {
            session_id,
            model_selector: Self::parse_model_selector(config_options),
            reasoning_selector: Self::parse_reasoning_selector(config_options),
            prompt_capabilities: acp::PromptCapabilities::new(),
        })
    }

    fn parse_model_selector(
        config_options: Option<&[acp::SessionConfigOption]>,
    ) -> Option<AcpModelSelector> {
        let options = config_options?;
        for option in options {
            let select = match &option.kind {
                acp::SessionConfigKind::Select(select) => select,
                _ => continue,
            };

            let is_model_category = option.category.as_ref().is_some_and(|category| {
                matches!(category, acp::SessionConfigOptionCategory::Model)
            });
            if !is_model_category {
                continue;
            }

            let selector_options = Self::collect_select_options(option);
            if selector_options.is_empty() {
                continue;
            }

            return Some(AcpModelSelector {
                current_value: select.current_value.to_string(),
                options: selector_options,
            });
        }

        None
    }

    fn parse_reasoning_selector(
        config_options: Option<&[acp::SessionConfigOption]>,
    ) -> Option<AcpReasoningSelector> {
        let options = config_options?;
        for option in options {
            let select = match &option.kind {
                acp::SessionConfigKind::Select(select) => select,
                _ => continue,
            };

            let is_reasoning_category = option.category.as_ref().is_some_and(|category| {
                matches!(category, acp::SessionConfigOptionCategory::ThoughtLevel)
            });
            if !is_reasoning_category {
                continue;
            }

            let selector_options = Self::collect_select_options(option);
            if selector_options.is_empty() {
                continue;
            }

            return Some(AcpReasoningSelector {
                current_value: select.current_value.to_string(),
                options: selector_options,
            });
        }

        None
    }

    fn collect_select_options(option: &acp::SessionConfigOption) -> Vec<AcpSelectOption> {
        let option_id = option.id.to_string();
        let select = match &option.kind {
            acp::SessionConfigKind::Select(select) => select,
            _ => return Vec::new(),
        };

        match &select.options {
            acp::SessionConfigSelectOptions::Ungrouped(values) => values
                .iter()
                .map(|value| AcpSelectOption {
                    config_id: option_id.clone(),
                    value: value.value.to_string(),
                    name: value.name.clone(),
                    description: value.description.clone(),
                })
                .collect(),
            acp::SessionConfigSelectOptions::Grouped(groups) => groups
                .iter()
                .flat_map(|group| group.options.iter())
                .map(|value| AcpSelectOption {
                    config_id: option_id.clone(),
                    value: value.value.to_string(),
                    name: value.name.clone(),
                    description: value.description.clone(),
                })
                .collect(),
            _ => Vec::new(),
        }
    }

    async fn apply_session_config_option(
        conn: &ConnectionTo<agent_client_protocol::Agent>,
        session_id: &acp::SessionId,
        option: &AcpSelectOption,
    ) -> Result<SessionConfigSelectors> {
        let response = conn
            .send_request(acp::SetSessionConfigOptionRequest::new(
                session_id.clone(),
                option.config_id.clone(),
                option.value.as_str(),
            ))
            .block_task()
            .await
            .context("set session config option")?;

        Ok(SessionConfigSelectors {
            model_selector: Self::parse_model_selector(Some(response.config_options.as_slice())),
            reasoning_selector: Self::parse_reasoning_selector(Some(
                response.config_options.as_slice(),
            )),
        })
    }

    async fn emit_session_config_messages(
        message_sender: &broadcast::Sender<AcpMessage>,
        history: &Arc<tokio::sync::Mutex<Vec<AcpMessage>>>,
        model_selector: Option<AcpModelSelector>,
        reasoning_selector: Option<AcpReasoningSelector>,
    ) {
        if model_selector.is_none() && reasoning_selector.is_none() {
            return;
        }

        let mut messages = Vec::new();
        if let Some(selector) = model_selector {
            messages.push(AcpMessage::SessionModelSelector(selector));
        }
        if let Some(selector) = reasoning_selector {
            messages.push(AcpMessage::SessionReasoningSelector(selector));
        }

        {
            let mut history = history.lock().await;
            history.retain(|item| {
                !matches!(
                    item,
                    AcpMessage::SessionModelSelector(_) | AcpMessage::SessionReasoningSelector(_)
                )
            });
            history.extend(messages.iter().cloned());
        }

        for message in messages {
            let _ = message_sender.send(message);
        }
    }

    async fn run_prompt_loop(
        conn: &ConnectionTo<agent_client_protocol::Agent>,
        agent_id: &str,
        is_processing: &AtomicBool,
        message_sender: &broadcast::Sender<AcpMessage>,
        history: Arc<tokio::sync::Mutex<Vec<AcpMessage>>>,
        history_manager: Arc<RwLock<AcpHistoryManager>>,
        queue: Arc<tokio::sync::Mutex<Vec<AcpQueuedMessage>>>,
        queue_notify: Arc<Notify>,
        session_id: acp::SessionId,
        prompt_capabilities: acp::PromptCapabilities,
        config_rx: &mut mpsc::Receiver<PendingConfigUpdate>,
        cancel_rx: &mut mpsc::Receiver<()>,
    ) {
        info!(
            "Starting prompt handling loop for agent {} with session {}",
            agent_id, session_id
        );

        loop {
            // First check if there is an item in the queue to process
            let next_prompt = {
                let mut q = queue.lock().await;
                if !q.is_empty() {
                    is_processing.store(true, Ordering::SeqCst);
                    Some(q.remove(0))
                } else {
                    None
                }
            };

            if let Some(queued_item) = next_prompt {
                info!(
                    "Processing queued prompt for agent {} (queue_id={}, text_len={}, attachments={})",
                    agent_id,
                    queued_item.id,
                    queued_item.prompt.len(),
                    queued_item.attachments.len()
                );

                // Broadcast updated queue since we popped an item
                let current_queue = {
                    let q = queue.lock().await;
                    q.clone()
                };
                let _ = message_sender.send(AcpMessage::QueueUpdate(AcpQueueUpdate {
                    queue: current_queue,
                }));

                // Immediately mark agent as processing so incoming prompts are queued
                let was_processing = is_processing.swap(true, Ordering::SeqCst);
                if !was_processing {
                    let _ = message_sender.send(AcpMessage::PromptState(AcpPromptState {
                        is_processing: true,
                    }));
                }

                // Create checkpoint before processing the message
                let mut manager = history_manager.write().await;
                let checkpoint_id = match manager.create_checkpoint(&queued_item.prompt) {
                    Ok(id) => Some(id),
                    Err(e) => {
                        error!("Failed to create checkpoint: {}", e);
                        None
                    }
                };
                drop(manager);

                let user_message = AcpMessage::User(AcpUserMessage {
                    content: queued_item.prompt.clone(),
                    checkpoint_id,
                    attachments: if queued_item.attachments.is_empty() {
                        None
                    } else {
                        Some(queued_item.attachments.clone())
                    },
                });

                {
                    let mut hist = history.lock().await;
                    hist.push(user_message.clone());
                }

                if let Err(e) = message_sender.send(user_message) {
                    debug!(
                        "No active subscribers while sending user message for agent {}: {}",
                        agent_id, e
                    );
                }

                // Drain any stale cancel signals before processing prompt
                while cancel_rx.try_recv().is_ok() {}

                // Handle prompt with cancellation support
                let was_cancelled = Self::handle_prompt_with_cancellation(
                    conn,
                    agent_id,
                    message_sender,
                    &history,
                    &session_id,
                    queued_item.prompt,
                    queued_item.attachments,
                    &prompt_capabilities,
                    cancel_rx,
                )
                .await;

                if was_cancelled {
                    // If user cancelled, clear the rest of the queue so subsequent prompts do not execute automatically
                    let mut q = queue.lock().await;
                    info!(
                        "Prompt was cancelled for agent {}, clearing {} remaining queued prompts",
                        agent_id,
                        q.len()
                    );
                    q.clear();
                    let _ = message_sender.send(AcpMessage::QueueUpdate(AcpQueueUpdate {
                        queue: Vec::new(),
                    }));
                }

                // Only emit processing = false when queue is completely drained
                let has_more = !queue.lock().await.is_empty();
                if !has_more {
                    is_processing.store(false, Ordering::SeqCst);

                    // Send prompt state: processing finished
                    let _ = message_sender.send(AcpMessage::PromptState(AcpPromptState {
                        is_processing: false,
                    }));
                }

                // Drain any remaining cancel signals before processing next prompt
                while cancel_rx.try_recv().is_ok() {}

                tokio::task::yield_now().await;
                continue;
            }

            tokio::select! {
                _ = queue_notify.notified() => {
                    continue;
                }
                maybe_config = config_rx.recv() => match maybe_config {
                    Some(update) => {
                        let result = Self::apply_session_config_option(conn, &session_id, &update.option).await
                            .map_err(|err| format!("{err:#}"));

                        if let Ok(selectors) = &result {
                            Self::emit_session_config_messages(
                                message_sender,
                                &history,
                                selectors.model_selector.clone(),
                                selectors.reasoning_selector.clone(),
                            )
                            .await;
                        }

                        let _ = update.response_tx.send(result);
                    }
                    None => {
                        info!("Config channel closed for agent {}", agent_id);
                        break;
                    }
                }
            }
        }
    }

    async fn handle_prompt_with_cancellation(
        conn: &ConnectionTo<agent_client_protocol::Agent>,
        agent_id: &str,
        message_sender: &broadcast::Sender<AcpMessage>,
        history: &Arc<tokio::sync::Mutex<Vec<AcpMessage>>>,
        session_id: &acp::SessionId,
        prompt: String,
        attachments: Vec<AcpPromptAttachment>,
        prompt_capabilities: &acp::PromptCapabilities,
        cancel_rx: &mut mpsc::Receiver<()>,
    ) -> bool {
        // Drain any stale cancel signals before sending prompt
        while cancel_rx.try_recv().is_ok() {}

        let blocks = Self::prepare_prompt_blocks(prompt, attachments, prompt_capabilities);
        let prompt_request = acp::PromptRequest::new(session_id.clone(), blocks);

        // Clone connection for cancellation
        let conn_for_prompt = conn.clone();
        let conn_for_cancel = conn.clone();

        // Pin the prompt future
        let mut prompt_fut = std::pin::pin!(async move {
            conn_for_prompt
                .send_request(prompt_request)
                .block_task()
                .await
        });

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

                            // Save to history
                            let message_for_ui = {
                                let mut hist = history.lock().await;
                                AcpClientImpl::append_or_push_error_message(&mut hist, &e.to_string())
                            };

                            // Send error message to UI
                            let _ = message_sender.send(message_for_ui);
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
                            .send_notification(acp::CancelNotification::new(session_id.clone()))
                        {
                            error!("Failed to send cancel notification for agent {}: {}", agent_id, e);
                        }
                    }
                }
            }
        }

        cancel_sent
    }

    fn prepare_prompt_blocks(
        prompt: String,
        attachments: Vec<AcpPromptAttachment>,
        prompt_capabilities: &acp::PromptCapabilities,
    ) -> Vec<acp::ContentBlock> {
        let has_audio = attachments.iter().any(|attachment| {
            Self::normalize_mime_type(&attachment.mime_type).starts_with("audio/")
        });
        let has_image = attachments.iter().any(|attachment| {
            Self::normalize_mime_type(&attachment.mime_type).starts_with("image/")
        });

        let prompt_text = if prompt.trim().is_empty() {
            if has_audio {
                "Please transcribe and summarize the attached audio file(s).".to_string()
            } else if has_image {
                "Please analyze the attached image(s).".to_string()
            } else if !attachments.is_empty() {
                "Please analyze the attached file(s).".to_string()
            } else {
                String::new()
            }
        } else {
            prompt
        };

        let mut blocks = vec![acp::ContentBlock::from(prompt_text)];
        let mut dropped_attachments = Vec::new();

        for mut attachment in attachments {
            if attachment.data_base64.is_empty() {
                continue;
            }

            let normalized_mime = Self::normalize_mime_type(&attachment.mime_type);
            attachment.mime_type = normalized_mime.clone();

            if normalized_mime.starts_with("image/") {
                if !prompt_capabilities.image {
                    dropped_attachments.push(format!(
                        "{} ({}) skipped: agent doesn't advertise image prompt capability.",
                        attachment.name, normalized_mime
                    ));
                    continue;
                }
                blocks.push(acp::ContentBlock::Image(acp::ImageContent::new(
                    attachment.data_base64,
                    normalized_mime,
                )));
                continue;
            }

            if normalized_mime.starts_with("audio/") {
                if !prompt_capabilities.audio {
                    dropped_attachments.push(format!(
                        "{} ({}) skipped: agent doesn't advertise audio prompt capability.",
                        attachment.name, normalized_mime
                    ));
                    continue;
                }
                blocks.push(acp::ContentBlock::Audio(acp::AudioContent::new(
                    attachment.data_base64,
                    normalized_mime,
                )));
                continue;
            }

            if Self::is_text_like_mime(&normalized_mime) {
                if let Some(text_block) = Self::try_text_attachment_block(&attachment) {
                    blocks.push(text_block);
                    continue;
                }
            }

            if !prompt_capabilities.embedded_context {
                dropped_attachments.push(format!(
                    "{} ({}) skipped: agent doesn't advertise embedded_context capability.",
                    attachment.name, normalized_mime
                ));
                continue;
            }

            let uri = format!("attachment://{}", attachment.name);
            let blob = acp::BlobResourceContents::new(attachment.data_base64, uri)
                .mime_type(normalized_mime);
            let resource = acp::EmbeddedResource::new(
                acp::EmbeddedResourceResource::BlobResourceContents(blob),
            );
            blocks.push(acp::ContentBlock::Resource(resource));
        }

        if !dropped_attachments.is_empty() {
            let fallback_text = format!(
                "Some attachments were not sent due to agent capabilities:\n- {}",
                dropped_attachments.join("\n- ")
            );
            blocks.push(acp::ContentBlock::from(fallback_text));
        }

        blocks
    }

    fn is_text_like_mime(mime_type: &str) -> bool {
        mime_type.starts_with("text/")
            || mime_type == "application/json"
            || mime_type.ends_with("+json")
            || mime_type == "application/xml"
            || mime_type.ends_with("+xml")
            || mime_type == "application/javascript"
    }

    fn normalize_mime_type(mime_type: &str) -> String {
        let normalized = mime_type
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();

        if normalized.is_empty() {
            "application/octet-stream".to_string()
        } else {
            normalized
        }
    }

    fn try_text_attachment_block(attachment: &AcpPromptAttachment) -> Option<acp::ContentBlock> {
        let bytes = match base64::engine::general_purpose::STANDARD.decode(&attachment.data_base64)
        {
            Ok(bytes) => bytes,
            Err(e) => {
                warn!(
                    "Failed to decode attachment {} from base64 ({}); sending as resource",
                    attachment.name, e
                );
                return None;
            }
        };

        let text = match String::from_utf8(bytes) {
            Ok(text) => text,
            Err(_) => {
                warn!(
                    "Attachment {} has text-like mime {} but invalid UTF-8; sending as resource",
                    attachment.name, attachment.mime_type
                );
                return None;
            }
        };

        let language_hint = if attachment.mime_type.contains("json") {
            "json"
        } else if attachment.mime_type.contains("xml") {
            "xml"
        } else if attachment.mime_type.contains("markdown") || attachment.name.ends_with(".md") {
            "markdown"
        } else {
            "text"
        };

        let text_block = format!(
            "\nAttached file: {} ({})\n\n```{}\n{}\n```",
            attachment.name, attachment.mime_type, language_hint, text
        );

        Some(acp::ContentBlock::from(text_block))
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
                            Self::spawn_agent_process(&cmd, &args, None).map_err(|e| {
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

                        let transport = ByteStreams::new(stdin.compat_write(), stdout.compat());
                        let mut all_sessions = Client
                            .builder()
                            .name("session-list")
                            .connect_with(transport, async move |conn| {
                                let _prompt_capabilities =
                                    Self::initialize_agent_connection(&conn, "session-list")
                                        .await
                                        .map_err(|e| {
                                            acp::Error::internal_error().data(format!("{e:#}"))
                                        })?;

                                let mut all_sessions = Vec::new();
                                let mut cursor = None;

                                loop {
                                    let response = conn
                                        .send_request(
                                            acp::ListSessionsRequest::new()
                                                .cwd(cwd.clone())
                                                .cursor(cursor.clone()),
                                        )
                                        .block_task()
                                        .await?;

                                    all_sessions.extend(response.sessions.into_iter().map(
                                        |session| AcpSessionSummary {
                                            session_id: session.session_id.to_string(),
                                            cwd: session.cwd.to_string_lossy().to_string(),
                                            title: session.title,
                                            updated_at: session.updated_at,
                                        },
                                    ));

                                    if response.next_cursor.is_none() {
                                        break;
                                    }
                                    cursor = response.next_cursor;
                                }

                                Ok(all_sessions)
                            })
                            .await
                            .map_err(|e| anyhow!("Failed to list sessions: {}", e))?;

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
        self.clear_queue().await;
        if let Some(shutdown_tx) = self.shutdown_sender.take() {
            let _ = shutdown_tx.send(()).await;
        }
        if let Some(handle) = self.process_handle.take() {
            let _ = handle.await;
        }
        if let Some(handle) = self.io_handle.take() {
            handle.abort();
        }
        self.connection = None;
        self.session_id = None;
        self.config_sender = None;
    }

    pub async fn send_prompt(
        &mut self,
        prompt: String,
        attachments: Vec<AcpPromptAttachment>,
    ) -> Result<String> {
        let queued_id = self.enqueue_prompt(prompt, attachments).await;
        Ok(queued_id)
    }

    pub async fn enqueue_prompt(
        &self,
        prompt: String,
        attachments: Vec<AcpPromptAttachment>,
    ) -> String {
        static QUEUE_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let count = QUEUE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let id = format!("queue-{}-{}", now, count);

        let item = AcpQueuedMessage {
            id: id.clone(),
            prompt,
            attachments,
            created_at: now,
        };

        let (current_queue, should_broadcast) = {
            let mut q = self.queue.lock().await;
            q.push(item);
            let is_busy = self.is_processing.load(Ordering::SeqCst);
            let should_broadcast = is_busy || q.len() > 1;
            (q.clone(), should_broadcast)
        };

        info!(
            "Enqueued prompt {} for agent {} (total queued: {}, broadcast: {})",
            id,
            self.agent_id,
            current_queue.len(),
            should_broadcast
        );

        if should_broadcast {
            if let Some(sender) = &self.message_sender {
                let _ = sender.send(AcpMessage::QueueUpdate(AcpQueueUpdate {
                    queue: current_queue,
                }));
            }
        }

        self.queue_notify.notify_one();
        id
    }

    pub async fn get_queue(&self) -> Vec<AcpQueuedMessage> {
        let q = self.queue.lock().await;
        q.clone()
    }

    pub async fn update_queued_prompt(&self, item_id: &str, prompt: String) -> bool {
        let (found, current_queue) = {
            let mut q = self.queue.lock().await;
            let mut found = false;
            for item in q.iter_mut() {
                if item.id == item_id {
                    item.prompt = prompt;
                    found = true;
                    break;
                }
            }
            (found, q.clone())
        };

        if found {
            info!("Updated queued prompt {} for agent {}", item_id, self.agent_id);
            if let Some(sender) = &self.message_sender {
                let _ = sender.send(AcpMessage::QueueUpdate(AcpQueueUpdate {
                    queue: current_queue,
                }));
            }
        }
        found
    }

    pub async fn remove_queued_prompt(&self, item_id: &str) -> bool {
        let (removed, current_queue) = {
            let mut q = self.queue.lock().await;
            let initial_len = q.len();
            q.retain(|item| item.id != item_id);
            let removed = q.len() < initial_len;
            (removed, q.clone())
        };

        if removed {
            info!("Removed queued prompt {} for agent {}", item_id, self.agent_id);
            if let Some(sender) = &self.message_sender {
                let _ = sender.send(AcpMessage::QueueUpdate(AcpQueueUpdate {
                    queue: current_queue,
                }));
            }
        }
        removed
    }

    pub async fn move_queued_prompt(&self, item_id: &str, direction: &str) -> bool {
        let (moved, current_queue) = {
            let mut q = self.queue.lock().await;
            let pos = q.iter().position(|item| item.id == item_id);
            let mut moved = false;
            if let Some(idx) = pos {
                if direction == "up" && idx > 0 {
                    q.swap(idx, idx - 1);
                    moved = true;
                } else if direction == "down" && idx + 1 < q.len() {
                    q.swap(idx, idx + 1);
                    moved = true;
                }
            }
            (moved, q.clone())
        };

        if moved {
            info!(
                "Moved queued prompt {} {} for agent {}",
                item_id, direction, self.agent_id
            );
            if let Some(sender) = &self.message_sender {
                let _ = sender.send(AcpMessage::QueueUpdate(AcpQueueUpdate {
                    queue: current_queue,
                }));
            }
        }
        moved
    }

    pub async fn clear_queue(&self) {
        let current_queue = {
            let mut q = self.queue.lock().await;
            q.clear();
            q.clone()
        };
        if let Some(sender) = &self.message_sender {
            let _ = sender.send(AcpMessage::QueueUpdate(AcpQueueUpdate {
                queue: current_queue,
            }));
        }
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

    pub async fn set_session_config_option(&self, option: AcpSelectOption) -> Result<()> {
        let config_tx = self
            .config_sender
            .as_ref()
            .context("Config sender not initialized")?;
        let (response_tx, response_rx) = tokio::sync::oneshot::channel();

        config_tx
            .send(PendingConfigUpdate {
                option,
                response_tx,
            })
            .await
            .context("Failed to queue config update")?;

        let _selectors = response_rx
            .await
            .map_err(|_| anyhow!("Config update response channel closed"))?
            .map_err(|err| anyhow!(err))?;

        Ok(())
    }

    pub fn agent_name(&self) -> &str {
        &self.agent_name
    }

    pub fn is_processing(&self) -> bool {
        self.is_processing.load(Ordering::SeqCst)
    }

    pub async fn get_history(&self) -> Vec<AcpMessage> {
        self.history.lock().await.clone()
    }

    /// Get the message sender for subscribing to agent messages.
    /// Returns None if the agent hasn't been started yet.
    pub fn get_message_sender(&self) -> Option<broadcast::Sender<AcpMessage>> {
        self.message_sender.clone()
    }
}

pub struct AcpManager {
    agents: HashMap<String, AcpAgent>,
    fs_sender: mpsc::Sender<AcpFsCommand>,
    acp_db: Option<Arc<crate::acp_db::AcpDb>>,
}

impl AcpManager {
    pub fn new(fs_sender: mpsc::Sender<AcpFsCommand>, acp_db: Option<Arc<crate::acp_db::AcpDb>>) -> Self {
        Self {
            agents: HashMap::new(),
            fs_sender,
            acp_db,
        }
    }

    /// Start agent by agent_id and agent_name. Returns an error if the agent already exists.
    pub async fn start_agent(
        &mut self,
        agent_id: String,
        agent_name: String,
        cmd: &str,
        args: &[String],
        env: Option<HashMap<String, String>>,
        resume_session_id: Option<String>,
    ) -> Result<AcpStartOutcome> {
        if self.agents.contains_key(&agent_id) {
            return Err(anyhow::anyhow!("Agent {} already running", agent_id));
        }

        let mut agent = AcpAgent::new(
            agent_id.clone(),
            agent_name.clone(),
            self.fs_sender.clone(),
            self.acp_db.clone(),
        );

        info!(
            "Starting ACP agent {} with command: {} {:?}, env: {:?}",
            agent_id, cmd, args, env
        );
        let outcome = agent.start(cmd, args, env, resume_session_id).await?;

        self.agents.insert(agent_id, agent);

        Ok(outcome)
    }

    pub async fn authenticate(
        &self,
        agent_id: &str,
        method_id: &str,
    ) -> Result<oneshot::Receiver<Result<SessionBootstrap>>> {
        let agent = self
            .agents
            .get(agent_id)
            .ok_or_else(|| anyhow::anyhow!("Agent {} not found", agent_id))?;

        let sender = agent
            .get_auth_sender()
            .await
            .ok_or_else(|| anyhow::anyhow!("Agent {} is not waiting for authentication", agent_id))?;

        let (reply_tx, reply_rx) = oneshot::channel();
        sender
            .send((method_id.to_string(), reply_tx))
            .await
            .map_err(|_| anyhow::anyhow!("Failed to send auth request to agent {}", agent_id))?;

        Ok(reply_rx)
    }

    pub fn set_session_id(&mut self, agent_id: &str, session_id: acp::SessionId) {
        if let Some(agent) = self.agents.get_mut(agent_id) {
            agent.set_session_id(session_id);
        }
    }

    /// Stop agent by agent_id.
    pub async fn stop_agent(&mut self, agent_id: &str) {
        if let Some(mut agent) = self.agents.remove(agent_id) {
            agent.stop().await;
        }
    }

    pub async fn stop_all(&mut self) {
        let agent_ids: Vec<String> = self.agents.keys().cloned().collect();
        for agent_id in agent_ids {
            self.stop_agent(&agent_id).await;
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

    pub async fn set_model(&self, agent_id: &str, option: AcpSelectOption) -> Result<()> {
        let agent = self
            .agents
            .get(agent_id)
            .ok_or_else(|| anyhow::anyhow!("Agent {} not found", agent_id))?;

        agent.set_session_config_option(option).await?;
        Ok(())
    }

    pub async fn set_reasoning(&self, agent_id: &str, option: AcpSelectOption) -> Result<()> {
        let agent = self
            .agents
            .get(agent_id)
            .ok_or_else(|| anyhow::anyhow!("Agent {} not found", agent_id))?;

        agent.set_session_config_option(option).await?;
        Ok(())
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

    pub fn is_agent_processing(&self, agent_id: &str) -> bool {
        self.agents
            .get(agent_id)
            .is_some_and(AcpAgent::is_processing)
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

    pub async fn get_agent_queue(&self, agent_id: &str) -> Option<Vec<AcpQueuedMessage>> {
        if let Some(agent) = self.agents.get(agent_id) {
            Some(agent.get_queue().await)
        } else {
            None
        }
    }

    pub async fn update_agent_queued_prompt(
        &self,
        agent_id: &str,
        item_id: &str,
        prompt: String,
    ) -> bool {
        if let Some(agent) = self.agents.get(agent_id) {
            agent.update_queued_prompt(item_id, prompt).await
        } else {
            false
        }
    }

    pub async fn remove_agent_queued_prompt(&self, agent_id: &str, item_id: &str) -> bool {
        if let Some(agent) = self.agents.get(agent_id) {
            agent.remove_queued_prompt(item_id).await
        } else {
            false
        }
    }

    pub async fn move_agent_queued_prompt(
        &self,
        agent_id: &str,
        item_id: &str,
        direction: &str,
    ) -> bool {
        if let Some(agent) = self.agents.get(agent_id) {
            agent.move_queued_prompt(item_id, direction).await
        } else {
            false
        }
    }

    #[allow(dead_code)]
    pub async fn clear_agent_queue(&self, agent_id: &str) -> bool {
        if let Some(agent) = self.agents.get(agent_id) {
            agent.clear_queue().await;
            true
        } else {
            false
        }
    }
}

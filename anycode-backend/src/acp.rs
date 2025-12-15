use agent_client_protocol::{self as acp, Agent as _};
use agent_client_protocol_schema::ProtocolVersion;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::process::Command;
use tokio::sync::{mpsc, broadcast};
use tokio::io::{self};
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};
use tracing::{info, debug, error};
use anyhow::{Result, anyhow};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpUserMessage {
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpAssistantMessage {
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_chunk: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpToolCall {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    pub arguments: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpToolResult {
    pub id: String,
    pub result: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpPromptState {
    pub is_processing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "role")]
pub enum AcpMessage {
    #[serde(rename = "user")]
    User(AcpUserMessage),
    #[serde(rename = "assistant")]
    Assistant(AcpAssistantMessage),
    #[serde(rename = "tool_call")]
    ToolCall(AcpToolCall),
    #[serde(rename = "tool_result")]
    ToolResult(AcpToolResult),
    #[serde(rename = "prompt_state")]
    PromptState(AcpPromptState),
}

struct AcpClientImpl {
    agent_id: String,
    message_sender: broadcast::Sender<AcpMessage>,
    history: Arc<tokio::sync::Mutex<Vec<AcpMessage>>>,
}

#[async_trait::async_trait(?Send)]
impl acp::Client for AcpClientImpl {
    async fn request_permission(
        &self,
        args: acp::RequestPermissionRequest,
    ) -> acp::Result<acp::RequestPermissionResponse> {
        info!("request_permission called for agent {}: {:?}", self.agent_id, args);

        // Handle tool_call if present
        let tool_call_update = &args.tool_call;
        // Extract tool call information from ToolCallUpdate
        let tool_call_id = tool_call_update.tool_call_id.to_string();
        let (tool_name, tool_command) = tool_call_update.fields.title
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
        
        let acp_tool_call = AcpToolCall {
            id: tool_call_id,
            name: tool_name,
            command: tool_command,
            arguments,
        };
        
        // Add to history
        {
            let mut history = self.history.lock().await;
            history.push(AcpMessage::ToolCall(acp_tool_call.clone()));
        }
        
        // Send to frontend
        self.send_message(AcpMessage::ToolCall(acp_tool_call)).await;

        // Always allow - use Selected with the first "allow" option
        let selected_option = args.options.iter()
            .find(|opt| opt.name.contains("Allow") || opt.option_id.to_string().contains("proceed"))
            .or_else(|| args.options.first());
        
        if let Some(option) = selected_option {
            info!("Allowing permission for agent {} with option: {:?}", self.agent_id, option.option_id);
            let selected_outcome = acp::SelectedPermissionOutcome::new(option.option_id.clone());
            Ok(acp::RequestPermissionResponse::new(acp::RequestPermissionOutcome::Selected(selected_outcome)))
        } else {
            error!("No permission options available for agent {}", self.agent_id);
            Ok(acp::RequestPermissionResponse::new(acp::RequestPermissionOutcome::Cancelled))
        }
    }

    async fn write_text_file(
        &self, _args: acp::WriteTextFileRequest,
    ) -> acp::Result<acp::WriteTextFileResponse> {
        info!("write_text_file called for agent {}: {:?}", self.agent_id, _args);
        Err(acp::Error::method_not_found())
    }

    async fn read_text_file(
        &self, _args: acp::ReadTextFileRequest,
    ) -> acp::Result<acp::ReadTextFileResponse> {
        info!("read_text_file called for agent {}: {:?}", self.agent_id, _args);
        Err(acp::Error::method_not_found())
    }

    async fn create_terminal(
        &self, _args: acp::CreateTerminalRequest,
    ) -> acp::Result<acp::CreateTerminalResponse> {
        info!("create_terminal called for agent {}: {:?}", self.agent_id, _args);
        Err(acp::Error::method_not_found())
    }

    async fn terminal_output(
        &self, _args: acp::TerminalOutputRequest,
    ) -> acp::Result<acp::TerminalOutputResponse> {
        info!("terminal_output called for agent {}: {:?}", self.agent_id, _args);
        Err(acp::Error::method_not_found())
    }

    async fn release_terminal(
        &self, _args: acp::ReleaseTerminalRequest,
    ) -> acp::Result<acp::ReleaseTerminalResponse> {
        info!("release_terminal called for agent {}: {:?}", self.agent_id, _args);
        Err(acp::Error::method_not_found())
    }

    async fn wait_for_terminal_exit(
        &self, _args: acp::WaitForTerminalExitRequest,
    ) -> acp::Result<acp::WaitForTerminalExitResponse> {
        info!("wait_for_terminal_exit called for agent {}: {:?}", self.agent_id, _args);
        Err(acp::Error::method_not_found())
    }

    async fn kill_terminal_command(
        &self, _args: acp::KillTerminalCommandRequest,
    ) -> acp::Result<acp::KillTerminalCommandResponse> {
        info!("kill_terminal_command called for agent {}: {:?}", self.agent_id, _args);
        Err(acp::Error::method_not_found())
    }

    async fn session_notification(
        &self, args: acp::SessionNotification,
    ) -> acp::Result<()> {
        info!("session_notification received for agent {}: {:?}", self.agent_id, args.update);
        match args.update {
            acp::SessionUpdate::AgentMessageChunk(chunk) => {
                self.handle_agent_message_chunk(chunk).await?;
            }
            acp::SessionUpdate::ToolCall(tool_call) => {
                self.handle_tool_call(tool_call).await;
            }
            acp::SessionUpdate::UserMessageChunk { .. } => {
                info!("UserMessageChunk received for agent {}", self.agent_id);
            }
            acp::SessionUpdate::AgentThoughtChunk { .. } => {
                info!("AgentThoughtChunk received for agent {}", self.agent_id);
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
                info!("AvailableCommandsUpdate received for agent {}", self.agent_id);
            }
            _ => {
                info!("Other session update received for agent {}: {:?}", self.agent_id, args.update);
            }
        }
        Ok(())
    }

    async fn ext_method(
        &self, _args: acp::ExtRequest
    ) -> acp::Result<acp::ExtResponse> {
        info!("ext_method called for agent {}: {:?}", self.agent_id, _args);
        Err(acp::Error::method_not_found())
    }

    async fn ext_notification(
        &self, _args: acp::ExtNotification
    ) -> acp::Result<()> {
        info!("ext_notification called for agent {}: {:?}", self.agent_id, _args);
        Err(acp::Error::method_not_found())
    }
}

impl AcpClientImpl {
    async fn handle_agent_message_chunk(
        &self,
        chunk: acp::ContentChunk,
    ) -> acp::Result<()> {
        let text = Self::extract_text_from_content(&chunk.content);
        info!("Received message chunk from agent {}: {}", self.agent_id, text);
        
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

    async fn handle_tool_call(&self, tool_call: acp::ToolCall) {
        info!("Received tool call from agent {}: title={}, tool_call_id={:?}", 
            self.agent_id, tool_call.title, tool_call.tool_call_id);
        debug!("Full tool_call structure: {:?}", tool_call);
        
        // Convert acp::ToolCall to our AcpToolCall format
        let tool_call_id = tool_call.tool_call_id.to_string();
        let (tool_name, tool_command) = Self::extract_tool_name_and_command(&tool_call.title);
        
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
        
        let acp_tool_call = AcpToolCall {
            id: tool_call_id,
            name: tool_name,
            command: tool_command,
            arguments,
        };
        
        // Add to history
        let mut history = self.history.lock().await;
        history.push(AcpMessage::ToolCall(acp_tool_call.clone()));
        
        // Send message to clients
        self.send_message(AcpMessage::ToolCall(acp_tool_call)).await;
    }

    async fn handle_tool_call_update(&self, update: acp::ToolCallUpdate) {
        info!("ToolCallUpdate received for agent {}: tool_call_id={:?}, status={:?}", 
            self.agent_id, update.tool_call_id, update.fields.status);
        
        // If tool call is completed, send tool result
        if let Some(acp::ToolCallStatus::Completed) = update.fields.status {
            let tool_call_id = update.tool_call_id.to_string();
            
            // Serialize entire update to JSON string and put in result
            let result = serde_json::to_value(&update)
                .unwrap_or_else(|_| serde_json::json!({}));
            
            let acp_tool_result = AcpToolResult {
                id: tool_call_id,
                result: result,
            };
            
            // Add to history
            {
                let mut history = self.history.lock().await;
                history.push(AcpMessage::ToolResult(acp_tool_result.clone()));
            }
            
            // Send to frontend
            self.send_message(AcpMessage::ToolResult(acp_tool_result)).await;
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

    fn extract_text_from_tool_call_content_vec(contents: &[acp::ToolCallContent]) -> String {
        contents
            .iter()
            .filter_map(|tool_content| {
                // Serialize ToolCallContent to JSON and extract text
                // Based on the log structure: Content { content: Text(TextContent { text: "..." }) }
                if let Ok(json_value) = serde_json::to_value(tool_content) {
                    // Try various paths to find text
                    // Path 1: content.Text.text (enum variant serialized as object with variant name as key)
                    if let Some(text) = json_value.get("content")
                        .and_then(|c| c.get("Text"))
                        .and_then(|t| t.get("text"))
                        .and_then(|t| t.as_str()) {
                        return Some(text.to_string());
                    }
                    // Path 2: content.text (if content is directly an object with text field)
                    if let Some(text) = json_value.get("content")
                        .and_then(|c| c.get("text"))
                        .and_then(|t| t.as_str()) {
                        return Some(text.to_string());
                    }
                    // Path 3: text (direct field)
                    if let Some(text) = json_value.get("text").and_then(|t| t.as_str()) {
                        return Some(text.to_string());
                    }
                    // Path 4: content array
                    if let Some(content_array) = json_value.get("content").and_then(|c| c.as_array()) {
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
        history.last()
            .map(|item| matches!(item, AcpMessage::Assistant(_)))
            .unwrap_or(false)
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

    async fn send_message(&self, message: AcpMessage) {
        match self.message_sender.send(message) {
            Ok(receiver_count) => {
                if receiver_count == 0 {
                    debug!("Message sent to agent {} but no receivers connected (stored in history)", self.agent_id);
                } else {
                    debug!("Message sent to agent {} with {} receivers", self.agent_id, receiver_count);
                }
            }
            Err(e) => {
                error!("Failed to send message to channel for agent {}: {}", self.agent_id, e);
            }
        }
    }
}

pub struct AcpAgent {
    agent_id: String,
    agent_name: String,
    connection: Option<acp::ClientSideConnection>,
    session_id: Option<acp::SessionId>,
    ready: Arc<AtomicBool>,
    message_sender: Option<broadcast::Sender<AcpMessage>>,
    prompt_sender: Option<mpsc::Sender<String>>,
    cancel_sender: Arc<tokio::sync::Mutex<Option<mpsc::Sender<()>>>>,
    process_handle: Option<tokio::task::JoinHandle<()>>,
    io_handle: Option<tokio::task::JoinHandle<()>>,
    history: Arc<tokio::sync::Mutex<Vec<AcpMessage>>>,
}

impl AcpAgent {
    pub fn new(agent_id: String, agent_name: String) -> Self {
        Self {
            agent_id,
            agent_name,
            connection: None,
            session_id: None,
            ready: Arc::new(AtomicBool::new(false)),
            message_sender: None,
            prompt_sender: None,
            cancel_sender: Arc::new(tokio::sync::Mutex::new(None)),
            process_handle: None,
            io_handle: None,
            history: Arc::new(tokio::sync::Mutex::new(Vec::new())),
        }
    }

    pub async fn start(&mut self, cmd: &str, args: &[String]) -> io::Result<()> {
        // Setup channels
        let (history_tx, _) = broadcast::channel::<AcpMessage>(100);
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
        
        let local_set_handle = tokio::task::spawn_blocking(move || {
            tokio::runtime::Handle::current().block_on(async {
                let local_set = tokio::task::LocalSet::new();
                local_set.run_until(async move {
                    Self::run_agent(
                        agent_id_clone,
                        ready_clone,
                        history_clone,
                        message_sender_clone,
                        stdin,
                        stdout,
                        stderr,
                        prompt_rx,
                        cancel_rx,
                        session_tx,
                    ).await;
                }).await;
            })
        });
        
        self.io_handle = Some(local_set_handle);
        self.connection = None;

        // Receive session ID (non-blocking check)
        if let Ok(session_id) = session_rx.try_recv() {
            self.session_id = Some(session_id);
        }

        // Store process handle for cleanup
        let process_handle = tokio::spawn(async move {
            let _ = child.wait().await;
            debug!("ACP agent process ended");
        });
        self.process_handle = Some(process_handle);

        Ok(())
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
        stdin: tokio::process::ChildStdin,
        stdout: tokio::process::ChildStdout,
        stderr: tokio::process::ChildStderr,
        mut prompt_rx: mpsc::Receiver<String>,
        mut cancel_rx: mpsc::Receiver<()>,
        session_tx: mpsc::Sender<acp::SessionId>,
    ) {
        // Create client implementation
        let client_impl = AcpClientImpl {
            agent_id: agent_id.clone(),
            message_sender: message_sender.clone(),
            history,
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
        Self::spawn_stderr_reader(stderr);
        
        // Initialize connection and create session
        let session_id = match Self::initialize_connection(&conn, &agent_id).await {
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
                session_id,
                &mut prompt_rx,
                &mut cancel_rx,
            ).await;
        } else {
            error!("No session ID for agent {}, cannot handle prompts", agent_id);
            // Keep the connection alive if no session
            loop {
                tokio::time::sleep(tokio::time::Duration::from_secs(3600)).await;
            }
        }
    }

    fn spawn_stderr_reader(stderr: tokio::process::ChildStderr) {
        tokio::task::spawn_local(async move {
            use tokio::io::{AsyncBufReadExt, BufReader};
            let mut reader = BufReader::new(stderr);
            let mut buf = String::new();
            while reader.read_line(&mut buf).await.is_ok() && !buf.is_empty() {
                error!("ACP stderr: {}", buf.trim());
                buf.clear();
            }
        });
    }

    async fn initialize_connection(
        conn: &std::rc::Rc<acp::ClientSideConnection>,
        agent_id: &str,
    ) -> Result<acp::SessionId> {
        let client_info = acp::Implementation::new("anycode", "1.0.0").title("Anycode Editor");
        let init_message = acp::InitializeRequest::new(ProtocolVersion::V1).client_info(client_info);

        conn.initialize(init_message).await
            .map_err(|e| anyhow!("Failed to initialize: {}", e))?;
        
        info!("ACP agent {} initialized successfully", agent_id);
        
        // Create new session
        let cwd = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
        let response = conn.new_session(acp::NewSessionRequest::new(cwd)).await
            .map_err(|e| anyhow!("Failed to create session: {}", e))?;
        
        info!("Session created for agent {}: {}", agent_id, response.session_id);
        Ok(response.session_id)
    }

    async fn run_prompt_loop(
        conn: &std::rc::Rc<acp::ClientSideConnection>,
        agent_id: &str,
        message_sender: &broadcast::Sender<AcpMessage>,
        session_id: acp::SessionId,
        prompt_rx: &mut mpsc::Receiver<String>,
        cancel_rx: &mut mpsc::Receiver<()>,
    ) {
        info!("Starting prompt handling loop for agent {} with session {}", agent_id, session_id);
        
        loop {
            match prompt_rx.recv().await {
                Some(prompt) => {
                    info!("Sending prompt to agent {}: {}", agent_id, prompt);
                    
                    // Send prompt state: processing started
                    let _ = message_sender.send(AcpMessage::PromptState(AcpPromptState {
                        is_processing: true,
                    }));
                    
                    // Handle prompt with cancellation support
                    Self::   handle_prompt_with_cancellation(
                        conn,
                        agent_id,
                        message_sender,
                        &session_id,
                        prompt,
                        cancel_rx,
                    ).await;
                    
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
        _message_sender: &broadcast::Sender<AcpMessage>,
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
        let mut prompt_fut = std::pin::pin!(async move {
            conn_for_prompt.prompt(prompt_request).await
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

    pub async fn send_prompt(&mut self, prompt: String) -> Result<()> {
        let prompt_tx = match &self.prompt_sender {
            Some(tx) => tx,
            None => return Err(anyhow!("Prompt sender not initialized"))
        };

        let user_message = AcpMessage::User(AcpUserMessage { content: prompt.clone() });

        // Save user message to history
        let mut history = self.history.lock().await;
        history.push(user_message.clone());

        // Send user message to all connected clients (non-blocking)
        if let Some(message_sender) = &self.message_sender {
            if let Err(e) = message_sender.send(user_message.clone()) {
                error!("Failed to broadcast user message for agent {}: {}", self.agent_id, e);
                // Continue anyway - message is in history and will be sent on reconnect
            }
        }

        // Send prompt to agent
        prompt_tx.send(prompt).await?;

        Ok(())
    }

    pub async fn cancel_prompt(&self) -> Result<()> {
        let cancel_sender_guard = self.cancel_sender.lock().await;
        let cancel_tx = match cancel_sender_guard.as_ref() {
            Some(tx) => tx,
            None => return Err(anyhow!("Cancel sender not initialized"))
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
}

pub struct AcpManager {
    agents: HashMap<String, AcpAgent>,
}

impl AcpManager {
    pub fn new() -> Self {
        Self {
            agents: HashMap::new(),
        }
    }

    /// Start agent by agent_id and agent_name. Returns an error if the agent already exists.
    pub async fn start_agent(
        &mut self, agent_id: String, agent_name: String, cmd: &str, args: &[String],
    ) -> Result<()> {

        if self.agents.contains_key(&agent_id) {
            return Err(anyhow::anyhow!("Agent {} already running", agent_id));
        }

        let mut agent = AcpAgent::new(agent_id.clone(), agent_name.clone());

        info!("Starting ACP agent {} with command: {} {:?}", agent_id, cmd, args);
        agent.start(cmd, args).await?;

        self.agents.insert(agent_id, agent);

        Ok(())
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
        self.agents.get(agent_id)?
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
}

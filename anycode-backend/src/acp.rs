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
use tokio::sync::{RwLock, broadcast, mpsc, oneshot};
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

#[derive(Debug, Clone)]
struct AcpPromptPayload {
    prompt: String,
    attachments: Vec<AcpPromptAttachment>,
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
}

struct AcpClientImpl {
    agent_id: String,
    message_sender: broadcast::Sender<AcpMessage>,
    history: Arc<tokio::sync::Mutex<Vec<AcpMessage>>>,
    /// Channel to send file operations to the ACP filesystem background task
    fs_sender: Option<mpsc::Sender<AcpFsCommand>>,
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
        info!(
            "session_notification received for agent {}: {:?}",
            self.agent_id, args.update
        );
        let item = AcpMessage::RawUpdate(AcpRawUpdate {
            agent_id: self.agent_id.clone(),
            ts: Utc::now().to_rfc3339(),
            update: serde_json::to_value(&args.update)?,
        });

        let mut hist = self.history.lock().await;
        if !Self::append_to_previous_raw_chunk(&mut hist, &args.update) {
            hist.push(item.clone());
        }
        drop(hist);

        self.send_message(item).await;
        Ok(())
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
struct SessionBootstrap {
    session_id: acp::SessionId,
    model_selector: Option<AcpModelSelector>,
    reasoning_selector: Option<AcpReasoningSelector>,
    prompt_capabilities: acp::PromptCapabilities,
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
    prompt_sender: Option<mpsc::Sender<AcpPromptPayload>>,
    config_sender: Option<mpsc::Sender<PendingConfigUpdate>>,
    cancel_sender: Arc<tokio::sync::Mutex<Option<mpsc::Sender<()>>>>,
    shutdown_sender: Option<mpsc::Sender<()>>,
    process_handle: Option<tokio::task::JoinHandle<()>>,
    io_handle: Option<tokio::task::JoinHandle<()>>,
    history: Arc<tokio::sync::Mutex<Vec<AcpMessage>>>,
    /// History manager for undo/redo support
    history_manager: Arc<RwLock<AcpHistoryManager>>,
    /// Channel to send file operations to the ACP filesystem background task
    fs_sender: mpsc::Sender<AcpFsCommand>,
}

impl AcpAgent {
    pub fn new(
        agent_id: String,
        agent_name: String,
        fs_sender: mpsc::Sender<AcpFsCommand>,
    ) -> Self {
        // Initialize history manager with current working directory and agent ID
        let project_root = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
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
            prompt_sender: None,
            config_sender: None,
            cancel_sender: Arc::new(tokio::sync::Mutex::new(None)),
            shutdown_sender: None,
            process_handle: None,
            io_handle: None,
            history: Arc::new(tokio::sync::Mutex::new(Vec::new())),
            history_manager: Arc::new(RwLock::new(history_manager)),
            fs_sender,
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

        let (prompt_tx, prompt_rx) = mpsc::channel::<AcpPromptPayload>(100);
        self.prompt_sender = Some(prompt_tx.clone());
        let (config_tx, config_rx) = mpsc::channel::<PendingConfigUpdate>(32);
        self.config_sender = Some(config_tx);

        let (cancel_tx, cancel_rx) = mpsc::channel::<()>(10);
        {
            let mut cancel_sender_guard = self.cancel_sender.lock().await;
            *cancel_sender_guard = Some(cancel_tx.clone());
        }
        let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);
        self.shutdown_sender = Some(shutdown_tx);

        let (bootstrap_tx, bootstrap_rx) = oneshot::channel::<Result<SessionBootstrap>>();

        // Spawn agent process
        let (mut child, stdin, stdout, stderr) = Self::spawn_agent_process(cmd, args)?;

        // Setup connection and run in LocalSet
        let ready_clone = self.ready.clone();
        let is_processing_clone = self.is_processing.clone();
        let agent_id_clone = self.agent_id.clone();
        let history_clone = self.history.clone();
        let message_sender_clone = history_tx.clone();
        let fs_sender_clone = self.fs_sender.clone();

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
                            message_sender_clone,
                            fs_sender_clone,
                            stdin,
                            stdout,
                            stderr,
                            prompt_rx,
                            config_rx,
                            cancel_rx,
                            bootstrap_tx,
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

        match tokio::time::timeout(tokio::time::Duration::from_secs(15), bootstrap_rx).await {
            Ok(Ok(Ok(bootstrap))) => {
                self.session_id = Some(bootstrap.session_id.clone());
                Ok(bootstrap.session_id.to_string())
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
    ) -> io::Result<(
        tokio::process::Child,
        tokio::process::ChildStdin,
        tokio::process::ChildStdout,
        tokio::process::ChildStderr,
    )> {
        let mut command = Self::agent_command(cmd);
        let mut child = command
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
        message_sender: broadcast::Sender<AcpMessage>,
        fs_sender: mpsc::Sender<AcpFsCommand>,
        stdin: tokio::process::ChildStdin,
        stdout: tokio::process::ChildStdout,
        stderr: tokio::process::ChildStderr,
        mut prompt_rx: mpsc::Receiver<AcpPromptPayload>,
        mut config_rx: mpsc::Receiver<PendingConfigUpdate>,
        mut cancel_rx: mpsc::Receiver<()>,
        bootstrap_tx: oneshot::Sender<Result<SessionBootstrap>>,
        resume_session_id: Option<String>,
    ) {
        // Clone history before moving client_impl
        let history_for_stderr = history.clone();
        let history_for_prompt = history.clone();

        // Create client implementation
        let client_impl = Arc::new(AcpClientImpl {
            agent_id: agent_id.clone(),
            message_sender: message_sender.clone(),
            history,
            fs_sender: Some(fs_sender),
        });

        // Read stderr for debugging
        Self::spawn_stderr_reader(stderr, message_sender.clone(), history_for_stderr);

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
                let bootstrap =
                    match Self::initialize_connection(&conn, &agent_id_for_conn, resume_session_id)
                        .await
                    {
                        Ok(value) => value,
                        Err(e) => {
                            let err = anyhow!(
                                "Failed to initialize ACP agent {}: {}",
                                agent_id_for_conn,
                                e
                            );
                            let _ = bootstrap_tx.send(Err(err));
                            return Err(acp::Error::internal_error().data(format!("{e:#}")));
                        }
                    };

                ready.store(true, Ordering::SeqCst);
                let _ = bootstrap_tx.send(Ok(bootstrap.clone()));

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
                    bootstrap.session_id,
                    bootstrap.prompt_capabilities,
                    &mut prompt_rx,
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

                // Save to history
                let message_for_ui = {
                    let mut history = history.lock().await;
                    AcpClientImpl::append_or_push_error_message(&mut history, &error_msg)
                };

                // Send error message to UI
                let _ = message_sender.send(message_for_ui);

                buf.clear();
            }
        });
    }

    async fn initialize_agent_connection(
        conn: &ConnectionTo<agent_client_protocol::Agent>,
        agent_id: &str,
    ) -> Result<acp::PromptCapabilities> {
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
            "ACP agent {} initialized successfully. Agent capabilities: {:?}",
            agent_id, init_response.agent_capabilities
        );
        Ok(init_response.agent_capabilities.prompt_capabilities)
    }

    async fn initialize_connection(
        conn: &ConnectionTo<agent_client_protocol::Agent>,
        agent_id: &str,
        resume_session_id: Option<String>,
    ) -> Result<SessionBootstrap> {
        let prompt_capabilities = Self::initialize_agent_connection(conn, agent_id).await?;

        let cwd = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
        let mut bootstrap = Self::create_or_resume_session(conn, resume_session_id, cwd).await?;
        bootstrap.prompt_capabilities = prompt_capabilities;

        info!(
            "Session ready for agent {}: {}",
            agent_id, bootstrap.session_id
        );
        Ok(bootstrap)
    }

    async fn create_or_resume_session(
        conn: &ConnectionTo<agent_client_protocol::Agent>,
        resume_session_id: Option<String>,
        cwd: PathBuf,
    ) -> Result<SessionBootstrap> {
        if let Some(resume_session_id) = resume_session_id.as_deref() {
            match Self::restore_session(conn, resume_session_id, &cwd).await? {
                RestoreSessionOutcome::Restored(bootstrap) => return Ok(bootstrap),
                RestoreSessionOutcome::Failed {
                    load_err,
                    resume_err,
                } => {
                    error!(
                        "Failed to restore ACP session {}. load_session error: {}. resume_session error: {}. Falling back to creating a new session.",
                        resume_session_id, load_err, resume_err
                    );
                }
            }
        }

        let response = conn
            .send_request(acp::NewSessionRequest::new(cwd))
            .block_task()
            .await
            .map_err(|e| anyhow!("Failed to create session: {}", e))?;

        Self::build_session_bootstrap(response.session_id, response.config_options.as_deref())
    }

    async fn restore_session(
        conn: &ConnectionTo<agent_client_protocol::Agent>,
        resume_session_id: &str,
        cwd: &PathBuf,
    ) -> Result<RestoreSessionOutcome> {
        let requested_session_id = SessionId::new(resume_session_id.to_string());
        let load_result = conn
            .send_request(acp::LoadSessionRequest::new(
                requested_session_id.clone(),
                cwd.clone(),
            ))
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
            .send_request(acp::ResumeSessionRequest::new(
                requested_session_id.clone(),
                cwd.clone(),
            ))
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
        session_id: acp::SessionId,
        prompt_capabilities: acp::PromptCapabilities,
        prompt_rx: &mut mpsc::Receiver<AcpPromptPayload>,
        config_rx: &mut mpsc::Receiver<PendingConfigUpdate>,
        cancel_rx: &mut mpsc::Receiver<()>,
    ) {
        info!(
            "Starting prompt handling loop for agent {} with session {}",
            agent_id, session_id
        );

        loop {
            tokio::select! {
                maybe_prompt = prompt_rx.recv() => match maybe_prompt {
                Some(prompt) => {
                    info!(
                        "Sending prompt to agent {} (text_len={}, attachments={})",
                        agent_id,
                        prompt.prompt.len(),
                        prompt.attachments.len()
                    );

                    is_processing.store(true, Ordering::SeqCst);

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
                        prompt.prompt,
                        prompt.attachments,
                        &prompt_capabilities,
                        cancel_rx,
                    )
                    .await;

                    is_processing.store(false, Ordering::SeqCst);

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
                },
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
    ) {
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
            attachments: if attachments.is_empty() {
                None
            } else {
                Some(attachments.clone())
            },
        });

        {
            let mut history = self.history.lock().await;
            history.push(user_message.clone());
        }

        if let Some(message_sender) = &self.message_sender {
            if let Err(e) = message_sender.send(user_message) {
                debug!(
                    "No active subscribers while sending user message for agent {}: {}",
                    self.agent_id, e
                );
            }
        }

        // Send prompt to agent
        let payload = AcpPromptPayload {
            prompt,
            attachments,
        };
        prompt_tx.send(payload).await?;

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
}

impl AcpManager {
    pub fn new(fs_sender: mpsc::Sender<AcpFsCommand>) -> Self {
        Self {
            agents: HashMap::new(),
            fs_sender,
        }
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

        let mut agent = AcpAgent::new(agent_id.clone(), agent_name.clone(), self.fs_sender.clone());

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
}

use agent_client_protocol::schema::v1 as acp;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::io::AsyncReadExt;
use tokio::sync::{Mutex, Notify, mpsc};
use tracing::{debug, info};

static TERMINAL_COUNTER: AtomicU64 = AtomicU64::new(1);

pub struct AcpTerminalOutputState {
    pub buffer: Vec<u8>,
    pub original_len: usize,
    pub output_byte_limit: Option<usize>,
    pub exit_status: Option<acp::TerminalExitStatus>,
}

pub struct AcpTerminalInstance {
    pub terminal_id: acp::TerminalId,
    pub session_id: acp::SessionId,
    pub command: String,
    pub pid: Option<u32>,
    pub output: Arc<Mutex<AcpTerminalOutputState>>,
    pub exit_notify: Arc<Notify>,
    pub kill_tx: mpsc::Sender<()>,
}

#[derive(Clone, Default)]
pub struct AcpTerminalManager {
    terminals: Arc<Mutex<HashMap<String, Arc<AcpTerminalInstance>>>>,
}

impl AcpTerminalManager {
    pub fn new() -> Self {
        Self {
            terminals: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn create_terminal(
        &self,
        args: acp::CreateTerminalRequest,
        project_root: &Path,
    ) -> acp::Result<acp::CreateTerminalResponse> {
        let count = TERMINAL_COUNTER.fetch_add(1, Ordering::Relaxed);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let terminal_id_str = format!("term-{}-{}", now, count);
        let terminal_id = acp::TerminalId::new(terminal_id_str.clone());

        let resolved_cwd = match &args.cwd {
            Some(dir) => {
                if dir.is_absolute() {
                    dir.clone()
                } else {
                    project_root.join(dir)
                }
            }
            None => project_root.to_path_buf(),
        };

        info!(
            "Creating ACP terminal {}: command='{}', args={:?}, cwd={:?}",
            terminal_id_str, args.command, args.args, resolved_cwd
        );

        let mut cmd = tokio::process::Command::new(&args.command);
        cmd.args(&args.args);
        cmd.current_dir(&resolved_cwd);
        for env_var in &args.env {
            cmd.env(&env_var.name, &env_var.value);
        }
        cmd.env("PAGER", "cat");
        cmd.env("GIT_PAGER", "cat");
        cmd.env("TERM", "dumb");

        cmd.stdin(std::process::Stdio::null());
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());
        cmd.kill_on_drop(true);

        let mut child = cmd.spawn().map_err(|e| {
            debug!("Failed to spawn command '{}': {}", args.command, e);
            acp::Error::internal_error()
        })?;

        let pid = child.id();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let output_state = Arc::new(Mutex::new(AcpTerminalOutputState {
            buffer: Vec::new(),
            original_len: 0,
            output_byte_limit: args.output_byte_limit.map(|l| l as usize),
            exit_status: None,
        }));

        let exit_notify = Arc::new(Notify::new());
        let (kill_tx, mut kill_rx) = mpsc::channel::<()>(1);

        if let Some(mut stdout) = stdout {
            let output_state = output_state.clone();
            tokio::spawn(async move {
                let mut buf = [0u8; 4096];
                while let Ok(n) = stdout.read(&mut buf).await {
                    if n == 0 {
                        break;
                    }
                    let mut state = output_state.lock().await;
                    state.original_len += n;
                    let limit = state.output_byte_limit.unwrap_or(usize::MAX);
                    if state.buffer.len() < limit {
                        let to_take = n.min(limit - state.buffer.len());
                        state.buffer.extend_from_slice(&buf[..to_take]);
                    }
                }
            });
        }

        if let Some(mut stderr) = stderr {
            let output_state = output_state.clone();
            tokio::spawn(async move {
                let mut buf = [0u8; 4096];
                while let Ok(n) = stderr.read(&mut buf).await {
                    if n == 0 {
                        break;
                    }
                    let mut state = output_state.lock().await;
                    state.original_len += n;
                    let limit = state.output_byte_limit.unwrap_or(usize::MAX);
                    if state.buffer.len() < limit {
                        let to_take = n.min(limit - state.buffer.len());
                        state.buffer.extend_from_slice(&buf[..to_take]);
                    }
                }
            });
        }

        let output_state_for_task = output_state.clone();
        let exit_notify_for_task = exit_notify.clone();

        tokio::spawn(async move {
            tokio::select! {
                status = child.wait() => {
                    let mut es = acp::TerminalExitStatus::new();
                    match status {
                        Ok(s) => {
                            if let Some(code) = s.code() {
                                es = es.exit_code(Some(code as u32));
                            }
                            #[cfg(unix)]
                            {
                                use std::os::unix::process::ExitStatusExt;
                                if let Some(sig) = s.signal() {
                                    es = es.signal(Some(format!("SIG{}", sig)));
                                }
                            }
                        }
                        Err(e) => {
                            debug!("Child wait error: {}", e);
                            es = es.exit_code(Some(1u32));
                        }
                    }
                    let mut state = output_state_for_task.lock().await;
                    state.exit_status = Some(es);
                    exit_notify_for_task.notify_waiters();
                }
                _ = kill_rx.recv() => {
                    info!("Killing terminal process pid {:?}", pid);
                    let _ = child.kill().await;
                    let _ = child.wait().await;

                    let es = acp::TerminalExitStatus::new()
                        .exit_code(Some(137u32))
                        .signal(Some("SIGKILL".to_string()));

                    let mut state = output_state_for_task.lock().await;
                    state.exit_status = Some(es);
                    exit_notify_for_task.notify_waiters();
                }
            }
        });

        let instance = Arc::new(AcpTerminalInstance {
            terminal_id: terminal_id.clone(),
            session_id: args.session_id.clone(),
            command: args.command,
            pid,
            output: output_state,
            exit_notify,
            kill_tx,
        });

        self.terminals
            .lock()
            .await
            .insert(terminal_id_str, instance);

        Ok(acp::CreateTerminalResponse::new(terminal_id))
    }

    pub async fn terminal_output(
        &self,
        args: acp::TerminalOutputRequest,
    ) -> acp::Result<acp::TerminalOutputResponse> {
        let instance = self.get_terminal(&args.terminal_id).await?;
        let state = instance.output.lock().await;
        let content = String::from_utf8_lossy(&state.buffer).to_string();
        let truncated = state.original_len > state.buffer.len();
        let mut resp = acp::TerminalOutputResponse::new(content, truncated);
        if let Some(ref es) = state.exit_status {
            resp = resp.exit_status(es.clone());
        }
        Ok(resp)
    }

    pub async fn wait_for_terminal_exit(
        &self,
        args: acp::WaitForTerminalExitRequest,
    ) -> acp::Result<acp::WaitForTerminalExitResponse> {
        let instance = self.get_terminal(&args.terminal_id).await?;
        loop {
            {
                let state = instance.output.lock().await;
                if let Some(ref es) = state.exit_status {
                    return Ok(acp::WaitForTerminalExitResponse::new(es.clone()));
                }
            }
            instance.exit_notify.notified().await;
        }
    }

    pub async fn kill_terminal_command(
        &self,
        args: acp::KillTerminalRequest,
    ) -> acp::Result<acp::KillTerminalResponse> {
        if let Ok(instance) = self.get_terminal(&args.terminal_id).await {
            let _ = instance.kill_tx.try_send(());
        }
        Ok(acp::KillTerminalResponse::default())
    }

    pub async fn release_terminal(
        &self,
        args: acp::ReleaseTerminalRequest,
    ) -> acp::Result<acp::ReleaseTerminalResponse> {
        let mut map = self.terminals.lock().await;
        if let Some(instance) = map.remove(args.terminal_id.0.as_ref()) {
            let _ = instance.kill_tx.try_send(());
        }
        Ok(acp::ReleaseTerminalResponse::default())
    }

    pub async fn kill_all_for_session(&self, session_id: &str) {
        let mut map = self.terminals.lock().await;
        map.retain(|_, instance| {
            if instance.session_id.0.as_ref() == session_id {
                let _ = instance.kill_tx.try_send(());
                false
            } else {
                true
            }
        });
    }

    pub async fn kill_all(&self) {
        let mut map = self.terminals.lock().await;
        for (_, instance) in map.drain() {
            let _ = instance.kill_tx.try_send(());
        }
    }

    async fn get_terminal(&self, id: &acp::TerminalId) -> acp::Result<Arc<AcpTerminalInstance>> {
        self.terminals
            .lock()
            .await
            .get(id.0.as_ref())
            .cloned()
            .ok_or_else(|| acp::Error::resource_not_found(Some(id.to_string())))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_terminal_exec_and_output() {
        let manager = AcpTerminalManager::new();
        let session_id = acp::SessionId::new("test-session");
        let project_root = std::env::temp_dir();

        let req = acp::CreateTerminalRequest::new(
            session_id.clone(),
            "echo".to_string(),
        ).args(vec!["hello_acp_terminal".to_string()]);

        let resp = manager.create_terminal(req, &project_root).await.unwrap();
        let term_id = resp.terminal_id;

        let wait_resp = manager
            .wait_for_terminal_exit(acp::WaitForTerminalExitRequest::new(
                session_id.clone(),
                term_id.clone(),
            ))
            .await
            .unwrap();

        assert_eq!(wait_resp.exit_status.exit_code, Some(0));

        let out_resp = manager
            .terminal_output(acp::TerminalOutputRequest::new(
                session_id.clone(),
                term_id.clone(),
            ))
            .await
            .unwrap();

        assert!(out_resp.output.contains("hello_acp_terminal"));

        manager
            .release_terminal(acp::ReleaseTerminalRequest::new(session_id, term_id))
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn test_terminal_kill() {
        let manager = AcpTerminalManager::new();
        let session_id = acp::SessionId::new("test-session-kill");
        let project_root = std::env::temp_dir();

        let req = acp::CreateTerminalRequest::new(
            session_id.clone(),
            "sleep".to_string(),
        ).args(vec!["10".to_string()]);

        let resp = manager.create_terminal(req, &project_root).await.unwrap();
        let term_id = resp.terminal_id;

        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

        manager
            .kill_terminal_command(acp::KillTerminalRequest::new(
                session_id.clone(),
                term_id.clone(),
            ))
            .await
            .unwrap();

        let wait_resp = manager
            .wait_for_terminal_exit(acp::WaitForTerminalExitRequest::new(
                session_id.clone(),
                term_id.clone(),
            ))
            .await
            .unwrap();

        assert!(wait_resp.exit_status.signal.is_some() || wait_resp.exit_status.exit_code == Some(137));
    }
}

use crate::utils::current_dir;
use anyhow::Result;
use portable_pty::{Child, CommandBuilder, PtyPair, PtySize, native_pty_system};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tokio::sync::mpsc;

pub struct Terminal {
    pty_input_tx: mpsc::Sender<String>,
    pty_resize_tx: mpsc::Sender<(u16, u16)>,
    kill_tx: mpsc::Sender<()>,
}

impl Terminal {
    pub async fn new(
        _name: String,
        _session_id: String,
        rows: u16,
        cols: u16,
        cmd: Option<String>,
        cwd: Option<PathBuf>,
        on_output_tx: mpsc::Sender<String>,
    ) -> anyhow::Result<Self> {
        let pty_system = native_pty_system();
        let pty_size = PtySize {
            rows: rows,
            cols: cols,
            pixel_width: 0,
            pixel_height: 0,
        };

        let pair = pty_system.openpty(pty_size)?;
        let command_str = cmd.unwrap_or_else(Self::default_shell);
        let mut cmd_builder = CommandBuilder::new(command_str);

        let working_dir = cwd.unwrap_or_else(|| current_dir());
        cmd_builder.cwd(working_dir);

        let child = pair.slave.spawn_command(cmd_builder)?;

        let writer = pair.master.take_writer()?;
        let reader = pair.master.try_clone_reader()?;

        let (pty_output_tx, pty_output_rx) = mpsc::channel::<String>(32);
        let (pty_input_tx, pty_input_rx) = mpsc::channel::<String>(32);
        let (pty_resize_tx, pty_resize_rx) = mpsc::channel::<(u16, u16)>(32);
        let (kill_tx, kill_rx) = mpsc::channel::<()>(1);

        Self::spawn_pty_reader(reader, pty_output_tx);
        Self::forward_output(pty_output_rx, on_output_tx);
        Self::spawn_terminal_task(child, writer, pair, pty_input_rx, pty_resize_rx, kill_rx);

        Ok(Self {
            pty_input_tx,
            pty_resize_tx,
            kill_tx,
        })
    }

    fn default_shell() -> String {
        if cfg!(target_os = "windows") {
            return "cmd.exe".to_string();
        }

        if let Ok(shell) = std::env::var("SHELL") {
            return shell;
        }

        let common_shells = ["/bin/zsh", "/bin/bash", "/bin/sh"];

        common_shells
            .iter()
            .find(|path| Path::new(path).exists())
            .unwrap_or(&"/bin/sh")
            .to_string()
    }

    fn spawn_pty_reader(mut reader: Box<dyn Read + Send>, pty_output_tx: mpsc::Sender<String>) {
        tokio::task::spawn_blocking(move || {
            tracing::info!("PTY reader started");
            let mut buf = [0u8; 1024];
            let mut unprocessed = Vec::new();
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        unprocessed.extend_from_slice(&buf[..n]);
                        let mut check_idx = 0;
                        while check_idx < unprocessed.len() {
                            match std::str::from_utf8(&unprocessed[check_idx..]) {
                                Ok(s) => {
                                    let _ = pty_output_tx.blocking_send(s.to_string());
                                    unprocessed.clear();
                                    break;
                                }
                                Err(e) => {
                                    let valid_up_to = e.valid_up_to();
                                    if valid_up_to > 0 {
                                        if let Ok(s) = std::str::from_utf8(&unprocessed[check_idx..check_idx + valid_up_to]) {
                                            let _ = pty_output_tx.blocking_send(s.to_string());
                                        }
                                        check_idx += valid_up_to;
                                    }
                                    match e.error_len() {
                                        Some(err_len) => {
                                            let _ = pty_output_tx.blocking_send(String::from("\u{FFFD}"));
                                            check_idx += err_len;
                                        }
                                        None => {
                                            unprocessed.drain(..check_idx);
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        tracing::warn!("PTY read error: {:?}", e);
                        break;
                    }
                }
            }
            if !unprocessed.is_empty() {
                let s = String::from_utf8_lossy(&unprocessed).to_string();
                let _ = pty_output_tx.blocking_send(s);
            }
            tracing::info!("PTY reader stopped");
        });
    }

    fn forward_output(
        mut pty_output_rx: mpsc::Receiver<String>,
        on_output_tx: mpsc::Sender<String>,
    ) {
        tokio::spawn(async move {
            while let Some(output) = pty_output_rx.recv().await {
                let _ = on_output_tx.send(output).await;
            }
        });
    }

    fn spawn_terminal_task(
        mut child: Box<dyn Child + Send>,
        mut writer: Box<dyn Write + Send>,
        pair: PtyPair,
        mut input_rx: mpsc::Receiver<String>,
        mut resize_rx: mpsc::Receiver<(u16, u16)>,
        mut kill_rx: mpsc::Receiver<()>,
    ) {
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    Some(input) = input_rx.recv() => {
                        if let Err(e) = writer.write_all(input.as_bytes()) {
                            tracing::error!("PTY write error: {:?}", e);
                        }
                        let _ = writer.flush();
                    }
                    Some((cols, rows)) = resize_rx.recv() => {
                        let _ = pair.master.resize(PtySize {
                            rows,
                            cols,
                            pixel_width: 0,
                            pixel_height: 0,
                        });
                    }
                    Some(_) = kill_rx.recv() => {
                        break;
                    }
                    else => break,
                }
            }
            let _ = child.kill();
            let _ = child.wait();
        });
    }

    pub async fn send_input(&self, input: String) -> Result<()> {
        self.pty_input_tx.send(input).await?;
        Ok(())
    }

    pub async fn resize(&self, cols: u16, rows: u16) -> Result<()> {
        self.pty_resize_tx.send((cols, rows)).await?;
        Ok(())
    }

    pub async fn kill(&self) -> Result<()> {
        self.kill_tx.send(()).await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc;
    use tokio::time::{Duration, timeout};

    #[tokio::test]
    async fn test_terminal_echo() -> Result<()> {
        let (tx, mut rx) = mpsc::channel::<String>(10);

        let shell = if cfg!(target_os = "windows") {
            "cmd.exe".to_string()
        } else {
            "cat".to_string()
        };

        let terminal = Terminal::new(
            "test".to_string(),
            "session1".to_string(),
            30,
            80,
            Some(shell),
            None,
            tx,
        )
        .await?;

        terminal.send_input("echo test\n".to_string()).await?;

        let mut output = String::new();
        let _ = timeout(Duration::from_secs(2), async {
            while let Some(chunk) = rx.recv().await {
                output.push_str(&chunk);
                if output.contains("test") {
                    break;
                }
            }
        })
        .await;

        println!("Output: {}", output);

        assert!(
            output.contains("test"),
            "terminal did not echo expected output, got: {}",
            output
        );

        Ok(())
    }

    #[tokio::test]
    async fn test_terminal_unicode() -> Result<()> {
        let (tx, mut rx) = mpsc::channel::<String>(10);

        let shell = if cfg!(target_os = "windows") {
            "cmd.exe".to_string()
        } else {
            "cat".to_string()
        };

        let terminal = Terminal::new(
            "test_unicode".to_string(),
            "session2".to_string(),
            30,
            80,
            Some(shell),
            None,
            tx,
        )
        .await?;

        let unicode_str = "привет, как дела? 🚀";
        terminal.send_input(format!("{}\n", unicode_str)).await?;

        let mut output = String::new();
        let _ = timeout(Duration::from_secs(2), async {
            while let Some(chunk) = rx.recv().await {
                output.push_str(&chunk);
                if output.contains(unicode_str) {
                    break;
                }
            }
        })
        .await;

        println!("Output: {}", output);

        assert!(
            output.contains(unicode_str),
            "terminal did not echo expected unicode output, got: {}",
            output
        );

        Ok(())
    }
}

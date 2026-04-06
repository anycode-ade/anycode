use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{Context, Result};
use serde_json::json;
use socketioxide::SocketIo;
use tokio::sync::{Mutex, mpsc, oneshot};
use tracing::{error, info};

use crate::code::Code;
use crate::config::Config;
use crate::diff::compute_text_edits;
use crate::handlers::io_handler::apply_edits_to_code;
use crate::lsp::LspManager;
use crate::utils::abs_file;

pub enum AcpFsCommand {
    WriteTextFile {
        agent_id: String,
        path: PathBuf,
        content: String,
        resp: oneshot::Sender<Result<()>>,
    },
    ReadTextFile {
        agent_id: String,
        path: PathBuf,
        resp: oneshot::Sender<Result<String>>,
    },
}

pub async fn run_acp_fs_loop(
    mut rx: mpsc::Receiver<AcpFsCommand>,
    file2code: Arc<Mutex<HashMap<String, Code>>>,
    lsp_manager: Arc<Mutex<LspManager>>,
    config: Config,
    io: Arc<SocketIo>,
) {
    info!("ACP filesystem loop started");

    while let Some(cmd) = rx.recv().await {
        match cmd {
            AcpFsCommand::WriteTextFile {
                agent_id,
                path,
                content,
                resp,
            } => {
                let result = handle_write(
                    &agent_id,
                    &path,
                    &content,
                    &file2code,
                    &lsp_manager,
                    &config,
                    &io,
                )
                .await;
                let _ = resp.send(result);
            }
            AcpFsCommand::ReadTextFile {
                agent_id,
                path,
                resp,
            } => {
                let result = handle_read(&agent_id, &path, &file2code).await;
                let _ = resp.send(result);
            }
        }
    }

    info!("ACP filesystem loop ended");
}

async fn handle_write(
    agent_id: &str,
    path: &PathBuf,
    content: &str,
    file2code: &Arc<Mutex<HashMap<String, Code>>>,
    lsp_manager: &Arc<Mutex<LspManager>>,
    _config: &Config,
    io: &Arc<SocketIo>,
) -> Result<()> {
    let abs_path = abs_file(&path.to_string_lossy()).context("Failed to resolve absolute path")?;

    // Lock file2code and check if file is open
    let mut f2c = file2code.lock().await;

    if let Some(code) = f2c.get_mut(&abs_path) {
        // Case A: file is open in file2code — diff and apply
        let old_text = code.get_content();

        if old_text == content {
            info!(
                "ACP write for agent {}: file {} unchanged, skipping",
                agent_id, abs_path
            );
            return Ok(());
        }

        let edits = compute_text_edits(&old_text, content);

        if edits.is_empty() {
            return Ok(());
        }

        info!(
            "ACP write for agent {}: applying {} edits to open file {}",
            agent_id,
            edits.len(),
            abs_path
        );

        // Apply edits through the same path as handle_file_change
        let lsp_changes = apply_edits_to_code(code, &edits, true);

        // Save to disk
        if let Err(e) = code.save_file() {
            error!("ACP write: failed to save file {}: {}", abs_path, e);
            return Err(e.into());
        }

        let lang = code.lang.clone();
        let saved_content = code.get_content();

        // Serialize edits for frontend notification
        let edits_json = json!({
            "file": abs_path,
            "edits": edits,
        });

        // Release file2code lock before LSP operations
        drop(f2c);

        // Notify frontend so open editors update without echo
        if let Err(e) = io.emit("watcher:edits", &edits_json).await {
            error!("ACP write: failed to emit watcher:edits: {}", e);
        }

        // LSP sync
        if !lsp_changes.is_empty() {
            let mut lsp = lsp_manager.lock().await;
            if let Some(lsp) = lsp.get(&lang).await {
                lsp.did_change_multi(&abs_path, lsp_changes).await;
                lsp.did_save(&abs_path, Some(&saved_content));
            }
        }

        info!(
            "ACP write for agent {}: successfully wrote {} ({} bytes)",
            agent_id,
            abs_path,
            content.len()
        );
    } else {
        // Case B: file is NOT open — write directly to disk
        drop(f2c);

        // Create parent directories if needed
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .context("Failed to create parent directories")?;
        }

        tokio::fs::write(path, content)
            .await
            .context("Failed to write file")?;

        info!(
            "ACP write for agent {}: wrote closed file {} ({} bytes)",
            agent_id,
            abs_path,
            content.len()
        );
    }

    Ok(())
}

async fn handle_read(
    agent_id: &str,
    path: &PathBuf,
    file2code: &Arc<Mutex<HashMap<String, Code>>>,
) -> Result<String> {
    let abs_path = abs_file(&path.to_string_lossy()).context("Failed to resolve absolute path")?;

    // Check if file is open in file2code
    let f2c = file2code.lock().await;

    if let Some(code) = f2c.get(&abs_path) {
        // Case A: return in-memory content
        let content = code.get_content();
        info!(
            "ACP read for agent {}: returning in-memory content for {} ({} bytes)",
            agent_id,
            abs_path,
            content.len()
        );
        Ok(content)
    } else {
        // Case B: read from disk
        drop(f2c);

        let content = tokio::fs::read_to_string(path)
            .await
            .context("Failed to read file")?;

        info!(
            "ACP read for agent {}: read from disk {} ({} bytes)",
            agent_id,
            abs_path,
            content.len()
        );
        Ok(content)
    }
}

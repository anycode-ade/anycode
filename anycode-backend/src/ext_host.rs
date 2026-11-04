use anyhow::{Context, Result, anyhow};
use lsp_types::{PublishDiagnosticsParams, Range};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use socketioxide::SocketIo;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, Command};
use tokio::sync::{Mutex, mpsc, oneshot};
use tracing::{debug, error, info};

use crate::extensions::manifest::VsCodeManifest;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcMessage {
    pub jsonrpc: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<Value>,
}

pub struct ExtHostManager {
    _child: Mutex<tokio::process::Child>,
    stdin: Arc<Mutex<ChildStdin>>,
    next_id: AtomicU64,
    pending_requests: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value>>>>>,
    active_extensions: Arc<Mutex<HashMap<String, bool>>>,
    activation_rules: Arc<Mutex<HashMap<String, Vec<String>>>>, // ext_id -> activationEvents
    pub io: Arc<Mutex<Option<Arc<SocketIo>>>>,
}

impl ExtHostManager {
    pub async fn spawn(
        workspace_root: &Path,
        diagnostic_tx: mpsc::Sender<PublishDiagnosticsParams>,
    ) -> Result<Arc<Self>> {
        let bundle_path = find_ext_host_bundle()?;
        info!("Spawning Node.js extension host from {:?}", bundle_path);

        let mut child = Command::new("node")
            .arg(&bundle_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .context("Failed to spawn Node.js extension host")?;

        let stdin = child.stdin.take().ok_or_else(|| anyhow!("No stdin"))?;
        let stdout = child.stdout.take().ok_or_else(|| anyhow!("No stdout"))?;

        let manager = Arc::new(Self {
            _child: Mutex::new(child),
            stdin: Arc::new(Mutex::new(stdin)),
            next_id: AtomicU64::new(1),
            pending_requests: Arc::new(Mutex::new(HashMap::new())),
            active_extensions: Arc::new(Mutex::new(HashMap::new())),
            activation_rules: Arc::new(Mutex::new(HashMap::new())),
            io: Arc::new(Mutex::new(None)),
        });

        // Spawn background reader loop
        let reader_mgr = manager.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);

            loop {
                // Read Content-Length header or newline-delimited JSON
                let mut content_length = None;

                loop {
                    let mut line = String::new();
                    match reader.read_line(&mut line).await {
                        Ok(0) => {
                            error!("Extension host process exited unexpectedly (EOF on stdout)");
                            let mut pending = reader_mgr.pending_requests.lock().await;
                            for (_, tx) in pending.drain() {
                                let _ = tx.send(Err(anyhow!("Extension host process exited unexpectedly")));
                            }
                            return;
                        }
                        Ok(_) => {
                            let trimmed = line.trim();
                            if trimmed.is_empty() {
                                if content_length.is_some() {
                                    break; // End of headers
                                }
                            } else if trimmed.starts_with('{') && trimmed.ends_with('}') {
                                // Direct newline-delimited JSON
                                if let Ok(msg) = serde_json::from_str::<JsonRpcMessage>(trimmed) {
                                    reader_mgr.handle_incoming_message(msg, &diagnostic_tx).await;
                                }
                                break;
                            } else if let Some(stripped) = trimmed.strip_prefix("Content-Length:") {
                                if let Ok(len) = stripped.trim().parse::<usize>() {
                                    content_length = Some(len);
                                }
                            }
                        }
                        Err(e) => {
                            error!("Error reading from extension host: {:?}", e);
                            return;
                        }
                    }
                }

                if let Some(len) = content_length {
                    let mut body = vec![0u8; len];
                    if let Err(e) = reader.read_exact(&mut body).await {
                        error!("Failed to read exact body from extension host: {:?}", e);
                        return;
                    }

                    if let Ok(msg) = serde_json::from_slice::<JsonRpcMessage>(&body) {
                        reader_mgr.handle_incoming_message(msg, &diagnostic_tx).await;
                    }
                }
            }
        });

        // Initialize extHost
        let storage_dir = dirs::data_dir()
            .or_else(dirs::home_dir)
            .map(|h| h.join(".anycode").join("extension-storage"))
            .unwrap_or_else(|| PathBuf::from(".anycode/extension-storage"));
        let _ = std::fs::create_dir_all(&storage_dir);

        manager
            .send_request(
                "extHost/init",
                json!({
                    "workspaceRoot": workspace_root.to_string_lossy(),
                    "storageDir": storage_dir.to_string_lossy()
                }),
            )
            .await?;

        Ok(manager)
    }

    pub fn set_socket_io(&self, io: Arc<SocketIo>) {
        if let Ok(mut lock) = self.io.try_lock() {
            *lock = Some(io);
        }
    }

    pub async fn register_manifest(&self, manifest: &VsCodeManifest) {
        let ext_id = manifest.extension_id();
        let mut events = manifest.activation_events.clone();

        // Default VS Code 1.74 implicit activations:
        if let Some(ref contrib) = manifest.contributes {
            for lang in &contrib.languages {
                events.push(format!("onLanguage:{}", lang.id));
            }
            for cmd in &contrib.commands {
                events.push(format!("onCommand:{}", cmd.command));
            }
        }

        let mut rules = self.activation_rules.lock().await;
        rules.insert(ext_id, events);
    }

    pub async fn activate_if_needed(&self, ext_id: &str, ext_path: &Path, manifest: &VsCodeManifest) -> Result<()> {
        {
            let mut active = self.active_extensions.lock().await;
            if active.get(ext_id).copied().unwrap_or(false) {
                return Ok(());
            }
            active.insert(ext_id.to_string(), true);
        }

        let main_file = manifest.main.as_deref().or(manifest.browser.as_deref());
        if main_file.is_none() {
            return Ok(()); // Declarative only
        }

        info!("Activating extension {}", ext_id);
        let resp = match self
            .send_request(
                "extHost/activateExtension",
                json!({
                    "id": ext_id,
                    "extensionPath": ext_path.to_string_lossy(),
                    "mainFile": main_file
                }),
            )
            .await
        {
            Ok(r) => r,
            Err(e) => {
                error!("Failed to activate extension {}: {:#}", ext_id, e);
                let mut active = self.active_extensions.lock().await;
                active.remove(ext_id);
                return Err(e);
            }
        };

        if resp.get("success").and_then(|v| v.as_bool()).unwrap_or(false) {
            info!("Extension {} activated successfully", ext_id);
        } else {
            error!("Extension {} activation failed: {:?}", ext_id, resp);
            let mut active = self.active_extensions.lock().await;
            active.remove(ext_id);
        }

        Ok(())
    }

    pub async fn check_language_activation(&self, lang: &str, installed: &[crate::extensions::InstalledExtension]) {
        let trigger = format!("onLanguage:{}", lang);
        for ext in installed {
            if !ext.enabled {
                continue;
            }
            let rules = self.activation_rules.lock().await;
            if let Some(events) = rules.get(&ext.id) {
                if events.iter().any(|e| e == "*" || e == "onStartupFinished" || e == &trigger) {
                    drop(rules);
                    let _ = self.activate_if_needed(&ext.id, &ext.dir, &ext.manifest).await;
                }
            }
        }
    }

    pub async fn check_command_activation(&self, cmd: &str, installed: &[crate::extensions::InstalledExtension]) {
        let trigger = format!("onCommand:{}", cmd);
        for ext in installed {
            if !ext.enabled {
                continue;
            }
            let rules = self.activation_rules.lock().await;
            if let Some(events) = rules.get(&ext.id) {
                if events.iter().any(|e| e == "*" || e == &trigger) {
                    drop(rules);
                    let _ = self.activate_if_needed(&ext.id, &ext.dir, &ext.manifest).await;
                }
            }
        }
    }

    // --- JSON-RPC sending helpers ---

    pub async fn send_request(&self, method: &str, params: Value) -> Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();

        {
            let mut pending = self.pending_requests.lock().await;
            pending.insert(id, tx);
        }

        let msg = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        });

        self.write_message(&msg).await?;

        match tokio::time::timeout(std::time::Duration::from_secs(15), rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(anyhow!("Extension host dropped response")),
            Err(_) => {
                let mut pending = self.pending_requests.lock().await;
                pending.remove(&id);
                Err(anyhow!("Extension host request timed out for {}", method))
            }
        }
    }

    pub async fn send_notification(&self, method: &str, params: Value) -> Result<()> {
        let msg = json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params
        });
        self.write_message(&msg).await
    }

    pub async fn send_response(&self, id: u64, result: Option<Value>, error: Option<Value>) -> Result<()> {
        let msg = json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": result.unwrap_or(Value::Null),
            "error": error
        });
        self.write_message(&msg).await
    }

    async fn write_message(&self, msg: &Value) -> Result<()> {
        let body = serde_json::to_string(msg)?;
        let header = format!("Content-Length: {}\r\n\r\n", body.len());

        let mut stdin = self.stdin.lock().await;
        stdin.write_all(header.as_bytes()).await?;
        stdin.write_all(body.as_bytes()).await?;
        stdin.flush().await?;
        Ok(())
    }

    async fn handle_incoming_message(
        &self,
        msg: JsonRpcMessage,
        diagnostic_tx: &mpsc::Sender<PublishDiagnosticsParams>,
    ) {
        // 1. Response to pending request
        if let Some(id) = msg.id {
            if msg.method.is_none() {
                let mut pending = self.pending_requests.lock().await;
                if let Some(tx) = pending.remove(&id) {
                    if let Some(err) = msg.error {
                        let _ = tx.send(Err(anyhow!("RPC Error: {:?}", err)));
                    } else {
                        let _ = tx.send(Ok(msg.result.unwrap_or(Value::Null)));
                    }
                }
                return;
            }
        }

        // 2. Incoming notification/request from Extension Host
        if let Some(ref method) = msg.method {
            match method.as_str() {
                "languages/publishDiagnostics" => {
                    if let Some(ref params) = msg.params {
                        if let Ok(diag_params) = serde_json::from_value::<PublishDiagnosticsParams>(params.clone()) {
                            let _ = diagnostic_tx.send(diag_params).await;
                        }
                    }
                }
                "window/showMessage" => {
                    if let Some(ref params) = msg.params {
                        if let Some(io) = self.io.lock().await.as_ref() {
                            let mut data = params.clone();
                            if let Some(id) = msg.id {
                                if let Some(obj) = data.as_object_mut() {
                                    obj.insert("requestId".to_string(), json!(id.to_string()));
                                }
                            }
                            let _ = io.emit("ext:window:message", &data).await;
                        }
                    }
                }
                "window/showQuickPick" => {
                    if let Some(id) = msg.id {
                        if let Some(ref params) = msg.params {
                            if let Some(io) = self.io.lock().await.as_ref() {
                                let _ = io.emit("ext:window:quick_pick", &serde_json::json!({
                                    "requestId": id.to_string(),
                                    "items": params.get("items").unwrap_or(&Value::Null),
                                    "options": params.get("options").unwrap_or(&Value::Null),
                                })).await;
                            }
                        }
                    }
                }
                "window/showInputBox" => {
                    if let Some(id) = msg.id {
                        if let Some(ref params) = msg.params {
                            if let Some(io) = self.io.lock().await.as_ref() {
                                let _ = io.emit("ext:window:input_box", &serde_json::json!({
                                    "requestId": id.to_string(),
                                    "options": params.get("options").unwrap_or(&Value::Null),
                                })).await;
                            }
                        }
                    }
                }
                "window/setStatusBar" => {
                    if let Some(ref params) = msg.params {
                        if let Some(io) = self.io.lock().await.as_ref() {
                            let _ = io.emit("ext:statusbar:update", params).await;
                        }
                    }
                }
                "window/setDecorations" => {
                    if let Some(ref params) = msg.params {
                        if let Some(io) = self.io.lock().await.as_ref() {
                            let _ = io.emit("ext:decorations:set", params).await;
                        }
                    }
                }
                "window/createWebviewPanel" => {
                    if let Some(ref params) = msg.params {
                        if let Some(io) = self.io.lock().await.as_ref() {
                            let _ = io.emit("ext:webview:create", params).await;
                        }
                    }
                }
                "window/setWebviewHtml" => {
                    if let Some(ref params) = msg.params {
                        if let Some(io) = self.io.lock().await.as_ref() {
                            let _ = io.emit("ext:webview:setHtml", params).await;
                        }
                    }
                }
                "window/disposeWebviewPanel" => {
                    if let Some(ref params) = msg.params {
                        if let Some(io) = self.io.lock().await.as_ref() {
                            let _ = io.emit("ext:webview:dispose", params).await;
                        }
                    }
                }
                "window/postWebviewMessage" => {
                    let sent = if let Some(ref params) = msg.params {
                        if let Some(io) = self.io.lock().await.as_ref() {
                            io.emit("ext:webview:message", params).await.is_ok()
                        } else {
                            false
                        }
                    } else {
                        false
                    };
                    if let Some(id) = msg.id {
                        let _ = self.send_response(id, Some(serde_json::json!(sent)), None).await;
                        return;
                    }
                }
                "commands/executeCommand" => {
                    if let Some(id) = msg.id {
                        let _ = self.send_response(id, Some(Value::Null), None).await;
                        return;
                    }
                }
                _ => {
                    debug!("Unhandled extension host request/notification: {}", method);
                }
            }

            if let Some(id) = msg.id {
                let _ = self.send_response(id, Some(Value::Null), None).await;
            }
        }
    }

    // --- Provider APIs ---

    pub async fn did_open_text_document(&self, uri: &str, lang: &str, version: i32, text: &str) {
        let _ = self
            .send_notification(
                "textDocument/didOpen",
                json!({
                    "uri": uri,
                    "languageId": lang,
                    "version": version,
                    "text": text
                }),
            )
            .await;
    }

    pub async fn did_change_text_document(&self, uri: &str, version: i32, changes: Vec<Value>, full_text: Option<&str>) {
        let _ = self
            .send_notification(
                "textDocument/didChange",
                json!({
                    "uri": uri,
                    "version": version,
                    "changes": changes,
                    "fullText": full_text
                }),
            )
            .await;
    }

    pub async fn did_save_text_document(&self, uri: &str) {
        let _ = self
            .send_notification("textDocument/didSave", json!({ "uri": uri }))
            .await;
    }

    pub async fn did_close_text_document(&self, uri: &str) {
        let _ = self
            .send_notification("textDocument/didClose", json!({ "uri": uri }))
            .await;
    }

    pub async fn provide_completions(&self, uri: &str, line: usize, character: usize) -> Result<Vec<Value>> {
        let res = self
            .send_request(
                "textDocument/completion",
                json!({
                    "uri": uri,
                    "line": line,
                    "character": character
                }),
            )
            .await?;

        if let Value::Array(items) = res {
            Ok(items)
        } else {
            Ok(Vec::new())
        }
    }

    pub async fn provide_hover(&self, uri: &str, line: usize, character: usize) -> Result<Option<Value>> {
        let res = self
            .send_request(
                "textDocument/hover",
                json!({
                    "uri": uri,
                    "line": line,
                    "character": character
                }),
            )
            .await?;

        if res.is_null() {
            Ok(None)
        } else {
            Ok(Some(res))
        }
    }

    pub async fn provide_definition(&self, uri: &str, line: usize, character: usize) -> Result<Vec<Value>> {
        let res = self
            .send_request(
                "textDocument/definition",
                json!({
                    "uri": uri,
                    "line": line,
                    "character": character
                }),
            )
            .await?;

        if let Value::Array(items) = res {
            Ok(items)
        } else {
            Ok(Vec::new())
        }
    }

    pub async fn provide_formatting(&self, uri: &str, options: Value) -> Result<Vec<Value>> {
        let res = self
            .send_request(
                "textDocument/formatting",
                json!({
                    "uri": uri,
                    "options": options
                }),
            )
            .await?;

        if let Value::Array(items) = res {
            Ok(items)
        } else {
            Ok(Vec::new())
        }
    }

    pub async fn provide_code_actions(&self, uri: &str, range: Range, context: Option<Value>) -> Result<Vec<Value>> {
        let res = self
            .send_request(
                "textDocument/codeAction",
                json!({
                    "uri": uri,
                    "range": {
                        "start": { "line": range.start.line, "character": range.start.character },
                        "end": { "line": range.end.line, "character": range.end.character }
                    },
                    "context": context
                }),
            )
            .await?;

        if let Value::Array(items) = res {
            Ok(items)
        } else {
            Ok(Vec::new())
        }
    }

    pub async fn execute_command(&self, command: &str, args: Option<Value>) -> Result<Value> {
        let arg_array = match args {
            Some(Value::Array(arr)) => arr,
            Some(val) => vec![val],
            None => Vec::new(),
        };

        self.send_request(
            "commands/executeCommand",
            json!({
                "command": command,
                "args": arg_array
            }),
        )
        .await
    }
}

fn find_ext_host_bundle() -> Result<PathBuf> {
    if let Ok(env_path) = std::env::var("ANYCODE_EXT_HOST_PATH") {
        let p = PathBuf::from(env_path);
        if p.exists() {
            return Ok(p);
        }
    }

    // Check sibling packages
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let candidates = [
        manifest_dir.join("../anycode-ext-host/dist/ext-host.cjs"),
        manifest_dir.join("dist/ext-host.cjs"),
        manifest_dir.join("anycode-ext-host/dist/ext-host.cjs"),
        PathBuf::from("anycode-ext-host/dist/ext-host.cjs"),
    ];

    for c in &candidates {
        if c.exists() {
            return Ok(c.canonicalize().unwrap_or_else(|_| c.clone()));
        }
    }

    // Default fallback
    Ok(candidates[0].clone())
}

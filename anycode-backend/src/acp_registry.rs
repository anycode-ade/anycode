use anyhow::{Context, Result, anyhow};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use tracing::{info, warn};

pub const DEFAULT_REGISTRY_URL: &str =
    "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
pub const REFRESH_THROTTLE_DURATION: Duration = Duration::from_secs(3600); // 1 hour

// MARK: - Registry JSON Models

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpRegistryIndex {
    pub version: String,
    pub agents: Vec<AcpRegistryAgentEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpRegistryAgentEntry {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    #[serde(default)]
    pub repository: Option<String>,
    #[serde(default)]
    pub website: Option<String>,
    #[serde(default)]
    pub authors: Option<Vec<String>>,
    #[serde(default)]
    pub license: Option<String>,
    #[serde(default)]
    pub license_url: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    pub distribution: AcpRegistryDistribution,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpRegistryDistribution {
    #[serde(default)]
    pub npx: Option<AcpRegistryNpxDistribution>,
    #[serde(default)]
    pub binary: Option<HashMap<String, AcpRegistryBinaryTarget>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpRegistryNpxDistribution {
    pub package: String,
    #[serde(default)]
    pub args: Option<Vec<String>>,
    #[serde(default)]
    pub env: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpRegistryBinaryTarget {
    pub archive: String,
    pub cmd: String,
    #[serde(default)]
    pub args: Option<Vec<String>>,
    #[serde(default)]
    pub sha256: Option<String>,
    #[serde(default)]
    pub env: Option<HashMap<String, String>>,
}

// MARK: - Enriched Summary for UI & Presets

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpRegistryAgentSummary {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub repository: Option<String>,
    pub website: Option<String>,
    pub authors: Option<Vec<String>>,
    pub license: Option<String>,
    pub license_url: Option<String>,
    pub icon: Option<String>,
    pub distribution_type: String, // "npx" | "binary" | "both" | "unsupported"
    pub is_supported: bool,
    pub is_installed: bool,
    pub installed_version: Option<String>,
    pub installed_path: Option<String>,
    pub has_update: bool,
    pub npx: Option<AcpRegistryNpxDistribution>,
    pub binary_target: Option<AcpRegistryBinaryTarget>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolvedAgentPreset {
    pub id: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub description: Option<String>,
    pub env: Option<HashMap<String, String>>,
    pub icon: Option<String>,
    pub version: String,
    pub distribution_type: String,
}

// MARK: - Platform Detection

pub fn current_platform_key() -> &'static str {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    match (os, arch) {
        ("macos", "aarch64") => "darwin-aarch64",
        ("macos", "x86_64") => "darwin-x86_64",
        ("linux", "aarch64") => "linux-aarch64",
        ("linux", "x86_64") => "linux-x86_64",
        ("windows", "x86_64") => "windows-x86_64",
        ("windows", "aarch64") => "windows-aarch64",
        _ => "unknown",
    }
}

// MARK: - Manager

pub struct AcpRegistryManager {
    registry_url: String,
    cache_dir: PathBuf,
    bin_dir: PathBuf,
    cached_agents: Mutex<Vec<AcpRegistryAgentEntry>>,
    last_fetch_time: Mutex<Option<Instant>>,
    active_cancellations: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl AcpRegistryManager {
    pub fn new() -> Self {
        let cache_dir = dirs::cache_dir()
            .map(|c| c.join("anycode").join("acp-registry"))
            .unwrap_or_else(|| PathBuf::from(".anycode/cache"));

        let bin_dir = dirs::data_dir()
            .or_else(dirs::home_dir)
            .map(|h| h.join(".anycode").join("bin"))
            .unwrap_or_else(|| PathBuf::from(".anycode/bin"));

        let _ = std::fs::create_dir_all(&cache_dir);
        let _ = std::fs::create_dir_all(&bin_dir);

        let initial_agents = Self::load_cached_manifest_from_disk(&cache_dir).unwrap_or_default();

        Self {
            registry_url: DEFAULT_REGISTRY_URL.to_string(),
            cache_dir,
            bin_dir,
            cached_agents: Mutex::new(initial_agents),
            last_fetch_time: Mutex::new(None),
            active_cancellations: Mutex::new(HashMap::new()),
        }
    }

    pub fn bin_dir(&self) -> &Path {
        &self.bin_dir
    }

    pub fn agent_bin_dir(&self, agent_id: &str, version: &str) -> PathBuf {
        let clean_id = agent_id.replace('/', "_");
        let clean_ver = version.replace('/', "_");
        self.bin_dir.join(clean_id).join(clean_ver)
    }

    pub fn sanitize_cmd(cmd: &str) -> String {
        let trimmed = cmd.trim();
        if let Some(stripped) = trimmed.strip_prefix("./") {
            stripped.to_string()
        } else {
            trimmed.to_string()
        }
    }

    pub fn expected_executable_path(
        &self,
        agent_id: &str,
        version: &str,
        cmd: &str,
    ) -> PathBuf {
        let dir = self.agent_bin_dir(agent_id, version);
        let clean = Self::sanitize_cmd(cmd);
        dir.join(clean)
    }

    pub fn is_binary_installed(&self, agent_id: &str, version: &str, cmd: &str) -> bool {
        let path = self.expected_executable_path(agent_id, version, cmd);
        if path.is_file() {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Ok(meta) = path.metadata() {
                    return meta.permissions().mode() & 0o111 != 0;
                }
            }
            #[cfg(not(unix))]
            {
                return true;
            }
        }

        // Also check if executable exists anywhere in that agent/version directory
        let dir = self.agent_bin_dir(agent_id, version);
        if dir.is_dir() {
            let clean = Self::sanitize_cmd(cmd);
            let target_name = Path::new(&clean)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(&clean);
            if let Ok(found) = Self::find_executable_in_dir(&dir, target_name) {
                return found.is_some();
            }
        }
        false
    }

    pub fn find_installed_binary(
        &self,
        agent_id: &str,
        version: &str,
        cmd: &str,
    ) -> Option<PathBuf> {
        let path = self.expected_executable_path(agent_id, version, cmd);
        if path.is_file() {
            return Some(path);
        }

        let dir = self.agent_bin_dir(agent_id, version);
        if dir.is_dir() {
            let clean = Self::sanitize_cmd(cmd);
            let target_name = Path::new(&clean)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(&clean);
            if let Ok(Some(found)) = Self::find_executable_in_dir(&dir, target_name) {
                return Some(found);
            }
        }
        None
    }

    fn find_executable_in_dir(dir: &Path, file_name: &str) -> Result<Option<PathBuf>> {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_file() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if name == file_name {
                        return Ok(Some(path));
                    }
                }
            } else if path.is_dir() {
                if let Ok(Some(sub)) = Self::find_executable_in_dir(&path, file_name) {
                    return Ok(Some(sub));
                }
            }
        }
        Ok(None)
    }

    pub async fn fetch_agents(&self, force_refresh: bool) -> Result<Vec<AcpRegistryAgentEntry>> {
        let should_throttle = {
            let last_fetch = self.last_fetch_time.lock().await;
            let cached = self.cached_agents.lock().await;
            !force_refresh
                && !cached.is_empty()
                && last_fetch
                    .map(|t| t.elapsed() < REFRESH_THROTTLE_DURATION)
                    .unwrap_or(false)
        };

        if should_throttle {
            let cached = self.cached_agents.lock().await;
            return Ok(cached.clone());
        }

        match self.download_manifest().await {
            Ok(index) => {
                let mut cached = self.cached_agents.lock().await;
                *cached = index.agents.clone();
                let mut last = self.last_fetch_time.lock().await;
                *last = Some(Instant::now());
                let _ = self.save_manifest_to_disk(&index);
                Ok(index.agents)
            }
            Err(e) => {
                warn!("Failed to fetch ACP registry from CDN: {}. Falling back to cache.", e);
                let cached = self.cached_agents.lock().await;
                if !cached.is_empty() {
                    return Ok(cached.clone());
                }
                Err(e)
            }
        }
    }

    async fn download_manifest(&self) -> Result<AcpRegistryIndex> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .build()?;

        let resp = client.get(&self.registry_url).send().await?;
        if !resp.status().is_success() {
            return Err(anyhow!("HTTP error fetching ACP registry: {}", resp.status()));
        }

        let bytes = resp.bytes().await?;
        let index: AcpRegistryIndex = serde_json::from_slice(&bytes)
            .context("Failed to deserialize ACP registry index JSON")?;
        Ok(index)
    }

    fn load_cached_manifest_from_disk(cache_dir: &Path) -> Result<Vec<AcpRegistryAgentEntry>> {
        let manifest_path = cache_dir.join("registry.json");
        if !manifest_path.is_file() {
            return Ok(vec![]);
        }
        let bytes = std::fs::read(&manifest_path)?;
        let index: AcpRegistryIndex = serde_json::from_slice(&bytes)?;
        Ok(index.agents)
    }

    fn save_manifest_to_disk(&self, index: &AcpRegistryIndex) -> Result<()> {
        let manifest_path = self.cache_dir.join("registry.json");
        let json_str = serde_json::to_string_pretty(index)?;
        std::fs::write(&manifest_path, json_str)?;
        Ok(())
    }

    pub async fn list_agent_summaries(
        &self,
        force_refresh: bool,
    ) -> Result<Vec<AcpRegistryAgentSummary>> {
        let agents = self.fetch_agents(force_refresh).await?;
        let platform_key = current_platform_key();

        let mut summaries = Vec::with_capacity(agents.len());

        for agent in agents {
            let has_npx = agent.distribution.npx.is_some();
            let binary_target = agent
                .distribution
                .binary
                .as_ref()
                .and_then(|b| b.get(platform_key).cloned());
            let has_binary = binary_target.is_some();

            let distribution_type = match (has_npx, has_binary) {
                (true, true) => "both",
                (true, false) => "npx",
                (false, true) => "binary",
                (false, false) => "unsupported",
            }
            .to_string();

            let is_supported = has_npx || has_binary;

            let (is_installed, installed_version, installed_path) = if let Some(ref target) = binary_target {
                if let Some(path) = self.find_installed_binary(&agent.id, &agent.version, &target.cmd) {
                    (true, Some(agent.version.clone()), Some(path.to_string_lossy().to_string()))
                } else {
                    // Check if an older version is installed
                    let clean_id = agent.id.replace('/', "_");
                    let agent_base = self.bin_dir.join(&clean_id);
                    let mut found_old = None;
                    if agent_base.is_dir() {
                        if let Ok(entries) = std::fs::read_dir(&agent_base) {
                            for e in entries.flatten() {
                                if e.path().is_dir() {
                                    if let Some(v) = e.file_name().to_str() {
                                        if let Some(p) = self.find_installed_binary(&agent.id, v, &target.cmd) {
                                            found_old = Some((v.to_string(), p.to_string_lossy().to_string()));
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    if let Some((old_ver, old_path)) = found_old {
                        (true, Some(old_ver), Some(old_path))
                    } else {
                        (false, None, None)
                    }
                }
            } else {
                (false, None, None)
            };

            let has_update = if let Some(ref inst_ver) = installed_version {
                inst_ver != &agent.version
            } else {
                false
            };

            summaries.push(AcpRegistryAgentSummary {
                id: agent.id,
                name: agent.name,
                version: agent.version,
                description: agent.description,
                repository: agent.repository,
                website: agent.website,
                authors: agent.authors,
                license: agent.license,
                license_url: agent.license_url,
                icon: agent.icon,
                distribution_type,
                is_supported,
                is_installed,
                installed_version,
                installed_path,
                has_update,
                npx: agent.distribution.npx,
                binary_target,
            });
        }

        Ok(summaries)
    }

    pub async fn cancel_install(&self, agent_id: &str) -> bool {
        let mut map = self.active_cancellations.lock().await;
        if let Some(flag) = map.remove(agent_id) {
            flag.store(true, Ordering::SeqCst);
            return true;
        }
        false
    }

    pub async fn download_and_install_binary<F>(
        &self,
        agent: &AcpRegistryAgentEntry,
        progress_cb: F,
    ) -> Result<PathBuf>
    where
        F: Fn(f64) + Send + Sync + 'static,
    {
        let platform_key = current_platform_key();
        let target = agent
            .distribution
            .binary
            .as_ref()
            .and_then(|b| b.get(platform_key))
            .ok_or_else(|| anyhow!("No binary target available for current platform '{}'", platform_key))?;

        let cancel_flag = Arc::new(AtomicBool::new(false));
        {
            let mut map = self.active_cancellations.lock().await;
            map.insert(agent.id.clone(), cancel_flag.clone());
        }

        let target_dir = self.agent_bin_dir(&agent.id, &agent.version);
        let _ = std::fs::create_dir_all(&target_dir);

        let temp_archive_path = std::env::temp_dir().join(format!(
            "anycode_{}_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos(),
            Path::new(&target.archive)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("archive")
        ));

        let progress_cb = Arc::new(progress_cb);
        let cb_clone = progress_cb.clone();
        let res = self
            .download_file_with_progress(
                &target.archive,
                &temp_archive_path,
                cancel_flag.clone(),
                move |p| {
                    cb_clone(p * 0.85);
                },
            )
            .await;

        if let Err(e) = res {
            let _ = std::fs::remove_file(&temp_archive_path);
            let mut map = self.active_cancellations.lock().await;
            map.remove(&agent.id);
            return Err(e);
        }

        if cancel_flag.load(Ordering::SeqCst) {
            let _ = std::fs::remove_file(&temp_archive_path);
            let mut map = self.active_cancellations.lock().await;
            map.remove(&agent.id);
            return Err(anyhow!("Download cancelled"));
        }

        progress_cb(0.88);

        // Verify SHA256 if present
        if let Some(expected_sha) = &target.sha256 {
            let expected = expected_sha.trim().to_lowercase();
            if !expected.is_empty() {
                let file_bytes = std::fs::read(&temp_archive_path)?;
                let mut hasher = Sha256::new();
                hasher.update(&file_bytes);
                let actual = format!("{:x}", hasher.finalize()).to_lowercase();
                if actual != expected {
                    let _ = std::fs::remove_file(&temp_archive_path);
                    let mut map = self.active_cancellations.lock().await;
                    map.remove(&agent.id);
                    return Err(anyhow!(
                        "SHA256 checksum mismatch. Expected: {}, Actual: {}",
                        expected,
                        actual
                    ));
                }
            }
        }

        progress_cb(0.92);

        // Extract
        let archive_lower = target.archive.to_lowercase();
        let extract_result = if archive_lower.ends_with(".tar.gz") || archive_lower.ends_with(".tgz") {
            Self::extract_tar_gz(&temp_archive_path, &target_dir)
        } else if archive_lower.ends_with(".zip") {
            Self::extract_zip(&temp_archive_path, &target_dir)
        } else {
            // Raw binary executable
            let clean = Self::sanitize_cmd(&target.cmd);
            let dest = target_dir.join(clean);
            let _ = std::fs::remove_file(&dest);
            std::fs::copy(&temp_archive_path, &dest).map(|_| ()).context("Failed to copy binary")
        };

        let _ = std::fs::remove_file(&temp_archive_path);
        {
            let mut map = self.active_cancellations.lock().await;
            map.remove(&agent.id);
        }

        extract_result?;

        // Locate executable and mark chmod +x
        let clean = Self::sanitize_cmd(&target.cmd);
        let target_name = Path::new(&clean)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&clean);

        let final_path = if let Some(found) = Self::find_executable_in_dir(&target_dir, target_name)? {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&found, std::fs::Permissions::from_mode(0o755));
            }
            found
        } else {
            return Err(anyhow!(
                "Executable '{}' not found in unpacked directory '{:?}'",
                target.cmd,
                target_dir
            ));
        };

        progress_cb(1.0);
        info!("Installed ACP agent binary: {:?}", final_path);
        Ok(final_path)
    }

    async fn download_file_with_progress<F>(
        &self,
        url: &str,
        dest: &Path,
        cancel_flag: Arc<AtomicBool>,
        progress_cb: F,
    ) -> Result<()>
    where
        F: Fn(f64) + Send + Sync + 'static,
    {
        use tokio::io::AsyncWriteExt;

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(300))
            .build()?;

        let resp = client.get(url).send().await?;
        if !resp.status().is_success() {
            return Err(anyhow!("Download failed with HTTP {}", resp.status()));
        }

        let total_size = resp.content_length().unwrap_or(0);
        let mut stream = resp.bytes_stream();
        let mut file = tokio::fs::File::create(dest).await?;
        let mut downloaded: u64 = 0;

        while let Some(chunk_res) = stream.next().await {
            if cancel_flag.load(Ordering::SeqCst) {
                return Err(anyhow!("Download cancelled"));
            }

            let chunk = chunk_res?;
            file.write_all(&chunk).await?;
            downloaded += chunk.len() as u64;

            if total_size > 0 {
                let p = downloaded as f64 / total_size as f64;
                progress_cb(p.min(1.0));
            }
        }

        file.flush().await?;
        Ok(())
    }

    fn extract_tar_gz(archive_path: &Path, dest_dir: &Path) -> Result<()> {
        let file = std::fs::File::open(archive_path)?;
        let gz = flate2::read::GzDecoder::new(file);
        let mut tar_archive = tar::Archive::new(gz);
        tar_archive.unpack(dest_dir).context("Failed to unpack tar.gz archive")?;
        Ok(())
    }

    fn extract_zip(archive_path: &Path, dest_dir: &Path) -> Result<()> {
        let file = std::fs::File::open(archive_path)?;
        let mut zip_archive = zip::ZipArchive::new(file).context("Failed to read zip archive")?;
        zip_archive.extract(dest_dir).context("Failed to unpack zip archive")?;
        Ok(())
    }

    pub fn uninstall_agent(&self, agent_id: &str) -> Result<()> {
        let clean_id = agent_id.replace('/', "_");
        let dir = self.bin_dir.join(clean_id);
        if dir.exists() {
            std::fs::remove_dir_all(&dir).context("Failed to remove agent directory")?;
        }
        Ok(())
    }

    pub fn to_agent_preset(
        entry: &AcpRegistryAgentEntry,
        binary_installed_path: Option<String>,
    ) -> ResolvedAgentPreset {
        let platform_key = current_platform_key();
        let target = entry
            .distribution
            .binary
            .as_ref()
            .and_then(|b| b.get(platform_key));

        let (command, args, env, dist_type) = if let Some(bin_path) = binary_installed_path {
            let target_args = target.and_then(|t| t.args.clone()).unwrap_or_default();
            let target_env = target.and_then(|t| t.env.clone());
            (bin_path, target_args, target_env, "binary".to_string())
        } else if let Some(ref npx) = entry.distribution.npx {
            let mut combined = vec!["-y".to_string(), npx.package.clone()];
            if let Some(extra) = &npx.args {
                combined.extend(extra.clone());
            }
            ("npx".to_string(), combined, npx.env.clone(), "npx".to_string())
        } else if let Some(t) = target {
            (
                t.cmd.clone(),
                t.args.clone().unwrap_or_default(),
                t.env.clone(),
                "binary".to_string(),
            )
        } else {
            (entry.id.clone(), vec![], None, "unknown".to_string())
        };

        ResolvedAgentPreset {
            id: entry.id.clone(),
            name: entry.name.clone(),
            command,
            args,
            description: Some(entry.description.clone()),
            env,
            icon: entry.icon.clone(),
            version: entry.version.clone(),
            distribution_type: dist_type,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_platform_key_valid() {
        let key = current_platform_key();
        assert!(
            key == "darwin-aarch64"
                || key == "darwin-x86_64"
                || key == "linux-aarch64"
                || key == "linux-x86_64"
                || key == "windows-x86_64"
                || key == "windows-aarch64"
        );
    }

    #[test]
    fn test_deserialize_registry_entry() {
        let sample = r#"{
            "id": "test-agent",
            "name": "Test Agent",
            "version": "1.0.0",
            "description": "Test description",
            "distribution": {
                "npx": {
                    "package": "@test/agent",
                    "args": ["--acp"]
                }
            }
        }"#;

        let entry: AcpRegistryAgentEntry = serde_json::from_str(sample).unwrap();
        assert_eq!(entry.id, "test-agent");
        assert_eq!(entry.name, "Test Agent");
        assert!(entry.distribution.npx.is_some());

        let preset = AcpRegistryManager::to_agent_preset(&entry, None);
        assert_eq!(preset.command, "npx");
        assert_eq!(preset.args, vec!["-y", "@test/agent", "--acp"]);
    }
}


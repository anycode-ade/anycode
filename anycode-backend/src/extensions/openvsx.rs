use anyhow::{Context, Result, anyhow};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;
use tokio::io::AsyncWriteExt;

pub const OPENVSX_API_URL: &str = "https://open-vsx.org/api";

pub fn current_target_platform() -> &'static str {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => "darwin-arm64",
        ("macos", "x86_64") => "darwin-x64",
        ("linux", "x86_64") => "linux-x64",
        ("linux", "aarch64") => "linux-arm64",
        ("windows", "x86_64") => "win32-x64",
        ("windows", "aarch64") => "win32-arm64",
        _ => "universal",
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenVsxSearchResult {
    pub offset: usize,
    pub total_size: usize,
    pub extensions: Vec<OpenVsxExtensionEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenVsxExtensionEntry {
    #[serde(default)]
    pub url: Option<String>,
    pub name: String,
    pub namespace: String,
    pub version: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub files: Option<OpenVsxFiles>,
    #[serde(default)]
    pub download_count: Option<u64>,
    #[serde(default)]
    pub average_rating: Option<f64>,
    #[serde(default)]
    pub review_count: Option<u64>,
}

impl OpenVsxExtensionEntry {
    pub fn id(&self) -> String {
        format!("{}.{}", self.namespace, self.name)
    }

    pub fn download_url(&self) -> Option<String> {
        self.files.as_ref().and_then(|f| f.download.clone()).or_else(|| {
            Some(format!(
                "{}/{}/{}/{}/file/{}.{}-{}.vsix",
                OPENVSX_API_URL, self.namespace, self.name, self.version, self.namespace, self.name, self.version
            ))
        })
    }

    pub fn icon_url(&self) -> Option<String> {
        self.files.as_ref().and_then(|f| f.icon.clone())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OpenVsxFiles {
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub download: Option<String>,
    #[serde(default)]
    pub manifest: Option<String>,
    #[serde(default)]
    pub readme: Option<String>,
    #[serde(default)]
    pub changelog: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenVsxExtensionDetail {
    pub name: String,
    pub namespace: String,
    pub version: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub files: Option<OpenVsxFiles>,
    #[serde(default)]
    pub download_count: Option<u64>,
    #[serde(default)]
    pub all_versions: Option<HashMap<String, String>>,
    #[serde(default)]
    pub published_date: Option<String>,
    #[serde(default)]
    pub license: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(default)]
    pub repository: Option<String>,
    #[serde(default)]
    pub downloads: Option<HashMap<String, String>>,
}

impl OpenVsxExtensionDetail {
    pub fn best_download_url(&self) -> Option<String> {
        let target = current_target_platform();
        if let Some(ref downloads) = self.downloads {
            if let Some(url) = downloads.get(target) {
                return Some(url.clone());
            }
            if target == "darwin-arm64" {
                if let Some(url) = downloads.get("darwin-x64") {
                    return Some(url.clone());
                }
            }
            if let Some(url) = downloads.get("universal") {
                return Some(url.clone());
            }
        }

        if let Some(ref files) = self.files {
            if let Some(ref dl) = files.download {
                return Some(dl.clone());
            }
        }

        if let Some(ref downloads) = self.downloads {
            if let Some(url) = downloads.values().next() {
                return Some(url.clone());
            }
        }

        None
    }
}

pub struct OpenVsxClient {
    client: reqwest::Client,
    download_client: reqwest::Client,
    base_url: String,
}

impl Default for OpenVsxClient {
    fn default() -> Self {
        Self::new()
    }
}

impl OpenVsxClient {
    pub fn new() -> Self {
        Self::with_base_url(OPENVSX_API_URL.to_string())
    }

    pub fn with_base_url(base_url: String) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent("Anycode-IDE/1.0")
            .build()
            .unwrap_or_default();

        let download_client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(30))
            .timeout(Duration::from_secs(900)) // 15 mins for large multi-hundred-megabyte VSIX packages
            .user_agent("Anycode-IDE/1.0")
            .build()
            .unwrap_or_default();

        Self {
            client,
            download_client,
            base_url,
        }
    }

    pub async fn search(
        &self,
        query: &str,
        offset: usize,
        size: usize,
    ) -> Result<OpenVsxSearchResult> {
        let url = format!(
            "{}/-/search?query={}&offset={}&size={}",
            self.base_url,
            urlencoding_encode(query),
            offset,
            size
        );

        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .context("Failed to request Open VSX search")?;

        if !resp.status().is_success() {
            return Err(anyhow!("Open VSX search returned status {}", resp.status()));
        }

        let result = resp
            .json::<OpenVsxSearchResult>()
            .await
            .context("Failed to parse Open VSX search response")?;

        Ok(result)
    }

    pub async fn get_extension(
        &self,
        namespace: &str,
        name: &str,
        version: Option<&str>,
    ) -> Result<OpenVsxExtensionDetail> {
        let url = match version {
            Some(v) => format!("{}/{}/{}/{}", self.base_url, namespace, name, v),
            None => format!("{}/{}/{}", self.base_url, namespace, name),
        };

        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .context("Failed to request Open VSX extension detail")?;

        if !resp.status().is_success() {
            return Err(anyhow!(
                "Open VSX extension detail returned status {}",
                resp.status()
            ));
        }

        let detail = resp
            .json::<OpenVsxExtensionDetail>()
            .await
            .context("Failed to parse Open VSX extension detail")?;

        Ok(detail)
    }

    pub async fn download_vsix_to_file(&self, download_url: &str, dest_path: &Path) -> Result<()> {
        let resp = self
            .download_client
            .get(download_url)
            .send()
            .await
            .context("Failed to download VSIX file")?;

        if !resp.status().is_success() {
            return Err(anyhow!("Failed to download VSIX: HTTP {}", resp.status()));
        }

        let total_size = resp.content_length();
        let mut file = tokio::fs::File::create(dest_path)
            .await
            .with_context(|| format!("Failed to create temporary VSIX file at {:?}", dest_path))?;

        let mut stream = resp.bytes_stream();
        let mut downloaded: u64 = 0;
        let mut last_log = std::time::Instant::now();

        while let Some(chunk_res) = stream.next().await {
            let chunk = chunk_res.context("Failed while reading VSIX download stream")?;
            file.write_all(&chunk)
                .await
                .context("Failed to write VSIX chunk to file")?;
            downloaded += chunk.len() as u64;

            if last_log.elapsed() >= Duration::from_secs(3) {
                if let Some(total) = total_size {
                    tracing::info!(
                        "Downloading VSIX: {} / {} MB ({:.1}%)",
                        downloaded / (1024 * 1024),
                        total / (1024 * 1024),
                        (downloaded as f64 / total as f64) * 100.0
                    );
                } else {
                    tracing::info!("Downloading VSIX: {} MB", downloaded / (1024 * 1024));
                }
                last_log = std::time::Instant::now();
            }
        }

        file.flush().await.context("Failed to flush VSIX file")?;
        Ok(())
    }

    pub async fn download_vsix(&self, download_url: &str) -> Result<Vec<u8>> {
        let resp = self
            .download_client
            .get(download_url)
            .send()
            .await
            .context("Failed to download VSIX file")?;

        if !resp.status().is_success() {
            return Err(anyhow!("Failed to download VSIX: HTTP {}", resp.status()));
        }

        let bytes = resp.bytes().await.context("Failed to read VSIX bytes")?;
        Ok(bytes.to_vec())
    }
}

fn urlencoding_encode(input: &str) -> String {
    let mut encoded = String::new();
    for byte in input.bytes() {
        if byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_' || byte == b'.' || byte == b'~' {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{:02X}", byte));
        }
    }
    encoded
}

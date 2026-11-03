use anyhow::{Context, Result, anyhow, bail};
use serde::Deserialize;
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};

const DEFAULT_REPO: &str = "anycode-ade/anycode";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateOptions {
    pub repo: String,
    pub target_tag: Option<String>,
    pub check_only: bool,
}

impl Default for UpdateOptions {
    fn default() -> Self {
        Self {
            repo: std::env::var("ANYCODE_REPO").unwrap_or_else(|_| DEFAULT_REPO.to_string()),
            target_tag: None,
            check_only: false,
        }
    }
}

#[derive(Deserialize)]
struct GithubRelease {
    tag_name: String,
}

pub fn normalize_target_tag(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed == "latest" || trimmed == "nightly" || trimmed.starts_with("commit-") || trimmed.starts_with('v') {
        return trimmed.to_string();
    }
    if (7..=40).contains(&trimmed.len()) && trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
        return format!("commit-{}", &trimmed[..7]);
    }
    if trimmed.chars().next().is_some_and(|c| c.is_ascii_digit()) {
        return format!("v{trimmed}");
    }
    trimmed.to_string()
}

pub fn platform_asset_name() -> Result<&'static str> {
    if cfg!(target_os = "macos") {
        Ok("anycode-universal-apple-darwin.tar.gz")
    } else if cfg!(target_os = "linux") {
        if cfg!(target_arch = "x86_64") {
            Ok("anycode-linux-x86_64-musl.tar.gz")
        } else if cfg!(target_arch = "aarch64") {
            Ok("anycode-linux-aarch64-musl.tar.gz")
        } else {
            bail!("Unsupported Linux architecture for self-update")
        }
    } else if cfg!(target_os = "windows") {
        Ok("anycode-windows-x86_64.zip")
    } else {
        bail!("Unsupported operating system for self-update")
    }
}

async fn fetch_latest_tag(client: &reqwest::Client, repo: &str) -> Result<String> {
    let url = format!("https://api.github.com/repos/{repo}/releases/latest");
    let resp = client
        .get(&url)
        .header("User-Agent", format!("anycode/{}", env!("CARGO_PKG_VERSION")))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .with_context(|| format!("Failed to query latest release from {url}"))?;

    if !resp.status().is_success() {
        bail!("GitHub API returned status {} when checking latest release", resp.status());
    }

    let release: GithubRelease = resp
        .json()
        .await
        .context("Failed to parse GitHub release metadata")?;
    Ok(release.tag_name)
}

pub async fn run_self_update(opts: UpdateOptions) -> Result<()> {
    let current_version = env!("CARGO_PKG_VERSION");
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .context("Failed to initialize HTTP client")?;

    let resolved_tag = match opts.target_tag.as_deref() {
        Some("latest") | None => fetch_latest_tag(&client, &opts.repo).await?,
        Some(tag) => normalize_target_tag(tag),
    };

    let clean_target_version = resolved_tag.strip_prefix('v').unwrap_or(&resolved_tag);

    if opts.target_tag.is_none() && clean_target_version == current_version {
        println!("anycode is already up to date (v{current_version}).");
        return Ok(());
    }

    if opts.check_only {
        if clean_target_version == current_version {
            println!("anycode is up to date (v{current_version}).");
        } else {
            println!("Update available: v{current_version} -> {resolved_tag}");
            println!("Run `anycode update` to install.");
        }
        return Ok(());
    }

    let asset = platform_asset_name()?;
    let download_url = format!(
        "https://github.com/{}/releases/download/{}/{}",
        opts.repo, resolved_tag, asset
    );

    println!("Updating anycode (v{current_version} -> {resolved_tag})...");
    println!("Downloading {download_url}");

    let resp = client
        .get(&download_url)
        .header("User-Agent", format!("anycode/{current_version}"))
        .send()
        .await
        .with_context(|| format!("Failed to download {download_url}"))?;

    if !resp.status().is_success() {
        bail!(
            "Failed to download release archive from {download_url} (HTTP {})",
            resp.status()
        );
    }

    let bytes = resp
        .bytes()
        .await
        .context("Failed to read release archive bytes")?;

    let binary_bytes = extract_binary_from_archive(&bytes, asset)?;
    let exe_path = std::env::current_exe().context("Failed to determine current executable path")?;
    let exe_path = fs::canonicalize(&exe_path).unwrap_or(exe_path);

    replace_executable(&exe_path, &binary_bytes)?;

    println!(
        "Successfully updated anycode to {} at {}",
        resolved_tag,
        exe_path.display()
    );
    Ok(())
}

fn extract_binary_from_archive(archive_bytes: &[u8], asset_name: &str) -> Result<Vec<u8>> {
    if asset_name.ends_with(".tar.gz") {
        let gz = flate2::read::GzDecoder::new(Cursor::new(archive_bytes));
        let mut archive = tar::Archive::new(gz);
        for entry in archive.entries().context("Failed to read tar archive")? {
            let mut entry = entry.context("Invalid tar entry")?;
            let path = entry.path().context("Invalid tar entry path")?;
            if path.file_name().and_then(|n| n.to_str()) == Some("anycode") {
                let mut buf = Vec::new();
                entry
                    .read_to_end(&mut buf)
                    .context("Failed to extract anycode binary from tar.gz")?;
                return Ok(buf);
            }
        }
        bail!("Archive {asset_name} did not contain `anycode` binary");
    } else if asset_name.ends_with(".zip") {
        let mut zip = zip::ZipArchive::new(Cursor::new(archive_bytes))
            .context("Failed to open zip archive")?;
        for i in 0..zip.len() {
            let mut file = zip.by_index(i).context("Invalid zip entry")?;
            let name = file.name().to_string();
            if name.ends_with("anycode.exe") || name == "anycode" {
                let mut buf = Vec::new();
                file.read_to_end(&mut buf)
                    .context("Failed to extract anycode.exe from zip")?;
                return Ok(buf);
            }
        }
        bail!("Archive {asset_name} did not contain `anycode.exe` binary");
    } else {
        bail!("Unsupported archive format: {asset_name}");
    }
}

fn replace_executable(exe_path: &Path, new_binary: &[u8]) -> Result<()> {
    let parent_dir: PathBuf = exe_path
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| anyhow!("Executable path has no parent directory: {}", exe_path.display()))?;

    let file_name = exe_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("anycode");

    let staging_path = parent_dir.join(format!(".{file_name}.update.tmp"));

    if let Err(err) = fs::write(&staging_path, new_binary) {
        if err.kind() == std::io::ErrorKind::PermissionDenied {
            bail!(
                "Permission denied writing to {}. Try running with sudo:\n  sudo anycode update",
                parent_dir.display()
            );
        }
        return Err(err).with_context(|| format!("Failed to write temporary binary to {}", staging_path.display()));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = fs::Permissions::from_mode(0o755);
        let _ = fs::set_permissions(&staging_path, perms);
    }

    #[cfg(windows)]
    {
        let backup_path = parent_dir.join(format!("{file_name}.old"));
        let _ = fs::remove_file(&backup_path);
        if let Err(err) = fs::rename(exe_path, &backup_path) {
            let _ = fs::remove_file(&staging_path);
            return Err(err).with_context(|| format!("Failed to move running executable {}", exe_path.display()));
        }
        if let Err(err) = fs::rename(&staging_path, exe_path) {
            let _ = fs::rename(&backup_path, exe_path);
            return Err(err).with_context(|| format!("Failed to replace executable {}", exe_path.display()));
        }
        return Ok(());
    }

    #[cfg(not(windows))]
    {
        if let Err(err) = fs::rename(&staging_path, exe_path) {
            let _ = fs::remove_file(&staging_path);
            if err.kind() == std::io::ErrorKind::PermissionDenied {
                bail!(
                    "Permission denied replacing {}. Try running with sudo:\n  sudo anycode update",
                    exe_path.display()
                );
            }
            return Err(err).with_context(|| format!("Failed to replace executable {}", exe_path.display()));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_target_tags() {
        assert_eq!(normalize_target_tag("latest"), "latest");
        assert_eq!(normalize_target_tag("nightly"), "nightly");
        assert_eq!(normalize_target_tag("v0.3.3"), "v0.3.3");
        assert_eq!(normalize_target_tag("0.3.3"), "v0.3.3");
        assert_eq!(normalize_target_tag("9c4370d"), "commit-9c4370d");
        assert_eq!(
            normalize_target_tag("9c4370d1234567890abcdef"),
            "commit-9c4370d"
        );
        assert_eq!(normalize_target_tag("commit-9c4370d"), "commit-9c4370d");
    }
}

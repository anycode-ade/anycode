use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{Cursor, Read, Seek};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::{info, warn};

use super::jsonc::strip_jsonc_comments;
use super::manifest::VsCodeManifest;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledExtension {
    pub id: String,
    pub manifest: VsCodeManifest,
    pub dir: PathBuf,
    pub enabled: bool,
    pub version: String,
    pub readme: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ExtensionStorageState {
    pub extensions: HashMap<String, ExtensionStateEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionStateEntry {
    pub id: String,
    pub version: String,
    pub enabled: bool,
    pub installed_dir: String,
    pub install_time: u64,
}

#[derive(Clone)]
pub struct ExtensionStorage {
    pub root_dir: PathBuf,
}

impl ExtensionStorage {
    pub fn new(custom_root: Option<PathBuf>) -> Self {
        let root_dir = custom_root
            .or_else(|| std::env::var("ANYCODE_EXTENSIONS_DIR").ok().map(PathBuf::from))
            .or_else(|| {
                dirs::data_dir()
                    .or_else(dirs::home_dir)
                    .map(|h| h.join(".anycode").join("extensions"))
            })
            .unwrap_or_else(|| PathBuf::from(".anycode/extensions"));

        let _ = fs::create_dir_all(&root_dir);

        Self { root_dir }
    }

    fn state_file(&self) -> PathBuf {
        self.root_dir.join("state.json")
    }

    pub fn load_state(&self) -> ExtensionStorageState {
        let path = self.state_file();
        if path.exists() {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(state) = serde_json::from_str::<ExtensionStorageState>(&content) {
                    return state;
                }
            }
        }
        ExtensionStorageState::default()
    }

    pub fn save_state(&self, state: &ExtensionStorageState) -> Result<()> {
        let path = self.state_file();
        let content = serde_json::to_string_pretty(state)?;
        fs::write(path, content)?;
        Ok(())
    }

    pub fn load_installed(&self) -> Result<Vec<InstalledExtension>> {
        let state = self.load_state();
        let mut result = Vec::new();

        // Also scan directories in root_dir in case some were manually placed
        let known_dirs: HashMap<String, ExtensionStateEntry> = state.extensions;

        if let Ok(entries) = fs::read_dir(&self.root_dir) {
            for entry in entries.filter_map(Result::ok) {
                let dir_path = entry.path();
                if !dir_path.is_dir() {
                    continue;
                }
                let pkg_json_path = dir_path.join("package.json");
                if !pkg_json_path.exists() {
                    continue;
                }

                if let Ok(manifest) = Self::read_manifest(&pkg_json_path) {
                    let ext_id = manifest.extension_id();
                    let enabled = known_dirs
                        .get(&ext_id)
                        .map(|s| s.enabled)
                        .unwrap_or(true);

                    let readme = dir_path
                        .join("README.md")
                        .exists()
                        .then(|| fs::read_to_string(dir_path.join("README.md")).ok())
                        .flatten();

                    result.push(InstalledExtension {
                        id: ext_id.clone(),
                        manifest,
                        dir: dir_path.clone(),
                        enabled,
                        version: known_dirs
                            .get(&ext_id)
                            .map(|s| s.version.clone())
                            .unwrap_or_default(),
                        readme,
                    });
                }
            }
        }

        // Sort by id
        result.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(result)
    }

    pub fn read_manifest(pkg_path: &Path) -> Result<VsCodeManifest> {
        let content = fs::read_to_string(pkg_path)
            .with_context(|| format!("Failed to read manifest at {:?}", pkg_path))?;
        let stripped = strip_jsonc_comments(&content);
        let mut manifest: VsCodeManifest = serde_json::from_str(&stripped)
            .with_context(|| format!("Failed to parse manifest at {:?}", pkg_path))?;

        if let Some(parent) = pkg_path.parent() {
            let nls_path = parent.join("package.nls.json");
            if nls_path.exists() {
                if let Ok(nls_content) = fs::read_to_string(&nls_path) {
                    if let Ok(nls_map) = serde_json::from_str::<HashMap<String, String>>(&strip_jsonc_comments(&nls_content)) {
                        Self::localize_manifest(&mut manifest, &nls_map);
                    }
                }
            }
        }

        Ok(manifest)
    }

    fn localize_json_value(val: &mut serde_json::Value, nls_map: &HashMap<String, String>) {
        match val {
            serde_json::Value::String(s) => {
                if s.starts_with('%') && s.ends_with('%') && s.len() > 2 {
                    let key = &s[1..s.len() - 1];
                    if let Some(localized) = nls_map.get(key) {
                        *s = localized.clone();
                    }
                }
            }
            serde_json::Value::Array(arr) => {
                for item in arr {
                    Self::localize_json_value(item, nls_map);
                }
            }
            serde_json::Value::Object(map) => {
                for (_, item) in map {
                    Self::localize_json_value(item, nls_map);
                }
            }
            _ => {}
        }
    }

    pub fn localize_manifest(manifest: &mut VsCodeManifest, nls_map: &HashMap<String, String>) {
        if let Some(ref name) = manifest.display_name {
            if name.starts_with('%') && name.ends_with('%') {
                let key = &name[1..name.len() - 1];
                if let Some(val) = nls_map.get(key) {
                    manifest.display_name = Some(val.clone());
                }
            }
        }
        if let Some(ref desc) = manifest.description {
            if desc.starts_with('%') && desc.ends_with('%') {
                let key = &desc[1..desc.len() - 1];
                if let Some(val) = nls_map.get(key) {
                    manifest.description = Some(val.clone());
                }
            }
        }
        if let Some(ref mut contrib) = manifest.contributes {
            if let Some(ref mut vc) = contrib.views_containers {
                Self::localize_json_value(vc, nls_map);
            }
            if let Some(ref mut v) = contrib.views {
                Self::localize_json_value(v, nls_map);
            }
            for cmd in &mut contrib.commands {
                if cmd.title.starts_with('%') && cmd.title.ends_with('%') {
                    let key = &cmd.title[1..cmd.title.len() - 1];
                    if let Some(val) = nls_map.get(key) {
                        cmd.title = val.clone();
                    }
                }
                if let Some(ref cat) = cmd.category {
                    if cat.starts_with('%') && cat.ends_with('%') {
                        let key = &cat[1..cat.len() - 1];
                        if let Some(val) = nls_map.get(key) {
                            cmd.category = Some(val.clone());
                        }
                    }
                }
            }
        }
    }

    pub fn install_from_vsix_bytes(
        &self,
        bytes: &[u8],
        expected_id: Option<&str>,
    ) -> Result<InstalledExtension> {
        let cursor = Cursor::new(bytes);
        let archive =
            zip::ZipArchive::new(cursor).context("Invalid VSIX file (failed to read zip archive)")?;
        self.install_from_archive(archive, expected_id)
    }

    pub fn install_from_path(&self, vsix_path: &Path) -> Result<InstalledExtension> {
        let file = fs::File::open(vsix_path)
            .with_context(|| format!("Failed to open VSIX file at {:?}", vsix_path))?;
        let archive =
            zip::ZipArchive::new(file).context("Invalid VSIX file (failed to read zip archive)")?;
        self.install_from_archive(archive, None)
    }

    pub fn install_from_archive<R: Read + Seek>(
        &self,
        mut archive: zip::ZipArchive<R>,
        expected_id: Option<&str>,
    ) -> Result<InstalledExtension> {
        // 1. Scan for package.json inside zip to determine extension metadata
        let mut pkg_json_bytes = None;
        let mut has_extension_prefix = false;

        for i in 0..archive.len() {
            let file = archive.by_index(i)?;
            let name = file.name();
            if name == "extension/package.json" {
                has_extension_prefix = true;
                let mut content = Vec::new();
                let mut f = file;
                f.read_to_end(&mut content)?;
                pkg_json_bytes = Some(content);
                break;
            } else if name == "package.json" {
                let mut content = Vec::new();
                let mut f = file;
                f.read_to_end(&mut content)?;
                pkg_json_bytes = Some(content);
                break;
            }
        }

        let pkg_content = pkg_json_bytes.ok_or_else(|| {
            anyhow!("package.json not found in VSIX archive (checked extension/package.json and package.json)")
        })?;

        let pkg_str = String::from_utf8(pkg_content)?;
        let stripped = strip_jsonc_comments(&pkg_str);
        let mut manifest: VsCodeManifest = serde_json::from_str(&stripped)
            .context("Failed to parse package.json from VSIX")?;

        let ext_id = manifest.extension_id();
        if let Some(exp) = expected_id {
            if !exp.eq_ignore_ascii_case(&ext_id) {
                warn!(
                    "Extension ID mismatch: expected {}, found {}",
                    exp, ext_id
                );
            }
        }

        let version = manifest.version.clone();
        let target_dir_name = format!("{}-{}", ext_id, version);
        let target_dir = self.root_dir.join(&target_dir_name);

        // If target directory already exists, clear it for clean reinstall
        if target_dir.exists() {
            let _ = fs::remove_dir_all(&target_dir);
        }
        fs::create_dir_all(&target_dir)?;

        // 2. Extract archive contents to target_dir
        for i in 0..archive.len() {
            let mut file = archive.by_index(i)?;
            let file_name = file.name().to_string();

            let rel_path = if has_extension_prefix {
                if !file_name.starts_with("extension/") {
                    continue;
                }
                file_name.trim_start_matches("extension/").to_string()
            } else {
                file_name
            };

            if rel_path.is_empty() {
                continue;
            }

            // Path traversal check
            let path = Path::new(&rel_path);
            if path.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
                continue;
            }

            let outpath = target_dir.join(path);

            if file.is_dir() {
                fs::create_dir_all(&outpath)?;
            } else {
                if let Some(p) = outpath.parent() {
                    if !p.exists() {
                        fs::create_dir_all(p)?;
                    }
                }
                let mut outfile = fs::File::create(&outpath)?;
                std::io::copy(&mut file, &mut outfile)?;

                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    if let Some(mode) = file.unix_mode() {
                        let _ = fs::set_permissions(&outpath, fs::Permissions::from_mode(mode));
                    }
                }
            }
        }

        // 3. Update state.json
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let nls_path = target_dir.join("package.nls.json");
        if nls_path.exists() {
            if let Ok(nls_content) = fs::read_to_string(&nls_path) {
                if let Ok(nls_map) = serde_json::from_str::<HashMap<String, String>>(&strip_jsonc_comments(&nls_content)) {
                    Self::localize_manifest(&mut manifest, &nls_map);
                }
            }
        }

        let mut state = self.load_state();
        state.extensions.insert(
            ext_id.clone(),
            ExtensionStateEntry {
                id: ext_id.clone(),
                version: version.clone(),
                enabled: true,
                installed_dir: target_dir.to_string_lossy().to_string(),
                install_time: now,
            },
        );
        self.save_state(&state)?;

        let readme = target_dir
            .join("README.md")
            .exists()
            .then(|| fs::read_to_string(target_dir.join("README.md")).ok())
            .flatten();

        info!("Successfully installed extension {} v{}", ext_id, version);

        Ok(InstalledExtension {
            id: ext_id,
            manifest,
            dir: target_dir,
            enabled: true,
            version,
            readme,
        })
    }

    pub fn uninstall(&self, ext_id: &str) -> Result<()> {
        let mut state = self.load_state();
        if let Some(entry) = state.extensions.remove(ext_id) {
            let dir = PathBuf::from(&entry.installed_dir);
            if dir.exists() {
                let _ = fs::remove_dir_all(dir);
            }
            self.save_state(&state)?;
            info!("Uninstalled extension {}", ext_id);
            return Ok(());
        }

        // Fallback: check directories matching ext_id-*
        if let Ok(entries) = fs::read_dir(&self.root_dir) {
            for entry in entries.filter_map(Result::ok) {
                let p = entry.path();
                if p.is_dir() {
                    if let Some(name) = p.file_name().and_then(|s| s.to_str()) {
                        if name.starts_with(&format!("{}-", ext_id)) {
                            let _ = fs::remove_dir_all(p);
                        }
                    }
                }
            }
        }

        self.save_state(&state)?;
        Ok(())
    }

    pub fn toggle(&self, ext_id: &str, enabled: bool) -> Result<()> {
        let mut state = self.load_state();
        if let Some(entry) = state.extensions.get_mut(ext_id) {
            entry.enabled = enabled;
            self.save_state(&state)?;
            return Ok(());
        }

        // If not in state, look up from disk
        if let Ok(installed) = self.load_installed() {
            if let Some(ext) = installed.into_iter().find(|e| e.id == ext_id) {
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();
                state.extensions.insert(
                    ext_id.to_string(),
                    ExtensionStateEntry {
                        id: ext_id.to_string(),
                        version: ext.version,
                        enabled,
                        installed_dir: ext.dir.to_string_lossy().to_string(),
                        install_time: now,
                    },
                );
                self.save_state(&state)?;
                return Ok(());
            }
        }

        Err(anyhow!("Extension {} not found", ext_id))
    }

    pub fn get_asset_path(&self, ext_id: &str, relative_path: &str) -> Option<PathBuf> {
        let state = self.load_state();
        let ext_dir = if let Some(entry) = state.extensions.get(ext_id) {
            PathBuf::from(&entry.installed_dir)
        } else {
            // Find in root_dir
            let mut found = None;
            if let Ok(entries) = fs::read_dir(&self.root_dir) {
                for entry in entries.filter_map(Result::ok) {
                    let p = entry.path();
                    if p.is_dir() {
                        if let Some(name) = p.file_name().and_then(|s| s.to_str()) {
                            if name.starts_with(&format!("{}-", ext_id)) {
                                found = Some(p);
                                break;
                            }
                        }
                    }
                }
            }
            found?
        };

        let clean_rel = relative_path.trim_start_matches('/');
        let candidate = ext_dir.join(clean_rel);

        // Security check: must reside inside ext_dir
        if let (Ok(can), Ok(root)) = (candidate.canonicalize(), ext_dir.canonicalize()) {
            if can.starts_with(root) && can.exists() {
                return Some(can);
            }
        }

        if candidate.exists() {
            Some(candidate)
        } else {
            None
        }
    }
}

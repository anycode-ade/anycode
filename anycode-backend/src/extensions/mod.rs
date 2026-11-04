pub mod jsonc;
pub mod manifest;
pub mod openvsx;
pub mod storage;
pub mod theme_converter;

use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::info;

pub use manifest::{
    CommandContribution, GrammarContribution, IconThemeContribution, LanguageContribution,
    SnippetContribution, ThemeContribution, VsCodeContributes, VsCodeManifest,
};
pub use openvsx::{OpenVsxClient, OpenVsxExtensionEntry, OpenVsxSearchResult};
pub use storage::{ExtensionStorage, InstalledExtension};
pub use theme_converter::{ConvertedTheme, convert_vscode_theme};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionSummary {
    pub id: String,
    pub name: String,
    pub publisher: String,
    pub display_name: String,
    pub description: String,
    pub version: String,
    pub enabled: bool,
    pub icon_url: Option<String>,
    pub readme: Option<String>,
    pub commands: Vec<CommandContribution>,
    pub themes: Vec<ThemeContribution>,
    pub icon_themes: Vec<IconThemeContribution>,
    pub languages: Vec<LanguageContribution>,
    #[serde(default)]
    pub views_containers: Option<serde_json::Value>,
    #[serde(default)]
    pub views: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContributedThemeInfo {
    pub ext_id: String,
    pub label: String,
    pub ui_theme: String,
    pub path: String,
    pub file_name: String,
    pub theme_name: String,
}

#[derive(Clone)]
pub struct ExtensionManager {
    pub storage: Arc<ExtensionStorage>,
    pub openvsx: Arc<OpenVsxClient>,
    pub cached_extensions: Arc<Mutex<Vec<InstalledExtension>>>,
}

impl Default for ExtensionManager {
    fn default() -> Self {
        Self::new(None)
    }
}

impl ExtensionManager {
    pub fn new(custom_root: Option<PathBuf>) -> Self {
        let storage = Arc::new(ExtensionStorage::new(custom_root));
        let openvsx = Arc::new(OpenVsxClient::new());
        let initial_installed = storage.load_installed().unwrap_or_default();

        Self {
            storage,
            openvsx,
            cached_extensions: Arc::new(Mutex::new(initial_installed)),
        }
    }

    pub async fn refresh(&self) -> Result<Vec<InstalledExtension>> {
        let installed = self.storage.load_installed()?;
        let mut cache = self.cached_extensions.lock().await;
        *cache = installed.clone();
        Ok(installed)
    }

    pub async fn list_installed(&self) -> Vec<ExtensionSummary> {
        let exts = self.cached_extensions.lock().await;
        exts.iter()
            .map(|ext| {
                let m = &ext.manifest;
                let contributes = m.contributes.as_ref();
                let icon_url = m.icon.as_ref().map(|icon_path| {
                    format!("/api/ext-asset/{}/{}", ext.id, icon_path.trim_start_matches('/'))
                });

                ExtensionSummary {
                    id: ext.id.clone(),
                    name: m.name.clone(),
                    publisher: m.publisher.clone(),
                    display_name: m.display_name.clone().unwrap_or_else(|| m.name.clone()),
                    description: m.description.clone().unwrap_or_default(),
                    version: ext.version.clone(),
                    enabled: ext.enabled,
                    icon_url,
                    readme: ext.readme.clone(),
                    commands: contributes.map(|c| c.commands.clone()).unwrap_or_default(),
                    themes: contributes.map(|c| c.themes.clone()).unwrap_or_default(),
                    icon_themes: contributes.map(|c| c.icon_themes.clone()).unwrap_or_default(),
                    languages: contributes.map(|c| c.languages.clone()).unwrap_or_default(),
                    views_containers: contributes.and_then(|c| c.views_containers.clone()),
                    views: contributes.and_then(|c| c.views.clone()),
                }
            })
            .collect()
    }

    pub async fn search_openvsx(
        &self,
        query: &str,
        offset: usize,
        size: usize,
    ) -> Result<OpenVsxSearchResult> {
        self.openvsx.search(query, offset, size).await
    }

    pub async fn install_from_openvsx(&self, ext_id: &str, version: Option<&str>) -> Result<InstalledExtension> {
        let parts: Vec<&str> = ext_id.split('.').collect();
        if parts.len() != 2 {
            return Err(anyhow!("Invalid extension ID format: expected 'publisher.name'"));
        }
        let namespace = parts[0];
        let name = parts[1];

        info!("Fetching metadata for extension {} from Open VSX", ext_id);
        let detail = self.openvsx.get_extension(namespace, name, version).await?;

        let download_url = detail.best_download_url().or_else(|| {
            Some(format!(
                "{}/{}/{}/{}/file/{}.{}-{}.vsix",
                openvsx::OPENVSX_API_URL,
                namespace,
                name,
                detail.version,
                namespace,
                name,
                detail.version
            ))
        }).ok_or_else(|| anyhow!("No download URL for extension {}", ext_id))?;

        info!("Downloading VSIX from {}", download_url);
        let temp_dir = std::env::temp_dir();
        let temp_file_name = format!("anycode-{}-{}.vsix", ext_id, detail.version);
        let temp_path = temp_dir.join(temp_file_name);

        self.openvsx.download_vsix_to_file(&download_url, &temp_path).await?;

        info!("Installing VSIX for {}", ext_id);
        let install_res = self.storage.install_from_path(&temp_path);
        let _ = std::fs::remove_file(&temp_path);
        let installed = install_res?;

        self.refresh().await?;
        Ok(installed)
    }

    pub async fn install_from_vsix_file(&self, path: &Path) -> Result<InstalledExtension> {
        let installed = self.storage.install_from_path(path)?;
        self.refresh().await?;
        Ok(installed)
    }

    pub async fn uninstall(&self, ext_id: &str) -> Result<()> {
        self.storage.uninstall(ext_id)?;
        self.refresh().await?;
        Ok(())
    }

    pub async fn toggle(&self, ext_id: &str, enabled: bool) -> Result<()> {
        self.storage.toggle(ext_id, enabled)?;
        self.refresh().await?;
        Ok(())
    }

    pub fn get_asset_path(&self, ext_id: &str, asset_path: &str) -> Option<PathBuf> {
        self.storage.get_asset_path(ext_id, asset_path)
    }

    pub async fn get_contributed_themes(&self) -> Vec<ContributedThemeInfo> {
        let exts = self.cached_extensions.lock().await;
        let mut result = Vec::new();

        for ext in exts.iter() {
            if !ext.enabled {
                continue;
            }
            if let Some(ref contrib) = ext.manifest.contributes {
                for theme in &contrib.themes {
                    result.push(ContributedThemeInfo {
                        ext_id: ext.id.clone(),
                        label: theme.label.clone(),
                        ui_theme: theme.ui_theme.clone(),
                        path: theme.path.clone(),
                        file_name: format!("ext:{}", ext.id),
                        theme_name: theme.label.clone(),
                    });
                }
            }
        }

        result
    }

    pub async fn get_theme_definition(&self, ext_id: &str, theme_label_or_path: &str) -> Result<ConvertedTheme> {
        let exts = self.cached_extensions.lock().await;
        let ext = exts
            .iter()
            .find(|e| e.id == ext_id && e.enabled)
            .ok_or_else(|| anyhow!("Extension {} not found or disabled", ext_id))?;

        let contrib = ext
            .manifest
            .contributes
            .as_ref()
            .ok_or_else(|| anyhow!("Extension has no contributes"))?;

        let theme_entry = contrib
            .themes
            .iter()
            .find(|t| t.label == theme_label_or_path || t.path == theme_label_or_path)
            .or_else(|| contrib.themes.first())
            .ok_or_else(|| anyhow!("Theme not found in extension {}", ext_id))?;

        let rel_path = theme_entry.path.trim_start_matches("./");
        let full_path = ext.dir.join(rel_path);

        convert_vscode_theme(&full_path, &theme_entry.label)
    }

    pub async fn get_all_commands(&self) -> Vec<CommandContribution> {
        let exts = self.cached_extensions.lock().await;
        let mut commands = Vec::new();
        for ext in exts.iter() {
            if !ext.enabled {
                continue;
            }
            if let Some(ref contrib) = ext.manifest.contributes {
                commands.extend(contrib.commands.clone());
            }
        }
        commands
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    #[tokio::test]
    async fn test_manifest_deserialization() {
        let json_manifest = r##"
        {
            "name": "super-theme",
            "displayName": "Super Theme",
            "publisher": "test-dev",
            "version": "1.2.3",
            "description": "An awesome VS Code theme",
            "main": "./dist/extension.js",
            "activationEvents": [
                "onStartupFinished",
                "onLanguage:rust"
            ],
            "contributes": {
                "themes": [
                    {
                        "label": "Super Dark",
                        "uiTheme": "vs-dark",
                        "path": "./themes/super-dark.json"
                    }
                ],
                "commands": [
                    {
                        "command": "super.sayHello",
                        "title": "Super: Say Hello"
                    }
                ]
            }
        }
        "##;

        let manifest: VsCodeManifest = serde_json::from_str(json_manifest).unwrap();
        assert_eq!(manifest.name, "super-theme");
        assert_eq!(manifest.publisher, "test-dev");
        assert_eq!(manifest.extension_id(), "test-dev.super-theme");
        assert_eq!(manifest.version, "1.2.3");
        assert_eq!(manifest.activation_events.len(), 2);

        let contributes = manifest.contributes.unwrap();
        assert_eq!(contributes.themes.len(), 1);
        assert_eq!(contributes.themes[0].label, "Super Dark");
        assert_eq!(contributes.commands.len(), 1);
        assert_eq!(contributes.commands[0].command, "super.sayHello");
    }

    #[tokio::test]
    async fn test_vsix_installation_lifecycle() {
        let temp_dir = tempfile::tempdir().unwrap();
        let manager = ExtensionManager::new(Some(temp_dir.path().to_path_buf()));

        // Create an in-memory .vsix zip archive
        let mut zip_bytes = Vec::new();
        {
            let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut zip_bytes));
            let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

            let pkg_json = r##"{
                "name": "test-ext",
                "publisher": "acme",
                "version": "1.0.0",
                "description": "Test extension description",
                "contributes": {
                    "themes": [
                        { "label": "Acme Dark", "uiTheme": "vs-dark", "path": "./themes/theme.json" }
                    ],
                    "commands": [
                        { "command": "acme.hello", "title": "Acme: Hello" }
                    ]
                }
            }"##;

            let theme_json = r##"{
                "name": "Acme Dark",
                "type": "dark",
                "colors": {
                    "editor.background": "#1e1e2e",
                    "editor.foreground": "#cdd6f4"
                },
                "tokenColors": [
                    {
                        "scope": "keyword",
                        "settings": { "foreground": "#cba6f7" }
                    }
                ]
            }"##;

            zip.start_file("extension/package.json", options).unwrap();
            zip.write_all(pkg_json.as_bytes()).unwrap();

            zip.start_file("extension/themes/theme.json", options).unwrap();
            zip.write_all(theme_json.as_bytes()).unwrap();

            zip.start_file("extension/README.md", options).unwrap();
            zip.write_all(b"# Acme Extension Readme").unwrap();

            zip.finish().unwrap();
        }

        // Install from VSIX
        let installed = manager
            .storage
            .install_from_vsix_bytes(&zip_bytes, Some("acme.test-ext"))
            .unwrap();

        assert_eq!(installed.id, "acme.test-ext");
        assert_eq!(installed.version, "1.0.0");
        assert!(installed.enabled);
        assert_eq!(installed.readme.as_deref(), Some("# Acme Extension Readme"));

        manager.refresh().await.unwrap();

        // Check list installed
        let list = manager.list_installed().await;
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "acme.test-ext");
        assert_eq!(list[0].themes.len(), 1);
        assert_eq!(list[0].commands.len(), 1);

        // Check theme definition conversion
        let theme = manager
            .get_theme_definition("acme.test-ext", "Acme Dark")
            .await
            .unwrap();
        assert_eq!(theme.name, "Acme Dark");
        assert_eq!(theme.mode, "dark");
        assert_eq!(theme.colors["background"], "#1e1e2e");
        assert_eq!(theme.highlight["syntax"]["keyword"]["color"], "#cba6f7");

        // Toggle disabled
        manager.toggle("acme.test-ext", false).await.unwrap();
        let list = manager.list_installed().await;
        assert!(!list[0].enabled);

        // Toggle enabled again
        manager.toggle("acme.test-ext", true).await.unwrap();
        let list = manager.list_installed().await;
        assert!(list[0].enabled);

        // Uninstall
        manager.uninstall("acme.test-ext").await.unwrap();
        let list = manager.list_installed().await;
        assert_eq!(list.len(), 0);
    }
}

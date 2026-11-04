use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VsCodeManifest {
    pub name: String,
    pub publisher: String,
    pub version: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub main: Option<String>,
    #[serde(default)]
    pub browser: Option<String>,
    #[serde(default)]
    pub activation_events: Vec<String>,
    #[serde(default)]
    pub contributes: Option<VsCodeContributes>,
    #[serde(default)]
    pub extension_dependencies: Option<Vec<String>>,
    #[serde(default)]
    pub extension_pack: Option<Vec<String>>,
    #[serde(default)]
    pub repository: Option<serde_json::Value>,
    #[serde(default)]
    pub engines: Option<HashMap<String, String>>,
}

impl VsCodeManifest {
    pub fn extension_id(&self) -> String {
        format!("{}.{}", self.publisher, self.name)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VsCodeContributes {
    #[serde(default)]
    pub themes: Vec<ThemeContribution>,
    #[serde(default, rename = "iconThemes")]
    pub icon_themes: Vec<IconThemeContribution>,
    #[serde(default)]
    pub languages: Vec<LanguageContribution>,
    #[serde(default)]
    pub grammars: Vec<GrammarContribution>,
    #[serde(default)]
    pub snippets: Vec<SnippetContribution>,
    #[serde(default)]
    pub commands: Vec<CommandContribution>,
    #[serde(default)]
    pub keybindings: Vec<KeybindingContribution>,
    #[serde(default)]
    pub configuration: Option<serde_json::Value>,
    #[serde(default, rename = "viewsContainers")]
    pub views_containers: Option<serde_json::Value>,
    #[serde(default)]
    pub views: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeContribution {
    #[serde(default)]
    pub id: Option<String>,
    pub label: String,
    #[serde(rename = "uiTheme", default = "default_ui_theme")]
    pub ui_theme: String, // "vs-dark", "vs", "hc-black", "hc-light"
    pub path: String,
}

fn default_ui_theme() -> String {
    "vs-dark".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IconThemeContribution {
    pub id: String,
    pub label: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageContribution {
    pub id: String,
    #[serde(default)]
    pub extensions: Vec<String>,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub filenames: Vec<String>,
    #[serde(default)]
    pub configuration: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrammarContribution {
    #[serde(default)]
    pub language: Option<String>,
    pub scope_name: String,
    pub path: String,
    #[serde(default)]
    pub embedded_languages: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnippetContribution {
    #[serde(default)]
    pub language: Option<String>,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandContribution {
    pub command: String,
    pub title: String,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub icon: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeybindingContribution {
    pub command: String,
    #[serde(default)]
    pub key: Option<String>,
    #[serde(default)]
    pub mac: Option<String>,
    #[serde(default)]
    pub when: Option<String>,
}

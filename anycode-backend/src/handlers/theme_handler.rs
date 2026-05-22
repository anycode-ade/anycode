use serde::{Deserialize, Serialize};
use serde_json::{self, json, Value};
use socketioxide::extract::{AckSender, Data, SocketRef};
use std::fs;
use std::path::PathBuf;
use tracing::info;

#[derive(Debug, Serialize, Deserialize)]
pub struct ThemeListResponseItem {
    pub id: String,
    pub name: String,
    #[serde(rename = "fileName")]
    pub file_name: String,
    #[serde(rename = "themeName")]
    pub theme_name: String,
}

#[derive(Debug, Deserialize)]
pub struct ThemeGetRequest {
    #[serde(rename = "fileName")]
    pub file_name: String,
    #[serde(rename = "themeName")]
    pub theme_name: String,
}

#[derive(Debug, Deserialize)]
struct ThemeFile {
    themes: Vec<ThemeDefinition>,
}

#[derive(Debug, Deserialize)]
struct ThemeDefinition {
    name: String,
    mode: String,
    colors: Value,
    highlight: Value,
}

fn get_themes_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join("themes"))
        .unwrap_or_else(|| PathBuf::from("themes"))
}

pub async fn handle_theme_list(
    _socket: SocketRef,
    ack: AckSender,
) {
    info!("theme:list requested");
    let mut list = Vec::new();
    let themes_dir = get_themes_dir();
    let mut seen_files = std::collections::HashSet::new();

    if let Ok(entries) = fs::read_dir(themes_dir) {
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                let file_name = match path.file_name().and_then(|s| s.to_str()) {
                    Some(name) => name.to_string(),
                    None => continue,
                };
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(theme_file) = serde_json::from_str::<ThemeFile>(&content) {
                        seen_files.insert(file_name.clone());
                        for t in theme_file.themes {
                            let id = format!("{}:{}", file_name, t.name);
                            list.push(ThemeListResponseItem {
                                id,
                                name: format!("{} ({})", t.name, t.mode),
                                file_name: file_name.clone(),
                                theme_name: t.name,
                            });
                        }
                    }
                }
            }
        }
    }

    for embedded_file in crate::config::Themes::iter() {
        let file_name = embedded_file.as_ref().to_string();
        if !seen_files.contains(&file_name) {
            if let Some(file_data) = crate::config::Themes::get(&file_name) {
                if let Ok(content) = std::str::from_utf8(file_data.data.as_ref()) {
                    if let Ok(theme_file) = serde_json::from_str::<ThemeFile>(content) {
                        for t in theme_file.themes {
                            let id = format!("{}:{}", file_name, t.name);
                            list.push(ThemeListResponseItem {
                                id,
                                name: format!("{} ({})", t.name, t.mode),
                                file_name: file_name.clone(),
                                theme_name: t.name,
                            });
                        }
                    }
                }
            }
        }
    }

    // Sort list by name for nicer presentation
    list.sort_by(|a, b| a.name.cmp(&b.name));

    let _ = ack.send(&json!(list));
}

pub async fn handle_theme_get(
    _socket: SocketRef,
    Data(request): Data<ThemeGetRequest>,
    ack: AckSender,
) {
    info!("theme:get requested: {:?}", request);
    let themes_dir = get_themes_dir();

    let theme_file_path = themes_dir.join(&request.file_name);
    // Basic security check to avoid path traversal
    if theme_file_path.parent() != Some(&themes_dir) {
        let _ = ack.send(&json!({ "success": false, "error": "Invalid theme file path" }));
        return;
    }

    let content = match fs::read_to_string(&theme_file_path) {
        Ok(c) => Some(c),
        Err(_) => {
            // Fallback to embedded theme asset
            crate::config::Themes::get(&request.file_name)
                .and_then(|file_data| std::str::from_utf8(file_data.data.as_ref()).ok().map(|s| s.to_string()))
        }
    };

    let content = match content {
        Some(c) => c,
        None => {
            let _ = ack.send(&json!({ "success": false, "error": format!("Theme file not found: {}", request.file_name) }));
            return;
        }
    };

    let theme_file = match serde_json::from_str::<ThemeFile>(&content) {
        Ok(f) => f,
        Err(e) => {
            let _ = ack.send(&json!({ "success": false, "error": format!("Failed to parse theme: {}", e) }));
            return;
        }
    };

    if let Some(theme_def) = theme_file.themes.into_iter().find(|t| t.name == request.theme_name) {
        let _ = ack.send(&json!({
            "success": true,
            "theme": {
                "name": theme_def.name,
                "mode": theme_def.mode,
                "colors": theme_def.colors,
                "highlight": theme_def.highlight,
            }
        }));
    } else {
        let _ = ack.send(&json!({ "success": false, "error": "Theme name not found in file" }));
    }
}

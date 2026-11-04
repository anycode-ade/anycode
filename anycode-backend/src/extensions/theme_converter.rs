use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

use super::jsonc::strip_jsonc_comments;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConvertedTheme {
    pub name: String,
    pub mode: String, // "dark" | "light"
    pub colors: Value,
    pub highlight: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct VsCodeThemeFile {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(rename = "type", default)]
    pub theme_type: Option<String>, // "dark" | "light" | "hc"
    #[serde(default)]
    pub include: Option<String>,
    #[serde(default)]
    pub colors: Option<HashMap<String, String>>,
    #[serde(rename = "tokenColors", default)]
    pub token_colors: Option<Value>,
    #[serde(rename = "semanticTokenColors", default)]
    pub semantic_token_colors: Option<Value>,
}

pub fn convert_vscode_theme(theme_path: &Path, default_name: &str) -> Result<ConvertedTheme> {
    let mut merged = load_and_merge_theme(theme_path, 0)?;

    let name = merged
        .name
        .clone()
        .unwrap_or_else(|| default_name.to_string());

    let mode = match merged.theme_type.as_deref() {
        Some("light") | Some("vs") => "light",
        _ => "dark",
    };

    let vs_colors = merged.colors.take().unwrap_or_default();
    let (colors, mut highlight) = map_ui_colors(&vs_colors, mode);

    let syntax_map = map_token_colors(&merged.token_colors.unwrap_or(Value::Array(vec![])));
    if let Value::Object(ref mut h_obj) = highlight {
        h_obj.insert("syntax".to_string(), Value::Object(syntax_map));
    }

    Ok(ConvertedTheme {
        name,
        mode: mode.to_string(),
        colors,
        highlight,
    })
}

fn load_and_merge_theme(theme_path: &Path, depth: usize) -> Result<VsCodeThemeFile> {
    if depth > 10 {
        return Err(anyhow!("Exceeded maximum include recursion depth in theme"));
    }

    let content = fs::read_to_string(theme_path)
        .with_context(|| format!("Failed to read theme file at {:?}", theme_path))?;
    let stripped = strip_jsonc_comments(&content);
    let mut current: VsCodeThemeFile = serde_json::from_str(&stripped)
        .with_context(|| format!("Failed to parse theme JSON at {:?}", theme_path))?;

    if let Some(ref inc) = current.include {
        let parent = theme_path
            .parent()
            .ok_or_else(|| anyhow!("No parent dir"))?;
        let inc_path = parent.join(inc);
        if inc_path.exists() {
            if let Ok(base) = load_and_merge_theme(&inc_path, depth + 1) {
                // Merge base into current: current overrides base
                let mut merged_colors = base.colors.unwrap_or_default();
                if let Some(cur_colors) = current.colors {
                    merged_colors.extend(cur_colors);
                }
                current.colors = Some(merged_colors);

                if current.theme_type.is_none() {
                    current.theme_type = base.theme_type;
                }
                if current.name.is_none() {
                    current.name = base.name;
                }

                // Merge tokenColors: base first, then current
                let mut combined_tokens = Vec::new();
                if let Some(Value::Array(base_tokens)) = base.token_colors {
                    combined_tokens.extend(base_tokens);
                }
                if let Some(Value::Array(cur_tokens)) = current.token_colors {
                    combined_tokens.extend(cur_tokens);
                }
                current.token_colors = Some(Value::Array(combined_tokens));
            }
        }
    }

    Ok(current)
}

fn map_ui_colors(vs: &HashMap<String, String>, mode: &str) -> (Value, Value) {
    let is_dark = mode == "dark";
    let def_bg = if is_dark { "#1e1e1e" } else { "#ffffff" };
    let def_fg = if is_dark { "#cccccc" } else { "#333333" };
    let def_border = if is_dark { "#3c3c3c" } else { "#e5e5e5" };
    let def_sidebar = if is_dark { "#252526" } else { "#f3f3f3" };
    let def_accent = if is_dark { "#007acc" } else { "#0066b8" };

    let get = |keys: &[&str], fallback: &str| -> String {
        for k in keys {
            if let Some(val) = vs.get(*k) {
                return val.clone();
            }
        }
        fallback.to_string()
    };

    let editor_bg = get(&["editor.background"], def_bg);
    let editor_fg = get(&["editor.foreground"], def_fg);
    let sidebar_bg = get(&["sideBar.background"], def_sidebar);
    let sidebar_fg = get(&["sideBar.foreground"], def_fg);
    let border = get(
        &["sideBar.border", "panel.border", "editorGroup.border"],
        def_border,
    );
    let accent = get(
        &["activityBarBadge.background", "focusBorder", "button.background"],
        def_accent,
    );
    let line_highlight = get(&["editor.lineHighlightBackground"], if is_dark { "#282828" } else { "#f0f0f0" });
    let line_number = get(&["editorLineNumber.foreground"], if is_dark { "#858585" } else { "#a0a0a0" });
    let active_line_number = get(&["editorLineNumber.activeForeground"], if is_dark { "#c6c6c6" } else { "#333333" });
    let selection = get(&["editor.selectionBackground"], if is_dark { "#264f78" } else { "#add6ff" });
    let tab_active_bg = get(&["tab.activeBackground"], &editor_bg);
    let tab_active_fg = get(&["tab.activeForeground"], &editor_fg);
    let tab_bar_bg = get(&["editorGroupHeader.tabsBackground"], &sidebar_bg);
    let status_bar_bg = get(&["statusBar.background"], &accent);
    let status_bar_fg = get(&["statusBar.foreground"], "#ffffff");

    let colors = json!({
        "accent.background": accent,
        "accent.foreground": "#ffffff",
        "background": editor_bg,
        "foreground": editor_fg,
        "border": border,
        "caret": get(&["editorCursor.foreground"], &editor_fg),
        "selection.background": selection,
        "sidebar.background": sidebar_bg,
        "sidebar.foreground": sidebar_fg,
        "sidebar.border": border,
        "tab.active.background": tab_active_bg,
        "tab.active.foreground": tab_active_fg,
        "tab.background": "transparent",
        "tab.foreground": get(&["tab.inactiveForeground"], &sidebar_fg),
        "tab_bar.background": tab_bar_bg,
        "title_bar.background": get(&["titleBar.activeBackground"], &sidebar_bg),
        "title_bar.border": border,
        "status_bar.background": status_bar_bg,
        "status_bar.foreground": status_bar_fg,
        "list.background": sidebar_bg,
        "list.active.background": get(&["list.activeSelectionBackground"], &selection),
        "input.border": get(&["input.border"], &border),
        "muted.background": get(&["badge.background"], if is_dark { "#2d2d2d" } else { "#e8e8e8" }),
        "muted.foreground": get(&["badge.foreground"], if is_dark { "#858585" } else { "#666666" })
    });

    let highlight = json!({
        "editor.background": editor_bg,
        "editor.foreground": editor_fg,
        "editor.active_line.background": line_highlight,
        "editor.line_number": line_number,
        "editor.active_line_number": active_line_number,
        "error": get(&["editorError.foreground"], "#f14c4c"),
        "error.background": get(&["editorError.background"], "#f14c4c22"),
        "warning": get(&["editorWarning.foreground"], "#cca700"),
        "warning.background": get(&["editorWarning.background"], "#cca70022"),
        "info": get(&["editorInfo.foreground"], "#3794ff"),
        "info.background": get(&["editorInfo.background"], "#3794ff22")
    });

    (colors, highlight)
}

fn map_token_colors(token_colors_val: &Value) -> Map<String, Value> {
    let mut syntax_map = Map::new();

    // Mapping from canonical anycode syntax key to VS Code textmate scope substrings
    let key_patterns: &[(&str, &[&str])] = &[
        ("comment", &["comment", "punctuation.definition.comment"]),
        ("string", &["string", "punctuation.definition.string"]),
        ("keyword", &["keyword", "storage.type", "storage.modifier"]),
        ("function", &["entity.name.function", "support.function"]),
        ("type", &["entity.name.type", "entity.name.class", "support.type", "support.class"]),
        ("number", &["constant.numeric", "constant.language"]),
        ("boolean", &["constant.language.boolean"]),
        ("constant", &["constant"]),
        ("variable", &["variable", "variable.other"]),
        ("variable.special", &["variable.language", "variable.parameter"]),
        ("property", &["variable.other.property", "support.type.property-name"]),
        ("tag", &["entity.name.tag"]),
        ("attribute", &["entity.other.attribute-name"]),
        ("string.escape", &["constant.character.escape"]),
        ("string.regex", &["string.regexp"]),
        ("constructor", &["entity.name.constructor"]),
    ];

    if let Value::Array(items) = token_colors_val {
        for item in items {
            let settings = item.get("settings");
            let fg = settings
                .and_then(|s| s.get("foreground"))
                .and_then(|f| f.as_str());

            if let Some(color) = fg {
                // Scope can be a string or an array of strings
                let scopes: Vec<String> = if let Some(scope_str) = item.get("scope").and_then(|s| s.as_str()) {
                    scope_str.split(',').map(|s| s.trim().to_string()).collect()
                } else if let Some(scope_arr) = item.get("scope").and_then(|s| s.as_array()) {
                    scope_arr.iter().filter_map(|s| s.as_str().map(|str_val| str_val.to_string())).collect()
                } else {
                    Vec::new()
                };

                for scope in scopes {
                    for (target_key, patterns) in key_patterns {
                        if patterns.iter().any(|pat| scope.contains(pat)) {
                            syntax_map.insert(
                                target_key.to_string(),
                                json!({ "color": color }),
                            );
                        }
                    }
                }
            }
        }
    }

    syntax_map
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_theme_conversion() {
        let vs_json = r##"
        {
            "name": "Test Dark Theme",
            "type": "dark",
            "colors": {
                "editor.background": "#123456",
                "editor.foreground": "#abcdef"
            },
            "tokenColors": [
                {
                    "scope": "comment, punctuation.definition.comment",
                    "settings": { "foreground": "#999999" }
                },
                {
                    "scope": ["keyword", "storage.type"],
                    "settings": { "foreground": "#ff0077" }
                }
            ]
        }
        "##;

        let temp = tempfile::NamedTempFile::new().unwrap();
        fs::write(temp.path(), vs_json).unwrap();

        let converted = convert_vscode_theme(temp.path(), "Fallback").unwrap();
        assert_eq!(converted.name, "Test Dark Theme");
        assert_eq!(converted.mode, "dark");
        assert_eq!(converted.colors["background"], "#123456");
        assert_eq!(converted.colors["foreground"], "#abcdef");
        assert_eq!(converted.highlight["syntax"]["comment"]["color"], "#999999");
        assert_eq!(converted.highlight["syntax"]["keyword"]["color"], "#ff0077");
    }
}

use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentWorkspace {
    pub path: String,
    pub name: String,
    pub last_opened: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorkspaceConfig {
    pub current_workspace: Option<String>,
    pub recent_workspaces: Vec<RecentWorkspace>,
    #[serde(default)]
    pub projects: Vec<String>,
}

pub fn get_config_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".anycode").join("workspaces.json"))
}

pub fn load_config() -> WorkspaceConfig {
    if let Some(path) = get_config_path() {
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Ok(config) = serde_json::from_str(&content) {
                return config;
            }
        }
    }
    WorkspaceConfig::default()
}

pub fn save_config(config: &WorkspaceConfig) {
    if let Some(path) = get_config_path() {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(content) = serde_json::to_string_pretty(config) {
            let _ = std::fs::write(&path, content);
        }
    }
}

pub fn record_workspace(path: &Path) {
    let canonical = anycode::utils::canonicalize_path(path).unwrap_or_else(|_| path.to_path_buf());
    let path_str = canonical.to_string_lossy().to_string();
    let name = canonical
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path_str.clone());

    let mut config = load_config();
    config.current_workspace = Some(path_str.clone());
    if !config.projects.contains(&path_str) {
        config.projects.push(path_str.clone());
    }

    config.recent_workspaces.retain(|r| r.path != path_str);

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    config.recent_workspaces.insert(
        0,
        RecentWorkspace {
            path: path_str,
            name,
            last_opened: now,
        },
    );

    if config.recent_workspaces.len() > 20 {
        config.recent_workspaces.truncate(20);
    }

    save_config(&config);
}

pub fn determine_initial_workspace() -> Option<PathBuf> {
    // 1. Explicit command-line argument: anycode <folder>
    if let Some(arg) = std::env::args().nth(1) {
        if !arg.starts_with('-') {
            let p = PathBuf::from(&arg);
            if p.is_dir() {
                record_workspace(&p);
                return Some(p);
            }
        }
    }

    // Keep the last selected project available on reload. The backend restores
    // all workspace roots; this value is only the desktop welcome-screen default.
    load_config()
        .current_workspace
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
}

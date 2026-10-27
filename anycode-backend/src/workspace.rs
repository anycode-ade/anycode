use crate::git::GitManager;
use crate::config::Config;
use lsp_types::PublishDiagnosticsParams;
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProjectInfo {
    pub id: String,
    pub name: String,
    pub root: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentWorkspace {
    pub path: String,
    pub name: String,
    pub last_opened: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct PersistedWorkspace {
    #[serde(default)]
    current_workspace: Option<String>,
    #[serde(default)]
    recent_workspaces: Vec<RecentWorkspace>,
    #[serde(default)]
    projects: Vec<String>,
}

#[derive(Clone)]
pub struct Project {
    pub info: ProjectInfo,
    pub git: Arc<Mutex<GitManager>>,
    pub lsp: Arc<Mutex<crate::lsp::LspManager>>,
}

pub struct WorkspaceManager {
    projects: HashMap<String, Project>,
    default_project_id: Option<String>,
    config_path: PathBuf,
    persisted: PersistedWorkspace,
    startup_root: PathBuf,
    config: Config,
    diagnostic_tx: tokio::sync::mpsc::Sender<PublishDiagnosticsParams>,
}

impl WorkspaceManager {
    pub fn new(
        startup_root: PathBuf,
        config: Config,
        diagnostic_tx: tokio::sync::mpsc::Sender<PublishDiagnosticsParams>,
    ) -> Self {
        Self::load(startup_root, true, config, diagnostic_tx, None)
    }

    pub fn new_empty(
        startup_root: PathBuf,
        config: Config,
        diagnostic_tx: tokio::sync::mpsc::Sender<PublishDiagnosticsParams>,
    ) -> Self {
        Self::load(startup_root, false, config, diagnostic_tx, None)
    }

    #[cfg(test)]
    fn new_with_config_path(
        startup_root: PathBuf,
        config_path: PathBuf,
        config: Config,
        diagnostic_tx: tokio::sync::mpsc::Sender<PublishDiagnosticsParams>,
    ) -> Self {
        Self::load(startup_root, true, config, diagnostic_tx, Some(config_path))
    }

    fn load(
        startup_root: PathBuf,
        add_startup_when_empty: bool,
        config: Config,
        diagnostic_tx: tokio::sync::mpsc::Sender<PublishDiagnosticsParams>,
        config_path: Option<PathBuf>,
    ) -> Self {
        let config_path = config_path.unwrap_or_else(|| {
            dirs::home_dir()
                .unwrap_or_else(|| startup_root.clone())
                .join(".anycode")
                .join("workspaces.json")
        });
        let mut persisted = std::fs::read_to_string(&config_path)
            .ok()
            .and_then(|content| serde_json::from_str::<PersistedWorkspace>(&content).ok())
            .unwrap_or_default();

        let mut projects = HashMap::new();
        for root in persisted.projects.iter().chain(
            persisted
                .current_workspace
                .iter()
                .filter(|_| persisted.projects.is_empty()),
        ) {
            if let Ok(project) = make_project(Path::new(root), &config, &diagnostic_tx) {
                projects.insert(project.info.id.clone(), project);
            }
        }

        if projects.is_empty() && add_startup_when_empty {
            if let Ok(project) = make_project(&startup_root, &config, &diagnostic_tx) {
                projects.insert(project.info.id.clone(), project);
            }
        }

        let default_project_id = persisted
            .current_workspace
            .as_ref()
            .and_then(|path| canonical_directory(Path::new(path)).ok())
            .map(|path| path.to_string_lossy().into_owned())
            .filter(|id| projects.contains_key(id))
            .or_else(|| projects.keys().min().cloned());

        persisted.projects = projects.keys().cloned().collect();
        let manager = Self {
            projects,
            default_project_id,
            config_path,
            persisted,
            startup_root,
            config,
            diagnostic_tx,
        };
        manager.persist();
        manager
    }

    pub fn projects(&self) -> Vec<ProjectInfo> {
        let mut projects = self
            .projects
            .values()
            .map(|project| project.info.clone())
            .collect::<Vec<_>>();
        projects.sort_by(|left, right| left.name.cmp(&right.name).then(left.root.cmp(&right.root)));
        projects
    }

    pub fn default_project_id(&self) -> Option<String> {
        self.default_project_id.clone()
    }

    pub fn recent_workspaces(&self) -> &[RecentWorkspace] {
        &self.persisted.recent_workspaces
    }

    pub fn remove_recent_workspace(&mut self, path: &str) -> Vec<RecentWorkspace> {
        self.persisted
            .recent_workspaces
            .retain(|recent| recent.path != path);
        self.persist();
        self.persisted.recent_workspaces.clone()
    }

    pub fn starting_directory(&self) -> PathBuf {
        self.default_project_id
            .as_deref()
            .and_then(|id| self.projects.get(id))
            .map(|project| PathBuf::from(&project.info.root))
            .unwrap_or_else(|| self.startup_root.clone())
    }

    pub fn get(&self, id: &str) -> Option<Project> {
        self.projects.get(id).cloned()
    }

    pub fn find_project_for_path(&self, path: &Path) -> Option<Project> {
        self.projects
            .values()
            .filter(|project| path.starts_with(&project_root(&project.info)))
            .max_by_key(|project| project.info.root.len())
            .cloned()
    }

    pub fn add_project(&mut self, path: &Path) -> Result<ProjectInfo> {
        let project = make_project(path, &self.config, &self.diagnostic_tx)?;
        let id = project.info.id.clone();
        let info = project.info.clone();
        self.projects.entry(id.clone()).or_insert(project);
        self.default_project_id = Some(id.clone());
        self.persisted.current_workspace = Some(id);
        self.record_recent(&info.root, &info.name);
        self.persist();
        Ok(info)
    }

    pub fn remove_project(&mut self, id: &str) -> Result<ProjectInfo> {
        let Some(project) = self.projects.remove(id) else {
            bail!("Project is no longer part of this workspace");
        };
        if self.default_project_id.as_deref() == Some(id) {
            self.default_project_id = self.projects.keys().min().cloned();
        }
        self.persisted.current_workspace = self.default_project_id.clone();
        self.persist();
        Ok(project.info)
    }

    pub fn remove_projects(&mut self, ids: &[String]) -> Result<Vec<ProjectInfo>> {
        if let Some(missing) = ids.iter().find(|id| !self.projects.contains_key(*id)) {
            bail!("Project is no longer part of this workspace: {missing}");
        }
        let removed = ids
            .iter()
            .filter_map(|id| self.projects.remove(id))
            .map(|project| project.info)
            .collect::<Vec<_>>();
        if self
            .default_project_id
            .as_ref()
            .is_some_and(|id| ids.contains(id))
        {
            self.default_project_id = self.projects.keys().min().cloned();
        }
        self.persisted.current_workspace = self.default_project_id.clone();
        self.persist();
        Ok(removed)
    }

    pub fn select_default(&mut self, id: &str) -> Result<()> {
        if !self.projects.contains_key(id) {
            bail!("Project is no longer part of this workspace");
        }
        self.default_project_id = Some(id.to_string());
        self.persisted.current_workspace = Some(id.to_string());
        self.persist();
        Ok(())
    }

    fn record_recent(&mut self, path: &str, name: &str) {
        self.persisted
            .recent_workspaces
            .retain(|recent| recent.path != path);
        self.persisted.recent_workspaces.insert(
            0,
            RecentWorkspace {
                path: path.to_string(),
                name: name.to_string(),
                last_opened: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|duration| duration.as_secs())
                    .unwrap_or_default(),
            },
        );
        self.persisted.recent_workspaces.truncate(20);
    }

    fn persist(&self) {
        let mut persisted = self.persisted.clone();
        persisted.projects = self.projects.keys().cloned().collect();
        persisted.projects.sort();
        if let Some(parent) = self.config_path.parent() {
            if let Err(error) = std::fs::create_dir_all(parent) {
                tracing::warn!("Could not create workspace config directory: {error}");
                return;
            }
        }
        match serde_json::to_vec_pretty(&persisted) {
            Ok(content) => {
                if let Err(error) = std::fs::write(&self.config_path, content) {
                    tracing::warn!("Could not persist workspace projects: {error}");
                }
            }
            Err(error) => tracing::warn!("Could not serialize workspace projects: {error}"),
        }
    }
}

pub fn canonical_directory(path: &Path) -> Result<PathBuf> {
    if !path.is_absolute() {
        bail!("Directory path must be absolute");
    }
    let canonical = crate::utils::canonicalize_path(path)
        .with_context(|| format!("Directory does not exist or cannot be accessed: {}", path.display()))?;
    if !canonical.is_dir() {
        bail!("Not a directory: {}", canonical.display());
    }
    Ok(canonical)
}

pub fn project_info_for_path(path: &Path) -> Result<ProjectInfo> {
    let root = canonical_directory(path)?;
    let root_text = root.to_string_lossy().into_owned();
    let name = root
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| root_text.clone());
    Ok(ProjectInfo {
        id: root_text.clone(),
        name,
        root: root_text,
    })
}

pub fn list_directories(path: &Path) -> Result<Vec<(String, String)>> {
    let (directories, _) = list_directory_entries(path)?;
    Ok(directories)
}

pub fn list_directory_entries(path: &Path) -> Result<(Vec<(String, String)>, Vec<String>)> {
    let entries = std::fs::read_dir(path)
        .with_context(|| format!("Cannot read directory: {}", path.display()))?;
    let mut directories = Vec::new();
    let mut files = Vec::new();
    for entry in entries.flatten() {
        let entry_path = entry.path();
        if crate::utils::is_ignored_path(&entry_path) {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if entry_path.is_dir() {
            let Ok(canonical) = crate::utils::canonicalize_path(&entry_path) else {
                continue;
            };
            directories.push((name, canonical.to_string_lossy().into_owned()));
        } else {
            files.push(name);
        }
    }
    directories.sort_by(|left, right| left.0.to_lowercase().cmp(&right.0.to_lowercase()));
    files.sort_by_key(|name| name.to_lowercase());
    Ok((directories, files))
}

fn make_project(
    path: &Path,
    config: &Config,
    diagnostic_tx: &tokio::sync::mpsc::Sender<PublishDiagnosticsParams>,
) -> Result<Project> {
    let info = project_info_for_path(path)?;
    let root = PathBuf::from(&info.root);
    let mut git = GitManager::new(root.clone());
    if let Err(error) = git.refresh_status_cache() {
        tracing::debug!("Project {} has no usable Git repository: {error}", root.display());
    }
    let mut lsp = crate::lsp::LspManager::new_with_root(config.clone(), root.clone());
    lsp.set_diagnostics_sender(diagnostic_tx.clone());
    Ok(Project {
        info,
        git: Arc::new(Mutex::new(git)),
        lsp: Arc::new(Mutex::new(lsp)),
    })
}

fn project_root(project: &ProjectInfo) -> PathBuf {
    PathBuf::from(&project.root)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_identity_is_canonical_and_duplicate_add_is_idempotent() {
        let root = tempfile::tempdir().unwrap();
        let config_dir = tempfile::tempdir().unwrap();
        let (diagnostics, _) = tokio::sync::mpsc::channel(1);
        let mut manager = WorkspaceManager::new_with_config_path(
            root.path().to_path_buf(),
            config_dir.path().join("workspaces.json"),
            crate::config::get(),
            diagnostics,
        );
        let added = manager.add_project(root.path()).unwrap();
        assert_eq!(manager.projects().len(), 1);
        assert_eq!(
            added.id,
            crate::utils::canonicalize_path(root.path()).unwrap().to_string_lossy()
        );
    }

    #[test]
    fn directory_listing_returns_only_directories_and_canonical_paths() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("child")).unwrap();
        std::fs::write(root.path().join("file.txt"), "text").unwrap();
        let listed = list_directories(root.path()).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].0, "child");
        assert!(Path::new(&listed[0].1).is_absolute());
    }

    #[test]
    fn workspace_reload_restores_all_projects_and_the_persisted_default() {
        let workspace_dir = tempfile::tempdir().unwrap();
        let startup = workspace_dir.path().join("server-startup");
        std::fs::create_dir(&startup).unwrap();
        let root_a = workspace_dir.path().join("project-a");
        let root_b = workspace_dir.path().join("project-b");
        create_git_project(&root_a, "alpha");
        create_git_project(&root_b, "beta");
        let config_path = workspace_dir.path().join("workspaces.json");
        let (diagnostics, _) = tokio::sync::mpsc::channel(1);
        let mut manager = WorkspaceManager::new_with_config_path(
            startup.clone(),
            config_path.clone(),
            crate::config::get(),
            diagnostics,
        );
        let project_a = manager.add_project(&root_a).unwrap();
        let project_b = manager.add_project(&root_b).unwrap();
        drop(manager);

        let (diagnostics, _) = tokio::sync::mpsc::channel(1);
        let restored = WorkspaceManager::new_with_config_path(
            startup,
            config_path,
            crate::config::get(),
            diagnostics,
        );
        assert!(restored.get(&project_a.id).is_some());
        assert!(restored.get(&project_b.id).is_some());
        assert_eq!(restored.default_project_id().as_deref(), Some(project_b.id.as_str()));
    }

    #[test]
    fn removing_a_recent_folder_does_not_remove_its_open_project() {
        let workspace_dir = tempfile::tempdir().unwrap();
        let startup = workspace_dir.path().join("server-startup");
        std::fs::create_dir(&startup).unwrap();
        let root_a = workspace_dir.path().join("project-a");
        let root_b = workspace_dir.path().join("project-b");
        create_git_project(&root_a, "alpha");
        create_git_project(&root_b, "beta");
        let config_path = workspace_dir.path().join("workspaces.json");
        let (diagnostics, _) = tokio::sync::mpsc::channel(1);
        let mut manager = WorkspaceManager::new_with_config_path(
            startup,
            config_path,
            crate::config::get(),
            diagnostics,
        );
        let project_a = manager.add_project(&root_a).unwrap();
        let project_b = manager.add_project(&root_b).unwrap();

        let recent = manager.remove_recent_workspace(&project_a.root);

        assert!(!recent.iter().any(|item| item.path == project_a.root));
        assert!(manager.get(&project_a.id).is_some());
        assert!(manager.get(&project_b.id).is_some());
    }

    #[tokio::test]
    async fn same_relative_file_and_git_status_remain_scoped_to_each_project() {
        let workspace_dir = tempfile::tempdir().unwrap();
        let startup = workspace_dir.path().join("server-startup");
        std::fs::create_dir(&startup).unwrap();
        let root_a = workspace_dir.path().join("project-a");
        let root_b = workspace_dir.path().join("project-b");
        create_git_project(&root_a, "alpha");
        create_git_project(&root_b, "beta");
        let config_path = workspace_dir.path().join("workspaces.json");
        let (diagnostics, _) = tokio::sync::mpsc::channel(1);
        let mut manager = WorkspaceManager::new_with_config_path(
            startup.clone(),
            config_path.clone(),
            crate::config::get(),
            diagnostics,
        );
        let project_a = manager.add_project(&root_a).unwrap();
        let project_b = manager.add_project(&root_b).unwrap();

        assert_ne!(project_a.id, project_b.id);
        assert_eq!(
            std::fs::read_to_string(Path::new(&project_a.root).join("src/main.rs")).unwrap(),
            "alpha"
        );
        assert_eq!(
            std::fs::read_to_string(Path::new(&project_b.root).join("src/main.rs")).unwrap(),
            "beta"
        );

        std::fs::write(root_a.join("src/main.rs"), "alpha updated").unwrap();
        let a = manager.get(&project_a.id).unwrap();
        let b = manager.get(&project_b.id).unwrap();
        let status_a = a.git.lock().await.status().unwrap();
        let status_b = b.git.lock().await.status().unwrap();
        assert_eq!(status_a.files.len(), 1);
        assert_eq!(
            Path::new(&status_a.files[0].path).canonicalize().unwrap(),
            Path::new(&project_a.root).join("src/main.rs").canonicalize().unwrap()
        );
        assert!(status_b.files.is_empty());

        std::fs::write(root_b.join("src/main.rs"), "beta updated").unwrap();
        assert_eq!(b.git.lock().await.status().unwrap().files.len(), 1);

        manager.remove_project(&project_a.id).unwrap();
        assert!(manager.get(&project_a.id).is_none());
        assert!(manager.get(&project_b.id).is_some());
        drop(manager);

        let (diagnostics, _) = tokio::sync::mpsc::channel(1);
        let restored = WorkspaceManager::new_with_config_path(
            startup,
            config_path,
            crate::config::get(),
            diagnostics,
        );
        assert!(restored.get(&project_a.id).is_none());
        assert!(restored.get(&project_b.id).is_some());
    }

    fn create_git_project(root: &Path, contents: &str) {
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("src/main.rs"), contents).unwrap();
        let repo = git2::Repository::init(root).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("src/main.rs")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let signature = git2::Signature::now("Anycode test", "test@example.invalid").unwrap();
        repo.commit(Some("HEAD"), &signature, &signature, "initial", &tree, &[])
            .unwrap();
    }
}

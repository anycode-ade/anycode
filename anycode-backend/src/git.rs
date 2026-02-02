use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use git2::{Repository, Status, StatusOptions};
use anyhow::{Context, Result};
use tracing::info;

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileStatus {
    Modified, Added, Deleted, Renamed, Conflict,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct GitFileStatus {
    pub path: String,
    pub status: FileStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct GitStatus {
    pub files: Vec<GitFileStatus>,
    pub branch: String,
}

impl GitStatus {
    pub fn to_json(&self) -> Value {
        json!({
            "files": self.files,
            "branch": self.branch
        })
    }
}

#[derive(Debug, Clone)]
pub struct FileOriginal {
    pub content: String,
    pub is_new: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PullResult {
    UpToDate,
    FastForward,
    Merged,
    Conflict { files: Vec<String> },
}

impl PullResult {
    pub fn to_json(&self) -> Value {
        match self {
            PullResult::UpToDate => json!({ "status": "up_to_date" }),
            PullResult::FastForward => json!({ "status": "fast_forward" }),
            PullResult::Merged => json!({ "status": "merged" }),
            PullResult::Conflict { files } => json!({ "status": "conflict", "files": files }),
        }
    }
}

pub struct GitManager {
    workdir: PathBuf,
    status_cache: GitStatus,
}

impl GitManager {
    pub fn new(workdir: PathBuf) -> Self {
        Self {
            workdir,
            status_cache: GitStatus::default(),
        }
    }

    fn repo(&self) -> Result<Repository> {
        Repository::discover(&self.workdir).context("Failed to discover git repository")
    }

    /// Check if a path should be ignored (in .git or gitignored)
    pub fn should_ignore(&self, path_str: &str) -> bool {
        // Skip .git directory
        if path_str.contains("/.git/") || path_str.ends_with("/.git") {
            return true;
        }

        // Try to check gitignore
        if let Ok(repo) = self.repo() {
            let workdir_str = match self.workdir.to_str() {
                Some(s) => s,
                None => return false,
            };

            let relative_path = if path_str.starts_with(workdir_str) {
                &path_str[workdir_str.len()..]
            } else {
                path_str
            };
            let relative_path = relative_path.trim_start_matches('/');

            if let Ok(ignored) = repo.status_should_ignore(Path::new(relative_path)) {
                return ignored;
            }
        }

        false
    }

    /// Get current git status
    pub fn status(&self) -> Result<GitStatus> {
        let repo = self.repo()?;

        let branch = repo.head()
            .map(|h| h.shorthand().unwrap_or("HEAD").to_string())
            .unwrap_or_else(|_| "HEAD".to_string());

        let mut opts = StatusOptions::new();
        opts.include_untracked(true)
            .recurse_untracked_dirs(true)
            .include_ignored(false);

        let statuses = repo.statuses(Some(&mut opts))?;

        let mut files: Vec<GitFileStatus> = Vec::new();

        for entry in statuses.iter() {
            let path = entry.path().unwrap_or("").to_string();
            let status = entry.status();

            let file_status = if status.contains(Status::WT_NEW) || status.contains(Status::INDEX_NEW) {
                FileStatus::Added
            } else if status.contains(Status::WT_DELETED) || status.contains(Status::INDEX_DELETED) {
                FileStatus::Deleted
            } else if status.contains(Status::WT_MODIFIED) || status.contains(Status::INDEX_MODIFIED) {
                FileStatus::Modified
            } else if status.contains(Status::WT_RENAMED) || status.contains(Status::INDEX_RENAMED) {
                FileStatus::Renamed
            } else {
                continue;
            };

            files.push(GitFileStatus { path, status: file_status });
        }

        info!("Git status: {} files changed on branch {}", files.len(), branch);

        Ok(GitStatus { files, branch })
    }

    /// Check if status changed, update cache, return new status if changed
    pub fn check_status_changed(&mut self) -> Option<GitStatus> {
        let new_status = match self.status() {
            Ok(s) => s,
            Err(_) => return None,
        };

        if self.status_cache != new_status {
            info!("Git status changed: {} files on branch {}", new_status.files.len(), new_status.branch);
            self.status_cache = new_status.clone();
            Some(new_status)
        } else {
            None
        }
    }

    /// Get original file content from HEAD
    pub fn file_original(&self, path: &str) -> Result<FileOriginal> {
        let repo = self.repo()?;
        let head = repo.head()?;
        let commit = head.peel_to_commit()?;
        let tree = commit.tree()?;

        // Convert absolute path to relative path from repo root
        let repo_path = repo.workdir().unwrap_or(Path::new("."));
        let file_path = Path::new(path);

        let relative_path = if file_path.is_absolute() {
            file_path.strip_prefix(repo_path)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| path.to_string())
        } else {
            path.to_string()
        };

        // Get file from tree - if not found, it's a new file
        let entry = match tree.get_path(Path::new(&relative_path)) {
            Ok(e) => e,
            Err(_) => {
                return Ok(FileOriginal { content: String::new(), is_new: true });
            }
        };

        let blob = repo.find_blob(entry.id())?;
        let content = std::str::from_utf8(blob.content())?.to_string();

        info!("Got original content for {}: {} bytes", relative_path, content.len());
        Ok(FileOriginal { content, is_new: false })
    }

    /// Commit files
    pub fn commit(&self, files: &[String], message: &str) -> Result<()> {
        let repo = self.repo()?;
        let mut index = repo.index()?;

        let repo_root = repo.workdir().unwrap_or(Path::new("."));
        for file_path in files {
            let path = Path::new(file_path);
            let relative_path = if path.is_absolute() {
                path.strip_prefix(repo_root).unwrap_or(path)
            } else {
                path
            };

            let full_path = repo_root.join(relative_path);
            if full_path.exists() {
                index.add_path(relative_path)?;
            } else {
                index.remove_path(relative_path)?;
            }
        }

        index.write()?;

        let tree_id = index.write_tree()?;
        let tree = repo.find_tree(tree_id)?;

        let sig = repo.signature().or_else(|_| {
            git2::Signature::now("Anycode User", "user@anycode.dev")
        })?;

        let parents: Vec<git2::Commit> = repo.head()
            .ok()
            .and_then(|h| h.peel_to_commit().ok())
            .map(|c| vec![c])
            .unwrap_or_default();

        let parents_refs: Vec<&git2::Commit> = parents.iter().collect();

        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parents_refs)
            .context("Failed to commit")?;

        info!("Committed {} files: {}", files.len(), message);
        Ok(())
    }

    /// Push to remote
    pub fn push(&self) -> Result<()> {
        let repo = self.repo()?;
        let mut remote = repo.find_remote("origin")?;
        let head = repo.head()?;

        let branch_name = head.shorthand()
            .context("Detached HEAD state")?;

        let refspec = format!("refs/heads/{}:refs/heads/{}", branch_name, branch_name);

        let mut callbacks = git2::RemoteCallbacks::new();
        callbacks.credentials(|_url, username_from_url, _allowed_types| {
            git2::Cred::ssh_key_from_agent(username_from_url.unwrap_or("git"))
        });

        let mut push_opts = git2::PushOptions::new();
        push_opts.remote_callbacks(callbacks);

        remote.push(&[&refspec], Some(&mut push_opts))?;

        info!("Pushed to origin/{}", branch_name);
        Ok(())
    }

    /// Pull from remote
    pub fn pull(&self) -> Result<PullResult> {
        let repo = self.repo()?;
        let mut remote = repo.find_remote("origin")?;
        let head = repo.head()?;
        let branch_name = head.shorthand()
            .context("Detached HEAD state")?;

        // Fetch from remote
        let mut callbacks = git2::RemoteCallbacks::new();
        callbacks.credentials(|_url, username_from_url, _allowed_types| {
            git2::Cred::ssh_key_from_agent(username_from_url.unwrap_or("git"))
        });

        let mut fetch_opts = git2::FetchOptions::new();
        fetch_opts.remote_callbacks(callbacks);

        remote.fetch(&[branch_name], Some(&mut fetch_opts), None)?;

        let fetch_head = repo.find_reference("FETCH_HEAD")?;
        let remote_commit = repo.reference_to_annotated_commit(&fetch_head)?;

        let (analysis, _) = repo.merge_analysis(&[&remote_commit])?;

        if analysis.is_up_to_date() {
            info!("Git pull: already up to date");
            return Ok(PullResult::UpToDate);
        }

        if analysis.is_fast_forward() {
            let refname = format!("refs/heads/{}", branch_name);
            let mut reference = repo.find_reference(&refname)?;
            reference.set_target(remote_commit.id(), "Fast-forward pull")?;

            let checkout_result = repo.checkout_head(Some(
                git2::build::CheckoutBuilder::default().safe()
            ));

            if let Err(e) = checkout_result {
                reference.set_target(head.target().unwrap(), "Revert failed pull")?;
                anyhow::bail!("Pull would overwrite uncommitted changes: {}", e);
            }

            info!("Git pull: fast-forward to {}", remote_commit.id());
            return Ok(PullResult::FastForward);
        }

        // Need to merge
        repo.merge(&[&remote_commit], None, None)?;

        let mut index = repo.index()?;

        if index.has_conflicts() {
            let conflicts: Vec<String> = index.conflicts()?
                .filter_map(|c| c.ok())
                .filter_map(|c| c.our.or(c.their).or(c.ancestor))
                .filter_map(|entry| String::from_utf8(entry.path).ok())
                .collect();

            let checkout_result = repo.checkout_index(None, Some(
                git2::build::CheckoutBuilder::default()
                    .allow_conflicts(true)
                    .conflict_style_merge(true)
                    .safe()
            ));

            if let Err(e) = checkout_result {
                repo.cleanup_state()?;
                anyhow::bail!("Failed to write conflict markers: {}", e);
            }

            info!("Git pull: conflicts in {:?}", conflicts);
            return Ok(PullResult::Conflict { files: conflicts });
        }

        // No conflicts - create merge commit
        let tree_id = index.write_tree()?;
        let tree = repo.find_tree(tree_id)?;

        let sig = repo.signature().or_else(|_| {
            git2::Signature::now("Anycode User", "user@anycode.dev")
        })?;

        let local_commit = head.peel_to_commit()?;
        let remote_commit_obj = repo.find_commit(remote_commit.id())?;

        repo.commit(
            Some("HEAD"),
            &sig,
            &sig,
            &format!("Merge remote-tracking branch 'origin/{}'", branch_name),
            &tree,
            &[&local_commit, &remote_commit_obj]
        )?;

        repo.cleanup_state()?;

        info!("Git pull: merged successfully");
        Ok(PullResult::Merged)
    }

    /// Revert file to HEAD or delete if untracked
    pub fn revert(&self, path: &str) -> Result<()> {
        let repo = self.repo()?;
        let repo_root = repo.workdir().unwrap_or(Path::new("."));

        let file_path = Path::new(path);
        let relative_path = if file_path.is_absolute() {
            file_path.strip_prefix(repo_root).unwrap_or(file_path)
        } else {
            file_path
        };

        // Check file status
        let mut opts = StatusOptions::new();
        opts.include_untracked(true).pathspec(path);

        let statuses = repo.statuses(Some(&mut opts))?;
        let is_new_file = statuses.iter().any(|entry| {
            entry.status().contains(Status::WT_NEW) ||
            entry.status().contains(Status::INDEX_NEW)
        });

        if is_new_file {
            let full_path = repo_root.join(relative_path);
            if full_path.exists() {
                std::fs::remove_file(&full_path)
                    .context("Failed to delete untracked file")?;
            }
            info!("Git revert: deleted untracked file {}", path);
        } else {
            let mut checkout_opts = git2::build::CheckoutBuilder::new();
            checkout_opts.path(relative_path).force();
            repo.checkout_head(Some(&mut checkout_opts))
                .context("Failed to restore file from HEAD")?;
            info!("Git revert: restored {} from HEAD", path);
        }

        Ok(())
    }
}

use anyhow::{Context, Result};
use git2::{Repository, Status, StatusOptions};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tracing::info;

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileStatus {
    Modified,
    Added,
    Deleted,
    Renamed,
    Conflict,
}


#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct GitFileStatus {
    pub path: String,
    pub status: FileStatus,
    pub added: usize,
    pub removed: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct GitStatus {
    pub files: Vec<GitFileStatus>,
    pub branch: String,
}

impl GitStatus {
    pub fn to_json(&self) -> Value {
        json!({
            "kind": "full",
            "files": self.files,
            "branch": self.branch
        })
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct GitStatusPatchFile {
    pub path: String,
    pub status: String,
    pub added: usize,
    pub removed: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitStatusUpdate {
    Full(GitStatus),
    Patch {
        branch: String,
        files: Vec<GitStatusPatchFile>,
    },
}

impl GitStatusUpdate {
    pub fn to_json(&self) -> Value {
        match self {
            Self::Full(status) => status.to_json(),
            Self::Patch { branch, files } => json!({
                "kind": "patch",
                "branch": branch,
                "files": files,
            }),
        }
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

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct GitBranchInfo {
    pub name: String,
    pub is_current: bool,
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
    pub fn should_ignore(&self, path: &Path) -> bool {
        let path_str = path.to_string_lossy();
        let path_str = path_str.as_ref();

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

    fn collect_numstat(repo: &Repository) -> Result<HashMap<String, (usize, usize)>> {
        let mut opts = git2::DiffOptions::new();
        opts.include_untracked(true)
            .recurse_untracked_dirs(true)
            .include_typechange(true);

        let head_tree = repo
            .head()
            .ok()
            .and_then(|head| head.peel_to_tree().ok());

        let diff = repo.diff_tree_to_workdir_with_index(head_tree.as_ref(), Some(&mut opts))?;

        let mut numstat_by_path: HashMap<String, (usize, usize)> = HashMap::new();

        diff.foreach(
            &mut |_delta, _progress| true,
            None,
            None,
            Some(&mut |delta, _hunk, line| {
                let Some(path) = delta
                    .new_file()
                    .path()
                    .or_else(|| delta.old_file().path())
                    .map(|p| p.to_string_lossy().to_string())
                else {
                    return true;
                };

                let entry = numstat_by_path.entry(path).or_insert((0, 0));
                match line.origin() {
                    '+' => entry.0 += 1,
                    '-' => entry.1 += 1,
                    _ => {}
                }
                true
            }),
        )?;

        Ok(numstat_by_path)
    }

    /// Get current git status
    pub fn status(&self) -> Result<GitStatus> {
        let repo = self.repo()?;
        let repo_root = repo.workdir().unwrap_or(Path::new("."));
        let numstat_by_path = Self::collect_numstat(&repo)?;

        let branch = Self::branch_name(&repo);

        let mut opts = StatusOptions::new();
        opts.include_untracked(true)
            .recurse_untracked_dirs(true)
            .include_ignored(false);

        let statuses = repo.statuses(Some(&mut opts))?;

        let mut files: Vec<GitFileStatus> = Vec::new();

        for entry in statuses.iter() {
            let relative_path = entry.path().unwrap_or("");
            if let Some(file_status) = Self::status_from_entry(
                repo_root,
                relative_path,
                entry.status(),
                numstat_by_path
                    .get(relative_path)
                    .map(|(added, _)| *added)
                    .unwrap_or(0),
                numstat_by_path
                    .get(relative_path)
                    .map(|(_, removed)| *removed)
                    .unwrap_or(0),
            ) {
                files.push(file_status);
            }
        }

        info!(
            "Git status: {} files changed on branch {}",
            files.len(),
            branch
        );

        Ok(GitStatus { files, branch })
    }

    /// Check if status changed, update cache, return new status if changed
    pub fn check_status_changed(&mut self) -> Option<GitStatus> {
        let new_status = match self.status() {
            Ok(s) => s,
            Err(_) => return None,
        };

        if self.status_cache != new_status {
            info!(
                "Git status changed: {} files on branch {}",
                new_status.files.len(),
                new_status.branch
            );
            self.status_cache = new_status.clone();
            Some(new_status)
        } else {
            None
        }
    }

    pub fn refresh_status_cache(&mut self) -> Result<GitStatus> {
        let status = self.status()?;
        self.status_cache = status.clone();
        Ok(status)
    }

    pub fn check_status_changed_for_paths(&mut self, paths: &[PathBuf]) -> Option<GitStatusUpdate> {
        let repo = self.repo().ok()?;
        let repo_root = repo.workdir().unwrap_or(Path::new("."));
        let branch = Self::branch_name(&repo);

        if self.status_cache.branch != branch {
            let full = self.status().ok()?;
            if self.status_cache != full {
                self.status_cache = full.clone();
                return Some(GitStatusUpdate::Full(full));
            }
            return None;
        }

        let mut patch_files: Vec<GitStatusPatchFile> = Vec::new();

        for path in paths {
            let Some(relative_path) = self.to_repo_relative_path(path, repo_root) else {
                let full = self.status().ok()?;
                if self.status_cache != full {
                    self.status_cache = full.clone();
                    return Some(GitStatusUpdate::Full(full));
                }
                return None;
            };
            if relative_path.is_empty() {
                continue;
            }

            let abs_path = repo_root.join(&relative_path).to_string_lossy().to_string();
            let next_file = self.status_for_relative_path(&repo, &relative_path).ok()?;
            let prev_index = self.status_cache.files.iter().position(|f| f.path == abs_path);
            let prev_file = prev_index.and_then(|idx| self.status_cache.files.get(idx).cloned());

            if prev_file == next_file {
                continue;
            }

            if let Some(idx) = prev_index {
                self.status_cache.files.remove(idx);
            }
            if let Some(file) = next_file.clone() {
                self.status_cache.files.push(file);
            }

            match next_file {
                Some(file) => patch_files.push(GitStatusPatchFile {
                    path: file.path,
                    status: Self::status_to_str(file.status).to_string(),
                    added: file.added,
                    removed: file.removed,
                }),
                None => patch_files.push(GitStatusPatchFile {
                    path: abs_path,
                    status: "removed".to_string(),
                    added: 0,
                    removed: 0,
                }),
            }
        }

        if patch_files.is_empty() {
            return None;
        }

        self.status_cache.branch = branch.clone();
        Some(GitStatusUpdate::Patch {
            branch,
            files: patch_files,
        })
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
            file_path
                .strip_prefix(repo_path)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| path.to_string())
        } else {
            path.to_string()
        };

        // Get file from tree - if not found, it's a new file
        let entry = match tree.get_path(Path::new(&relative_path)) {
            Ok(e) => e,
            Err(_) => {
                return Ok(FileOriginal {
                    content: String::new(),
                    is_new: true,
                });
            }
        };

        let blob = repo.find_blob(entry.id())?;
        let content = std::str::from_utf8(blob.content())?.to_string();

        info!(
            "Got original content for {}: {} bytes",
            relative_path,
            content.len()
        );
        Ok(FileOriginal {
            content,
            is_new: false,
        })
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

        let sig = repo
            .signature()
            .or_else(|_| git2::Signature::now("Anycode User", "user@anycode.dev"))?;

        let parents: Vec<git2::Commit> = repo
            .head()
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

        let branch_name = head.shorthand().context("Detached HEAD state")?;

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

    pub fn list_branches(&self) -> Result<Vec<GitBranchInfo>> {
        let repo = self.repo()?;
        let current_branch = Self::branch_name(&repo);
        let mut branches = Vec::new();

        for branch_result in repo.branches(Some(git2::BranchType::Local))? {
            let (branch, _) = branch_result?;
            if let Some(name) = branch.name()? {
                branches.push(GitBranchInfo {
                    name: name.to_string(),
                    is_current: name == current_branch,
                });
            }
        }

        branches.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(branches)
    }

    pub fn checkout_branch(&self, branch: &str) -> Result<()> {
        let repo = self.repo()?;
        let mut status_opts = StatusOptions::new();
        status_opts
            .include_untracked(true)
            .recurse_untracked_dirs(true)
            .include_ignored(false);
        let statuses = repo.statuses(Some(&mut status_opts))?;
        if !statuses.is_empty() {
            anyhow::bail!(
                "Failed to change branch\nGit command failed:\nYou have local changes. Please commit your changes or stash them before you switch branches."
            );
        }

        let local_branch = repo
            .find_branch(branch, git2::BranchType::Local)
            .with_context(|| format!("Local branch '{}' not found", branch))?;
        let reference = local_branch.into_reference();
        let reference_name = reference
            .name()
            .context("Invalid branch reference name")?
            .to_string();
        let target_commit = reference
            .peel_to_commit()
            .with_context(|| format!("Failed to resolve branch '{}' commit", branch))?;
        let target_tree = target_commit
            .tree()
            .with_context(|| format!("Failed to resolve branch '{}' tree", branch))?;

        repo.checkout_tree(
            target_tree.as_object(),
            Some(git2::build::CheckoutBuilder::new().safe()),
        )
        .with_context(|| format!("Failed to change branch to '{}'", branch))?;
        repo.set_head(&reference_name)
            .with_context(|| format!("Failed to set HEAD to '{}'", branch))?;

        info!("Checked out branch {}", branch);
        Ok(())
    }

    /// Pull from remote
    pub fn pull(&self) -> Result<PullResult> {
        let repo = self.repo()?;
        let mut remote = repo.find_remote("origin")?;
        let head = repo.head()?;
        let branch_name = head.shorthand().context("Detached HEAD state")?;

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

            let checkout_result =
                repo.checkout_head(Some(git2::build::CheckoutBuilder::default().safe()));

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
            let conflicts: Vec<String> = index
                .conflicts()?
                .filter_map(|c| c.ok())
                .filter_map(|c| c.our.or(c.their).or(c.ancestor))
                .filter_map(|entry| String::from_utf8(entry.path).ok())
                .collect();

            let checkout_result = repo.checkout_index(
                None,
                Some(
                    git2::build::CheckoutBuilder::default()
                        .allow_conflicts(true)
                        .conflict_style_merge(true)
                        .safe(),
                ),
            );

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

        let sig = repo
            .signature()
            .or_else(|_| git2::Signature::now("Anycode User", "user@anycode.dev"))?;

        let local_commit = head.peel_to_commit()?;
        let remote_commit_obj = repo.find_commit(remote_commit.id())?;

        repo.commit(
            Some("HEAD"),
            &sig,
            &sig,
            &format!("Merge remote-tracking branch 'origin/{}'", branch_name),
            &tree,
            &[&local_commit, &remote_commit_obj],
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
            entry.status().contains(Status::WT_NEW) || entry.status().contains(Status::INDEX_NEW)
        });

        if is_new_file {
            let full_path = repo_root.join(relative_path);
            if full_path.exists() {
                std::fs::remove_file(&full_path).context("Failed to delete untracked file")?;
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
    fn branch_name(repo: &Repository) -> String {
        repo.head()
            .map(|h| h.shorthand().unwrap_or("HEAD").to_string())
            .unwrap_or_else(|_| "HEAD".to_string())
    }

    fn status_from_entry(
        repo_root: &Path,
        relative_path: &str,
        status: Status,
        added: usize,
        removed: usize,
    ) -> Option<GitFileStatus> {
        let file_status = if status.contains(Status::WT_NEW) || status.contains(Status::INDEX_NEW) {
            FileStatus::Added
        } else if status.contains(Status::WT_DELETED) || status.contains(Status::INDEX_DELETED) {
            FileStatus::Deleted
        } else if status.contains(Status::WT_MODIFIED) || status.contains(Status::INDEX_MODIFIED) {
            FileStatus::Modified
        } else if status.contains(Status::WT_RENAMED) || status.contains(Status::INDEX_RENAMED) {
            FileStatus::Renamed
        } else if status.contains(Status::CONFLICTED) {
            FileStatus::Conflict
        } else {
            return None;
        };

        let added = if matches!(file_status, FileStatus::Added) && added == 0 {
            let abs_path = repo_root.join(relative_path);
            match std::fs::read_to_string(&abs_path) {
                Ok(content) if !content.is_empty() => content.lines().count().max(1),
                _ => 0,
            }
        } else {
            added
        };

        Some(GitFileStatus {
            path: repo_root.join(relative_path).to_string_lossy().to_string(),
            status: file_status,
            added,
            removed,
        })
    }

    fn status_to_str(status: FileStatus) -> &'static str {
        match status {
            FileStatus::Modified => "modified",
            FileStatus::Added => "added",
            FileStatus::Deleted => "deleted",
            FileStatus::Renamed => "renamed",
            FileStatus::Conflict => "conflict",
        }
    }

    fn to_repo_relative_path(&self, path: &Path, repo_root: &Path) -> Option<String> {
        let abs = if path.is_absolute() {
            path.to_path_buf()
        } else {
            self.workdir.join(path)
        };
        abs.strip_prefix(repo_root)
            .ok()
            .map(|p| p.to_string_lossy().replace('\\', "/"))
    }

    fn numstat_for_path(repo: &Repository, relative_path: &str) -> Result<(usize, usize)> {
        let mut opts = git2::DiffOptions::new();
        opts.include_untracked(true)
            .recurse_untracked_dirs(true)
            .include_typechange(true)
            .pathspec(relative_path);

        let head_tree = repo.head().ok().and_then(|head| head.peel_to_tree().ok());
        let diff = repo.diff_tree_to_workdir_with_index(head_tree.as_ref(), Some(&mut opts))?;

        let mut added = 0usize;
        let mut removed = 0usize;
        diff.foreach(
            &mut |_delta, _progress| true,
            None,
            None,
            Some(&mut |_delta, _hunk, line| {
                match line.origin() {
                    '+' => added += 1,
                    '-' => removed += 1,
                    _ => {}
                }
                true
            }),
        )?;
        Ok((added, removed))
    }

    fn status_for_relative_path(&self, repo: &Repository, relative_path: &str) -> Result<Option<GitFileStatus>> {
        let repo_root = repo.workdir().unwrap_or(Path::new("."));
        let mut opts = StatusOptions::new();
        opts.include_untracked(true)
            .recurse_untracked_dirs(true)
            .include_ignored(false)
            .pathspec(relative_path);

        let statuses = repo.statuses(Some(&mut opts))?;
        let (added, removed) = Self::numstat_for_path(repo, relative_path).unwrap_or((0, 0));

        for entry in statuses.iter() {
            let Some(entry_path) = entry.path() else {
                continue;
            };
            if entry_path != relative_path {
                continue;
            }
            if let Some(file) = Self::status_from_entry(repo_root, entry_path, entry.status(), added, removed) {
                return Ok(Some(file));
            }
        }
        Ok(None)
    }
}

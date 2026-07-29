use anyhow::{Context, Result};
use git2::{Repository, Status, StatusOptions};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tracing::info;

use crate::utils::format_path;

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
    pub staged: bool,
    pub unstaged: bool,
    pub conflicted: bool,
    pub added: usize,
    pub removed: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct GitStatus {
    pub files: Vec<GitFileStatus>,
    pub branch: String,
    pub head_hash: String,
}

impl GitStatus {
    pub fn to_json(&self) -> Value {
        json!({
            "kind": "full",
            "files": self.files,
            "branch": self.branch,
            "head_hash": self.head_hash
        })
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct GitStatusPatchFile {
    pub path: String,
    pub status: String,
    pub staged: bool,
    pub unstaged: bool,
    pub conflicted: bool,
    pub added: usize,
    pub removed: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitStatusUpdate {
    Full(GitStatus),
    Patch {
        branch: String,
        head_hash: String,
        files: Vec<GitStatusPatchFile>,
    },
}

impl GitStatusUpdate {
    pub fn to_json(&self) -> Value {
        match self {
            Self::Full(status) => status.to_json(),
            Self::Patch {
                branch,
                head_hash,
                files,
            } => json!({
                "kind": "patch",
                "branch": branch,
                "head_hash": head_hash,
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

#[derive(Debug, Clone, PartialEq, Eq)]
struct GitMetadataSnapshot {
    index: Option<FileStamp>,
    head: Option<FileStamp>,
    current_ref: Option<FileStamp>,
    packed_refs: Option<FileStamp>,
    merge_head: Option<FileStamp>,
    rebase_merge: Option<FileStamp>,
    rebase_apply: Option<FileStamp>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct FileStamp {
    modified: Option<std::time::SystemTime>,
    len: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct NumstatCacheEntry {
    head_sha1: Option<[u8; 20]>,
    mtime_sec: u32,
    mtime_nsec: u32,
    file_size: u32,
    added: usize,
    removed: usize,
}

struct BoundedContentCache {
    head_hash: String,
    entries: HashMap<String, Option<String>>,
    order: std::collections::VecDeque<String>,
}

impl BoundedContentCache {
    fn new(head_hash: String) -> Self {
        Self {
            head_hash,
            entries: HashMap::new(),
            order: std::collections::VecDeque::new(),
        }
    }

    fn get(&self, path: &str) -> Option<&Option<String>> {
        self.entries.get(path)
    }

    fn insert(&mut self, path: String, content: Option<String>) {
        if !self.entries.contains_key(&path) {
            self.order.push_back(path.clone());
            if self.order.len() > 100 {
                if let Some(oldest) = self.order.pop_front() {
                    self.entries.remove(&oldest);
                }
            }
        }
        self.entries.insert(path, content);
    }
}

pub struct GitManager {
    workdir: PathBuf,
    status_cache: GitStatus,
    last_git_snapshot: Option<GitMetadataSnapshot>,
    index_cache: Option<(FileStamp, HashMap<String, IndexEntry>)>,
    head_blob_cache: Option<(String, HashMap<String, Option<[u8; 20]>>)>,
    numstat_cache: HashMap<String, NumstatCacheEntry>,
    head_blob_content_cache: Option<BoundedContentCache>,
    repo_cache: std::sync::OnceLock<Repository>,
}

#[derive(Debug, Clone, Copy)]
struct IndexEntry {
    mtime_sec: u32,
    mtime_nsec: u32,
    file_size: u32,
    sha1: [u8; 20],
    stage: u8,
}

enum IndexLookup {
    Available(Option<IndexEntry>),
    Unavailable,
}

impl GitManager {
    pub fn new(workdir: PathBuf) -> Self {
        Self {
            workdir,
            status_cache: GitStatus::default(),
            last_git_snapshot: None,
            index_cache: None,
            head_blob_cache: None,
            numstat_cache: HashMap::new(),
            head_blob_content_cache: None,
            repo_cache: std::sync::OnceLock::new(),
        }
    }

    fn repo(&self) -> Result<&Repository> {
        if let Some(r) = self.repo_cache.get() {
            return Ok(r);
        }
        let r = Repository::discover(&self.workdir).context("Failed to discover git repository")?;
        let _ = self.repo_cache.set(r);
        Ok(self.repo_cache.get().unwrap())
    }

    fn git_metadata_snapshot(&self) -> Result<GitMetadataSnapshot> {
        let git_dir = self.git_dir()?;
        let head_ref = Self::head_ref_path(&git_dir);

        Ok(GitMetadataSnapshot {
            index: Self::file_stamp(&git_dir.join("index")),
            head: Self::file_stamp(&git_dir.join("HEAD")),
            current_ref: head_ref.as_ref().and_then(|path| Self::file_stamp(path)),
            packed_refs: Self::file_stamp(&git_dir.join("packed-refs")),
            merge_head: Self::file_stamp(&git_dir.join("MERGE_HEAD")),
            rebase_merge: Self::file_stamp(&git_dir.join("rebase-merge")),
            rebase_apply: Self::file_stamp(&git_dir.join("rebase-apply")),
        })
    }

    fn git_dir(&self) -> Result<PathBuf> {
        let repo = self.repo()?;
        Ok(repo.path().to_path_buf())
    }

    fn file_stamp(path: &Path) -> Option<FileStamp> {
        let meta = std::fs::metadata(path).ok()?;
        Some(FileStamp {
            modified: meta.modified().ok(),
            len: meta.len(),
        })
    }

    fn head_ref_path(git_dir: &Path) -> Option<PathBuf> {
        let head = std::fs::read_to_string(git_dir.join("HEAD")).ok()?;
        let ref_name = head.strip_prefix("ref: ")?.trim();
        Some(git_dir.join(ref_name))
    }

    fn sort_files(files: &mut [GitFileStatus]) {
        files.sort_by(|a, b| {
            a.path
                .cmp(&b.path)
                .then_with(|| Self::status_to_str(a.status).cmp(Self::status_to_str(b.status)))
                .then_with(|| a.staged.cmp(&b.staged))
                .then_with(|| a.unstaged.cmp(&b.unstaged))
                .then_with(|| a.conflicted.cmp(&b.conflicted))
                .then_with(|| a.added.cmp(&b.added))
                .then_with(|| a.removed.cmp(&b.removed))
        });
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

        let head_tree = repo.head().ok().and_then(|head| head.peel_to_tree().ok());

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

        Self::sort_files(&mut files);

        let head_hash = Self::head_hash_of(&repo);
        Ok(GitStatus {
            files,
            branch,
            head_hash,
        })
    }

    /// Check if status changed, update cache, return new status if changed
    pub fn check_status_changed(&mut self) -> Option<GitStatus> {
        let snapshot = self.git_metadata_snapshot().ok()?;

        if self
            .last_git_snapshot
            .as_ref()
            .is_some_and(|last| last == &snapshot)
        {
            return None;
        }

        self.last_git_snapshot = Some(snapshot);

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
        self.last_git_snapshot = self.git_metadata_snapshot().ok();
        self.status_cache = status.clone();
        Ok(status)
    }

    pub fn check_status_changed_for_paths(&mut self, paths: &[PathBuf]) -> Option<GitStatusUpdate> {
        if self.status_cache.files.is_empty() && self.status_cache.branch.is_empty() {
            let full = self.status().ok()?;
            self.status_cache = full.clone();
            return Some(GitStatusUpdate::Full(full));
        }

        let repo_root;
        let branch;
        let head_hash;
        {
            let repo = self.repo().ok()?;
            repo_root = repo
                .workdir()
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| Path::new(".").to_path_buf());
            branch = Self::branch_name(repo);
            head_hash = Self::head_hash_of(repo);
        }

        if self.status_cache.branch != branch || self.status_cache.head_hash != head_hash {
            let full = self.status().ok()?;
            if self.status_cache != full {
                self.status_cache = full.clone();
                return Some(GitStatusUpdate::Full(full));
            }
            return None;
        }

        let mut patch_files: Vec<GitStatusPatchFile> = Vec::new();

        for path in paths {
            let Some(relative_path) = self.to_repo_relative_path(path, &repo_root) else {
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
            let next_file = match self.status_for_relative_path(&relative_path) {
                Ok(file) => file,
                Err(e) => {
                    tracing::warn!("Failed to get status for {}: {}", abs_path, e);
                    continue;
                }
            };
            let prev_index = self
                .status_cache
                .files
                .iter()
                .position(|f| f.path == abs_path);

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
            Self::sort_files(&mut self.status_cache.files);

            match next_file {
                Some(file) => patch_files.push(GitStatusPatchFile {
                    path: file.path,
                    status: Self::status_to_str(file.status).to_string(),
                    staged: file.staged,
                    unstaged: file.unstaged,
                    conflicted: file.conflicted,
                    added: file.added,
                    removed: file.removed,
                }),
                None => patch_files.push(GitStatusPatchFile {
                    path: abs_path,
                    status: "removed".to_string(),
                    staged: false,
                    unstaged: false,
                    conflicted: false,
                    added: 0,
                    removed: 0,
                }),
            }
        }

        if patch_files.is_empty() {
            return None;
        }

        self.status_cache.branch = branch.clone();
        self.status_cache.head_hash = head_hash.clone();
        Some(GitStatusUpdate::Patch {
            branch,
            head_hash,
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
            let canonical_repo = repo_path
                .canonicalize()
                .unwrap_or_else(|_| repo_path.into());
            let canonical_file = file_path
                .canonicalize()
                .unwrap_or_else(|_| file_path.into());
            canonical_file
                .strip_prefix(canonical_repo)
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

    /// Commit currently staged index entries (like `git commit`)
    pub fn commit(&self, message: &str) -> Result<()> {
        let repo = self.repo()?;
        let mut index = repo.index()?;
        let head_commit = repo.head().ok().and_then(|h| h.peel_to_commit().ok());

        index.write()?;

        let tree_id = index.write_tree()?;
        let tree = repo.find_tree(tree_id)?;

        let parents: Vec<git2::Commit> = head_commit.map(|c| vec![c]).unwrap_or_default();
        let parents_refs: Vec<&git2::Commit> = parents.iter().collect();

        let sig = repo.signature()?;
        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parents_refs)
            .context("Failed to commit")?;

        info!("Committed staged index: {}", message);
        Ok(())
    }

    /// Stage file in index (like `git add <path>`)
    pub fn stage(&self, path: &str) -> Result<()> {
        let repo = self.repo()?;
        let repo_root = repo.workdir().unwrap_or(Path::new("."));
        let file_path = Path::new(path);
        let relative_path = if file_path.is_absolute() {
            file_path.strip_prefix(repo_root).unwrap_or(file_path)
        } else {
            file_path
        };

        let mut index = repo.index()?;
        if repo_root.join(relative_path).exists() {
            index.add_path(relative_path)?;
        } else {
            let _ = index.remove_path(relative_path);
        }
        index.write()?;
        Ok(())
    }

    /// Unstage file from index (like `git restore --staged <path>`)
    pub fn unstage(&self, path: &str) -> Result<()> {
        let repo = self.repo()?;
        let repo_root = repo.workdir().unwrap_or(Path::new("."));
        let file_path = Path::new(path);
        let relative_path = if file_path.is_absolute() {
            file_path.strip_prefix(repo_root).unwrap_or(file_path)
        } else {
            file_path
        };

        let head = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
        if let Some(commit) = head {
            repo.reset_default(Some(commit.as_object()), [relative_path])?;
        } else {
            let mut index = repo.index()?;
            let _ = index.remove_path(relative_path);
            index.write()?;
        }
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
            .context("Git user identity is not configured. Set user.name and user.email before creating a merge commit.")?;

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
            match file_path.strip_prefix(repo_root) {
                Ok(path) => path.to_path_buf(),
                Err(_) => {
                    let canonical_path = file_path.canonicalize().ok();
                    let canonical_root = repo_root.canonicalize().ok();
                    canonical_path
                        .as_deref()
                        .zip(canonical_root.as_deref())
                        .and_then(|(path, root)| path.strip_prefix(root).ok())
                        .map(Path::to_path_buf)
                        .context("Path to revert is outside the repository")?
                }
            }
        } else {
            file_path.to_path_buf()
        };

        if relative_path.as_os_str().is_empty()
            || relative_path.components().any(|component| {
                matches!(
                    component,
                    std::path::Component::ParentDir
                        | std::path::Component::RootDir
                        | std::path::Component::Prefix(_)
                )
            })
        {
            anyhow::bail!("Invalid repository-relative path to revert: {}", path);
        }

        // Check file status
        let mut opts = StatusOptions::new();
        opts.include_untracked(true).pathspec(&relative_path);

        let statuses = repo.statuses(Some(&mut opts))?;
        let is_new_file = statuses.iter().any(|entry| {
            entry.status().contains(Status::WT_NEW) || entry.status().contains(Status::INDEX_NEW)
        });

        if is_new_file {
            // A newly added file can be either untracked or already staged.
            // Remove an index entry as well, otherwise it remains in Changes.
            repo.reset_default(None, [&relative_path])
                .context("Failed to remove added file from the Git index")?;

            let full_path = repo_root.join(&relative_path);
            if full_path.exists() {
                std::fs::remove_file(&full_path).context("Failed to delete untracked file")?;
            }
            info!("Git revert: deleted untracked file {}", path);
        } else {
            // Reset both the index and worktree so Revert also handles staged edits.
            let head = repo.head()?.peel_to_commit()?;
            repo.reset_default(Some(head.as_object()), [&relative_path])
                .context("Failed to reset file in the Git index")?;

            let mut checkout_opts = git2::build::CheckoutBuilder::new();
            checkout_opts.path(&relative_path).force();
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

    fn head_hash_of(repo: &Repository) -> String {
        repo.head()
            .and_then(|h| h.peel_to_commit())
            .map(|c| c.id().to_string())
            .unwrap_or_default()
    }

    fn status_from_entry(
        repo_root: &Path,
        relative_path: &str,
        status: Status,
        added: usize,
        removed: usize,
    ) -> Option<GitFileStatus> {
        let conflicted = status.contains(Status::CONFLICTED);
        let staged = status.intersects(
            Status::INDEX_NEW
                | Status::INDEX_MODIFIED
                | Status::INDEX_DELETED
                | Status::INDEX_RENAMED
                | Status::INDEX_TYPECHANGE,
        );
        let unstaged = status.intersects(
            Status::WT_NEW
                | Status::WT_MODIFIED
                | Status::WT_DELETED
                | Status::WT_RENAMED
                | Status::WT_TYPECHANGE,
        );

        let file_status = if conflicted {
            FileStatus::Conflict
        } else if status.contains(Status::WT_NEW) || status.contains(Status::INDEX_NEW) {
            FileStatus::Added
        } else if status.contains(Status::WT_DELETED) || status.contains(Status::INDEX_DELETED) {
            FileStatus::Deleted
        } else if status.contains(Status::WT_MODIFIED) || status.contains(Status::INDEX_MODIFIED) {
            FileStatus::Modified
        } else if status.contains(Status::WT_RENAMED) || status.contains(Status::INDEX_RENAMED) {
            FileStatus::Renamed
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
            path: format_path(&repo_root.join(relative_path).to_string_lossy()),
            status: file_status,
            staged,
            unstaged,
            conflicted,
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

    fn get_head_blob_content_raw(repo: &Repository, relative_path: &str) -> Option<String> {
        let head = repo.head().ok()?;
        let commit = head.peel_to_commit().ok()?;
        let tree = commit.tree().ok()?;
        let entry = tree.get_path(Path::new(relative_path)).ok()?;
        let blob = repo.find_blob(entry.id()).ok()?;
        let content = std::str::from_utf8(blob.content()).ok()?;
        Some(content.to_string())
    }

    fn cached_head_blob_content(&mut self, relative_path: &str) -> Option<String> {
        let _ = self.repo().ok()?;
        let repo = self.repo_cache.get()?;
        let head_hash = Self::head_hash_of(repo);
        if head_hash.is_empty() {
            return Self::get_head_blob_content_raw(repo, relative_path);
        }

        let cache_is_current = self
            .head_blob_content_cache
            .as_ref()
            .is_some_and(|cache| cache.head_hash == head_hash);

        if !cache_is_current {
            self.head_blob_content_cache = Some(BoundedContentCache::new(head_hash));
        }

        let cache = self.head_blob_content_cache.as_mut()?;
        if let Some(cached) = cache.get(relative_path) {
            return cached.clone();
        }

        let content = Self::get_head_blob_content_raw(repo, relative_path);
        cache.insert(relative_path.to_string(), content.clone());
        content
    }

    fn numstat_in_memory(
        &mut self,
        relative_path: &str,
        file_status: &FileStatus,
    ) -> (usize, usize) {
        let repo = match self.repo() {
            Ok(r) => r,
            Err(_) => return (0, 0),
        };
        if matches!(file_status, FileStatus::Deleted) {
            if let Some(old_text) = self.cached_head_blob_content(relative_path) {
                return (0, old_text.lines().count());
            }
            return (0, 0);
        }

        let abs_path = repo.workdir().unwrap_or(Path::new(".")).join(relative_path);
        let new_text = match std::fs::read_to_string(&abs_path) {
            Ok(content) => content,
            Err(_) => return (0, 0),
        };

        if matches!(file_status, FileStatus::Added) {
            let added = if new_text.is_empty() {
                0
            } else {
                new_text.lines().count().max(1)
            };
            return (added, 0);
        }

        if let Some(old_text) = self.cached_head_blob_content(relative_path) {
            if old_text == new_text {
                return (0, 0);
            }

            let old_lines: Vec<&str> = old_text.lines().collect();
            let new_lines: Vec<&str> = new_text.lines().collect();

            let mut start = 0;
            while start < old_lines.len()
                && start < new_lines.len()
                && old_lines[start] == new_lines[start]
            {
                start += 1;
            }

            let mut old_end = old_lines.len();
            let mut new_end = new_lines.len();
            while old_end > start
                && new_end > start
                && old_lines[old_end - 1] == new_lines[new_end - 1]
            {
                old_end -= 1;
                new_end -= 1;
            }

            let old_trimmed = &old_lines[start..old_end];
            let new_trimmed = &new_lines[start..new_end];

            if old_trimmed.is_empty() {
                return (new_trimmed.len(), 0);
            }
            if new_trimmed.is_empty() {
                return (0, old_trimmed.len());
            }

            let changes =
                similar::utils::diff_slices(similar::Algorithm::Myers, old_trimmed, new_trimmed);

            let mut added = 0;
            let mut removed = 0;
            for (tag, slice) in changes {
                match tag {
                    similar::ChangeTag::Insert => added += slice.len(),
                    similar::ChangeTag::Delete => removed += slice.len(),
                    _ => {}
                }
            }
            return (added, removed);
        }

        (0, 0)
    }

    fn get_head_blob_sha1(repo: &Repository, relative_path: &str) -> Option<[u8; 20]> {
        let head = repo.head().ok()?;
        let commit = head.peel_to_commit().ok()?;
        let tree = commit.tree().ok()?;
        let entry = tree.get_path(Path::new(relative_path)).ok()?;
        let oid = entry.id();
        Some(oid.as_bytes().try_into().ok()?)
    }

    fn cached_head_blob_sha1(&mut self, relative_path: &str) -> Option<[u8; 20]> {
        let _ = self.repo().ok()?;
        let repo = self.repo_cache.get()?;
        let head_hash = Self::head_hash_of(repo);
        if head_hash.is_empty() {
            return Self::get_head_blob_sha1(repo, relative_path);
        }

        let cache_is_current = self
            .head_blob_cache
            .as_ref()
            .is_some_and(|(cached_head, _)| cached_head == &head_hash);

        if !cache_is_current {
            self.head_blob_cache = Some((head_hash, HashMap::new()));
        }

        let (_, cache) = self.head_blob_cache.as_mut()?;
        if let Some(cached) = cache.get(relative_path) {
            return *cached;
        }

        let blob_sha1 = Self::get_head_blob_sha1(repo, relative_path);
        cache.insert(relative_path.to_string(), blob_sha1);
        blob_sha1
    }

    fn parse_index(index_bytes: &[u8]) -> Option<HashMap<String, IndexEntry>> {
        if index_bytes.len() < 12 || &index_bytes[0..4] != b"DIRC" {
            return None;
        }
        let version = u32::from_be_bytes(index_bytes[4..8].try_into().ok()?);
        let num_entries = u32::from_be_bytes(index_bytes[8..12].try_into().ok()?);

        if version != 2 && version != 3 {
            return None;
        }

        let mut entries = HashMap::with_capacity(num_entries as usize);
        let mut offset = 12;
        for _ in 0..num_entries {
            if offset + 62 > index_bytes.len() {
                break;
            }

            let mtime_sec =
                u32::from_be_bytes(index_bytes[offset + 8..offset + 12].try_into().ok()?);
            let mtime_nsec =
                u32::from_be_bytes(index_bytes[offset + 12..offset + 16].try_into().ok()?);
            let file_size =
                u32::from_be_bytes(index_bytes[offset + 36..offset + 40].try_into().ok()?);

            let mut sha1 = [0u8; 20];
            sha1.copy_from_slice(&index_bytes[offset + 40..offset + 60]);

            let flags = u16::from_be_bytes(index_bytes[offset + 60..offset + 62].try_into().ok()?);
            let is_extended = (flags & 0x4000) != 0;
            let path_start = if is_extended && version == 3 {
                offset + 64
            } else {
                offset + 62
            };

            let path_len_flag = (flags & 0x0FFF) as usize;
            let path_len = if path_len_flag < 0x0FFF {
                path_len_flag
            } else {
                let mut len = 0;
                while path_start + len < index_bytes.len() && index_bytes[path_start + len] != 0 {
                    len += 1;
                }
                len
            };

            if path_start + path_len > index_bytes.len() {
                break;
            }

            let path_bytes = &index_bytes[path_start..path_start + path_len];
            if let Ok(path) = std::str::from_utf8(path_bytes) {
                let entry = IndexEntry {
                    mtime_sec,
                    mtime_nsec,
                    file_size,
                    sha1,
                    stage: ((flags >> 12) & 3) as u8,
                };

                entries
                    .entry(path.to_string())
                    .and_modify(|existing: &mut IndexEntry| {
                        if existing.stage == 0 && entry.stage > 0 {
                            *existing = entry;
                        }
                    })
                    .or_insert(entry);
            }

            let metadata_size = if is_extended && version == 3 { 64 } else { 62 };
            offset += (metadata_size + path_len + 8) & !7usize;
        }
        Some(entries)
    }

    fn cached_index_entry(&mut self, relative_path: &str) -> Result<IndexLookup> {
        let git_dir = self.git_dir()?;
        let index_path = git_dir.join("index");
        let Some(stamp) = Self::file_stamp(&index_path) else {
            self.index_cache = None;
            return Ok(IndexLookup::Unavailable);
        };

        let cache_is_current = self
            .index_cache
            .as_ref()
            .is_some_and(|(cached_stamp, _)| cached_stamp == &stamp);

        if !cache_is_current {
            let index_bytes = std::fs::read(&index_path)?;
            let Some(entries) = Self::parse_index(&index_bytes) else {
                self.index_cache = None;
                return Ok(IndexLookup::Unavailable);
            };
            self.index_cache = Some((stamp, entries));
        }

        Ok(IndexLookup::Available(self.index_cache.as_ref().and_then(
            |(_, entries)| entries.get(relative_path).copied(),
        )))
    }

    fn status_file_via_cli(&mut self, relative_path: &str) -> Result<Option<GitFileStatus>> {
        let repo_root = {
            let repo = self.repo()?;
            repo.workdir()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| self.workdir.clone())
        };

        let output = std::process::Command::new("git")
            .arg("status")
            .arg("--porcelain=v1")
            .arg("--untracked-files=all")
            .arg("--no-renames")
            .arg("-z")
            .arg("--")
            .arg(relative_path)
            .current_dir(&repo_root)
            .output()?;

        if !output.status.success() {
            return Ok(None);
        }

        let stdout = output.stdout;
        if stdout.is_empty() {
            return Ok(None);
        }

        if stdout.len() < 3 {
            return Ok(None);
        }

        let x_char = stdout[0] as char;
        let y_char = stdout[1] as char;
        let untracked = x_char == '?' && y_char == '?';

        let conflicted = x_char == 'U'
            || y_char == 'U'
            || (x_char == 'D' && y_char == 'D')
            || (x_char == 'A' && y_char == 'A');
        let staged = x_char != ' ' && x_char != '?' && x_char != '!' && !conflicted;
        let unstaged =
            untracked || (y_char != ' ' && y_char != '?' && y_char != '!' && !conflicted);

        let file_status = if conflicted {
            FileStatus::Conflict
        } else if untracked || x_char == 'A' || y_char == 'A' {
            FileStatus::Added
        } else if x_char == 'D' || y_char == 'D' {
            FileStatus::Deleted
        } else if x_char == 'M' || y_char == 'M' {
            FileStatus::Modified
        } else {
            return Ok(None);
        };

        let (mut added, removed) = self.numstat_in_memory(relative_path, &file_status);

        if matches!(file_status, FileStatus::Added) && added == 0 {
            let abs_path = repo_root.join(relative_path);
            if let Ok(content) = std::fs::read_to_string(&abs_path) {
                if !content.is_empty() {
                    added = content.lines().count().max(1);
                }
            }
        }

        let abs_path = repo_root.join(relative_path).to_string_lossy().to_string();

        Ok(Some(GitFileStatus {
            path: abs_path,
            status: file_status,
            staged,
            unstaged,
            conflicted,
            added,
            removed,
        }))
    }

    fn status_file_custom(&mut self, relative_path: &str) -> Result<Option<GitFileStatus>> {
        let index_entry = match self.cached_index_entry(relative_path)? {
            IndexLookup::Available(Some(entry)) => entry,
            IndexLookup::Available(None) => return self.status_file_via_cli(relative_path),
            IndexLookup::Unavailable => return self.status_file_via_cli(relative_path),
        };

        let repo_root = {
            let repo = self.repo()?;
            repo.workdir()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| self.workdir.clone())
        };
        let abs_path = repo_root.join(relative_path);
        let metadata = std::fs::metadata(&abs_path).ok();

        if metadata.is_none() {
            let head_sha1 = self.cached_head_blob_sha1(relative_path);
            let staged = head_sha1.map_or(true, |h| h != index_entry.sha1);
            let unstaged = true;
            let (_, removed) = self.numstat_in_memory(relative_path, &FileStatus::Deleted);

            return Ok(Some(GitFileStatus {
                path: format_path(&abs_path.to_string_lossy()),
                status: FileStatus::Deleted,
                staged,
                unstaged,
                conflicted: index_entry.stage > 0,
                added: 0,
                removed,
            }));
        }

        let metadata = metadata.unwrap();
        let (file_mtime_sec, file_mtime_nsec) = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::SystemTime::UNIX_EPOCH).ok())
            .map(|d| (d.as_secs() as u32, d.subsec_nanos()))
            .unwrap_or((0, 0));
        let file_size = metadata.len() as u32;

        let has_worktree_changes = index_entry.mtime_sec != file_mtime_sec
            || index_entry.mtime_nsec != file_mtime_nsec
            || index_entry.file_size != file_size;

        let head_sha1 = self.cached_head_blob_sha1(relative_path);

        let has_staged_changes = match head_sha1 {
            Some(head_hash) => head_hash != index_entry.sha1,
            None => true,
        };

        let is_conflicted = index_entry.stage > 0;

        if !has_worktree_changes && !has_staged_changes && !is_conflicted {
            return Ok(None);
        }

        let file_status = if is_conflicted {
            FileStatus::Conflict
        } else if head_sha1.is_none() {
            FileStatus::Added
        } else if has_worktree_changes || has_staged_changes {
            FileStatus::Modified
        } else {
            return Ok(None);
        };

        let cache_key = relative_path.to_string();
        let cache_hit = self.numstat_cache.get(&cache_key).and_then(|entry| {
            if entry.head_sha1 == head_sha1
                && entry.mtime_sec == file_mtime_sec
                && entry.mtime_nsec == file_mtime_nsec
                && entry.file_size == file_size
            {
                Some((entry.added, entry.removed))
            } else {
                None
            }
        });

        let (added, removed) = match cache_hit {
            Some(res) => res,
            None => {
                let (mut add, rem) = self.numstat_in_memory(relative_path, &file_status);
                if matches!(file_status, FileStatus::Added) && add == 0 {
                    if let Ok(content) = std::fs::read_to_string(&abs_path) {
                        if !content.is_empty() {
                            add = content.lines().count().max(1);
                        }
                    }
                }
                self.numstat_cache.insert(
                    cache_key,
                    NumstatCacheEntry {
                        head_sha1,
                        mtime_sec: file_mtime_sec,
                        mtime_nsec: file_mtime_nsec,
                        file_size,
                        added: add,
                        removed: rem,
                    },
                );
                (add, rem)
            }
        };

        if !has_staged_changes && !is_conflicted && added == 0 && removed == 0 {
            return Ok(None);
        }

        Ok(Some(GitFileStatus {
            path: format_path(&abs_path.to_string_lossy()),
            status: file_status,
            staged: has_staged_changes,
            unstaged: has_worktree_changes,
            conflicted: is_conflicted,
            added,
            removed,
        }))
    }

    fn status_for_relative_path(&mut self, relative_path: &str) -> Result<Option<GitFileStatus>> {
        self.status_file_custom(relative_path)
    }
}

#[cfg(test)]
#[path = "tests/git.rs"]
mod tests;

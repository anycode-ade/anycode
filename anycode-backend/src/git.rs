use anyhow::{Context, Result};
use git2::{Delta, DiffFindOptions, DiffOptions, Repository, Status, StatusOptions};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use tokio::sync::{mpsc, oneshot};
use tokio_util::sync::CancellationToken;
use tracing::info;

use crate::utils::format_path;

fn git_command() -> Command {
    #[cfg(windows)]
    let mut command = {
        use std::os::windows::process::CommandExt;
        let mut command = Command::new("git");
        command.creation_flags(0x0800_0000);
        command
    };
    #[cfg(not(windows))]
    let mut command = Command::new("git");

    crate::path_env::apply_to_std_command(&mut command);
    command
}

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
    /// Commits reachable from HEAD; `None` when HEAD has no commit yet.
    pub commit_count: Option<usize>,
    /// Committer time of the HEAD commit in unix seconds; `None` when HEAD has no commit yet.
    pub last_commit_at: Option<i64>,
}

impl GitStatus {
    pub fn to_json(&self) -> Value {
        json!({
            "kind": "full",
            "files": self.files,
            "branch": self.branch,
            "head_hash": self.head_hash,
            "commit_count": self.commit_count,
            "last_commit_at": self.last_commit_at
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

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct GitHistoryCommit {
    pub hash: String,
    pub tags: Vec<String>,
    pub parents: Vec<String>,
    pub summary: String,
    pub message: String,
    pub author_name: String,
    pub author_email: String,
    pub timestamp: i64,
    pub timezone_offset: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct GitHistoryPage {
    pub commits: Vec<GitHistoryCommit>,
    pub has_more: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitHistorySearchOutcome {
    Complete(GitHistoryPage),
    Cancelled,
}

pub enum SearchHistorySessionCommand {
    NextPage {
        limit: usize,
        batches: Option<mpsc::UnboundedSender<Vec<GitHistoryCommit>>>,
        response: oneshot::Sender<Result<GitHistorySearchOutcome>>,
    },
    Cancel,
}

pub struct SearchHistorySession {
    root_path: PathBuf,
    mode: GitHistorySearchMode,
    query: String,
    cancel: CancellationToken,
}

impl SearchHistorySession {
    pub fn new(
        root_path: PathBuf,
        mode: GitHistorySearchMode,
        query: String,
        cancel: CancellationToken,
    ) -> Self {
        Self {
            root_path,
            mode,
            query,
            cancel,
        }
    }

    pub fn run(self, mut commands: mpsc::UnboundedReceiver<SearchHistorySessionCommand>) {
        info!("SearchHistorySession started");
        let repo = match Repository::discover(&self.root_path) {
            Ok(repo) => repo,
            Err(error) => {
                if let Some(SearchHistorySessionCommand::NextPage { response, .. }) =
                    commands.blocking_recv()
                {
                    let _ = response.send(Err(error.into()));
                }
                return;
            }
        };
        let query = self.query.trim().to_string();
        let needle = query.to_lowercase();
        let repo_empty = repo.is_empty().unwrap_or(false);
        let mut walk = if self.mode == GitHistorySearchMode::Hash || query.is_empty() || repo_empty
        {
            None
        } else {
            match repo.revwalk().and_then(|mut walk| {
                walk.push_head()?;
                Ok(walk)
            }) {
                Ok(walk) => Some(walk),
                Err(error) => {
                    if let Some(SearchHistorySessionCommand::NextPage { response, .. }) =
                        commands.blocking_recv()
                    {
                        let _ = response.send(Err(error.into()));
                    }
                    return;
                }
            }
        };
        let mut pending = None;
        let mut exhausted = query.is_empty() || repo_empty;
        let mut hash_consumed = false;

        while let Some(command) = commands.blocking_recv() {
            match command {
                SearchHistorySessionCommand::Cancel => break,
                SearchHistorySessionCommand::NextPage {
                    limit,
                    batches,
                    response,
                } => {
                    let result = if self.cancel.is_cancelled() {
                        Ok(GitHistorySearchOutcome::Cancelled)
                    } else if self.mode == GitHistorySearchMode::Hash {
                        search_history_hash_page(&repo, &query, &self.cancel, &mut hash_consumed)
                    } else {
                        search_history_walk_page(
                            &repo,
                            walk.as_mut().expect("revwalk exists for text search"),
                            self.mode,
                            &needle,
                            limit,
                            &self.cancel,
                            &mut pending,
                            &mut exhausted,
                            batches.as_ref(),
                        )
                    };
                    if let (Some(batches), Ok(GitHistorySearchOutcome::Complete(page))) =
                        (batches.as_ref(), &result)
                    {
                        if self.mode == GitHistorySearchMode::Hash && !page.commits.is_empty() {
                            let _ = batches.send(page.commits.clone());
                        }
                    }
                    // Close the batch channel before completing the request so the
                    // handler can drain every queued batch without racing the response.
                    drop(batches);
                    let should_stop = match &result {
                        Ok(GitHistorySearchOutcome::Complete(_)) => false,
                        Ok(GitHistorySearchOutcome::Cancelled) | Err(_) => true,
                    };
                    let _ = response.send(result);
                    if should_stop {
                        break;
                    }
                }
            }
        }

        info!("SearchHistorySession stopped");
    }
}

fn search_history_hash_page(
    repo: &Repository,
    query: &str,
    cancel: &CancellationToken,
    consumed: &mut bool,
) -> Result<GitHistorySearchOutcome> {
    if cancel.is_cancelled() {
        return Ok(GitHistorySearchOutcome::Cancelled);
    }
    if *consumed
        || query.len() < 4
        || query.len() > 40
        || !query.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Ok(GitHistorySearchOutcome::Complete(GitHistoryPage {
            commits: Vec::new(),
            has_more: false,
        }));
    }
    *consumed = true;
    let commit = repo
        .revparse_single(query)
        .ok()
        .and_then(|object| object.peel_to_commit().ok())
        .map(GitManager::history_commit);
    if cancel.is_cancelled() {
        return Ok(GitHistorySearchOutcome::Cancelled);
    }
    Ok(GitHistorySearchOutcome::Complete(GitHistoryPage {
        commits: commit.into_iter().collect(),
        has_more: false,
    }))
}

fn search_history_walk_page(
    repo: &Repository,
    walk: &mut git2::Revwalk<'_>,
    mode: GitHistorySearchMode,
    needle: &str,
    limit: usize,
    cancel: &CancellationToken,
    pending: &mut Option<GitHistoryCommit>,
    exhausted: &mut bool,
    batches: Option<&mpsc::UnboundedSender<Vec<GitHistoryCommit>>>,
) -> Result<GitHistorySearchOutcome> {
    let limit = limit.clamp(1, 100);
    let mut commits = Vec::with_capacity(limit);
    let mut batch = Vec::with_capacity(25);
    let mut last_batch = std::time::Instant::now();
    if let Some(commit) = pending.take() {
        batch.push(commit.clone());
        commits.push(commit);
    }

    while commits.len() < limit && !*exhausted {
        match next_history_search_match(repo, walk, mode, needle, cancel)? {
            Some(commit) => {
                batch.push(commit.clone());
                commits.push(commit);
                if batch.len() >= 25
                    || last_batch.elapsed() >= std::time::Duration::from_millis(100)
                {
                    if let Some(batches) = batches {
                        let _ = batches.send(std::mem::take(&mut batch));
                    }
                    last_batch = std::time::Instant::now();
                }
            }
            None => *exhausted = true,
        }
        if cancel.is_cancelled() {
            return Ok(GitHistorySearchOutcome::Cancelled);
        }
    }
    if let Some(batches) = batches {
        if !batch.is_empty() {
            let _ = batches.send(batch);
        }
    }

    if commits.len() == limit && !*exhausted {
        match next_history_search_match(repo, walk, mode, needle, cancel)? {
            Some(commit) => *pending = Some(commit),
            None => *exhausted = true,
        }
    }
    if cancel.is_cancelled() {
        return Ok(GitHistorySearchOutcome::Cancelled);
    }
    Ok(GitHistorySearchOutcome::Complete(GitHistoryPage {
        commits,
        has_more: pending.is_some(),
    }))
}

fn next_history_search_match(
    repo: &Repository,
    walk: &mut git2::Revwalk<'_>,
    mode: GitHistorySearchMode,
    needle: &str,
    cancel: &CancellationToken,
) -> Result<Option<GitHistoryCommit>> {
    for oid in walk.by_ref() {
        if cancel.is_cancelled() {
            return Ok(None);
        }
        let commit = repo.find_commit(oid?)?;
        let is_match = match mode {
            GitHistorySearchMode::Message => commit
                .message()
                .unwrap_or("")
                .to_lowercase()
                .contains(needle),
            GitHistorySearchMode::Author => {
                let author = commit.author();
                author.name().unwrap_or("").to_lowercase().contains(needle)
                    || author.email().unwrap_or("").to_lowercase().contains(needle)
            }
            GitHistorySearchMode::Hash => unreachable!(),
        };
        if is_match {
            return Ok(Some(GitManager::history_commit(commit)));
        }
    }
    Ok(None)
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GitHistorySearchMode {
    Message,
    Hash,
    Author,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct GitHistoryFile {
    pub path: String,
    pub old_path: Option<String>,
    pub status: FileStatus,
    pub added: usize,
    pub removed: usize,
    pub binary: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct GitHistoryFileContent {
    pub old_content: Option<String>,
    pub new_content: Option<String>,
    pub old_binary: bool,
    pub new_binary: bool,
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

    /// Return commits reachable from HEAD in the revwalk's fast default order.
    ///
    /// Topological sorting forces libgit2 to inspect the entire reachable graph
    /// before yielding a small page, which is prohibitively expensive for large
    /// repositories such as Linux. Tags are intentionally omitted from history:
    /// resolving every tag for every commit made this method O(page_size * refs).
    pub fn history(&self, offset: usize, limit: usize) -> Result<GitHistoryPage> {
        let repo = self.repo()?;
        if repo.is_empty()? {
            return Ok(GitHistoryPage {
                commits: Vec::new(),
                has_more: false,
            });
        }

        let limit = limit.clamp(1, 100);
        let mut walk = repo.revwalk()?;
        walk.push_head()?;
        let mut commits = Vec::with_capacity(limit);
        let mut has_more = false;

        for oid in walk.skip(offset).take(limit + 1) {
            if commits.len() == limit {
                has_more = true;
                break;
            }
            commits.push(Self::history_commit(repo.find_commit(oid?)?));
        }

        Ok(GitHistoryPage { commits, has_more })
    }

    /// Return commits whose first-parent diff touches `path`.
    pub fn file_history(&self, path: &str, offset: usize, limit: usize) -> Result<GitHistoryPage> {
        let repo = self.repo()?;
        if repo.is_empty()? {
            return Ok(GitHistoryPage {
                commits: Vec::new(),
                has_more: false,
            });
        }

        let limit = limit.clamp(1, 100);
        let Some(root) = repo.workdir().and_then(|path| path.canonicalize().ok()) else {
            return Ok(GitHistoryPage {
                commits: Vec::new(),
                has_more: false,
            });
        };
        let requested_path = Path::new(path);
        let absolute_path = if requested_path.is_absolute() {
            requested_path.to_path_buf()
        } else {
            root.join(requested_path)
        };
        let normalized_path = absolute_path.canonicalize().unwrap_or(absolute_path);
        let Ok(relative_path) = normalized_path.strip_prefix(&root) else {
            return Ok(GitHistoryPage {
                commits: Vec::new(),
                has_more: false,
            });
        };
        let path = relative_path.to_string_lossy().replace('\\', "/");
        if path.is_empty() {
            return Ok(GitHistoryPage {
                commits: Vec::new(),
                has_more: false,
            });
        }
        let max_count = offset.saturating_add(limit).saturating_add(1).to_string();
        let output = git_command()
            .arg("-C")
            .arg(&root)
            .args(["log", "--no-color", "--date=default"])
            .arg(format!("--max-count={max_count}"))
            .arg("--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%z%x00%s%x00%b%x1e")
            .arg("--")
            .arg(&path)
            .output()
            .context("Failed to read Git file history")?;
        if !output.status.success() {
            anyhow::bail!(
                "Git file history failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        let matching = String::from_utf8_lossy(&output.stdout)
            .split('\u{1e}')
            .filter_map(Self::parse_history_commit)
            .collect::<Vec<_>>();
        let has_more = matching.len() > offset + limit;
        let commits = matching.into_iter().skip(offset).take(limit).collect();
        Ok(GitHistoryPage { commits, has_more })
    }

    fn parse_history_commit(record: &str) -> Option<GitHistoryCommit> {
        let mut fields = record.split('\0');
        let hash = fields.next()?.trim().to_string();
        if hash.is_empty() {
            return None;
        }
        let parents = fields
            .next()?
            .split_whitespace()
            .map(str::to_string)
            .collect();
        let author_name = fields.next()?.to_string();
        let author_email = fields.next()?.to_string();
        let timestamp = fields.next()?.parse().ok()?;
        let timezone_offset = fields.next().and_then(parse_timezone_offset).unwrap_or(0);
        let summary = fields.next()?.to_string();
        let message = fields.next().unwrap_or("").trim().to_string();
        Some(GitHistoryCommit {
            hash,
            tags: Vec::new(),
            parents,
            summary,
            message,
            author_name,
            author_email,
            timestamp,
            timezone_offset,
        })
    }

    fn history_commit(commit: git2::Commit<'_>) -> GitHistoryCommit {
        let author = commit.author();
        let time = commit.time();
        GitHistoryCommit {
            hash: commit.id().to_string(),
            tags: Vec::new(),
            parents: commit.parent_ids().map(|id| id.to_string()).collect(),
            summary: commit.summary().unwrap_or("").to_string(),
            message: commit.message().unwrap_or("").to_string(),
            author_name: author.name().unwrap_or("").to_string(),
            author_email: author.email().unwrap_or("").to_string(),
            timestamp: time.seconds(),
            timezone_offset: time.offset_minutes(),
        }
    }

    /// Diff a commit against its first parent. Root commits are diffed against an empty tree.
    pub fn history_files(&self, hash: &str) -> Result<Vec<GitHistoryFile>> {
        let repo = self.repo()?;
        let commit = repo.find_commit(git2::Oid::from_str(hash)?)?;
        let new_tree = commit.tree()?;
        let old_tree = if commit.parent_count() > 0 {
            Some(commit.parent(0)?.tree()?)
        } else {
            None
        };
        let mut options = DiffOptions::new();
        let mut diff =
            repo.diff_tree_to_tree(old_tree.as_ref(), Some(&new_tree), Some(&mut options))?;
        let mut find = DiffFindOptions::new();
        find.renames(true);
        diff.find_similar(Some(&mut find))?;

        let mut files = Vec::<GitHistoryFile>::new();
        for (index, delta) in diff.deltas().enumerate() {
            let status = match delta.status() {
                Delta::Added => FileStatus::Added,
                Delta::Deleted => FileStatus::Deleted,
                Delta::Renamed | Delta::Copied => FileStatus::Renamed,
                _ => FileStatus::Modified,
            };
            let old_path = delta
                .old_file()
                .path()
                .map(|p| p.to_string_lossy().to_string());
            let new_path = delta
                .new_file()
                .path()
                .map(|p| p.to_string_lossy().to_string());
            let path = if status == FileStatus::Deleted {
                old_path.clone()
            } else {
                new_path
            }
            .unwrap_or_default();
            files.push(GitHistoryFile {
                path,
                old_path: if status == FileStatus::Renamed {
                    old_path
                } else {
                    None
                },
                status,
                added: 0,
                removed: 0,
                binary: delta.flags().contains(git2::DiffFlags::BINARY),
            });

            // libgit2 exposes line counts while walking patches. Binary files simply have no lines.
            if let Some(patch) = git2::Patch::from_diff(&diff, index)? {
                let (_, added, removed) = patch.line_stats()?;
                files[index].added = added;
                files[index].removed = removed;
                files[index].binary =
                    files[index].binary || patch.delta().flags().contains(git2::DiffFlags::BINARY);
            }
        }
        files.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(files)
    }

    pub fn history_file_content(
        &self,
        hash: &str,
        path: &str,
        old_path: Option<&str>,
    ) -> Result<GitHistoryFileContent> {
        let repo = self.repo()?;
        let commit = repo.find_commit(git2::Oid::from_str(hash)?)?;
        let new_tree = commit.tree()?;
        let old_tree = if commit.parent_count() > 0 {
            Some(commit.parent(0)?.tree()?)
        } else {
            None
        };

        let read_blob =
            |tree: Option<&git2::Tree<'_>>, blob_path: &str| -> Result<(Option<String>, bool)> {
                let Some(tree) = tree else {
                    return Ok((Some(String::new()), false));
                };
                let Ok(entry) = tree.get_path(Path::new(blob_path)) else {
                    return Ok((Some(String::new()), false));
                };
                let blob = repo.find_blob(entry.id())?;
                if blob.is_binary() {
                    return Ok((None, true));
                }
                match std::str::from_utf8(blob.content()) {
                    Ok(content) => Ok((Some(content.to_string()), false)),
                    Err(_) => Ok((None, true)),
                }
            };

        let (old_content, old_binary) = read_blob(old_tree.as_ref(), old_path.unwrap_or(path))?;
        let (new_content, new_binary) = read_blob(Some(&new_tree), path)?;
        Ok(GitHistoryFileContent {
            old_content,
            new_content,
            old_binary,
            new_binary,
        })
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
        let (commit_count, last_commit_at) = Self::head_commit_info(&repo);
        Ok(GitStatus {
            files,
            branch,
            head_hash,
            commit_count,
            last_commit_at,
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
        let raw_content = std::str::from_utf8(blob.content())?;
        let content = raw_content
            .strip_prefix('\u{feff}')
            .unwrap_or(raw_content)
            .to_string();

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
    pub fn push(&self) -> Result<&'static str> {
        let repo = self.repo()?;
        let mut remote = repo.find_remote("origin")?;
        let head = repo.head()?;

        let branch_name = head.shorthand().context("Detached HEAD state")?;
        let local_oid = head.target().context("HEAD has no target")?;
        let remote_oid = repo
            .find_reference(&format!("refs/remotes/origin/{}", branch_name))
            .ok()
            .and_then(|reference| reference.target());
        let status = if remote_oid == Some(local_oid) {
            "up_to_date"
        } else {
            "pushed"
        };

        let refspec = format!("refs/heads/{}:refs/heads/{}", branch_name, branch_name);

        let mut callbacks = git2::RemoteCallbacks::new();
        callbacks.credentials(|_url, username_from_url, _allowed_types| {
            git2::Cred::ssh_key_from_agent(username_from_url.unwrap_or("git"))
        });

        let mut push_opts = git2::PushOptions::new();
        push_opts.remote_callbacks(callbacks);

        remote.push(&[&refspec], Some(&mut push_opts))?;

        info!("Pushed to origin/{}", branch_name);
        Ok(status)
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

    pub fn create_branch(&self, branch: &str) -> Result<()> {
        let branch = branch.trim();
        if branch.is_empty() {
            anyhow::bail!("Branch name cannot be empty");
        }
        let repo = self.repo()?;
        let head = repo.head().context("Failed to get HEAD")?;
        let commit = head
            .peel_to_commit()
            .context("Failed to resolve HEAD commit")?;
        let new_branch = repo
            .branch(branch, &commit, false)
            .with_context(|| format!("Failed to create branch '{}'", branch))?;
        let reference = new_branch.into_reference();
        let reference_name = reference
            .name()
            .context("Invalid branch reference name")?
            .to_string();
        repo.set_head(&reference_name)
            .with_context(|| format!("Failed to set HEAD to '{}'", branch))?;

        info!("Created and checked out branch {}", branch);
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

    /// Fetch from remote
    pub fn fetch(&self) -> Result<()> {
        let repo = self.repo()?;
        let mut remote = repo.find_remote("origin")?;

        let mut callbacks = git2::RemoteCallbacks::new();
        callbacks.credentials(|_url, username_from_url, _allowed_types| {
            git2::Cred::ssh_key_from_agent(username_from_url.unwrap_or("git"))
        });

        let mut fetch_opts = git2::FetchOptions::new();
        fetch_opts.remote_callbacks(callbacks);

        let branch_name = repo
            .head()
            .ok()
            .and_then(|h| h.shorthand().map(|s| s.to_string()));

        let refspecs: Vec<String> = if let Some(ref b) = branch_name {
            vec![format!("refs/heads/{}:refs/remotes/origin/{}", b, b)]
        } else {
            vec![]
        };

        let fetch_res = remote.fetch(&[] as &[&str], Some(&mut fetch_opts), None);
        if let Err(e) = fetch_res {
            if !refspecs.is_empty() {
                let refspec_strs: Vec<&str> = refspecs.iter().map(|s| s.as_str()).collect();
                let mut retry_callbacks = git2::RemoteCallbacks::new();
                retry_callbacks.credentials(|_url, username_from_url, _allowed_types| {
                    git2::Cred::ssh_key_from_agent(username_from_url.unwrap_or("git"))
                });
                let mut retry_opts = git2::FetchOptions::new();
                retry_opts.remote_callbacks(retry_callbacks);
                remote.fetch(&refspec_strs, Some(&mut retry_opts), None)?;
            } else {
                return Err(e.into());
            }
        }

        info!("Git fetch completed successfully");
        Ok(())
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

        let full_path = repo_root.join(&relative_path);
        let tracked_in_head = repo
            .head()
            .ok()
            .and_then(|head| head.peel_to_tree().ok())
            .is_some_and(|tree| tree.get_path(&relative_path).is_ok());
        let tracked_in_index = repo
            .index()
            .context("Failed to read the Git index")?
            .get_path(&relative_path, 0)
            .is_some();

        // Do not infer this from `Repository::statuses(pathspec)`: libgit2 may
        // collapse untracked directories and return no exact match for a nested
        // path. A path absent from HEAD is an added/untracked path regardless of
        // whether it has already been staged.
        let is_new_file =
            !tracked_in_head && (tracked_in_index || std::fs::symlink_metadata(&full_path).is_ok());

        if is_new_file {
            // A newly added file can be either untracked or already staged.
            // Remove an index entry as well, otherwise it remains in Changes.
            repo.reset_default(None, [&relative_path])
                .context("Failed to remove added file from the Git index")?;

            match std::fs::symlink_metadata(&full_path) {
                Ok(metadata) if metadata.file_type().is_dir() => {
                    anyhow::bail!("Cannot revert a directory as a file: {}", path);
                }
                Ok(_) => {
                    std::fs::remove_file(&full_path).context("Failed to delete added file")?;
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error).context("Failed to inspect added file"),
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

        let still_changed = if is_new_file {
            let still_in_index = repo
                .index()
                .context("Failed to verify the Git index after revert")?
                .get_path(&relative_path, 0)
                .is_some();
            still_in_index || std::fs::symlink_metadata(&full_path).is_ok()
        } else {
            !repo
                .status_file(&relative_path)
                .context("Failed to verify file status after revert")?
                .is_empty()
        };
        if still_changed {
            anyhow::bail!(
                "Git revert completed, but the path is still changed: {}",
                path
            );
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

    /// Returns (number of commits reachable from HEAD, HEAD commit time in unix seconds).
    fn head_commit_info(repo: &Repository) -> (Option<usize>, Option<i64>) {
        let Ok(head) = repo.head().and_then(|h| h.peel_to_commit()) else {
            return (None, None);
        };
        let commit_count = repo.revwalk().ok().and_then(|mut walk| {
            walk.push(head.id()).ok()?;
            Some(walk.count())
        });
        (commit_count, Some(head.time().seconds()))
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

        let output = git_command()
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

fn parse_timezone_offset(value: &str) -> Option<i32> {
    let sign = if value.starts_with('-') { -1 } else { 1 };
    let digits = value.trim_start_matches(['+', '-']);
    (digits.len() == 4).then(|| {
        let hours: i32 = digits[..2].parse().ok()?;
        let minutes: i32 = digits[2..].parse().ok()?;
        Some(sign * (hours * 60 + minutes))
    })?
}

/// Inline payload limit before switching to chunked `/ws/node` transfers (8 MiB raw -> ~10.7 MiB b64).
pub(crate) const TRANSFER_CHUNK_BYTES: usize = 8 * 1024 * 1024;
/// Maximum size for uncommitted working-tree overlay tar.gz (ignored build artifacts are excluded).
pub(crate) const MAX_DIRTY_OVERLAY_BYTES: usize = 32 * 1024 * 1024;
const MAX_DIRTY_SUMMARY_ITEMS: usize = 100;
const MAX_KNOWN_BASES: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudSyncMetadata {
    pub base_sha: String,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub source_root: Option<String>,
    #[serde(default)]
    pub source_name: Option<String>,
    #[serde(default)]
    pub overlay_paths: Vec<String>,
    #[serde(default)]
    pub synced_at_epoch: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncGitPayload {
    #[serde(default)]
    pub bundle_b64: String,
    #[serde(default)]
    pub bundle_transfer_id: Option<String>,
    pub head_sha: String,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub shallow: Option<String>,
    #[serde(default)]
    pub overlay_b64: Option<String>,
    #[serde(default)]
    pub deleted_files: Vec<String>,
    #[serde(default)]
    pub overlay_paths: Vec<String>,
    #[serde(default)]
    pub source_root: Option<String>,
    #[serde(default)]
    pub source_name: Option<String>,
}

pub struct PackedGitSync {
    pub payload: SyncGitPayload,
    pub bundle_file: Option<tempfile::NamedTempFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteGitStateInfo {
    pub is_git_repo: bool,
    #[serde(default)]
    pub is_worktree: bool,
    #[serde(default)]
    pub has_commits: bool,
    #[serde(default)]
    pub head_sha: Option<String>,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub branches: Vec<String>,
    #[serde(default)]
    pub dirty_count: usize,
    #[serde(default)]
    pub dirty_files: Vec<String>,
    #[serde(default)]
    pub commits_ahead: usize,
    #[serde(default)]
    pub commits_summary: Vec<String>,
    #[serde(default)]
    pub sync_meta: Option<CloudSyncMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PullGitBundleResponse {
    pub changed: bool,
    pub head_sha: String,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub base_sha: Option<String>,
    pub has_wip: bool,
    pub commits_count: usize,
    pub dirty_count: usize,
    #[serde(default)]
    pub commits_summary: Vec<String>,
    #[serde(default)]
    pub dirty_files: Vec<String>,
    #[serde(default)]
    pub bundle_b64: Option<String>,
    #[serde(default)]
    pub bundle_transfer_id: Option<String>,
    #[serde(default)]
    pub bundle_size: Option<u64>,
    #[serde(default)]
    pub ref_name: Option<String>,
}

struct CloudRefGuard<'a> {
    repo_dir: &'a Path,
    ref_name: String,
}

impl<'a> CloudRefGuard<'a> {
    fn new(repo_dir: &'a Path, ref_name: String) -> Self {
        Self { repo_dir, ref_name }
    }
}

impl Drop for CloudRefGuard<'_> {
    fn drop(&mut self) {
        if !self.ref_name.is_empty() {
            let mut cmd = git_command();
            let _ = cmd
                .current_dir(self.repo_dir)
                .args(["update-ref", "-d", &self.ref_name])
                .output();
        }
    }
}

fn unix_epoch_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn run_git_raw(
    cwd: &Path,
    args: &[&str],
    extra_env: &[(&str, &str)],
) -> Result<std::process::Output> {
    let mut cmd = git_command();
    cmd.current_dir(cwd).args(args);
    for (k, v) in extra_env {
        cmd.env(k, v);
    }
    cmd.output()
        .with_context(|| format!("Failed to spawn git {:?} in {}", args, cwd.display()))
}

fn run_git_checked(cwd: &Path, args: &[&str], extra_env: &[(&str, &str)]) -> Result<String> {
    let out = run_git_raw(cwd, args, extra_env)?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let stdout = String::from_utf8_lossy(&out.stdout);
        let msg = if !stderr.trim().is_empty() {
            stderr.trim().to_string()
        } else {
            stdout.trim().to_string()
        };
        anyhow::bail!("git {} failed: {}", args.join(" "), msg);
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn git_ok(cwd: &Path, args: &[&str]) -> bool {
    run_git_raw(cwd, args, &[])
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn validate_safe_rel_path(rel_str: &str) -> Result<PathBuf> {
    use std::path::Component;

    let rel = Path::new(rel_str);
    if rel_str.is_empty() || rel.is_absolute() {
        anyhow::bail!("Unsafe relative path: {}", rel_str);
    }
    let mut first = None;
    for comp in rel.components() {
        match comp {
            Component::Normal(s) => {
                if first.is_none() {
                    first = Some(s.to_string_lossy().into_owned());
                }
            }
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                anyhow::bail!("Unsafe path traversal component: {}", rel_str);
            }
        }
    }
    if first.as_deref() == Some(".git") {
        anyhow::bail!("Refusing to modify .git path via overlay: {}", rel_str);
    }
    Ok(rel.to_path_buf())
}

fn sync_metadata_path(git_dir: &Path) -> PathBuf {
    git_dir.join("anycode-cloud-sync.json")
}

fn resolve_git_dir(repo_dir: &Path) -> Result<PathBuf> {
    let raw = run_git_checked(repo_dir, &["rev-parse", "--git-dir"], &[])?;
    let p = PathBuf::from(&raw);
    if p.is_absolute() {
        Ok(p)
    } else {
        Ok(repo_dir.join(p))
    }
}

fn read_sync_metadata(repo_dir: &Path) -> Option<CloudSyncMetadata> {
    let git_dir = resolve_git_dir(repo_dir).ok()?;
    let path = sync_metadata_path(&git_dir);
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_sync_metadata(repo_dir: &Path, meta: &CloudSyncMetadata) -> Result<()> {
    let git_dir = resolve_git_dir(repo_dir)?;
    let path = sync_metadata_path(&git_dir);
    let encoded = serde_json::to_string_pretty(meta)?;
    std::fs::write(path, encoded)?;
    Ok(())
}

fn current_branch_name(repo_dir: &Path) -> Option<String> {
    run_git_checked(repo_dir, &["symbolic-ref", "--short", "HEAD"], &[])
        .ok()
        .filter(|s| !s.is_empty())
}

fn collect_dirty_overlay(
    repo_dir: &Path,
    max_bytes: usize,
) -> Result<(Option<String>, Vec<String>, Vec<String>)> {
    use base64::Engine as _;
    use flate2::Compression;
    use flate2::write::GzEncoder;
    use std::collections::BTreeSet;

    let out = run_git_raw(repo_dir, &["status", "--porcelain=v1", "-z", "-uall"], &[])?;
    if !out.status.success() {
        anyhow::bail!(
            "git status failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }

    let raw_bytes = out.stdout;
    if raw_bytes.is_empty() {
        return Ok((None, Vec::new(), Vec::new()));
    }

    let tokens: Vec<&[u8]> = raw_bytes.split(|&b| b == 0).collect();
    let mut files_to_pack: BTreeSet<String> = BTreeSet::new();
    let mut deleted_files: BTreeSet<String> = BTreeSet::new();

    let mut i = 0;
    while i < tokens.len() {
        let tok = tokens[i];
        i += 1;
        if tok.is_empty() || tok.len() < 4 || tok[2] != b' ' {
            continue;
        }
        let x = tok[0] as char;
        let y = tok[1] as char;
        let path_str = String::from_utf8_lossy(&tok[3..]).into_owned();

        if matches!(x, 'R' | 'C') || matches!(y, 'R' | 'C') {
            if i < tokens.len() {
                let orig_bytes = tokens[i];
                i += 1;
                if !orig_bytes.is_empty() {
                    let orig_str = String::from_utf8_lossy(orig_bytes).into_owned();
                    if x == 'R' && !repo_dir.join(&orig_str).exists() {
                        deleted_files.insert(orig_str);
                    }
                }
            }
        }

        let full_path = repo_dir.join(&path_str);
        if y == 'D' || (x == 'D' && y == ' ') || !full_path.exists() {
            if !full_path.exists() {
                deleted_files.insert(path_str);
            }
            continue;
        }

        if let Ok(meta) = std::fs::symlink_metadata(&full_path) {
            if !meta.file_type().is_symlink() && meta.is_file() {
                files_to_pack.insert(path_str);
            }
        }
    }

    if files_to_pack.is_empty() {
        return Ok((None, deleted_files.into_iter().collect(), Vec::new()));
    }

    struct VecLimitedWriter {
        buf: Vec<u8>,
        max: usize,
    }
    impl std::io::Write for VecLimitedWriter {
        fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
            if self.buf.len().saturating_add(data.len()) > self.max {
                return Err(std::io::Error::other(format!(
                    "Dirty overlay archive exceeds {} MiB limit",
                    self.max / (1024 * 1024)
                )));
            }
            self.buf.extend_from_slice(data);
            Ok(data.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    let gz = GzEncoder::new(
        VecLimitedWriter {
            buf: Vec::new(),
            max: max_bytes,
        },
        Compression::fast(),
    );
    let mut builder = tar::Builder::new(gz);
    let mut packed_paths = Vec::new();
    for rel in &files_to_pack {
        let safe_rel = validate_safe_rel_path(rel)?;
        let full = repo_dir.join(&safe_rel);
        if let Ok(meta) = std::fs::symlink_metadata(&full) {
            if !meta.file_type().is_symlink() && meta.is_file() {
                builder.append_path_with_name(&full, &safe_rel)?;
                packed_paths.push(rel.clone());
            }
        }
    }
    let gz = builder.into_inner()?;
    let writer = gz.finish()?;
    let overlay_b64 = if packed_paths.is_empty() {
        None
    } else {
        Some(base64::engine::general_purpose::STANDARD.encode(writer.buf))
    };

    Ok((
        overlay_b64,
        deleted_files.into_iter().collect(),
        packed_paths,
    ))
}

/// Package a local Git repository as a full `git bundle --all HEAD` (+ dirty working-tree overlay).
/// Bundles smaller than `TRANSFER_CHUNK_BYTES` are inlined; larger ones are returned on disk for chunked transfer.
/// Returns `Ok(None)` if `root` is not a Git repository or has no commits yet.
pub fn pack_git_sync_to_file(root: &Path, source_name: &str) -> Result<Option<PackedGitSync>> {
    use base64::Engine as _;

    if !git_ok(root, &["rev-parse", "--is-inside-work-tree"]) {
        return Ok(None);
    }
    if !git_ok(root, &["rev-parse", "--verify", "HEAD"]) {
        return Ok(None);
    }

    let head_sha = run_git_checked(root, &["rev-parse", "HEAD"], &[])?;
    let branch = current_branch_name(root);
    let tmp_bundle = tempfile::NamedTempFile::new()?;
    let bundle_arg = tmp_bundle.path().to_string_lossy().into_owned();
    run_git_checked(root, &["bundle", "create", &bundle_arg, "--all", "HEAD"], &[])?;

    let bundle_len = std::fs::metadata(tmp_bundle.path())?.len();
    let (bundle_b64, bundle_file) = if bundle_len <= TRANSFER_CHUNK_BYTES as u64 {
        let bytes = std::fs::read(tmp_bundle.path())?;
        (
            base64::engine::general_purpose::STANDARD.encode(bytes),
            None,
        )
    } else {
        (String::new(), Some(tmp_bundle))
    };

    let (overlay_b64, deleted_files, overlay_paths) =
        collect_dirty_overlay(root, MAX_DIRTY_OVERLAY_BYTES)?;

    Ok(Some(PackedGitSync {
        payload: SyncGitPayload {
            bundle_b64,
            bundle_transfer_id: None,
            head_sha,
            branch,
            shallow: None,
            overlay_b64,
            deleted_files,
            overlay_paths,
            source_root: Some(root.to_string_lossy().into_owned()),
            source_name: Some(source_name.to_string()),
        },
        bundle_file,
    }))
}

/// Inline wrapper for smaller repositories and tests.
pub fn pack_git_sync_payload(
    root: &Path,
    source_name: &str,
    max_bytes: usize,
) -> Result<Option<SyncGitPayload>> {
    use base64::Engine as _;

    let Some(mut packed) = pack_git_sync_to_file(root, source_name)? else {
        return Ok(None);
    };
    if let Some(file) = packed.bundle_file.take() {
        let bytes = std::fs::read(file.path())?;
        if bytes.len() > max_bytes {
            anyhow::bail!(
                "Git bundle size ({:.1} MiB) exceeds {} MiB limit",
                bytes.len() as f64 / (1024.0 * 1024.0),
                max_bytes / (1024 * 1024)
            );
        }
        packed.payload.bundle_b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    }
    Ok(Some(packed.payload))
}

fn merge_shallow_file(git_dir: &Path, incoming_shallow: &str) -> Result<()> {
    use std::collections::BTreeSet;

    let shallow_path = git_dir.join("shallow");
    let mut lines: BTreeSet<String> = if shallow_path.is_file() {
        std::fs::read_to_string(&shallow_path)?
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(str::to_string)
            .collect()
    } else {
        BTreeSet::new()
    };

    for line in incoming_shallow.lines() {
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            lines.insert(trimmed.to_string());
        }
    }

    if !lines.is_empty() {
        let content = lines.into_iter().collect::<Vec<_>>().join("\n") + "\n";
        std::fs::write(shallow_path, content)?;
    }
    Ok(())
}

/// Apply a `SyncGitPayload` using an on-disk bundle file into `target_path`.
pub fn apply_git_sync_from_bundle_file(
    target_path: &Path,
    bundle_path: &Path,
    payload: &SyncGitPayload,
) -> Result<()> {
    use std::collections::HashSet;

    std::fs::create_dir_all(target_path)?;
    let prev_meta = read_sync_metadata(target_path);
    let bundle_str = bundle_path.to_string_lossy().into_owned();

    let already_git = target_path.join(".git").exists()
        || git_ok(target_path, &["rev-parse", "--is-inside-work-tree"]);
    if !already_git {
        run_git_checked(target_path, &["init"], &[])?;
    } else if let Ok(prev_head) = run_git_checked(target_path, &["rev-parse", "HEAD"], &[]) {
        if prev_head != payload.head_sha {
            let backup_ref = format!("refs/anycode-backup/{}", unix_epoch_secs());
            let _ = run_git_raw(target_path, &["update-ref", &backup_ref, &prev_head], &[]);
        }
    }

    let git_dir = resolve_git_dir(target_path)?;
    if let Some(shallow) = payload.shallow.as_deref().filter(|s| !s.trim().is_empty()) {
        merge_shallow_file(&git_dir, shallow)?;
    } else {
        // Unshallow repos that came from an older shallow sync now that bundles carry full history.
        let shallow_path = git_dir.join("shallow");
        if shallow_path.is_file() {
            let _ = std::fs::remove_file(shallow_path);
        }
    }

    let staging_ref = "refs/anycode-sync/head";
    let _staging_guard = CloudRefGuard::new(target_path, staging_ref.to_string());
    let head_refspec = format!("HEAD:{}", staging_ref);
    run_git_checked(target_path, &["fetch", &bundle_str, &head_refspec], &[])?;

    // Detach briefly so all local branches in the bundle can be updated in place.
    run_git_checked(target_path, &["checkout", "-f", "--detach", &payload.head_sha], &[])?;
    let _ = run_git_raw(
        target_path,
        &["fetch", "--force", &bundle_str, "refs/heads/*:refs/heads/*"],
        &[],
    );

    if let Some(branch) = payload
        .branch
        .as_deref()
        .map(str::trim)
        .filter(|b| !b.is_empty())
    {
        run_git_checked(
            target_path,
            &["checkout", "-f", "-B", branch, &payload.head_sha],
            &[],
        )?;
    } else {
        run_git_checked(
            target_path,
            &["checkout", "-f", "--detach", &payload.head_sha],
            &[],
        )?;
    }

    if !already_git {
        // Drop stale non-ignored leftovers from an earlier non-git sync while keeping .gitignore'd build caches.
        let _ = run_git_raw(target_path, &["clean", "-fd"], &[]);
    }

    if let Some(old) = prev_meta {
        let new_set: HashSet<&str> = payload.overlay_paths.iter().map(String::as_str).collect();
        for old_path in old.overlay_paths {
            if !new_set.contains(old_path.as_str()) {
                if let Ok(rel) = validate_safe_rel_path(&old_path) {
                    let full = target_path.join(&rel);
                    if full.is_file() {
                        let _ = std::fs::remove_file(&full);
                    }
                }
            }
        }
    }

    for del in &payload.deleted_files {
        let rel = validate_safe_rel_path(del)?;
        let full = target_path.join(rel);
        if full.is_file() || full.is_symlink() {
            let _ = std::fs::remove_file(full);
        }
    }

    if let Some(overlay_b64) = payload.overlay_b64.as_deref().filter(|s| !s.trim().is_empty()) {
        crate::node_server::unpack_project_archive(overlay_b64, target_path)?;
    }

    let meta = CloudSyncMetadata {
        base_sha: payload.head_sha.clone(),
        branch: payload.branch.clone(),
        source_root: payload.source_root.clone(),
        source_name: payload.source_name.clone(),
        overlay_paths: payload.overlay_paths.clone(),
        synced_at_epoch: unix_epoch_secs(),
    };
    write_sync_metadata(target_path, &meta)?;
    Ok(())
}

/// Apply an inline base64 `SyncGitPayload` into `target_path` on a node server.
pub fn apply_git_sync_payload(target_path: &Path, payload: &SyncGitPayload) -> Result<()> {
    use base64::Engine as _;

    let bundle_bytes = base64::engine::general_purpose::STANDARD
        .decode(payload.bundle_b64.trim())
        .map_err(|e| anyhow::anyhow!("Invalid git bundle encoding: {}", e))?;
    let tmp = tempfile::NamedTempFile::new()?;
    std::fs::write(tmp.path(), bundle_bytes)?;
    apply_git_sync_from_bundle_file(target_path, tmp.path(), payload)
}

fn collect_dirty_summary(repo_dir: &Path) -> Result<(usize, Vec<String>)> {
    let out = run_git_raw(repo_dir, &["status", "--porcelain=v1", "-uall"], &[])?;
    if !out.status.success() {
        anyhow::bail!(
            "git status failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut all = Vec::new();
    for line in text.lines() {
        if !line.trim().is_empty() {
            all.push(line.to_string());
        }
    }
    let count = all.len();
    all.truncate(MAX_DIRTY_SUMMARY_ITEMS);
    Ok((count, all))
}

fn filter_existing_commits(repo_dir: &Path, candidates: &[String], cap: usize) -> Vec<String> {
    use std::collections::HashSet;

    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for sha in candidates {
        let trimmed = sha.trim();
        if trimmed.is_empty() || !seen.insert(trimmed.to_string()) {
            continue;
        }
        let rev = format!("{}^{{commit}}", trimmed);
        if git_ok(repo_dir, &["cat-file", "-e", &rev]) {
            out.push(trimmed.to_string());
            if out.len() >= cap {
                break;
            }
        }
    }
    out
}

fn is_git_linked_worktree(repo_dir: &Path) -> bool {
    let Ok(git_dir_raw) = run_git_checked(repo_dir, &["rev-parse", "--git-dir"], &[]) else {
        return false;
    };
    let Ok(common_raw) = run_git_checked(repo_dir, &["rev-parse", "--git-common-dir"], &[]) else {
        return false;
    };
    let git_dir = if Path::new(&git_dir_raw).is_absolute() {
        PathBuf::from(&git_dir_raw)
    } else {
        repo_dir.join(&git_dir_raw)
    };
    let common_dir = if Path::new(&common_raw).is_absolute() {
        PathBuf::from(&common_raw)
    } else {
        repo_dir.join(&common_raw)
    };
    let a = std::fs::canonicalize(&git_dir).unwrap_or(git_dir);
    let b = std::fs::canonicalize(&common_dir).unwrap_or(common_dir);
    a != b
}

fn list_local_branches(repo_dir: &Path, current: Option<&str>) -> Vec<String> {
    let raw = run_git_checked(
        repo_dir,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(refname:short)",
            "refs/heads",
        ],
        &[],
    )
    .unwrap_or_default();

    let mut seen = std::collections::HashSet::new();
    let mut branches: Vec<String> = raw
        .lines()
        .map(str::trim)
        .filter(|s| !s.is_empty() && seen.insert((*s).to_string()))
        .map(str::to_string)
        .collect();

    fn branch_tier(current: Option<&str>, name: &str) -> (u8, usize) {
        if current == Some(name) {
            return (0, 0);
        }
        if let Some(pos) = ["main", "master", "develop", "dev", "trunk"]
            .iter()
            .position(|&p| p == name)
        {
            return (1, pos);
        }
        (2, 0)
    }

    // `sort_by_key` is stable, so `--sort=-committerdate` order is preserved within each tier.
    branches.sort_by_key(|name| branch_tier(current, name));
    branches
}

pub fn inspect_remote_git_state(repo_dir: &Path) -> Result<RemoteGitStateInfo> {
    if !git_ok(repo_dir, &["rev-parse", "--is-inside-work-tree"]) {
        return Ok(RemoteGitStateInfo {
            is_git_repo: false,
            is_worktree: false,
            has_commits: false,
            head_sha: None,
            branch: None,
            branches: Vec::new(),
            dirty_count: 0,
            dirty_files: Vec::new(),
            commits_ahead: 0,
            commits_summary: Vec::new(),
            sync_meta: None,
        });
    }

    let is_worktree = is_git_linked_worktree(repo_dir);
    let sync_meta = read_sync_metadata(repo_dir);
    let (dirty_count, dirty_files) = collect_dirty_summary(repo_dir)?;
    let branch = current_branch_name(repo_dir);
    let branches = list_local_branches(repo_dir, branch.as_deref());
    let Ok(head_sha) = run_git_checked(repo_dir, &["rev-parse", "HEAD"], &[]) else {
        return Ok(RemoteGitStateInfo {
            is_git_repo: true,
            is_worktree,
            has_commits: false,
            head_sha: None,
            branch,
            branches,
            dirty_count,
            dirty_files,
            commits_ahead: 0,
            commits_summary: Vec::new(),
            sync_meta,
        });
    };

    let (commits_ahead, commits_summary) = sync_meta
        .as_ref()
        .map(|m| count_commits_ahead_of(repo_dir, &m.base_sha, true))
        .unwrap_or((0, Vec::new()));

    Ok(RemoteGitStateInfo {
        is_git_repo: true,
        is_worktree,
        has_commits: true,
        head_sha: Some(head_sha),
        branch,
        branches,
        dirty_count,
        dirty_files,
        commits_ahead,
        commits_summary,
        sync_meta,
    })
}

fn count_commits_ahead_of(
    repo_dir: &Path,
    base_sha: &str,
    with_summary: bool,
) -> (usize, Vec<String>) {
    let base_rev = format!("{}^{{commit}}", base_sha);
    if !git_ok(repo_dir, &["cat-file", "-e", &base_rev]) {
        return (0, Vec::new());
    }
    let range = format!("{}..HEAD", base_sha);
    let commits_ahead = run_git_checked(repo_dir, &["rev-list", "--count", &range], &[])
        .ok()
        .and_then(|cnt| cnt.parse::<usize>().ok())
        .unwrap_or(0);
    let commits_summary = if with_summary {
        run_git_checked(repo_dir, &["log", "--oneline", "-n", "20", &range], &[])
            .ok()
            .map(|log| {
                log.lines()
                    .map(str::trim)
                    .filter(|l| !l.is_empty())
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    (commits_ahead, commits_summary)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteWorktreeEntry {
    pub id: String,
    pub path: String,
    pub branch: Option<String>,
    pub head_sha: Option<String>,
    pub short_sha: Option<String>,
    pub commits_ahead: usize,
    pub dirty_count: usize,
    pub is_dirty: bool,
    pub base_sha: Option<String>,
    pub is_main: bool,
    #[serde(default)]
    pub diff_added: usize,
    #[serde(default)]
    pub diff_removed: usize,
    #[serde(default)]
    pub diff_files: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorktreeDiffStats {
    pub added: usize,
    pub removed: usize,
    pub files: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorktreeDiffHunkLine {
    pub kind: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorktreeDiffHunk {
    pub old_start: usize,
    pub new_start: usize,
    pub lines: Vec<WorktreeDiffHunkLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorktreeDiffFile {
    pub path: String,
    pub status: String,
    pub added: usize,
    pub removed: usize,
    pub is_binary: bool,
    pub hunks: Vec<WorktreeDiffHunk>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorktreeDiffResponse {
    pub worktree_path: String,
    pub base_sha: Option<String>,
    pub branch: Option<String>,
    pub added: usize,
    pub removed: usize,
    pub truncated: bool,
    pub files: Vec<WorktreeDiffFile>,
}

#[derive(Debug, Default)]
struct PorcelainWorktreeStanza {
    path: String,
    head_sha: Option<String>,
    branch: Option<String>,
    bare: bool,
    prunable: bool,
}

fn parse_worktree_porcelain(raw: &str) -> Vec<PorcelainWorktreeStanza> {
    let mut entries = Vec::new();
    let mut cur: Option<PorcelainWorktreeStanza> = None;

    for raw_line in raw.lines() {
        let line = raw_line.trim_end_matches('\r');
        if line.is_empty() {
            if let Some(stanza) = cur.take() {
                if !stanza.path.is_empty() {
                    entries.push(stanza);
                }
            }
            continue;
        }
        if let Some(rest) = line.strip_prefix("worktree ") {
            if let Some(stanza) = cur.take() {
                if !stanza.path.is_empty() {
                    entries.push(stanza);
                }
            }
            cur = Some(PorcelainWorktreeStanza {
                path: rest.to_string(),
                ..Default::default()
            });
            continue;
        }
        if let Some(ref mut stanza) = cur {
            if let Some(sha) = line.strip_prefix("HEAD ") {
                let s = sha.trim();
                if !s.is_empty() && !s.chars().all(|c| c == '0') {
                    stanza.head_sha = Some(s.to_string());
                }
            } else if let Some(bref) = line.strip_prefix("branch ") {
                let trimmed = bref.trim();
                let short = trimmed.strip_prefix("refs/heads/").unwrap_or(trimmed);
                if !short.is_empty() {
                    stanza.branch = Some(short.to_string());
                }
            } else if line == "bare" {
                stanza.bare = true;
            } else if line == "prunable" || line.starts_with("prunable ") {
                stanza.prunable = true;
            }
        }
    }
    if let Some(stanza) = cur.take() {
        if !stanza.path.is_empty() {
            entries.push(stanza);
        }
    }
    entries
}

/// List secondary `git worktree` entries associated with `repo_dir`.
pub fn list_git_worktrees(repo_dir: &Path) -> Result<Vec<RemoteWorktreeEntry>> {
    if !repo_dir.exists() || !git_ok(repo_dir, &["rev-parse", "--git-dir"]) {
        return Ok(Vec::new());
    }
    let _ = run_git_raw(repo_dir, &["worktree", "prune"], &[]);
    let raw = run_git_checked(repo_dir, &["worktree", "list", "--porcelain"], &[])?;
    let stanzas = parse_worktree_porcelain(&raw);
    let main_canon = stanzas
        .first()
        .map(|s| Path::new(&s.path))
        .and_then(|p| std::fs::canonicalize(p).ok())
        .or_else(|| std::fs::canonicalize(repo_dir).ok());
    let fallback_base = run_git_checked(repo_dir, &["rev-parse", "HEAD"], &[]).ok();

    let mut out = Vec::new();
    for (idx, stanza) in stanzas.into_iter().enumerate() {
        if idx == 0 || stanza.bare || stanza.prunable {
            continue;
        }
        let wt_path = PathBuf::from(&stanza.path);
        if !wt_path.is_dir() {
            continue;
        }
        let canon = std::fs::canonicalize(&wt_path).unwrap_or_else(|_| wt_path.clone());
        if main_canon.as_ref().is_some_and(|m| m == &canon) {
            continue;
        }

        let sync_meta = read_sync_metadata(&canon);
        let base_sha = sync_meta
            .as_ref()
            .map(|m| m.base_sha.clone())
            .or_else(|| fallback_base.clone());
        let (commits_ahead, _) = base_sha
            .as_deref()
            .map(|b| count_commits_ahead_of(&canon, b, false))
            .unwrap_or((0, Vec::new()));
        let (dirty_count, _dirty_files) = collect_dirty_summary(&canon)?;
        let diff_stats = compute_worktree_diff_stats(&canon).unwrap_or_default();
        let short_sha = stanza
            .head_sha
            .as_ref()
            .map(|s| s.chars().take(7).collect::<String>());
        let id = canon
            .file_name()
            .and_then(|n| n.to_str())
            .filter(|s| !s.is_empty())
            .unwrap_or("worktree")
            .to_string();

        out.push(RemoteWorktreeEntry {
            id,
            path: canon.to_string_lossy().into_owned(),
            branch: stanza.branch,
            head_sha: stanza.head_sha,
            short_sha,
            commits_ahead,
            dirty_count,
            is_dirty: dirty_count > 0,
            base_sha,
            is_main: false,
            diff_added: diff_stats.added,
            diff_removed: diff_stats.removed,
            diff_files: diff_stats.files,
        });
    }

    Ok(out)
}

/// Force-remove a secondary `git worktree` belonging to `repo_dir` and clean up
/// auto-generated `agent/*` branches if present.
pub fn remove_git_worktree(repo_dir: &Path, worktree_path: &Path) -> Result<()> {
    if !repo_dir.exists() || !git_ok(repo_dir, &["rev-parse", "--git-dir"]) {
        anyhow::bail!("Path is not a git repository: {}", repo_dir.display());
    }
    let raw = run_git_checked(repo_dir, &["worktree", "list", "--porcelain"], &[])?;
    let stanzas = parse_worktree_porcelain(&raw);
    let target_canon = std::fs::canonicalize(worktree_path).unwrap_or_else(|_| worktree_path.to_path_buf());

    let matched = stanzas.iter().enumerate().find(|(_, s)| {
        let p = Path::new(&s.path);
        std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf()) == target_canon
    });
    let Some((idx, stanza)) = matched else {
        anyhow::bail!(
            "Worktree is not registered in this repository: {}",
            worktree_path.display()
        );
    };
    if idx == 0 {
        anyhow::bail!("Refusing to remove the main repository worktree");
    }

    let wt_arg = target_canon.to_string_lossy().into_owned();
    run_git_checked(repo_dir, &["worktree", "remove", "--force", &wt_arg], &[])?;
    let _ = run_git_raw(repo_dir, &["worktree", "prune"], &[]);

    if let Some(branch) = stanza.branch.as_deref() {
        if branch.starts_with("agent/") {
            let _ = run_git_raw(repo_dir, &["branch", "-D", branch], &[]);
        }
    }

    Ok(())
}

#[derive(Debug, Clone, Default)]
pub struct CreateGitWorktreeOptions<'a> {
    pub branch: Option<&'a str>,
    pub worktree_dir: Option<&'a str>,
    pub worktree_name: Option<&'a str>,
    pub base_ref: Option<&'a str>,
    pub include_dirty: bool,
}

/// Create an isolated `git worktree` from `repo_dir` under `worktrees_root`,
/// preserving sync metadata (`base_sha`, `source_root`, `source_name`) and optionally dirty edits.
pub fn create_git_worktree(
    repo_dir: &Path,
    worktrees_root: &Path,
    project_name: &str,
    opts: CreateGitWorktreeOptions<'_>,
) -> Result<(PathBuf, String)> {
    if !git_ok(repo_dir, &["rev-parse", "--is-inside-work-tree"]) {
        anyhow::bail!(
            "Project at {} is not a Git repository",
            repo_dir.display()
        );
    }
    if !git_ok(repo_dir, &["rev-parse", "--verify", "HEAD"]) {
        anyhow::bail!("Git repository has no commits yet");
    }

    let base_rev_arg = opts
        .base_ref
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|b| format!("{}^{{commit}}", b))
        .unwrap_or_else(|| "HEAD".to_string());
    let head_sha = run_git_checked(repo_dir, &["rev-parse", "--verify", &base_rev_arg], &[])?;
    let parent_meta = read_sync_metadata(repo_dir);
    let requested_branch_clean = opts
        .branch
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let requested_name_raw = opts
        .worktree_name
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let (wt_path, default_branch) = match opts.worktree_dir.map(str::trim).filter(|s| !s.is_empty()) {
        Some(explicit) => {
            let p = PathBuf::from(explicit);
            if p.exists() {
                anyhow::bail!("Target worktree directory already exists: {}", p.display());
            }
            let id = requested_name_raw
                .map(|raw| sanitize_slug(raw, false))
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| crate::utils::short_alpha_id(8));
            (p, format!("agent/{}", id))
        }
        None => {
            let proj_slug = sanitize_slug(project_name, false);
            let proj_slug = if proj_slug.is_empty() { "project" } else { &proj_slug };
            let parent = worktrees_root.join(proj_slug);
            if let Some(raw_name) = requested_name_raw {
                let slug = sanitize_slug(raw_name, false);
                if slug.is_empty() {
                    anyhow::bail!("Invalid worktree name: {}", raw_name);
                }
                let candidate = parent.join(&slug);
                if candidate.exists() {
                    anyhow::bail!("Worktree '{}' already exists", slug);
                }
                (candidate, format!("agent/{}", slug))
            } else {
                let mut chosen = None;
                for _ in 0..1000u32 {
                    let id = crate::utils::short_alpha_id(8);
                    let candidate = parent.join(&id);
                    let branch_candidate = format!("agent/{}", id);
                    let branch_ref = format!("refs/heads/{}", branch_candidate);
                    let branch_taken = requested_branch_clean.is_none()
                        && git_ok(repo_dir, &["show-ref", "--verify", "--quiet", &branch_ref]);
                    if !candidate.exists() && !branch_taken {
                        chosen = Some((candidate, branch_candidate));
                        break;
                    }
                }
                chosen.context("Could not allocate a unique worktree directory")?
            }
        }
    };

    let branch = pick_available_branch(repo_dir, requested_branch_clean, &default_branch)?;

    if let Some(parent) = wt_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let wt_str = wt_path.to_string_lossy().into_owned();
    run_git_checked(
        repo_dir,
        &["worktree", "add", "-b", &branch, &wt_str, &head_sha],
        &[],
    )?;

    if opts.include_dirty {
        let (overlay_b64, deleted_files, _) =
            collect_dirty_overlay(repo_dir, MAX_DIRTY_OVERLAY_BYTES)?;
        for del in &deleted_files {
            if let Ok(rel) = validate_safe_rel_path(del) {
                let full = wt_path.join(rel);
                if full.is_file() || full.is_symlink() {
                    let _ = std::fs::remove_file(full);
                }
            }
        }
        if let Some(b64) = overlay_b64.as_deref().filter(|s| !s.trim().is_empty()) {
            crate::node_server::unpack_project_archive(b64, &wt_path)?;
        }
    }

    let meta = CloudSyncMetadata {
        base_sha: head_sha,
        branch: Some(branch.clone()),
        source_root: parent_meta.as_ref().and_then(|m| m.source_root.clone()),
        source_name: parent_meta
            .as_ref()
            .and_then(|m| m.source_name.clone())
            .or_else(|| Some(project_name.to_string())),
        overlay_paths: Vec::new(),
        synced_at_epoch: unix_epoch_secs(),
    };
    write_sync_metadata(&wt_path, &meta)?;

    let canonical_wt = std::fs::canonicalize(&wt_path).unwrap_or(wt_path);
    Ok((canonical_wt, branch))
}

fn build_wip_snapshot_commit(repo_dir: &Path, head_sha: &str) -> Result<Option<String>> {
    let head_tree = run_git_checked(repo_dir, &["rev-parse", "HEAD^{tree}"], &[])?;
    let tmp = tempfile::TempDir::new()?;
    let tmp_idx = tmp.path().join("wip.index");
    let idx_str = tmp_idx.to_string_lossy().into_owned();
    let idx_env = [("GIT_INDEX_FILE", idx_str.as_str())];

    run_git_checked(repo_dir, &["read-tree", "HEAD"], &idx_env)?;
    run_git_checked(repo_dir, &["add", "-A"], &idx_env)?;
    let wip_tree = run_git_checked(repo_dir, &["write-tree"], &idx_env)?;

    if wip_tree == head_tree {
        return Ok(None);
    }

    let author_env = [
        ("GIT_AUTHOR_NAME", "Anycode Agent"),
        ("GIT_AUTHOR_EMAIL", "anycode@local"),
        ("GIT_COMMITTER_NAME", "Anycode Agent"),
        ("GIT_COMMITTER_EMAIL", "anycode@local"),
    ];
    let wip_sha = run_git_checked(
        repo_dir,
        &[
            "commit-tree",
            &wip_tree,
            "-p",
            head_sha,
            "-m",
            "WIP: uncommitted changes from remote node",
        ],
        &author_env,
    )?;
    Ok(Some(wip_sha))
}

/// Package remote commits and any uncommitted working-tree edits into a delta git bundle file.
/// Bundles smaller than `TRANSFER_CHUNK_BYTES` are inlined; larger ones are returned on disk for chunked transfer.
pub fn build_pull_bundle_to_file(
    repo_dir: &Path,
    known_bases: &[String],
) -> Result<(PullGitBundleResponse, Option<tempfile::NamedTempFile>)> {
    use base64::Engine as _;

    if !git_ok(repo_dir, &["rev-parse", "--is-inside-work-tree"]) {
        anyhow::bail!(
            "Remote project at {} is not a Git repository. Re-sync it from your local project first.",
            repo_dir.display()
        );
    }
    if !git_ok(repo_dir, &["rev-parse", "--verify", "HEAD"]) {
        anyhow::bail!("Remote Git repository has no commits yet");
    }

    let head_sha = run_git_checked(repo_dir, &["rev-parse", "HEAD"], &[])?;
    let branch = current_branch_name(repo_dir);
    let sync_meta = read_sync_metadata(repo_dir);
    let base_sha = sync_meta.as_ref().map(|m| m.base_sha.clone());

    let (dirty_count, dirty_files) = collect_dirty_summary(repo_dir)?;
    let wip_sha = if dirty_count > 0 {
        build_wip_snapshot_commit(repo_dir, &head_sha)?
    } else {
        None
    };
    let has_wip = wip_sha.is_some();
    let final_sha = wip_sha.unwrap_or_else(|| head_sha.clone());

    let mut candidate_bases = Vec::with_capacity(known_bases.len() + 1);
    if let Some(ref base) = base_sha {
        if known_bases.iter().any(|k| k == base) {
            candidate_bases.push(base.clone());
        }
    }
    candidate_bases.extend(known_bases.iter().cloned());
    let exclude_bases = filter_existing_commits(repo_dir, &candidate_bases, 64);

    let mut count_args: Vec<String> = vec!["rev-list".into(), "--count".into()];
    for b in &exclude_bases {
        count_args.push(format!("^{}", b));
    }
    count_args.push(final_sha.clone());
    let count_arg_refs: Vec<&str> = count_args.iter().map(String::as_str).collect();
    let total_objects_ahead: usize = run_git_checked(repo_dir, &count_arg_refs, &[])?
        .parse()
        .unwrap_or(0);

    if total_objects_ahead == 0 {
        return Ok((
            PullGitBundleResponse {
                changed: false,
                head_sha,
                branch,
                base_sha,
                has_wip: false,
                commits_count: 0,
                dirty_count: 0,
                commits_summary: Vec::new(),
                dirty_files: Vec::new(),
                bundle_b64: None,
                bundle_transfer_id: None,
                bundle_size: None,
                ref_name: None,
            },
            None,
        ));
    }

    let mut commit_count_args: Vec<String> = vec!["rev-list".into(), "--count".into()];
    for b in &exclude_bases {
        commit_count_args.push(format!("^{}", b));
    }
    commit_count_args.push(head_sha.clone());
    let commit_count_refs: Vec<&str> = commit_count_args.iter().map(String::as_str).collect();
    let commits_count: usize = run_git_checked(repo_dir, &commit_count_refs, &[])?
        .parse()
        .unwrap_or(0);

    let mut log_args: Vec<String> =
        vec!["log".into(), "--oneline".into(), "-n".into(), "20".into()];
    for b in &exclude_bases {
        log_args.push(format!("^{}", b));
    }
    log_args.push(head_sha.clone());
    let log_refs: Vec<&str> = log_args.iter().map(String::as_str).collect();
    let commits_summary = run_git_checked(repo_dir, &log_refs, &[])
        .unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(str::to_string)
        .collect();

    let ref_name = format!(
        "refs/anycode-pull/res-{}-{}",
        std::process::id(),
        unix_epoch_secs()
    );
    let _ref_guard = CloudRefGuard::new(repo_dir, ref_name.clone());
    run_git_checked(repo_dir, &["update-ref", &ref_name, &final_sha], &[])?;

    let tmp_bundle = tempfile::NamedTempFile::new()?;
    let bundle_str = tmp_bundle.path().to_string_lossy().into_owned();

    let mut bundle_args: Vec<String> = vec!["bundle".into(), "create".into(), bundle_str.clone()];
    for b in &exclude_bases {
        bundle_args.push(format!("^{}", b));
    }
    bundle_args.push(ref_name.clone());
    let bundle_refs: Vec<&str> = bundle_args.iter().map(String::as_str).collect();
    run_git_checked(repo_dir, &bundle_refs, &[])?;

    let bundle_len = std::fs::metadata(tmp_bundle.path())?.len();
    let (bundle_b64, transfer_file) = if bundle_len <= TRANSFER_CHUNK_BYTES as u64 {
        let bytes = std::fs::read(tmp_bundle.path())?;
        (
            Some(base64::engine::general_purpose::STANDARD.encode(bytes)),
            None,
        )
    } else {
        (None, Some(tmp_bundle))
    };

    Ok((
        PullGitBundleResponse {
            changed: true,
            head_sha,
            branch,
            base_sha,
            has_wip,
            commits_count,
            dirty_count,
            commits_summary,
            dirty_files,
            bundle_b64,
            bundle_transfer_id: None,
            bundle_size: Some(bundle_len),
            ref_name: Some(ref_name),
        },
        transfer_file,
    ))
}

/// Inline wrapper for smaller deltas and tests.
pub fn build_pull_bundle(
    repo_dir: &Path,
    known_bases: &[String],
    max_bytes: usize,
) -> Result<PullGitBundleResponse> {
    use base64::Engine as _;

    let (mut resp, file_opt) = build_pull_bundle_to_file(repo_dir, known_bases)?;
    if let Some(file) = file_opt {
        let bytes = std::fs::read(file.path())?;
        if bytes.len() > max_bytes {
            anyhow::bail!(
                "Pull delta bundle ({:.1} MiB) exceeds {} MiB limit",
                bytes.len() as f64 / (1024.0 * 1024.0),
                max_bytes / (1024 * 1024)
            );
        }
        resp.bundle_b64 = Some(base64::engine::general_purpose::STANDARD.encode(bytes));
    }
    Ok(resp)
}

pub fn resolve_git_toplevel(dir: &Path) -> Result<PathBuf> {
    let raw = run_git_checked(dir, &["rev-parse", "--show-toplevel"], &[])
        .with_context(|| format!("Local project is not a Git repository: {}", dir.display()))?;
    Ok(std::fs::canonicalize(&raw).unwrap_or_else(|_| PathBuf::from(raw)))
}

pub fn collect_local_known_bases(repo_dir: &Path) -> Result<Vec<String>> {
    let Ok(raw) = run_git_checked(
        repo_dir,
        &[
            "rev-list",
            &format!("--max-count={}", MAX_KNOWN_BASES),
            "--all",
        ],
        &[],
    ) else {
        return Ok(Vec::new());
    };
    Ok(raw
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(str::to_string)
        .collect())
}

fn sanitize_slug(input: &str, allow_slash: bool) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        let ok = ch.is_ascii_alphanumeric()
            || matches!(ch, '-' | '_' | '.')
            || (allow_slash && ch == '/');
        if ok {
            out.push(ch);
        } else {
            out.push('-');
        }
    }
    while out.contains("//") {
        out = out.replace("//", "/");
    }
    while out.contains("..") {
        out = out.replace("..", "-");
    }
    out.trim_matches(|c| c == '/' || c == '.' || c == '-')
        .trim_end_matches(".lock")
        .to_string()
}

fn pick_available_branch(
    repo_dir: &Path,
    requested: Option<&str>,
    default_base: &str,
) -> Result<String> {
    if let Some(explicit) = requested.map(str::trim).filter(|s| !s.is_empty()) {
        if !git_ok(repo_dir, &["check-ref-format", "--branch", explicit]) {
            anyhow::bail!("Invalid Git branch name: {}", explicit);
        }
        let full_ref = format!("refs/heads/{}", explicit);
        if git_ok(repo_dir, &["show-ref", "--verify", "--quiet", &full_ref]) {
            anyhow::bail!("Local branch '{}' already exists", explicit);
        }
        return Ok(explicit.to_string());
    }

    let base = sanitize_slug(default_base, true);
    let base = if base.is_empty() || !git_ok(repo_dir, &["check-ref-format", "--branch", &base]) {
        format!("cloud/pull-{}", unix_epoch_secs())
    } else {
        base
    };

    for idx in 0..1000u32 {
        let candidate = if idx == 0 {
            base.clone()
        } else {
            format!("{}-{}", base, idx + 1)
        };
        let full_ref = format!("refs/heads/{}", candidate);
        if !git_ok(repo_dir, &["show-ref", "--verify", "--quiet", &full_ref])
            && git_ok(repo_dir, &["check-ref-format", "--branch", &candidate])
        {
            return Ok(candidate);
        }
    }
    anyhow::bail!("Could not allocate a unique branch name")
}

fn pick_worktree_path(
    worktrees_root: &Path,
    project_name: &str,
    branch_name: &str,
    requested_dir: Option<&str>,
) -> Result<PathBuf> {
    if let Some(explicit) = requested_dir.map(str::trim).filter(|s| !s.is_empty()) {
        let path = PathBuf::from(explicit);
        if path.exists() {
            anyhow::bail!("Target worktree directory already exists: {}", path.display());
        }
        return Ok(path);
    }

    let proj_slug = sanitize_slug(project_name, false);
    let proj_slug = if proj_slug.is_empty() {
        "project"
    } else {
        &proj_slug
    };
    let branch_slug = sanitize_slug(&branch_name.replace('/', "-"), false);
    let branch_slug = if branch_slug.is_empty() {
        format!("wt-{}", unix_epoch_secs())
    } else {
        branch_slug
    };

    let parent = worktrees_root.join(proj_slug);
    for idx in 0..1000u32 {
        let folder = if idx == 0 {
            branch_slug.clone()
        } else {
            format!("{}-{}", branch_slug, idx + 1)
        };
        let candidate = parent.join(folder);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    anyhow::bail!("Could not allocate a unique worktree directory")
}

/// Fetch an on-disk delta bundle into `local_repo_root` and check it out into a fresh git worktree.
pub fn apply_pull_bundle_file_to_worktree(
    local_repo_root: &Path,
    bundle_path: &Path,
    pull: &PullGitBundleResponse,
    server_name: &str,
    project_name: &str,
    worktrees_root: &Path,
    requested_branch: Option<&str>,
    requested_worktree_dir: Option<&str>,
) -> Result<(PathBuf, String)> {
    let remote_ref = pull
        .ref_name
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .context("Missing source ref name in pull response")?;
    let bundle_str = bundle_path.to_string_lossy().into_owned();

    let staging_ref = format!(
        "refs/anycode-cloud-stage/pull-{}-{}",
        std::process::id(),
        unix_epoch_secs()
    );
    let _staging_guard = CloudRefGuard::new(local_repo_root, staging_ref.clone());
    let refspec = format!("{}:{}", remote_ref, staging_ref);
    run_git_checked(local_repo_root, &["fetch", &bundle_str, &refspec], &[])?;

    let srv_slug = sanitize_slug(&server_name.to_lowercase(), false);
    let srv_slug = if srv_slug.is_empty() { "node" } else { &srv_slug };
    let base_label = pull
        .branch
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(project_name);
    let stamp = chrono::Local::now().format("%m%d-%H%M%S");
    let default_branch = format!("cloud/{}/{}-{}", srv_slug, base_label, stamp);

    let branch = pick_available_branch(local_repo_root, requested_branch, &default_branch)?;
    let worktree_path = pick_worktree_path(
        worktrees_root,
        project_name,
        &branch,
        requested_worktree_dir,
    )?;

    if let Some(parent) = worktree_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let wt_str = worktree_path.to_string_lossy().into_owned();
    run_git_checked(
        local_repo_root,
        &["worktree", "add", "-b", &branch, &wt_str, &staging_ref],
        &[],
    )?;

    if pull.has_wip && git_ok(&worktree_path, &["rev-parse", "--verify", "HEAD~1"]) {
        run_git_checked(&worktree_path, &["reset", "--mixed", "HEAD~1"], &[])?;
    }

    let canonical_wt = std::fs::canonicalize(&worktree_path).unwrap_or(worktree_path);
    Ok((canonical_wt, branch))
}

/// Fetch an inline base64 delta bundle into `local_repo_root` and check it out into a fresh git worktree.
pub fn apply_pull_bundle_to_worktree(
    local_repo_root: &Path,
    pull: &PullGitBundleResponse,
    server_name: &str,
    project_name: &str,
    worktrees_root: &Path,
    requested_branch: Option<&str>,
    requested_worktree_dir: Option<&str>,
) -> Result<(PathBuf, String)> {
    use base64::Engine as _;

    let bundle_b64 = pull
        .bundle_b64
        .as_deref()
        .context("Missing delta bundle in remote response")?;
    let bundle_bytes = base64::engine::general_purpose::STANDARD
        .decode(bundle_b64.trim())
        .map_err(|e| anyhow::anyhow!("Invalid pull bundle encoding: {}", e))?;
    let tmp_bundle = tempfile::NamedTempFile::new()?;
    std::fs::write(tmp_bundle.path(), bundle_bytes)?;

    apply_pull_bundle_file_to_worktree(
        local_repo_root,
        tmp_bundle.path(),
        pull,
        server_name,
        project_name,
        worktrees_root,
        requested_branch,
        requested_worktree_dir,
    )
}

const MAX_WORKTREE_UNTRACKED_BYTES: u64 = 512 * 1024;
const MAX_WORKTREE_DIFF_PAYLOAD_BYTES: usize = 4 * 1024 * 1024;

fn resolve_worktree_base_sha(worktree_path: &Path) -> Option<String> {
    if let Some(meta) = read_sync_metadata(worktree_path) {
        let base = meta.base_sha.trim();
        if !base.is_empty() && git_ok(worktree_path, &["cat-file", "-e", base]) {
            return Some(base.to_string());
        }
    }
    run_git_checked(worktree_path, &["rev-parse", "--verify", "HEAD"], &[]).ok()
}

fn collect_untracked_files(worktree_path: &Path) -> Result<Vec<String>> {
    let out = run_git_raw(
        worktree_path,
        &[
            "-c",
            "core.quotePath=false",
            "ls-files",
            "--others",
            "--exclude-standard",
            "-z",
        ],
        &[],
    )?;
    if !out.status.success() {
        return Ok(Vec::new());
    }
    Ok(out
        .stdout
        .split(|&b| b == 0)
        .filter(|slice| !slice.is_empty())
        .map(|slice| String::from_utf8_lossy(slice).into_owned())
        .collect())
}

fn read_untracked_text(worktree_path: &Path, rel_path: &str) -> Option<String> {
    let full = worktree_path.join(rel_path);
    let meta = std::fs::symlink_metadata(&full).ok()?;
    if !meta.is_file() || meta.len() > MAX_WORKTREE_UNTRACKED_BYTES {
        return None;
    }
    let bytes = std::fs::read(&full).ok()?;
    let sample = &bytes[..bytes.len().min(8192)];
    if sample.contains(&0) {
        return None;
    }
    String::from_utf8(bytes).ok()
}

fn parse_hunk_header(header: &str) -> Option<(usize, usize)> {
    let rest = header.strip_prefix("@@ -")?;
    let end_marker = rest.find(" @@")?;
    let coords = &rest[..end_marker];
    let mut parts = coords.split(" +");
    let old_part = parts.next()?;
    let new_part = parts.next()?;
    let old_start = old_part.split(',').next()?.parse::<usize>().ok()?;
    let new_start = new_part.split(',').next()?.parse::<usize>().ok()?;
    Some((old_start.max(1), new_start.max(1)))
}

fn strip_diff_prefix(raw: &str, prefix: &str) -> Option<String> {
    let trimmed = raw.trim_end_matches('\r');
    if trimmed == "/dev/null" {
        return None;
    }
    Some(trimmed.strip_prefix(prefix).unwrap_or(trimmed).to_string())
}

fn collect_numstat_map(
    worktree_path: &Path,
    base_sha: &str,
) -> Result<std::collections::HashMap<String, (usize, usize, bool)>> {
    let mut map = std::collections::HashMap::new();
    let out = run_git_raw(
        worktree_path,
        &[
            "-c",
            "core.quotePath=false",
            "diff",
            "--numstat",
            "--no-renames",
            "-z",
            base_sha,
        ],
        &[],
    )?;
    if !out.status.success() {
        return Ok(map);
    }

    for entry in out.stdout.split(|&b| b == 0).filter(|s| !s.is_empty()) {
        let s = String::from_utf8_lossy(entry);
        let mut parts = s.splitn(3, '\t');
        let add_str = parts.next().unwrap_or("");
        let del_str = parts.next().unwrap_or("");
        let Some(path) = parts.next() else {
            continue;
        };
        if path.is_empty() {
            continue;
        }
        let is_binary = add_str == "-" || del_str == "-";
        let added = add_str.parse::<usize>().unwrap_or(0);
        let removed = del_str.parse::<usize>().unwrap_or(0);
        map.insert(path.to_string(), (added, removed, is_binary));
    }
    Ok(map)
}

fn collect_name_status_map(
    worktree_path: &Path,
    base_sha: &str,
) -> Result<std::collections::HashMap<String, String>> {
    let mut map = std::collections::HashMap::new();
    let out = run_git_raw(
        worktree_path,
        &[
            "-c",
            "core.quotePath=false",
            "diff",
            "--name-status",
            "--no-renames",
            "-z",
            base_sha,
        ],
        &[],
    )?;
    if !out.status.success() {
        return Ok(map);
    }

    let fields: Vec<&[u8]> = out.stdout.split(|&b| b == 0).filter(|s| !s.is_empty()).collect();
    let mut i = 0;
    while i + 1 < fields.len() {
        let status_code = String::from_utf8_lossy(fields[i]);
        let path = String::from_utf8_lossy(fields[i + 1]).into_owned();
        let status = match status_code.chars().next() {
            Some('A') => "added",
            Some('D') => "deleted",
            Some('R') => "renamed",
            _ => "modified",
        };
        map.insert(path, status.to_string());
        i += 2;
    }
    Ok(map)
}

/// Compute aggregate diff line counts (`+added`, `-removed`, `files`) for a worktree against its base commit.
pub fn compute_worktree_diff_stats(worktree_path: &Path) -> Result<WorktreeDiffStats> {
    if !worktree_path.exists() || !git_ok(worktree_path, &["rev-parse", "--is-inside-work-tree"]) {
        return Ok(WorktreeDiffStats::default());
    }

    let mut stats = WorktreeDiffStats::default();
    if let Some(base_sha) = resolve_worktree_base_sha(worktree_path) {
        let numstat = collect_numstat_map(worktree_path, &base_sha)?;
        for (_, (added, removed, _is_binary)) in numstat {
            stats.files += 1;
            stats.added += added;
            stats.removed += removed;
        }
    }

    for rel_path in collect_untracked_files(worktree_path)? {
        stats.files += 1;
        if let Some(text) = read_untracked_text(worktree_path, &rel_path) {
            stats.added += text.lines().count();
        }
    }

    Ok(stats)
}

/// Collect unified diff hunks against `base_sha` plus untracked text files for fast multibuffer rendering.
pub fn collect_worktree_diff(worktree_path: &Path) -> Result<WorktreeDiffResponse> {
    if !worktree_path.exists() || !git_ok(worktree_path, &["rev-parse", "--is-inside-work-tree"]) {
        anyhow::bail!("Path is not a git worktree: {}", worktree_path.display());
    }

    let canonical_wt = std::fs::canonicalize(worktree_path).unwrap_or_else(|_| worktree_path.to_path_buf());
    let base_sha = resolve_worktree_base_sha(&canonical_wt);
    let branch = run_git_checked(&canonical_wt, &["rev-parse", "--abbrev-ref", "HEAD"], &[])
        .ok()
        .filter(|b| !b.is_empty() && b != "HEAD");

    let mut files: Vec<WorktreeDiffFile> = Vec::new();
    let mut total_added = 0usize;
    let mut total_removed = 0usize;
    let mut payload_bytes = 0usize;
    let mut truncated = false;

    if let Some(ref base) = base_sha {
        let numstat_map = collect_numstat_map(&canonical_wt, base)?;
        let status_map = collect_name_status_map(&canonical_wt, base)?;

        let out = run_git_raw(
            &canonical_wt,
            &[
                "-c",
                "core.quotePath=false",
                "diff",
                "-U3",
                "--no-color",
                "--no-ext-diff",
                "--no-renames",
                base,
            ],
            &[],
        )?;
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr);
            anyhow::bail!("git diff failed: {}", err.trim());
        }

        let diff_text = String::from_utf8_lossy(&out.stdout);

        struct PendingFile {
            old_path: Option<String>,
            new_path: Option<String>,
            fallback_path: Option<String>,
            is_binary: bool,
            hunks: Vec<WorktreeDiffHunk>,
            current_hunk: Option<WorktreeDiffHunk>,
        }

        let flush_pending = |pending_opt: Option<PendingFile>,
                             files: &mut Vec<WorktreeDiffFile>,
                             total_added: &mut usize,
                             total_removed: &mut usize| {
            let Some(mut pending) = pending_opt else {
                return;
            };
            if let Some(hunk) = pending.current_hunk.take() {
                pending.hunks.push(hunk);
            }
            let Some(path) = pending
                .new_path
                .or(pending.old_path)
                .or(pending.fallback_path)
            else {
                return;
            };
            let status = status_map
                .get(&path)
                .cloned()
                .unwrap_or_else(|| "modified".to_string());
            let (added, removed, numstat_binary) = numstat_map
                .get(&path)
                .copied()
                .unwrap_or((0, 0, false));
            *total_added += added;
            *total_removed += removed;
            files.push(WorktreeDiffFile {
                path,
                status,
                added,
                removed,
                is_binary: pending.is_binary || numstat_binary,
                hunks: pending.hunks,
            });
        };

        let mut current: Option<PendingFile> = None;

        for raw_line in diff_text.split('\n') {
            let line = raw_line.strip_suffix('\r').unwrap_or(raw_line);
            if let Some(rest) = line.strip_prefix("diff --git ") {
                flush_pending(current.take(), &mut files, &mut total_added, &mut total_removed);
                if payload_bytes >= MAX_WORKTREE_DIFF_PAYLOAD_BYTES {
                    truncated = true;
                    break;
                }
                let fallback_path = rest
                    .split(" b/")
                    .nth(1)
                    .map(|p| p.to_string());
                current = Some(PendingFile {
                    old_path: None,
                    new_path: None,
                    fallback_path,
                    is_binary: false,
                    hunks: Vec::new(),
                    current_hunk: None,
                });
                continue;
            }

            let Some(ref mut pending) = current else {
                continue;
            };

            if pending.current_hunk.is_none() {
                if let Some(p) = line.strip_prefix("--- ") {
                    pending.old_path = strip_diff_prefix(p, "a/");
                    continue;
                }
                if let Some(p) = line.strip_prefix("+++ ") {
                    pending.new_path = strip_diff_prefix(p, "b/");
                    continue;
                }
                if line.starts_with("Binary files ") || line == "GIT binary patch" {
                    pending.is_binary = true;
                    continue;
                }
            }

            if line.starts_with("@@ -") {
                if let Some(hunk) = pending.current_hunk.take() {
                    pending.hunks.push(hunk);
                }
                if let Some((old_start, new_start)) = parse_hunk_header(line) {
                    pending.current_hunk = Some(WorktreeDiffHunk {
                        old_start,
                        new_start,
                        lines: Vec::new(),
                    });
                }
                continue;
            }

            if let Some(ref mut hunk) = pending.current_hunk {
                if line.starts_with('\\') {
                    continue;
                }
                if let Some(body) = line.strip_prefix(' ') {
                    payload_bytes += body.len() + 16;
                    hunk.lines.push(WorktreeDiffHunkLine {
                        kind: "context".to_string(),
                        text: body.to_string(),
                    });
                } else if let Some(body) = line.strip_prefix('+') {
                    payload_bytes += body.len() + 16;
                    hunk.lines.push(WorktreeDiffHunkLine {
                        kind: "add".to_string(),
                        text: body.to_string(),
                    });
                } else if let Some(body) = line.strip_prefix('-') {
                    payload_bytes += body.len() + 16;
                    hunk.lines.push(WorktreeDiffHunkLine {
                        kind: "del".to_string(),
                        text: body.to_string(),
                    });
                }
                if payload_bytes >= MAX_WORKTREE_DIFF_PAYLOAD_BYTES {
                    truncated = true;
                    break;
                }
            }
        }

        flush_pending(current.take(), &mut files, &mut total_added, &mut total_removed);

        // Include any changed files reported by numstat that had empty hunks (e.g. mode-only or skipped after cap)
        let seen: std::collections::HashSet<String> = files.iter().map(|f| f.path.clone()).collect();
        for (path, (added, removed, is_binary)) in &numstat_map {
            if seen.contains(path) {
                continue;
            }
            let status = status_map
                .get(path)
                .cloned()
                .unwrap_or_else(|| "modified".to_string());
            total_added += *added;
            total_removed += *removed;
            files.push(WorktreeDiffFile {
                path: path.clone(),
                status,
                added: *added,
                removed: *removed,
                is_binary: *is_binary,
                hunks: Vec::new(),
            });
        }
    }

    for rel_path in collect_untracked_files(&canonical_wt)? {
        if payload_bytes >= MAX_WORKTREE_DIFF_PAYLOAD_BYTES {
            truncated = true;
            files.push(WorktreeDiffFile {
                path: rel_path,
                status: "untracked".to_string(),
                added: 0,
                removed: 0,
                is_binary: false,
                hunks: Vec::new(),
            });
            continue;
        }

        if let Some(text) = read_untracked_text(&canonical_wt, &rel_path) {
            let lines: Vec<WorktreeDiffHunkLine> = text
                .lines()
                .map(|line| {
                    payload_bytes += line.len() + 16;
                    WorktreeDiffHunkLine {
                        kind: "add".to_string(),
                        text: line.to_string(),
                    }
                })
                .collect();
            let line_count = lines.len();
            total_added += line_count;
            files.push(WorktreeDiffFile {
                path: rel_path,
                status: "untracked".to_string(),
                added: line_count,
                removed: 0,
                is_binary: false,
                hunks: if lines.is_empty() {
                    Vec::new()
                } else {
                    vec![WorktreeDiffHunk {
                        old_start: 1,
                        new_start: 1,
                        lines,
                    }]
                },
            });
        } else {
            files.push(WorktreeDiffFile {
                path: rel_path,
                status: "untracked".to_string(),
                added: 0,
                removed: 0,
                is_binary: true,
                hunks: Vec::new(),
            });
        }
    }

    files.sort_by(|a, b| a.path.cmp(&b.path));

    Ok(WorktreeDiffResponse {
        worktree_path: canonical_wt.to_string_lossy().into_owned(),
        base_sha,
        branch,
        added: total_added,
        removed: total_removed,
        truncated,
        files,
    })
}

#[cfg(test)]
#[path = "tests/git.rs"]
mod tests;

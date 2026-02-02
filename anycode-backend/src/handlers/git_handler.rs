use serde_json::{json, Value};
use socketioxide::extract::{AckSender, Data, State};
use tracing::info;
use crate::app_state::{AppState, send_response};
use serde::{Deserialize, Serialize};
use git2::{Repository, Status, StatusOptions};
use std::path::Path;
use anyhow::{Context, Result};

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileStatus {
    Modified, Added, Deleted, Renamed, Conflict,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitFileStatus {
    pub path: String,
    pub status: FileStatus,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitFileOriginalRequest {
    pub path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitCommitRequest {
    pub files: Vec<String>,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitRevertRequest {
    pub path: String,
}

fn git_status_impl() -> Result<Value> {
    let workdir = crate::utils::current_dir();
    
    let repo = Repository::discover(&workdir)?;

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

        files.push(GitFileStatus { 
            path, status: file_status 
        });
    }

    info!("Git status: {} files changed on branch {}", files.len(), branch);

    Ok(json!({ "files": files, "branch": branch }))
}

pub async fn handle_git_status(ack: AckSender, _state: State<AppState>) {
    info!("Received git:status");
    send_response(ack, git_status_impl());
}

fn git_file_original_impl(request: &GitFileOriginalRequest) -> Result<Value> {
    let workdir = crate::utils::current_dir();
    
    let repo = Repository::discover(&workdir)?;
    let head = repo.head()?;
    let commit = head.peel_to_commit()?;
    let tree = commit.tree()?;

    // Convert absolute path to relative path from repo root
    let repo_path = repo.workdir().unwrap_or(Path::new("."));
    let file_path = Path::new(&request.path);
    
    let relative_path = if file_path.is_absolute() {
        file_path.strip_prefix(repo_path)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| request.path.clone())
    } else {
        request.path.clone()
    };

    // Get file from tree - if not found, it's a new file
    let entry = match tree.get_path(Path::new(&relative_path)) {
        Ok(e) => e,
        Err(_) => {
            return Ok(json!({ "content": "", "is_new": true }));
        }
    };

    let blob = repo.find_blob(entry.id())?;
    let content = std::str::from_utf8(blob.content())?.to_string();

    info!("Got original content for {}: {} bytes", relative_path, content.len());
    Ok(json!({ "content": content, "is_new": false }))
}

pub async fn handle_git_file_original(
    Data(request): Data<GitFileOriginalRequest>,
    ack: AckSender,
    _state: State<AppState>,
) {
    info!("Received git:file-original: {:?}", request.path);
    send_response(ack, git_file_original_impl(&request));
}

fn git_commit_impl(request: &GitCommitRequest) -> Result<Value> {
    let workdir = crate::utils::current_dir();
    
    let repo = Repository::discover(&workdir)?;
    let mut index = repo.index()?;

    // Add/remove files to index
    let repo_root = repo.workdir().unwrap_or(Path::new("."));
    for file_path in &request.files {
        let path = Path::new(file_path);
        let relative_path = if path.is_absolute() {
            path.strip_prefix(repo_root).unwrap_or(path)
        } else {
            path
        };

        // Check if file exists on disk - if not, it's a deletion
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

    // Get HEAD as parent
    let parents: Vec<git2::Commit> = repo.head()
        .ok()
        .and_then(|h| h.peel_to_commit().ok())
        .map(|c| vec![c])
        .unwrap_or_default();

    let parents_refs: Vec<&git2::Commit> = parents.iter().collect();

    repo.commit(Some("HEAD"), &sig, &sig, &request.message, &tree, &parents_refs)
        .context("Failed to commit")?;

    Ok(json!({}))
}

pub async fn handle_git_commit(
    Data(request): Data<GitCommitRequest>,
    ack: AckSender,
    _state: State<AppState>,
) {
    info!("Received git:commit: {} files", request.files.len());
    send_response(ack, git_commit_impl(&request));
}

fn git_push_impl() -> Result<Value> {
    let workdir = crate::utils::current_dir();
    
    let repo = Repository::discover(&workdir)?;
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

    Ok(json!({}))
}

pub async fn handle_git_push(ack: AckSender, _state: State<AppState>) {
    info!("Received git:push");
    send_response(ack, git_push_impl());
}

fn git_pull_impl() -> Result<Value> {
    let workdir = crate::utils::current_dir();
    let repo = Repository::discover(&workdir)?;
    
    // Get remote and branch
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
    
    // Get the fetched commit
    let fetch_head = repo.find_reference("FETCH_HEAD")?;
    let remote_commit = repo.reference_to_annotated_commit(&fetch_head)?;
    
    // Analyze what kind of merge we need
    let (analysis, _) = repo.merge_analysis(&[&remote_commit])?;
    
    if analysis.is_up_to_date() {
        info!("Git pull: already up to date");
        return Ok(json!({ "status": "up_to_date" }));
    }
    
    if analysis.is_fast_forward() {
        // Fast-forward: just move the branch pointer
        let refname = format!("refs/heads/{}", branch_name);
        let mut reference = repo.find_reference(&refname)?;
        reference.set_target(remote_commit.id(), "Fast-forward pull")?;
        
        // SAFE checkout - preserves uncommitted changes, fails if conflict
        let checkout_result = repo.checkout_head(Some(
            git2::build::CheckoutBuilder::default()
                .safe()  // Don't overwrite uncommitted changes!
        ));
        
        if let Err(e) = checkout_result {
            // Revert the reference change
            reference.set_target(head.target().unwrap(), "Revert failed pull")?;
            anyhow::bail!("Pull would overwrite uncommitted changes: {}", e);
        }
        
        info!("Git pull: fast-forward to {}", remote_commit.id());
        return Ok(json!({ "status": "fast_forward" }));
    }
    
    // Need to merge
    repo.merge(&[&remote_commit], None, None)?;
    
    let mut index = repo.index()?;
    
    if index.has_conflicts() {
        // Collect conflicting files
        let conflicts: Vec<String> = index.conflicts()?
            .filter_map(|c| c.ok())
            .filter_map(|c| {
                c.our.or(c.their).or(c.ancestor)
            })
            .filter_map(|entry| String::from_utf8(entry.path).ok())
            .collect();
        
        // Write files with conflict markers to disk (safe - doesn't overwrite unrelated changes)
        let checkout_result = repo.checkout_index(None, Some(
            git2::build::CheckoutBuilder::default()
                .allow_conflicts(true)
                .conflict_style_merge(true)
                .safe()  // Preserve other uncommitted changes
        ));
        
        if let Err(e) = checkout_result {
            repo.cleanup_state()?;
            anyhow::bail!("Failed to write conflict markers: {}", e);
        }
        
        info!("Git pull: conflicts in {:?}", conflicts);
        return Ok(json!({ 
            "status": "conflict",
            "files": conflicts
        }));
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
    Ok(json!({ "status": "merged" }))
}

pub async fn handle_git_pull(ack: AckSender, _state: State<AppState>) {
    info!("Received git:pull");
    send_response(ack, git_pull_impl());
}

fn git_revert_impl(request: &GitRevertRequest) -> Result<Value> {
    let workdir = crate::utils::current_dir();
    let repo = Repository::discover(&workdir)?;
    let repo_root = repo.workdir().unwrap_or(Path::new("."));
    
    // Convert to relative path
    let file_path = Path::new(&request.path);
    let relative_path = if file_path.is_absolute() {
        file_path.strip_prefix(repo_root).unwrap_or(file_path)
    } else {
        file_path
    };
    
    // Check file status to know if it's tracked or untracked
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .pathspec(&request.path);
    
    let statuses = repo.statuses(Some(&mut opts))?;
    let is_new_file = statuses.iter().any(|entry| {
        entry.status().contains(Status::WT_NEW) || 
        entry.status().contains(Status::INDEX_NEW)
    });
    
    if is_new_file {
        // For new/untracked files, just delete
        let full_path = repo_root.join(relative_path);
        if full_path.exists() {
            std::fs::remove_file(&full_path)
                .context("Failed to delete untracked file")?;
        }
        info!("Git revert: deleted untracked file {}", request.path);
    } else {
        // For tracked files, restore from HEAD
        let mut checkout_opts = git2::build::CheckoutBuilder::new();
        checkout_opts.path(relative_path).force();
        repo.checkout_head(Some(&mut checkout_opts))
            .context("Failed to restore file from HEAD")?;
        info!("Git revert: restored {} from HEAD", request.path);
    }
    
    Ok(json!({}))
}

pub async fn handle_git_revert(
    Data(request): Data<GitRevertRequest>,
    ack: AckSender,
    _state: State<AppState>,
) {
    info!("Received git:revert: {:?}", request.path);
    send_response(ack, git_revert_impl(&request));
}

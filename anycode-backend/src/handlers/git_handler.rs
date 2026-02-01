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
    Modified, Added, Deleted, Renamed,
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

    // Add files to index
    for path in &request.files {
        let path = Path::new(path);
        let relative_path = if path.is_absolute() {
            path.strip_prefix(repo.workdir().unwrap_or(Path::new(".")))
                .unwrap_or(path)
        } else {
            path
        };

        index.add_path(relative_path)?;
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

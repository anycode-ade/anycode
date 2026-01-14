use anyhow::{anyhow, Context, Result};
use git2::{build::CheckoutBuilder, IndexAddOption, Repository, ResetType, Signature};
use std::path::{Path, PathBuf};
use tracing::{info, warn, debug};

/// Checkpoint representing a state before a user message
#[derive(Debug, Clone)]
pub struct Checkpoint {
    pub commit_hash: String,
    pub prompt: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// AcpHistoryManager - manages undo/redo using a shadow git repository
/// Uses GIT_WORK_TREE approach: .git is in .anycode/agents_history, working tree is project root
pub struct AcpHistoryManager {
    /// Path to project root (working tree)
    project_root: PathBuf,
    /// Path to shadow git directory (.anycode/agents_history)
    history_dir: PathBuf,
    /// Ordered list of checkpoints (oldest first)
    checkpoints: Vec<Checkpoint>,
    /// Whether the repository has been initialized
    initialized: bool,
}

impl AcpHistoryManager {
    /// Create a new AcpHistoryManager for the given project root and agent
    pub fn new(project_root: impl AsRef<Path>, agent_id: &str) -> Self {
        let project_root = project_root.as_ref().to_path_buf();
        let history_dir = project_root
            .join(".anycode")
            .join("agents_history")
            .join(agent_id);

        Self {
            project_root,
            history_dir,
            checkpoints: Vec::new(),
            initialized: false,
        }
    }

    /// Get the path to the .git directory
    fn git_dir(&self) -> PathBuf {
        self.history_dir.join(".git")
    }

    fn sync_shadow_gitignore(&self) -> Result<()> {
        let user_gitignore_path = self.project_root.join(".gitignore");
        let mut content = match std::fs::read_to_string(&user_gitignore_path) {
            Ok(text) => text,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(e) => return Err(e).context("Failed to read project .gitignore"),
        };

        let has_anycode = content
            .lines()
            .map(|line| line.trim())
            .any(|line| line == ".anycode" || line == ".anycode/");
        let has_git = content
            .lines()
            .map(|line| line.trim())
            .any(|line| line == ".git" || line == ".git/");

        let mut prefix = String::new();
        if !has_anycode {
            prefix.push_str(".anycode/\n");
        }
        if !has_git {
            prefix.push_str(".git/\n");
        }

        if !prefix.is_empty() {
            if !content.is_empty() && !content.starts_with('\n') {
                content = format!("{}\n{}", prefix.trim_end(), content);
            } else {
                content = format!("{}{}", prefix, content);
            }
        }

        let shadow_gitignore_path = self.history_dir.join(".gitignore");
        std::fs::write(&shadow_gitignore_path, content)
            .context("Failed to write shadow .gitignore")?;

        Ok(())
    }

    /// Initialize the shadow git repository
    pub fn init(&mut self) -> Result<()> {
        if self.initialized {
            return Ok(());
        }

        // Create history directory if needed
        std::fs::create_dir_all(&self.history_dir)
            .context("Failed to create history directory")?;

        self.sync_shadow_gitignore()?;

        let git_dir = self.git_dir();

        if git_dir.exists() {
            // Repository already exists, verify it's valid and load checkpoints
            info!("Opening existing history repository at {:?}", git_dir);
            // Verify repository is valid by trying to open it
            match self.open_repo() {
                Ok(_) => {
                    self.load_checkpoints()?;
                }
                Err(e) => {
                    // Repository is corrupted or invalid, reinitialize
                    warn!("Existing repository invalid ({}), removing and reinitializing", e);
                    std::fs::remove_dir_all(&git_dir)
                        .context("Failed to remove corrupted git directory")?;
                    self.initialize_new_repo()?;
                }
            }
        } else {
            // Initialize new repository with separate git dir
            self.initialize_new_repo()?;
        }

        self.initialized = true;
        Ok(())
    }

    /// Initialize a new git repository
    fn initialize_new_repo(&self) -> Result<()> {
        info!("Initializing new history repository at {:?}", self.git_dir());

        // Initialize repository at git_dir
        let _repo = Repository::init(&self.git_dir())
            .context("Failed to initialize git repository")?;

        // Now set the workdir to the project root
        let repo = self.open_repo()?;
        repo.set_workdir(&self.project_root, false)
            .context("Failed to set workdir")?;

        // Create initial commit with current state
        self.create_initial_commit()?;

        Ok(())
    }

    /// Open the repository with workdir set to project root
    fn open_repo(&self) -> Result<Repository> {
        let repo = Repository::open(&self.git_dir())
            .context("Failed to open git repository")?;

        // Set workdir to project root
        repo.set_workdir(&self.project_root, false)
            .context("Failed to set workdir")?;

        Ok(repo)
    }

    /// Create the initial commit with current project state
    fn create_initial_commit(&self) -> Result<String> {
        let repo = self.open_repo()?;

        // Add all files to index; use .gitignore from shadow repo
        let mut index = repo.index()?;
        index.add_all(
            ["*"].iter(),
            IndexAddOption::DEFAULT,
            Some(&mut |path, _matched_spec| {
                let path_str = path.to_string_lossy();
                if path_str.starts_with(".anycode/") { 1 } else { 0 }
            }),
        )?;
        index.write()?;

        let tree_id = index.write_tree()?;
        let tree = repo.find_tree(tree_id)?;

        let sig = Signature::now("AnyCode", "anycode@local")?;

        let commit_id = repo.commit(
            Some("HEAD"),
            &sig,
            &sig,
            "Initial checkpoint",
            &tree,
            &[], // No parents for initial commit
        )?;

        let hash = commit_id.to_string();
        info!("Created initial commit: {}", hash);

        Ok(hash)
    }

    /// Load existing checkpoints from repository history
    fn load_checkpoints(&mut self) -> Result<()> {
        let repo = self.open_repo()?;

        let mut revwalk = repo.revwalk()?;
        revwalk.push_head()?;

        let mut checkpoints = Vec::new();

        for oid in revwalk {
            let oid = oid?;
            let commit = repo.find_commit(oid)?;
            let message = commit.message().unwrap_or("");

            // Parse checkpoint message format: "checkpoint:msg_id:description"
            if let Some(rest) = message.strip_prefix("checkpoint:") {
                let prompt = rest.to_string();

                checkpoints.push(Checkpoint {
                    commit_hash: oid.to_string(),
                    prompt: prompt.clone(),
                    created_at: chrono::DateTime::from_timestamp(
                        commit.time().seconds(),
                        0
                    ).unwrap_or_else(chrono::Utc::now),
                });
            }
        }

        // Reverse to get oldest first
        checkpoints.reverse();

        self.checkpoints = checkpoints;
        info!("Loaded {} checkpoints from history", self.checkpoints.len());

        Ok(())
    }

    /// Create a checkpoint before processing a user message
    /// Returns the commit hash of the checkpoint
    pub fn create_checkpoint(&mut self, prompt: &str) -> Result<String> {
        if !self.initialized {
            self.init()?;
        }

        let repo = self.open_repo()?;

        // Add all files to index; use .gitignore from shadow repo
        let mut index = repo.index()?;
        index.add_all(
            ["*"].iter(),
            IndexAddOption::DEFAULT,
            Some(&mut |path, _matched_spec| {
                let path_str = path.to_string_lossy();
                if path_str.starts_with(".anycode/") { 1 } else { 0 }
            }),
        )?;

        // Also handle deleted files
        index.update_all(["*"].iter(), None)?;
        index.write()?;

        let tree_id = index.write_tree()?;
        let tree = repo.find_tree(tree_id)?;

        let head = repo.head()?.peel_to_commit()?;
        let head_tree = head.tree()?;

        // If no changes, still register the checkpoint with current HEAD
        let hash = if tree.id() == head_tree.id() {
            debug!("No changes to commit for checkpoint");
            head.id().to_string()
        } else {
            let sig = Signature::now("AnyCode", "anycode@local")?;
            let commit_message = format!("checkpoint:{}", prompt);

            let commit_id = repo.commit(
                Some("HEAD"),
                &sig,
                &sig,
                &commit_message,
                &tree,
                &[&head],
            )?;

            commit_id.to_string()
        };

        let checkpoint = Checkpoint {
            commit_hash: hash.clone(),
            prompt: prompt.to_string(),
            created_at: chrono::Utc::now(),
        };

        self.checkpoints.push(checkpoint);

        info!("Created checkpoint {} for prompt", hash);

        Ok(hash)
    }

    /// Restore project to state at a specific checkpoint
    pub fn restore_to_checkpoint(&self, prompt: &str) -> Result<()> {
        let checkpoint = self.get_checkpoint(prompt)?;
        self.restore_to_commit(&checkpoint.commit_hash)
    }

    /// Restore project to a specific commit hash
    pub fn restore_to_commit(&self, commit_hash: &str) -> Result<()> {
        let repo = self.open_repo()?;

        let oid = git2::Oid::from_str(commit_hash)
            .context("Invalid commit hash")?;
        let commit = repo.find_commit(oid)
            .context("Commit not found")?;

        // Hard reset to the target commit
        let mut checkout_opts = CheckoutBuilder::new();
        checkout_opts.force();

        repo.reset(commit.as_object(), ResetType::Hard, Some(&mut checkout_opts))
            .context("Failed to reset to checkpoint")?;

        info!("Restored project to commit {}", commit_hash);

        Ok(())
    }

    /// Get a checkpoint by prompt
    pub fn get_checkpoint(&self, prompt: &str) -> Result<&Checkpoint> {
        self.checkpoints
            .iter()
            .find(|checkpoint| checkpoint.prompt == prompt)
            .ok_or_else(|| anyhow!("Checkpoint not found for prompt: {}", prompt))
    }

    /// Get all checkpoints
    pub fn get_all_checkpoints(&self) -> &[Checkpoint] {
        &self.checkpoints
    }

    /// Get the latest checkpoint
    pub fn get_latest_checkpoint(&self) -> Option<&Checkpoint> {
        self.checkpoints.last()
    }

    /// Undo to the previous checkpoint (one step back)
    pub fn undo(&self) -> Result<Option<&Checkpoint>> {
        if self.checkpoints.len() < 2 {
            return Ok(None);
        }

        let prev = &self.checkpoints[self.checkpoints.len() - 2];
        self.restore_to_commit(&prev.commit_hash)?;

        Ok(Some(prev))
    }

    /// Clear all history and reinitialize
    pub fn clear_history(&mut self) -> Result<()> {
        if self.history_dir.exists() {
            std::fs::remove_dir_all(&self.history_dir)
                .context("Failed to remove history directory")?;
        }

        self.checkpoints.clear();
        self.initialized = false;

        self.init()?;

        info!("History cleared and reinitialized");
        Ok(())
    }

    /// Get project root path
    pub fn project_root(&self) -> &Path {
        &self.project_root
    }

    /// Get history directory path
    pub fn history_dir(&self) -> &Path {
        &self.history_dir
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_init_and_checkpoint() -> Result<()> {
        let temp_dir = TempDir::new()?;
        let project_root = temp_dir.path();

        // Create a test file
        std::fs::write(project_root.join("test.txt"), "initial content")?;

        let mut manager = AcpHistoryManager::new(project_root, "test_agent");
        manager.init()?;

        // Create a checkpoint
        let hash1 = manager.create_checkpoint("First message")?;
        assert!(!hash1.is_empty());

        // Modify the file
        std::fs::write(project_root.join("test.txt"), "modified content")?;

        // Create another checkpoint
        let hash2 = manager.create_checkpoint("Second message")?;
        assert_ne!(hash1, hash2);

        // Verify checkpoints
        assert_eq!(manager.get_all_checkpoints().len(), 2);

        Ok(())
    }

    #[test]
    fn test_restore() -> Result<()> {
        let temp_dir = TempDir::new()?;
        let project_root = temp_dir.path();
        let test_file = project_root.join("test.txt");

        // Create initial file
        std::fs::write(&test_file, "initial")?;

        let mut manager = AcpHistoryManager::new(project_root, "test_agent");
        manager.init()?;

        // Checkpoint 1
        manager.create_checkpoint("Initial")?;

        // Modify
        std::fs::write(&test_file, "modified")?;

        // Checkpoint 2
        manager.create_checkpoint("Modified")?;

        // Verify current state
        assert_eq!(std::fs::read_to_string(&test_file)?, "modified");

        // Restore to checkpoint 1
        manager.restore_to_checkpoint("Initial")?;

        // Verify restored state
        assert_eq!(std::fs::read_to_string(&test_file)?, "initial");

        Ok(())
    }

    #[test]
    fn test_file_deletion_restore() -> Result<()> {
        let temp_dir = TempDir::new()?;
        let project_root = temp_dir.path();
        let test_file = project_root.join("to_delete.txt");

        // Create file
        std::fs::write(&test_file, "will be deleted")?;

        let mut manager = AcpHistoryManager::new(project_root, "test_agent");
        manager.init()?;

        // Checkpoint before deletion
        manager.create_checkpoint("Before delete")?;

        // Delete file
        std::fs::remove_file(&test_file)?;
        assert!(!test_file.exists());

        // Checkpoint after deletion
        manager.create_checkpoint("After delete")?;

        // Restore to before deletion
        manager.restore_to_checkpoint("Before delete")?;

        // File should be back
        assert!(test_file.exists());
        assert_eq!(std::fs::read_to_string(&test_file)?, "will be deleted");

        Ok(())
    }
}

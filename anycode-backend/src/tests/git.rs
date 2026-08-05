use super::*;
use std::time::Instant;

fn commit_all(repo: &Repository, message: &str) -> git2::Oid {
    let mut index = repo.index().unwrap();
    index
        .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
        .unwrap();
    index.update_all(["*"].iter(), None).unwrap();
    index.write().unwrap();
    let tree_id = index.write_tree().unwrap();
    let tree = repo.find_tree(tree_id).unwrap();
    let sig = git2::Signature::now("Anycode Test", "test@anycode.dev").unwrap();
    let parents = repo
        .head()
        .ok()
        .and_then(|head| head.peel_to_commit().ok())
        .into_iter()
        .collect::<Vec<_>>();
    let parent_refs = parents.iter().collect::<Vec<_>>();
    repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parent_refs)
        .unwrap()
}

#[test]
fn history_is_paginated_and_root_commit_is_diffed_against_empty_tree() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    let repo = Repository::init(temp_dir.path()).unwrap();
    std::fs::write(temp_dir.path().join("one.txt"), "one\n").unwrap();
    let root = commit_all(&repo, "root commit");
    std::fs::write(temp_dir.path().join("two.txt"), "two\n").unwrap();
    commit_all(&repo, "second commit");

    let manager = GitManager::new(temp_dir.path().to_path_buf());
    let first_page = manager.history(0, 1).unwrap();
    assert_eq!(first_page.commits.len(), 1);
    assert_eq!(first_page.commits[0].summary, "second commit");
    assert!(first_page.has_more);
    let second_page = manager.history(1, 1).unwrap();
    assert_eq!(second_page.commits[0].hash, root.to_string());
    assert!(!second_page.has_more);

    let root_files = manager.history_files(&root.to_string()).unwrap();
    assert_eq!(root_files.len(), 1);
    assert_eq!(root_files[0].status, FileStatus::Added);
    assert_eq!(root_files[0].added, 1);
    let content = manager
        .history_file_content(&root.to_string(), "one.txt", None)
        .unwrap();
    assert_eq!(content.old_content.as_deref(), Some(""));
    assert_eq!(content.new_content.as_deref(), Some("one\n"));
}

#[test]
#[ignore = "manual benchmark; set ANYCODE_GIT_BENCH_REPO or use ~/dev/linux"]
fn benchmark_history_pages() {
    let repo_path = std::env::var_os("ANYCODE_GIT_BENCH_REPO")
        .map(std::path::PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join("dev/linux")))
        .expect("set ANYCODE_GIT_BENCH_REPO to a Git repository");
    assert!(repo_path.exists(), "repository not found: {repo_path:?}");

    let manager = GitManager::new(repo_path);
    for offset in [0, 50] {
        let started = Instant::now();
        let page = manager.history(offset, 50).unwrap();
        println!(
            "history(offset={offset}, limit=50): {:?} ({} commits)",
            started.elapsed(),
            page.commits.len()
        );
        assert_eq!(page.commits.len(), 50);
        assert!(page.commits.iter().all(|commit| commit.tags.is_empty()));
    }
}

#[test]
fn history_supports_renames_deletes_and_binary_content() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    let repo = Repository::init(temp_dir.path()).unwrap();
    std::fs::write(temp_dir.path().join("old.txt"), "same content\n").unwrap();
    std::fs::write(temp_dir.path().join("deleted.txt"), "gone\n").unwrap();
    // Valid UTF-8 can still be binary (for example, when it contains NUL bytes).
    std::fs::write(temp_dir.path().join("binary.bin"), [0, b'a']).unwrap();
    commit_all(&repo, "initial");

    std::fs::rename(
        temp_dir.path().join("old.txt"),
        temp_dir.path().join("new.txt"),
    )
    .unwrap();
    std::fs::remove_file(temp_dir.path().join("deleted.txt")).unwrap();
    let commit = commit_all(&repo, "rename and delete");
    let manager = GitManager::new(temp_dir.path().to_path_buf());
    let files = manager.history_files(&commit.to_string()).unwrap();
    let renamed = files.iter().find(|file| file.path == "new.txt").unwrap();
    assert_eq!(renamed.status, FileStatus::Renamed);
    assert_eq!(renamed.old_path.as_deref(), Some("old.txt"));
    assert!(
        files
            .iter()
            .any(|file| file.path == "deleted.txt" && file.status == FileStatus::Deleted)
    );

    let binary = manager
        .history_file_content(&commit.to_string(), "binary.bin", None)
        .unwrap();
    assert!(binary.old_binary && binary.new_binary);
    assert!(binary.old_content.is_none() && binary.new_content.is_none());
}

#[test]
fn merge_history_uses_the_first_parent() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    let repo = Repository::init(temp_dir.path()).unwrap();
    std::fs::write(temp_dir.path().join("base.txt"), "base\n").unwrap();
    commit_all(&repo, "base");
    std::fs::write(temp_dir.path().join("first.txt"), "first\n").unwrap();
    let first_parent_id = commit_all(&repo, "first parent");
    std::fs::write(temp_dir.path().join("second.txt"), "second\n").unwrap();
    let second_parent_id = commit_all(&repo, "second parent");

    let first_parent = repo.find_commit(first_parent_id).unwrap();
    let second_parent = repo.find_commit(second_parent_id).unwrap();
    let merge_tree = second_parent.tree().unwrap();
    let sig = git2::Signature::now("Anycode Test", "test@anycode.dev").unwrap();
    let merge_id = repo
        .commit(
            None,
            &sig,
            &sig,
            "merge",
            &merge_tree,
            &[&first_parent, &second_parent],
        )
        .unwrap();
    repo.set_head_detached(merge_id).unwrap();

    let manager = GitManager::new(temp_dir.path().to_path_buf());
    let files = manager.history_files(&merge_id.to_string()).unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].path, "second.txt");
    assert_eq!(files[0].status, FileStatus::Added);
}

#[test]
#[ignore = "manual benchmark depends on /Users/max/dev/tmp/linux"]
fn benchmark_status_methods() {
    let linux_dir = std::path::PathBuf::from("/Users/max/dev/tmp/linux");
    let mut manager = GitManager::new(linux_dir);

    let test_file = "Makefile";

    let _ = manager.status_file_via_cli(test_file).unwrap();
    let _ = manager.status_file_custom(test_file).unwrap();

    let start_cli = Instant::now();
    for _ in 0..100 {
        let _ = manager.status_file_via_cli(test_file).unwrap();
    }
    let duration_cli = start_cli.elapsed();

    let start_custom = Instant::now();
    for _ in 0..100 {
        let _ = manager.status_file_custom(test_file).unwrap();
    }
    let duration_custom = start_custom.elapsed();

    println!("CLI Version (100 runs): {:?}", duration_cli);
    println!("Custom Version (100 runs): {:?}", duration_custom);

    assert!(
        duration_custom < duration_cli,
        "Custom version must be faster than CLI!"
    );
}

#[test]
fn test_numstat_correctness() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    let repo = Repository::init(temp_dir.path()).unwrap();

    let file_path = temp_dir.path().join("test.txt");
    let content_v1 = "line 1\nline 2\nline 3\nline 4\nline 5\n";
    std::fs::write(&file_path, content_v1).unwrap();

    let mut index = repo.index().unwrap();
    index.add_path(Path::new("test.txt")).unwrap();
    index.write().unwrap();
    let tree_id = index.write_tree().unwrap();
    let tree = repo.find_tree(tree_id).unwrap();
    let sig = git2::Signature::now("Anycode Test", "test@anycode.dev").unwrap();
    repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
        .unwrap();

    let content_v2 = "line 1\nline 2\nline X\nline 4\nline 5\nline 6\n";
    std::fs::write(&file_path, content_v2).unwrap();

    let mut manager = GitManager::new(temp_dir.path().to_path_buf());
    let (added, removed) = manager.numstat_in_memory("test.txt", &FileStatus::Modified);
    assert_eq!(added, 2);
    assert_eq!(removed, 1);
}

#[test]
fn path_status_uses_repo_root_when_workdir_is_subdirectory() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    let repo = Repository::init(temp_dir.path()).unwrap();

    let src_dir = temp_dir.path().join("src");
    std::fs::create_dir(&src_dir).unwrap();
    let file_path = src_dir.join("test.txt");
    std::fs::write(&file_path, "line 1\nline 2\n").unwrap();

    let mut index = repo.index().unwrap();
    index.add_path(Path::new("src/test.txt")).unwrap();
    index.write().unwrap();
    let tree_id = index.write_tree().unwrap();
    let tree = repo.find_tree(tree_id).unwrap();
    let sig = git2::Signature::now("Anycode Test", "test@anycode.dev").unwrap();
    repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
        .unwrap();

    std::fs::write(&file_path, "line 1\nline changed\n").unwrap();

    let mut manager = GitManager::new(src_dir);
    let status = manager
        .status_file_custom("src/test.txt")
        .unwrap()
        .expect("modified file should be reported");

    assert_eq!(
        Path::new(&status.path).canonicalize().unwrap(),
        file_path.canonicalize().unwrap()
    );
    assert_eq!(status.status, FileStatus::Modified);
    assert!(status.unstaged);
}

#[test]
fn untracked_file_is_reported_as_unstaged_by_path_status() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    Repository::init(temp_dir.path()).unwrap();

    let file_path = temp_dir.path().join("new.txt");
    std::fs::write(&file_path, "new line\n").unwrap();

    let mut manager = GitManager::new(temp_dir.path().to_path_buf());
    let status = manager
        .status_file_custom("new.txt")
        .unwrap()
        .expect("untracked file should be reported");

    assert_eq!(status.status, FileStatus::Added);
    assert!(!status.staged);
    assert!(status.unstaged);
}

#[test]
fn revert_deletes_untracked_file_given_an_absolute_path() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    Repository::init(temp_dir.path()).unwrap();

    let file_path = temp_dir.path().join("new.txt");
    std::fs::write(&file_path, "new line\n").unwrap();

    let manager = GitManager::new(temp_dir.path().to_path_buf());
    manager.revert(file_path.to_str().unwrap()).unwrap();

    assert!(!file_path.exists());
    assert!(manager.status().unwrap().files.is_empty());
}

#[test]
fn revert_deletes_nested_untracked_file_beside_tracked_files() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    let repo = Repository::init(temp_dir.path()).unwrap();

    let app_dir = temp_dir.path().join("anycode");
    std::fs::create_dir(&app_dir).unwrap();
    std::fs::write(app_dir.join("tracked.txt"), "tracked\n").unwrap();

    let mut index = repo.index().unwrap();
    index.add_path(Path::new("anycode/tracked.txt")).unwrap();
    index.write().unwrap();
    let tree_id = index.write_tree().unwrap();
    let tree = repo.find_tree(tree_id).unwrap();
    let sig = git2::Signature::now("Anycode Test", "test@anycode.dev").unwrap();
    repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
        .unwrap();

    let file_path = app_dir.join("new.txt");
    std::fs::write(&file_path, "new line\n").unwrap();

    let manager = GitManager::new(temp_dir.path().to_path_buf());
    manager.revert(file_path.to_str().unwrap()).unwrap();

    assert!(!file_path.exists());
    assert!(manager.status().unwrap().files.is_empty());
}

#[test]
fn revert_removes_a_staged_added_file_from_disk_and_index() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    let repo = Repository::init(temp_dir.path()).unwrap();

    let file_path = temp_dir.path().join("new.txt");
    std::fs::write(&file_path, "new line\n").unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(Path::new("new.txt")).unwrap();
    index.write().unwrap();

    let manager = GitManager::new(temp_dir.path().to_path_buf());
    manager.revert(file_path.to_str().unwrap()).unwrap();

    assert!(!file_path.exists());
    assert!(manager.status().unwrap().files.is_empty());
    let mut index = repo.index().unwrap();
    index.read(true).unwrap();
    assert!(index.get_path(Path::new("new.txt"), 0).is_none());
}

#[test]
fn deleted_file_numstat_counts_lines_not_bytes() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    let repo = Repository::init(temp_dir.path()).unwrap();

    let file_path = temp_dir.path().join("test.txt");
    std::fs::write(&file_path, "first line\nsecond line\nthird line\n").unwrap();

    let mut index = repo.index().unwrap();
    index.add_path(Path::new("test.txt")).unwrap();
    index.write().unwrap();
    let tree_id = index.write_tree().unwrap();
    let tree = repo.find_tree(tree_id).unwrap();
    let sig = git2::Signature::now("Anycode Test", "test@anycode.dev").unwrap();
    repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
        .unwrap();

    std::fs::remove_file(&file_path).unwrap();

    let mut manager = GitManager::new(temp_dir.path().to_path_buf());
    let status = manager
        .status_file_custom("test.txt")
        .unwrap()
        .expect("deleted file should be reported");

    assert_eq!(status.status, FileStatus::Deleted);
    assert_eq!(status.added, 0);
    assert_eq!(status.removed, 3);
}

#[test]
fn staged_add_then_deleted_from_worktree_reports_staged_and_unstaged() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    let repo = Repository::init(temp_dir.path()).unwrap();

    let sig = git2::Signature::now("Anycode Test", "test@anycode.dev").unwrap();
    let mut index = repo.index().unwrap();
    let tree_id = index.write_tree().unwrap();
    let tree = repo.find_tree(tree_id).unwrap();
    repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
        .unwrap();

    let file_path = temp_dir.path().join("new.txt");
    std::fs::write(&file_path, "new line\n").unwrap();

    let mut index = repo.index().unwrap();
    index.add_path(Path::new("new.txt")).unwrap();
    index.write().unwrap();
    std::fs::remove_file(&file_path).unwrap();

    let mut manager = GitManager::new(temp_dir.path().to_path_buf());
    let status = manager
        .status_file_custom("new.txt")
        .unwrap()
        .expect("staged add deleted from worktree should be reported");

    assert_eq!(status.status, FileStatus::Deleted);
    assert!(status.staged);
    assert!(status.unstaged);
}

#[test]
fn staged_modify_then_deleted_from_worktree_reports_staged_and_unstaged() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    let repo = Repository::init(temp_dir.path()).unwrap();

    let file_path = temp_dir.path().join("test.txt");
    std::fs::write(&file_path, "original line\n").unwrap();

    let mut index = repo.index().unwrap();
    index.add_path(Path::new("test.txt")).unwrap();
    index.write().unwrap();
    let tree_id = index.write_tree().unwrap();
    let tree = repo.find_tree(tree_id).unwrap();
    let sig = git2::Signature::now("Anycode Test", "test@anycode.dev").unwrap();
    repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
        .unwrap();

    std::fs::write(&file_path, "modified line\n").unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(Path::new("test.txt")).unwrap();
    index.write().unwrap();
    std::fs::remove_file(&file_path).unwrap();

    let mut manager = GitManager::new(temp_dir.path().to_path_buf());
    let status = manager
        .status_file_custom("test.txt")
        .unwrap()
        .expect("staged modify deleted from worktree should be reported");

    assert_eq!(status.status, FileStatus::Deleted);
    assert!(status.staged);
    assert!(status.unstaged);
}

#[test]
#[ignore = "manual benchmark depends on and modifies /Users/max/dev/tmp/linux"]
fn benchmark_status_real() {
    let linux_dir = std::path::PathBuf::from("/Users/max/dev/tmp/linux");
    let mut manager = GitManager::new(linux_dir.clone());

    let test_file = "Makefile";
    let file_path = linux_dir.join(test_file);

    let original_content = std::fs::read_to_string(&file_path).unwrap();

    struct RestoreGuard {
        path: std::path::PathBuf,
        content: String,
    }
    impl Drop for RestoreGuard {
        fn drop(&mut self) {
            let _ = std::fs::write(&self.path, &self.content);
        }
    }
    let _guard = RestoreGuard {
        path: file_path.clone(),
        content: original_content.clone(),
    };

    let mut modified_content = original_content.clone();
    modified_content.push_str("\n# benchmark comment\n");
    std::fs::write(&file_path, &modified_content).unwrap();

    let _ = manager.status_file_via_cli(test_file).unwrap();
    let _ = manager.status_file_custom(test_file).unwrap();

    let start_cli = Instant::now();
    for _ in 0..100 {
        let _ = manager.status_file_via_cli(test_file).unwrap();
    }
    let duration_cli = start_cli.elapsed();

    let start_custom = Instant::now();
    for _ in 0..100 {
        manager.numstat_cache.clear();
        let _ = manager.status_file_custom(test_file).unwrap();
    }
    let duration_custom = start_custom.elapsed();

    println!("Real CLI Version (100 runs): {:?}", duration_cli);
    println!(
        "Real Custom Version (100 runs, no cache): {:?}",
        duration_custom
    );

    assert!(
        duration_custom < duration_cli,
        "Real custom version must be faster than CLI!"
    );
}

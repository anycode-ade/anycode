use super::*;
use std::time::Instant;

fn commit_all(repo: &Repository, message: &str) -> git2::Oid {
    commit_all_as(repo, message, "Anycode Test", "test@anycode.dev")
}

fn commit_all_as(repo: &Repository, message: &str, name: &str, email: &str) -> git2::Oid {
    let mut index = repo.index().unwrap();
    index
        .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
        .unwrap();
    index.update_all(["*"].iter(), None).unwrap();
    index.write().unwrap();
    let tree_id = index.write_tree().unwrap();
    let tree = repo.find_tree(tree_id).unwrap();
    let sig = git2::Signature::now(name, email).unwrap();
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
fn search_history_session_reuses_its_worker_cursor_across_pages() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    let repo = Repository::init(temp_dir.path()).unwrap();
    let mut expected = Vec::new();
    for index in 0..5 {
        std::fs::write(temp_dir.path().join("file.txt"), format!("{index}\n")).unwrap();
        expected.push(commit_all(&repo, &format!("match {index}")).to_string());
    }

    let cancel = tokio_util::sync::CancellationToken::new();
    let session = SearchHistorySession::new(
        temp_dir.path().to_path_buf(),
        GitHistorySearchMode::Message,
        "match".to_string(),
        cancel,
    );
    let (sender, receiver) = tokio::sync::mpsc::unbounded_channel();
    let worker = std::thread::spawn(move || session.run(receiver));

    let page = || {
        let (response, result) = tokio::sync::oneshot::channel();
        sender
            .send(SearchHistorySessionCommand::NextPage {
                limit: 2,
                batches: None,
                response,
            })
            .unwrap();
        match result.blocking_recv().unwrap().unwrap() {
            GitHistorySearchOutcome::Complete(page) => page,
            GitHistorySearchOutcome::Cancelled => panic!("session was unexpectedly cancelled"),
        }
    };

    let first = page();
    let second = page();
    assert_eq!(
        first
            .commits
            .iter()
            .map(|commit| &commit.hash)
            .collect::<Vec<_>>(),
        expected.iter().rev().take(2).collect::<Vec<_>>()
    );
    assert_eq!(
        second
            .commits
            .iter()
            .map(|commit| &commit.hash)
            .collect::<Vec<_>>(),
        expected.iter().rev().skip(2).take(2).collect::<Vec<_>>()
    );
    assert!(first.has_more);
    assert!(second.has_more);

    sender.send(SearchHistorySessionCommand::Cancel).unwrap();
    worker.join().unwrap();
}

#[test]
fn search_history_session_reports_cancellation_to_the_pending_page() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    let repo = Repository::init(temp_dir.path()).unwrap();
    std::fs::write(temp_dir.path().join("file.txt"), "one\n").unwrap();
    commit_all(&repo, "initial commit");

    let cancel = tokio_util::sync::CancellationToken::new();
    let session = SearchHistorySession::new(
        temp_dir.path().to_path_buf(),
        GitHistorySearchMode::Message,
        "not present".to_string(),
        cancel.clone(),
    );
    let (sender, receiver) = tokio::sync::mpsc::unbounded_channel();
    let worker = std::thread::spawn(move || session.run(receiver));
    cancel.cancel();
    let (response, result) = tokio::sync::oneshot::channel();
    sender
        .send(SearchHistorySessionCommand::NextPage {
            limit: 50,
            batches: None,
            response,
        })
        .unwrap();
    assert_eq!(
        result.blocking_recv().unwrap().unwrap(),
        GitHistorySearchOutcome::Cancelled
    );
    worker.join().unwrap();
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
fn file_history_only_returns_commits_that_touch_the_path() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    let repo = Repository::init(temp_dir.path()).unwrap();
    std::fs::write(temp_dir.path().join("one.txt"), "one\n").unwrap();
    let first = commit_all(&repo, "add one");
    std::fs::write(temp_dir.path().join("two.txt"), "two\n").unwrap();
    commit_all(&repo, "add two");
    std::fs::write(temp_dir.path().join("one.txt"), "changed\n").unwrap();
    let last = commit_all(&repo, "change one");

    let manager = GitManager::new(temp_dir.path().to_path_buf());
    let page = manager.file_history("one.txt", 0, 10).unwrap();
    let expected = [last.to_string(), first.to_string()];
    assert_eq!(
        page.commits
            .iter()
            .map(|commit| &commit.hash)
            .collect::<Vec<_>>(),
        expected.iter().collect::<Vec<_>>()
    );
    assert!(!page.has_more);

    let first_page = manager.file_history("one.txt", 0, 1).unwrap();
    let second_page = manager
        .file_history(temp_dir.path().join("one.txt").to_str().unwrap(), 1, 1)
        .unwrap();
    assert_eq!(first_page.commits[0].hash, last.to_string());
    assert!(first_page.has_more);
    assert_eq!(second_page.commits[0].hash, first.to_string());
    assert!(!second_page.has_more);

    let outside_path = tempfile::TempDir::new().unwrap().path().join("outside.txt");
    let outside_page = manager.file_history(outside_path.to_str().unwrap(), 0, 10).unwrap();
    assert!(outside_page.commits.is_empty());
}

#[test]
fn status_reports_head_commit_count_and_time() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    let repo = Repository::init(temp_dir.path()).unwrap();
    let manager = GitManager::new(temp_dir.path().to_path_buf());

    let unborn = manager.status().unwrap();
    assert_eq!(unborn.commit_count, None);
    assert_eq!(unborn.last_commit_at, None);

    std::fs::write(temp_dir.path().join("a.txt"), "a\n").unwrap();
    commit_all(&repo, "first");
    std::fs::write(temp_dir.path().join("b.txt"), "b\n").unwrap();
    let second = commit_all(&repo, "second");

    let status = manager.status().unwrap();
    assert_eq!(status.commit_count, Some(2));
    let head_time = repo.find_commit(second).unwrap().time().seconds();
    assert_eq!(status.last_commit_at, Some(head_time));
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

#[test]
fn cloud_git_sync_and_pull_worktree_roundtrip_with_commits_and_wip() {
    let tmp = tempfile::TempDir::new().unwrap();
    let local_dir = tmp.path().join("local-repo");
    std::fs::create_dir_all(&local_dir).unwrap();

    run_git_checked(&local_dir, &["init", "-b", "feature/demo"], &[]).unwrap();
    run_git_checked(&local_dir, &["config", "user.name", "Alice"], &[]).unwrap();
    run_git_checked(
        &local_dir,
        &["config", "user.email", "alice@example.com"],
        &[],
    )
    .unwrap();

    std::fs::write(local_dir.join(".gitignore"), "target/\n").unwrap();
    std::fs::write(local_dir.join("main.txt"), "base-line\n").unwrap();
    std::fs::write(local_dir.join("remove-me.txt"), "gone soon\n").unwrap();
    run_git_checked(&local_dir, &["add", "."], &[]).unwrap();
    run_git_checked(&local_dir, &["commit", "-m", "init"], &[]).unwrap();

    // Local dirty working tree edits before sync.
    std::fs::write(local_dir.join("local-dirty.txt"), "from-local\n").unwrap();
    std::fs::remove_file(local_dir.join("remove-me.txt")).unwrap();

    let payload = pack_git_sync_payload(&local_dir, "demo", TRANSFER_CHUNK_BYTES)
        .unwrap()
        .expect("git payload expected");

    let remote_dir = tmp.path().join("remote-repo");
    apply_git_sync_payload(&remote_dir, &payload).unwrap();
    assert!(!remote_dir.join("remove-me.txt").exists());
    assert_eq!(
        std::fs::read_to_string(remote_dir.join("local-dirty.txt")).unwrap(),
        "from-local\n"
    );

    // Remote agent commits work AND leaves additional uncommitted changes.
    run_git_checked(&remote_dir, &["config", "user.name", "Remote Agent"], &[]).unwrap();
    run_git_checked(
        &remote_dir,
        &["config", "user.email", "agent@example.com"],
        &[],
    )
    .unwrap();
    std::fs::write(remote_dir.join("main.txt"), "committed-by-agent\n").unwrap();
    run_git_checked(&remote_dir, &["add", "main.txt"], &[]).unwrap();
    run_git_checked(&remote_dir, &["commit", "-m", "agent commit"], &[]).unwrap();

    std::fs::write(remote_dir.join("wip-note.txt"), "unstaged edit\n").unwrap();
    std::fs::create_dir_all(remote_dir.join("target")).unwrap();
    std::fs::write(remote_dir.join("target").join("build.bin"), "ignored").unwrap();

    let info = inspect_remote_git_state(&remote_dir).unwrap();
    assert!(info.is_git_repo);
    assert_eq!(info.commits_ahead, 1);
    assert!(info.dirty_count >= 1);

    let known_bases = collect_local_known_bases(&local_dir).unwrap();
    let pull = build_pull_bundle(&remote_dir, &known_bases, TRANSFER_CHUNK_BYTES).unwrap();
    assert!(pull.changed);
    assert!(pull.has_wip);
    assert_eq!(pull.commits_count, 1);

    let worktrees_root = tmp.path().join("worktrees");
    let (wt_path, wt_branch) = apply_pull_bundle_to_worktree(
        &local_dir,
        &pull,
        "alpha-node",
        "demo",
        &worktrees_root,
        Some("cloud/test-wt"),
        None,
    )
    .unwrap();

    assert_eq!(wt_branch, "cloud/test-wt");
    assert_eq!(
        std::fs::read_to_string(wt_path.join("main.txt")).unwrap(),
        "committed-by-agent\n"
    );
    assert_eq!(
        std::fs::read_to_string(wt_path.join("wip-note.txt")).unwrap(),
        "unstaged edit\n"
    );
    // Ignored target/ directory must NOT be pulled back.
    assert!(!wt_path.join("target").join("build.bin").exists());
    // Local checkout stays untouched.
    assert_eq!(
        std::fs::read_to_string(local_dir.join("main.txt")).unwrap(),
        "base-line\n"
    );
    // Worktree HEAD should be the agent's real commit (not the synthetic WIP commit).
    let wt_top_msg = run_git_checked(&wt_path, &["log", "-1", "--pretty=%s"], &[]).unwrap();
    assert_eq!(wt_top_msg, "agent commit");
}

#[test]
fn cloud_git_sync_over_existing_nongit_dir_keeps_ignored_and_pulls_zero_commit_wip() {
    let tmp = tempfile::TempDir::new().unwrap();
    let local_dir = tmp.path().join("local-repo");
    std::fs::create_dir_all(&local_dir).unwrap();

    run_git_checked(&local_dir, &["init", "-b", "main"], &[]).unwrap();
    run_git_checked(&local_dir, &["config", "user.name", "Alice"], &[]).unwrap();
    run_git_checked(
        &local_dir,
        &["config", "user.email", "alice@example.com"],
        &[],
    )
    .unwrap();
    std::fs::write(local_dir.join(".gitignore"), "node_modules/\n").unwrap();
    std::fs::write(local_dir.join("app.ts"), "export const x = 1;\n").unwrap();
    run_git_checked(&local_dir, &["add", "."], &[]).unwrap();
    run_git_checked(&local_dir, &["commit", "-m", "initial"], &[]).unwrap();

    // Simulate an older non-git sync folder that has ignored dependencies & a stale deleted file.
    let remote_dir = tmp.path().join("remote-nongit");
    std::fs::create_dir_all(remote_dir.join("node_modules/pkg")).unwrap();
    std::fs::write(remote_dir.join("node_modules/pkg/index.js"), "dep").unwrap();
    std::fs::write(remote_dir.join("stale.txt"), "old leftover").unwrap();
    std::fs::write(remote_dir.join("app.ts"), "export const x = 0;\n").unwrap();

    let payload = pack_git_sync_payload(&local_dir, "demo", TRANSFER_CHUNK_BYTES)
        .unwrap()
        .unwrap();
    apply_git_sync_payload(&remote_dir, &payload).unwrap();

    assert!(remote_dir.join("node_modules/pkg/index.js").is_file());
    assert!(!remote_dir.join("stale.txt").exists());
    assert_eq!(
        std::fs::read_to_string(remote_dir.join("app.ts")).unwrap(),
        "export const x = 1;\n"
    );

    // Pull when nothing changed yet -> changed == false.
    let known = collect_local_known_bases(&local_dir).unwrap();
    let empty_pull = build_pull_bundle(&remote_dir, &known, TRANSFER_CHUNK_BYTES).unwrap();
    assert!(!empty_pull.changed);

    // Agent edits file without making a git commit -> 0 commits, WIP only.
    std::fs::write(remote_dir.join("app.ts"), "export const x = 42;\n").unwrap();
    let wip_pull = build_pull_bundle(&remote_dir, &known, TRANSFER_CHUNK_BYTES).unwrap();
    assert!(wip_pull.changed);
    assert!(wip_pull.has_wip);
    assert_eq!(wip_pull.commits_count, 0);

    let worktrees_root = tmp.path().join("worktrees");
    let (wt_path, _) = apply_pull_bundle_to_worktree(
        &local_dir,
        &wip_pull,
        "air-node",
        "demo",
        &worktrees_root,
        None,
        None,
    )
    .unwrap();

    assert_eq!(
        std::fs::read_to_string(wt_path.join("app.ts")).unwrap(),
        "export const x = 42;\n"
    );
    let wt_status = run_git_checked(&wt_path, &["status", "--short"], &[]).unwrap();
    assert!(wt_status.contains("M app.ts"));
}

#[test]
fn cloud_git_remote_worktree_create_commit_and_pull_delta() {
    let tmp = tempfile::TempDir::new().unwrap();
    let local_dir = tmp.path().join("local-repo");
    std::fs::create_dir_all(&local_dir).unwrap();

    run_git_checked(&local_dir, &["init", "-b", "main"], &[]).unwrap();
    run_git_checked(&local_dir, &["config", "user.name", "Alice"], &[]).unwrap();
    run_git_checked(
        &local_dir,
        &["config", "user.email", "alice@example.com"],
        &[],
    )
    .unwrap();

    // Multi-commit local history (full history should survive sync via --all HEAD).
    std::fs::write(local_dir.join("app.txt"), "v1\n").unwrap();
    run_git_checked(&local_dir, &["add", "."], &[]).unwrap();
    run_git_checked(&local_dir, &["commit", "-m", "commit one"], &[]).unwrap();

    std::fs::write(local_dir.join("app.txt"), "v2\n").unwrap();
    run_git_checked(&local_dir, &["add", "."], &[]).unwrap();
    run_git_checked(&local_dir, &["commit", "-m", "commit two"], &[]).unwrap();

    // Local dirty edit that should be synced to remote base and carried into the new remote worktree.
    std::fs::write(local_dir.join("notes.txt"), "local-wip\n").unwrap();

    let packed = pack_git_sync_to_file(&local_dir, "demo")
        .unwrap()
        .expect("packed git sync expected");
    assert!(packed.bundle_file.is_none());
    let remote_base = tmp.path().join("remote-base");
    apply_git_sync_payload(&remote_base, &packed.payload).unwrap();

    // Verify full history was preserved on remote base (2 commits, not shallow 1).
    let remote_count = run_git_checked(&remote_base, &["rev-list", "--count", "HEAD"], &[]).unwrap();
    assert_eq!(remote_count, "2");

    // Create a dedicated worktree on remote for an agent, carrying dirty changes.
    let remote_wts = tmp.path().join("remote-worktrees");
    let (remote_wt, remote_branch) = create_git_worktree(
        &remote_base,
        &remote_wts,
        "demo",
        CreateGitWorktreeOptions {
            branch: Some("agent/task-1"),
            include_dirty: true,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(remote_branch, "agent/task-1");
    let wt_dir_name = remote_wt.file_name().unwrap().to_str().unwrap();
    assert_eq!(wt_dir_name.len(), 8);
    assert!(wt_dir_name.chars().all(|c| c.is_ascii_lowercase()));
    assert_eq!(
        std::fs::read_to_string(remote_wt.join("notes.txt")).unwrap(),
        "local-wip\n"
    );

    // Agent works inside remote_wt: commits new work AND leaves an uncommitted edit.
    run_git_checked(&remote_wt, &["config", "user.name", "Agent"], &[]).unwrap();
    run_git_checked(
        &remote_wt,
        &["config", "user.email", "agent@example.com"],
        &[],
    )
    .unwrap();
    std::fs::write(remote_wt.join("notes.txt"), "committed-note\n").unwrap();
    run_git_checked(&remote_wt, &["add", "notes.txt"], &[]).unwrap();
    run_git_checked(&remote_wt, &["commit", "-m", "agent task commit"], &[]).unwrap();
    std::fs::write(remote_wt.join("app.txt"), "v2+wip\n").unwrap();

    let wt_info = inspect_remote_git_state(&remote_wt).unwrap();
    assert!(wt_info.is_git_repo);
    assert!(wt_info.is_worktree);
    assert_eq!(wt_info.commits_ahead, 1);
    assert!(wt_info.dirty_count >= 1);

    let known = collect_local_known_bases(&local_dir).unwrap();
    let (pull, bundle_file_opt) = build_pull_bundle_to_file(&remote_wt, &known).unwrap();
    assert!(pull.changed);
    assert!(pull.has_wip);
    assert_eq!(pull.commits_count, 1);
    assert!(bundle_file_opt.is_none());

    // Simulate file-based bundle fetch into local worktree.
    let mut bundle_tmp = tempfile::NamedTempFile::new().unwrap();
    let bundle_bytes = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        pull.bundle_b64.as_deref().unwrap().trim(),
    )
    .unwrap();
    std::io::Write::write_all(&mut bundle_tmp, &bundle_bytes).unwrap();
    std::io::Write::flush(&mut bundle_tmp).unwrap();

    let local_wts = tmp.path().join("local-worktrees");
    let (pulled_wt, pulled_branch) = apply_pull_bundle_file_to_worktree(
        &local_dir,
        bundle_tmp.path(),
        &pull,
        "beta-node",
        "demo",
        &local_wts,
        None,
        None,
    )
    .unwrap();

    assert!(pulled_branch.starts_with("cloud/beta-node/"));
    assert_eq!(
        std::fs::read_to_string(pulled_wt.join("notes.txt")).unwrap(),
        "committed-note\n"
    );
    assert_eq!(
        std::fs::read_to_string(pulled_wt.join("app.txt")).unwrap(),
        "v2+wip\n"
    );
    let log_top = run_git_checked(&pulled_wt, &["log", "-1", "--pretty=%s"], &[]).unwrap();
    assert_eq!(log_top, "agent task commit");

    // Neither local base repo nor remote base repo was polluted by remote_wt commits.
    assert_eq!(
        run_git_checked(&local_dir, &["rev-list", "--count", "HEAD"], &[]).unwrap(),
        "2"
    );
    assert_eq!(
        run_git_checked(&remote_base, &["rev-list", "--count", "HEAD"], &[]).unwrap(),
        "2"
    );
}

#[test]
fn list_and_remove_git_worktrees_tracks_status_and_cleans_up() {
    let tmp = tempfile::TempDir::new().unwrap();
    let repo_dir = tmp.path().join("repo");
    std::fs::create_dir_all(&repo_dir).unwrap();

    run_git_checked(&repo_dir, &["init"], &[]).unwrap();
    run_git_checked(&repo_dir, &["config", "user.name", "Test"], &[]).unwrap();
    run_git_checked(&repo_dir, &["config", "user.email", "test@local"], &[]).unwrap();
    std::fs::write(repo_dir.join("main.txt"), "base\n").unwrap();
    run_git_checked(&repo_dir, &["add", "."], &[]).unwrap();
    run_git_checked(&repo_dir, &["commit", "-m", "initial"], &[]).unwrap();

    assert!(list_git_worktrees(&repo_dir).unwrap().is_empty());

    let wts_root = tmp.path().join("wts");
    let (wt_path, branch) = create_git_worktree(
        &repo_dir,
        &wts_root,
        "repo",
        CreateGitWorktreeOptions {
            include_dirty: false,
            ..Default::default()
        },
    )
    .unwrap();
    assert!(branch.starts_with("agent/"));

    std::fs::write(wt_path.join("main.txt"), "committed\n").unwrap();
    run_git_checked(&wt_path, &["add", "."], &[]).unwrap();
    run_git_checked(&wt_path, &["commit", "-m", "wt commit"], &[]).unwrap();
    std::fs::write(wt_path.join("untracked.txt"), "wip\n").unwrap();

    let entries = list_git_worktrees(&repo_dir).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].commits_ahead, 1);
    assert_eq!(entries[0].dirty_count, 1);
    assert!(entries[0].is_dirty);
    assert_eq!(entries[0].branch.as_deref(), Some(branch.as_str()));
    assert_eq!(entries[0].id.len(), 8);

    // Removing the main repo itself must be rejected.
    assert!(remove_git_worktree(&repo_dir, &repo_dir).is_err());

    remove_git_worktree(&repo_dir, &wt_path).unwrap();
    assert!(!wt_path.exists());
    assert!(list_git_worktrees(&repo_dir).unwrap().is_empty());
}

#[test]
fn create_git_worktree_supports_custom_name_and_base_ref() {
    let tmp = tempfile::TempDir::new().unwrap();
    let repo_dir = tmp.path().join("repo");
    std::fs::create_dir_all(&repo_dir).unwrap();

    run_git_checked(&repo_dir, &["init", "-b", "main"], &[]).unwrap();
    run_git_checked(&repo_dir, &["config", "user.name", "Test"], &[]).unwrap();
    run_git_checked(&repo_dir, &["config", "user.email", "test@local"], &[]).unwrap();
    std::fs::write(repo_dir.join("base.txt"), "main-v1\n").unwrap();
    run_git_checked(&repo_dir, &["add", "."], &[]).unwrap();
    run_git_checked(&repo_dir, &["commit", "-m", "main commit"], &[]).unwrap();

    run_git_checked(&repo_dir, &["checkout", "-b", "older-feature", "main"], &[]).unwrap();
    std::fs::write(repo_dir.join("old.txt"), "old\n").unwrap();
    run_git_checked(&repo_dir, &["add", "."], &[]).unwrap();
    run_git_checked(
        &repo_dir,
        &["commit", "-m", "older branch commit"],
        &[("GIT_COMMITTER_DATE", "2026-01-02T00:00:00Z")],
    )
    .unwrap();

    run_git_checked(&repo_dir, &["checkout", "-b", "cloud/newer-branch", "main"], &[]).unwrap();
    std::fs::write(repo_dir.join("cloud.txt"), "cloud\n").unwrap();
    run_git_checked(&repo_dir, &["add", "."], &[]).unwrap();
    run_git_checked(
        &repo_dir,
        &["commit", "-m", "newer branch commit"],
        &[("GIT_COMMITTER_DATE", "2026-02-01T00:00:00Z")],
    )
    .unwrap();

    run_git_checked(&repo_dir, &["checkout", "-b", "alpha-feature", "main"], &[]).unwrap();
    std::fs::write(repo_dir.join("feat.txt"), "feat\n").unwrap();
    run_git_checked(&repo_dir, &["add", "."], &[]).unwrap();
    run_git_checked(
        &repo_dir,
        &["commit", "-m", "feature commit"],
        &[("GIT_COMMITTER_DATE", "2026-03-01T00:00:00Z")],
    )
    .unwrap();

    let state = inspect_remote_git_state(&repo_dir).unwrap();
    assert_eq!(state.branch.as_deref(), Some("alpha-feature"));
    assert_eq!(
        state.branches,
        vec![
            "alpha-feature".to_string(),
            "main".to_string(),
            "cloud/newer-branch".to_string(),
            "older-feature".to_string(),
        ]
    );

    let wts_root = tmp.path().join("wts");
    let (wt_path, wt_branch) = create_git_worktree(
        &repo_dir,
        &wts_root,
        "repo",
        CreateGitWorktreeOptions {
            worktree_name: Some("hotfix-ui"),
            base_ref: Some("main"),
            include_dirty: false,
            ..Default::default()
        },
    )
    .unwrap();

    assert_eq!(wt_path.file_name().and_then(|s| s.to_str()), Some("hotfix-ui"));
    assert_eq!(wt_branch, "agent/hotfix-ui");
    assert!(!wt_path.join("feat.txt").exists());
    assert_eq!(
        std::fs::read_to_string(wt_path.join("base.txt")).unwrap(),
        "main-v1\n"
    );

    // Duplicate custom name fails cleanly instead of overwriting.
    assert!(create_git_worktree(
        &repo_dir,
        &wts_root,
        "repo",
        CreateGitWorktreeOptions {
            worktree_name: Some("hotfix-ui"),
            include_dirty: false,
            ..Default::default()
        },
    )
    .is_err());
}

#[test]
fn compute_worktree_diff_stats_and_collect_hunks_against_base_sha() {
    let tmp = tempfile::TempDir::new().unwrap();
    let repo_dir = tmp.path().join("repo");
    let wts_root = tmp.path().join("wts");
    std::fs::create_dir_all(&repo_dir).unwrap();

    run_git_checked(&repo_dir, &["init", "-b", "main"], &[]).unwrap();
    run_git_checked(&repo_dir, &["config", "user.email", "test@example.com"], &[]).unwrap();
    run_git_checked(&repo_dir, &["config", "user.name", "Tester"], &[]).unwrap();

    let mut initial = String::new();
    for i in 1..=30 {
        initial.push_str(&format!("line {}\n", i));
    }
    std::fs::write(repo_dir.join("app.rs"), &initial).unwrap();
    run_git_checked(&repo_dir, &["add", "."], &[]).unwrap();
    run_git_checked(&repo_dir, &["commit", "-m", "initial"], &[]).unwrap();

    let (wt_path, _) = create_git_worktree(
        &repo_dir,
        &wts_root,
        "repo",
        CreateGitWorktreeOptions {
            worktree_name: Some("agent-a"),
            include_dirty: false,
            ..Default::default()
        },
    )
    .unwrap();

    // Clean worktree has 0 stats and 0 files
    let empty_stats = compute_worktree_diff_stats(&wt_path).unwrap();
    assert_eq!(empty_stats, WorktreeDiffStats { added: 0, removed: 0, files: 0 });

    // Edit near top and commit inside worktree
    let mut lines: Vec<String> = (1..=30).map(|i| format!("line {}", i)).collect();
    lines[1] = "line 2 edited".to_string();
    std::fs::write(wt_path.join("app.rs"), format!("{}\n", lines.join("\n"))).unwrap();
    run_git_checked(&wt_path, &["add", "app.rs"], &[]).unwrap();
    run_git_checked(&wt_path, &["commit", "-m", "wt commit"], &[]).unwrap();

    // Edit near bottom (uncommitted) + add untracked file
    lines[27] = "line 28 edited".to_string();
    lines.push("line 31 added".to_string());
    std::fs::write(wt_path.join("app.rs"), format!("{}\n", lines.join("\n"))).unwrap();
    std::fs::write(wt_path.join("notes.txt"), "hello\nworld\n").unwrap();

    let stats = compute_worktree_diff_stats(&wt_path).unwrap();
    assert_eq!(stats, WorktreeDiffStats { added: 5, removed: 2, files: 2 });

    let diff = collect_worktree_diff(&wt_path).unwrap();
    assert_eq!(diff.added, 5);
    assert_eq!(diff.removed, 2);
    assert!(!diff.truncated);
    assert_eq!(diff.files.len(), 2);

    let app_file = diff.files.iter().find(|f| f.path == "app.rs").unwrap();
    assert_eq!(app_file.status, "modified");
    assert_eq!(app_file.added, 3);
    assert_eq!(app_file.removed, 2);
    assert_eq!(app_file.hunks.len(), 2);
    assert!(app_file.hunks[0].new_start <= 2);
    assert!(app_file.hunks[1].new_start >= 20);

    let notes_file = diff.files.iter().find(|f| f.path == "notes.txt").unwrap();
    assert_eq!(notes_file.status, "untracked");
    assert_eq!(notes_file.added, 2);
    assert_eq!(notes_file.hunks.len(), 1);
}

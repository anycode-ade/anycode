use super::*;
use std::time::Instant;

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

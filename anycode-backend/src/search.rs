use crate::utils::{is_ignored_path, is_search_ignored_dir, relative_to_current_dir};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::Semaphore;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

pub fn collect_files_recursively(dir_path: &Path) -> Result<Vec<PathBuf>> {
    let mut collected_files = Vec::new();
    collect_files_inner(dir_path, &mut collected_files)?;
    Ok(collected_files)
}

fn collect_files_inner(dir_path: &Path, collected: &mut Vec<PathBuf>) -> Result<()> {
    // Use search-specific ignore for directories
    if is_search_ignored_dir(dir_path) {
        return Ok(());
    }

    for entry_result in std::fs::read_dir(dir_path)? {
        let entry = entry_result?;
        let path = entry.path();

        if path.is_dir() {
            // Check directory with search-specific ignore
            if is_search_ignored_dir(&path) {
                continue;
            }
            collect_files_inner(&path, collected)?;
        } else {
            // Check file with regular ignore (for file extensions, etc.)
            if is_ignored_path(&path) {
                continue;
            }
            // Ignore files larger than 100 MB to avoid blocking search
            const MAX_FILE_SIZE: u64 = 100 * 1024 * 1024; // 100 MB
            if let Ok(metadata) = std::fs::metadata(&path) {
                if metadata.len() > MAX_FILE_SIZE {
                    continue;
                }
            }
            collected.push(path);
        }
    }

    Ok(())
}

pub fn line_search(line_content: &str, pattern: &str, line_number: usize) -> Vec<SearchResult> {
    let mut results = Vec::new();
    let mut search_start = 0;

    // Search for all occurrences in the line
    while let Some(byte_index) = line_content[search_start..].find(pattern) {
        let match_start = search_start + byte_index;
        // Count characters correctly – Unicode taught me to be careful
        let symbol_column = line_content[..search_start + byte_index].chars().count();

        let chars: Vec<char> = line_content.chars().collect();
        let match_char_start = line_content[..match_start].chars().count();
        let match_char_end = match_char_start + pattern.chars().count();
        let preview_start = match_char_start.saturating_sub(50);
        let preview_end = (match_char_end + 50).min(chars.len());
        let preview: String = chars[preview_start..preview_end].iter().collect();

        results.push(SearchResult {
            line: line_number,
            column: symbol_column,
            preview,
        });

        // Move forward in the line, search for the next match
        search_start += byte_index + pattern.len();
    }

    results
}

pub fn multiline_search(content: &str, pattern: &str) -> Vec<SearchResult> {
    let mut results = Vec::new();
    let mut search_start = 0;

    // Find all occurrences of the pattern in the content
    while let Some(byte_index) = content[search_start..].find(pattern) {
        let match_start = search_start + byte_index;

        // Count lines and characters up to the match start to find line number and column
        let mut line_number = 0;
        let mut column = 0;

        for ch in content[..match_start].chars() {
            if ch == '\n' {
                line_number += 1;
                column = 0;
            } else {
                column += 1;
            }
        }

        // Create preview: extract surrounding context (up to 50 chars before and after)
        let chars: Vec<char> = content.chars().collect();
        let match_char_start = content[..match_start].chars().count();
        let match_char_end = match_char_start + pattern.chars().count();
        let preview_start = match_char_start.saturating_sub(50);
        let preview_end = (match_char_end + 50).min(chars.len());
        let preview: String = chars[preview_start..preview_end].iter().collect();

        results.push(SearchResult {
            line: line_number,
            column,
            preview,
        });

        // Move forward in the content, search for the next match
        search_start += byte_index + pattern.len();
    }

    results
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchResult {
    pub line: usize,
    pub column: usize,
    pub preview: String,
}

pub async fn file_search(
    file_path: &str,
    pattern: &str,
    cancel_token: CancellationToken,
) -> Result<Vec<SearchResult>> {
    let mut results = Vec::new();

    // Check if pattern is multi-line (contains newline)
    let is_multiline = pattern.contains('\n');

    if is_multiline {
        // For multi-line patterns, read entire file content
        if cancel_token.is_cancelled() {
            return Ok(results);
        }

        let content = tokio::fs::read_to_string(file_path).await?;

        if cancel_token.is_cancelled() {
            return Ok(results);
        }

        results = multiline_search(&content, pattern);
    } else {
        // For single-line patterns, use line-by-line processing (more memory efficient)
        let path = Path::new(file_path);
        let file = tokio::fs::File::open(path).await?;
        let reader = BufReader::new(file);

        let mut lines = reader.lines();
        let mut line_number = 0;

        loop {
            tokio::select! {
                line_result = lines.next_line() => {
                    match line_result? {
                        Some(content) => {
                            if cancel_token.is_cancelled() {
                                break;
                            }

                            let line_results = line_search(&content, pattern, line_number);
                            results.extend(line_results);
                            line_number += 1;
                        }
                        // End of file reached
                        None => {
                            break;
                        }
                    }
                }
                _ = cancel_token.cancelled() => {
                    break;
                }
            }
        }
    }

    Ok(results)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileSearchResult {
    pub file_path: String,
    pub display_path: String,
    pub matches: Vec<SearchResult>,
}

pub async fn global_search(
    dir_path: &Path,
    pattern: &str,
    cancel: CancellationToken,
    result_tx: mpsc::Sender<FileSearchResult>,
) -> Result<()> {
    let mut files = collect_files_recursively(dir_path)?;

    // Sort files by depth
    files.sort_by(|a, b| {
        let depth_a = a.components().count();
        let depth_b = b.components().count();
        match depth_a.cmp(&depth_b) {
            std::cmp::Ordering::Equal => a.cmp(b),
            other => other,
        }
    });

    let semaphore = Arc::new(Semaphore::new(8));
    let mut handles = Vec::new();

    for file_path in files {
        if cancel.is_cancelled() {
            break;
        }

        let permit = semaphore.clone().acquire_owned().await.unwrap();
        let path_buf = file_path.clone();
        let pattern = pattern.to_string();
        let cancel_token = cancel.clone();
        let result_tx = result_tx.clone();

        let handle = tokio::spawn(async move {
            let _permit = permit;

            let file_path_str = path_buf.to_string_lossy().to_string();
            let display_path = relative_to_current_dir(&path_buf)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| file_path_str.clone());

            let matches = match file_search(&file_path_str, &pattern, cancel_token.clone()).await {
                Ok(m) => m,
                Err(_err) => {
                    // Error reading/searching file, skip it
                    return;
                }
            };

            if !matches.is_empty() {
                if result_tx
                    .send(FileSearchResult {
                        file_path: file_path_str,
                        display_path,
                        matches,
                    })
                    .await
                    .is_err()
                {
                    // Global receiver dropped, skip results
                }
            }
        });

        handles.push(handle);
    }

    for handle in handles {
        let _ = handle.await;
    }

    Ok(())
}

pub mod search_exp {
    

    #[test]
    fn test_line_search_simple() {
        let line = "This is a test string where test appears twice: test.";
        let pattern = "test";
        let results = line_search(line, pattern, 0);

        assert_eq!(results.len(), 3);

        // First occurrence
        assert_eq!(results[0].line, 0);
        assert_eq!(results[0].column, 10);
        assert!(results[0].preview.contains(pattern));

        // Second occurrence
        assert_eq!(results[1].column, 28);
        assert!(results[1].preview.contains(pattern));

        // Third occurrence
        assert_eq!(results[2].column, 48);
        assert!(results[2].preview.contains(pattern));
    }

    #[test]
    fn test_line_search_unicode() {
        let line = "Пример строки с шаблон шаблоном и ещё текст.";
        let pattern = "шаблон";
        let results = line_search(line, pattern, 0);

        assert_eq!(results.len(), 2);

        // First occurrence
        assert_eq!(results[0].line, 0);
        assert_eq!(results[0].column, 16);
        assert!(results[0].preview.contains(pattern));

        // Second occurrence
        assert_eq!(results[1].column, 23);
        assert!(results[1].preview.contains(pattern));
    }

    #[test]
    fn test_line_search_no_match() {
        let line = "Nothing to see here.";
        let pattern = "absent";
        let results = line_search(line, pattern, 0);

        assert!(results.is_empty());
    }

    #[test]
    fn test_line_search_long_preview_cutoff() {
        let line = "A".repeat(100) + "pattern" + &"B".repeat(100);
        let pattern = "pattern";
        let results = line_search(&line, pattern, 0);

        assert_eq!(results.len(), 1);
        let result = &results[0];

        assert_eq!(result.line, 0);
        assert_eq!(result.column, 100); // 100 'A's before pattern
        assert!(result.preview.contains(pattern));

        let expected_preview_len = 50 + pattern.len() + 50;
        assert_eq!(result.preview.chars().count(), expected_preview_len);

        assert!(result.preview.starts_with(&"A".repeat(50)));
        assert!(result.preview.ends_with(&"B".repeat(50)));
    }

    #[tokio::test]
    async fn test_search_in_file_with_cancel_named_tempfile() -> Result<()> {
        let pattern = "search_term";

        let mut temp_file = tempfile::NamedTempFile::new()?;

        use std::io::Write;
        writeln!(
            temp_file,
            "This is a test file.\n\
            This line contains the search_term.\n\
            This line does not.\n\
            Another line with search_term.\n"
        )?;

        let temp_file_path = temp_file.path().to_path_buf();

        let cancel = CancellationToken::new();

        let results =
            file_search(temp_file_path.to_string_lossy().as_ref(), pattern, cancel).await?;

        println!("Results: {:?}", results);

        assert_eq!(results.len(), 2);
        assert_eq!(results[0].line, 1);
        assert!(results[0].preview.contains(pattern));
        assert_eq!(results[1].line, 3);
        assert!(results[1].preview.contains(pattern));

        Ok(())
    }

    #[tokio::test]
    async fn test_search_in_file_with_cancel_cancelled() -> Result<()> {
        let pattern = "search_term";
        let mut temp_file = tempfile::NamedTempFile::new()?;

        use std::io::Write;
        writeln!(
            temp_file,
            "This is a test file.\n\
            This line contains the search_term.\n\
            This line does not.\n\
            Another line with search_term.\n"
        )?;

        let temp_file_path = temp_file.path().to_path_buf();

        let cancel = CancellationToken::new();

        // Send cancellation signal immediately
        cancel.cancel();

        // Search should return empty results when cancelled
        let results =
            file_search(temp_file_path.to_string_lossy().as_ref(), pattern, cancel).await?;

        println!("Results len: {}", results.len());
        println!("Results: {:?}", results);

        // Assert that processing stopped before completing
        // We expect 0 results to be returned.
        assert!(results.len() == 0);

        Ok(())
    }

    #[tokio::test]
    async fn test_batch_search_with_cancel() -> Result<()> {
        use tempfile::TempDir;

        // Create a temporary directory for the test
        let temp_dir = TempDir::new()?;
        let dir_path = temp_dir.path().to_path_buf(); // Clone the path to allow it to live longer

        // Create test files inside the temp directory
        let file_1 = dir_path.join("file1.txt");
        let file_2 = dir_path.join("file2.txt");

        // Write some content to the files
        std::fs::write(
            &file_1,
            "hello world\nюникод не помеха search_term here\nbye world",
        )?;
        std::fs::write(&file_2, "nothing to match\nno search term\nstill nothing")?;

        // Create the cancellation token
        let cancel = CancellationToken::new();

        // Channel to collect results
        let (result_tx, mut result_rx) = tokio::sync::mpsc::channel::<FileSearchResult>(100);

        let cancel_clone = cancel.clone();
        // Send cancellation signal after a short delay
        tokio::spawn(async move {
            // Adjust the delay as needed
            // tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;
            // cancel.cancel();
        });

        // Run batch search with a cancellation token
        let pattern = "search_term";
        tokio::spawn(async move {
            let search_result = global_search(&dir_path, pattern, cancel_clone, result_tx).await;

            if let Err(err) = search_result {
                eprintln!("search failed: {}", err);
            }
        });

        // Collect results
        let mut collected_results = Vec::new();
        while let Some(file_result) = result_rx.recv().await {
            println!("Results for file: {}", file_result.display_path);
            for result in &file_result.matches {
                println!(
                    "  Line {}:{} {}",
                    result.line, result.column, result.preview
                );
            }
            collected_results.push(file_result);
        }

        // Assertions

        // We expect only one file (file1.txt) to contain matches
        assert_eq!(collected_results.len(), 1, "Expected one file with matches");

        let file1_results = &collected_results[0];
        assert!(
            file1_results.file_path.ends_with("file1.txt"),
            "Expected matches in file1.txt"
        );
        assert!(
            file1_results.display_path.ends_with("file1.txt"),
            "Expected display path to remain readable"
        );

        // We expect at least one match in that file
        assert!(
            !file1_results.matches.is_empty(),
            "Expected at least one match"
        );

        // Check that all matches contain the search pattern in their preview
        for search_result in &file1_results.matches {
            assert!(
                search_result.preview.contains(pattern),
                "Preview should contain the pattern"
            );
        }

        Ok(())
    }

    #[test]
    fn test_multiline_search() {
        let content = "line 1\nline 2\nline 3 with pattern\nline 4\nline 5";
        let pattern = "line 2\nline 3";
        let results = multiline_search(content, pattern);

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].line, 1); // line 2 is at index 1 (0-indexed)
        assert!(results[0].preview.contains(pattern));
    }

    #[tokio::test]
    async fn test_file_search_multiline() -> Result<()> {
        let mut temp_file = tempfile::NamedTempFile::new()?;

        use std::io::Write;
        writeln!(
            temp_file,
            "first line\nsecond line\nthird line\nfourth line\ntest\ntest"
        )?;

        let temp_file_path = temp_file.path().to_path_buf();
        let pattern = "second line\nthird line";

        let cancel = CancellationToken::new();

        let results =
            file_search(temp_file_path.to_string_lossy().as_ref(), pattern, cancel).await?;

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].line, 1); // second line is at index 1
        assert!(results[0].preview.contains("second line"));
        assert!(results[0].preview.contains("third line"));

        Ok(())
    }

    #[tokio::test]
    async fn test_global_search_specific_directory_with_timing() -> Result<()> {
        use std::path::PathBuf;
        use std::time::Instant;

        let home_dir = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
        let mut rust_dir = PathBuf::from(home_dir);
        rust_dir.push("dev/rust");

        // Skip test if directory doesn't exist
        if !rust_dir.exists() {
            println!("Skipping test: directory {:?} does not exist", rust_dir);
            return Ok(());
        }

        let pattern = "upstream_monomorphization";
        let cancel = CancellationToken::new();
        let (result_tx, mut result_rx) = mpsc::channel::<FileSearchResult>(1000);

        let start = Instant::now();

        // Run the search
        global_search(&rust_dir, pattern, cancel, result_tx).await?;

        let elapsed = start.elapsed();

        // Collect all results
        let mut all_results = Vec::new();
        while let Some(file_result) = result_rx.recv().await {
            all_results.push(file_result);
        }

        let total_matches: usize = all_results.iter().map(|r| r.matches.len()).sum();

        println!(
            "Global search in {:?} took {:.2?} seconds and found {} files with {} total matches.",
            rust_dir,
            elapsed,
            all_results.len(),
            total_matches
        );

        for file_result in &all_results {
            for r in &file_result.matches {
                println!(
                    "File: {}, Line: {}, Col: {}, preview: {}",
                    file_result.file_path, r.line, r.column, r.preview
                );
            }
        }

        Ok(())
    }
}

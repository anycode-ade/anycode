use super::*;

#[test]
fn test_find_local_paths() {
    let temp_dir = std::env::temp_dir();
    let temp_file = temp_dir.join("test_file_anycode.txt");
    std::fs::write(&temp_file, "hello").unwrap();

    let prompt = format!(
        "Please look at file://{} and write code",
        temp_file.display()
    );
    let paths = find_local_paths(&prompt);
    assert!(paths.contains(&temp_file));

    // Test non-ASCII input (Cyrillic 'с' like in the user's report)
    let prompt_cyrillic = format!("Привет, вот файл: file://{} с текстом", temp_file.display());
    let paths_cyrillic = find_local_paths(&prompt_cyrillic);
    assert!(paths_cyrillic.contains(&temp_file));

    let _ = std::fs::remove_file(temp_file);
}

//! Regression checks for Windows project paths.
//!
//! On Windows `std::fs::canonicalize` returns verbatim paths such as `\\?\C:\...`.
//! Project roots must be plain paths, otherwise file requests resolved against the
//! root do not match it, and the agent's `cmd.exe` gets a verbatim working directory.

use std::path::Path;

use crate::utils::abs_file;
use crate::workspace::project_info_for_path;

#[test]
fn file_inside_project_resolves_under_project_root() {
    let project = tempfile::tempdir().unwrap();
    let file = project.path().join("src").join("main.rs");
    std::fs::create_dir_all(file.parent().unwrap()).unwrap();
    std::fs::write(&file, "fn main() {}").unwrap();

    let info = project_info_for_path(project.path()).unwrap();
    let resolved = abs_file(&file.to_string_lossy()).unwrap();

    eprintln!("project root: {}\nresolved file: {resolved}", info.root);
    assert!(
        Path::new(&resolved).starts_with(&info.root),
        "file {resolved} is not under project root {}",
        info.root
    );
}

#[cfg(windows)]
#[test]
fn project_root_is_a_usable_windows_shell_working_directory() {
    let project = tempfile::tempdir().unwrap();
    let info = project_info_for_path(project.path()).unwrap();

    // The agent process is started through cmd.exe with the project root as its working directory.
    let output = std::process::Command::new("cmd.exe")
        .args(["/D", "/S", "/C", "cd"])
        .current_dir(&info.root)
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    eprintln!("project root: {}\nstdout: {stdout}\nstderr: {stderr}", info.root);
    assert!(
        output.status.success(),
        "cmd.exe failed in project root {}: {stderr}",
        info.root
    );
}

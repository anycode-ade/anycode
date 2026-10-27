//! Regression checks for Windows project paths.
//!
//! On Windows `std::fs::canonicalize` returns verbatim paths such as `\\?\C:\...`.
//! Project roots must be plain paths, otherwise file requests resolved against the
//! root do not match it.

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

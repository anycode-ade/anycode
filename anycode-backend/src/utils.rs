use lsp_types::Uri;
use pathdiff::diff_paths;
use std::path::{Component, Path, PathBuf};

pub const DEFAULT_IGNORE_DIRS: &[&str] = &[
    // Version control and IDEs
    ".git",
    ".anycode",
    // Python
    "__pycache__",
    ".pytest_cache",
    ".venv",
    "venv",
    "env",
    ".mypy_cache",
    ".tox",
    // Build artifacts and output directories
    "target",
    "node_modules",
    "dist",
    "build",
    "out",
    "bin",
    "obj",
    ".next",
    ".nuxt",
    ".output",
    "coverage",
    // Java
    ".gradle",
    ".m2",
    "classes",
];

pub const DEFAULT_IGNORE_FILES: &[&str] = &[
    // System files
    ".DS_Store",
    "Thumbs.db",
    "desktop.ini",
    // Certificate and key files
    "*.pem",
    "*.key",
    "*.crt",
    "*.p12",
    // Images and video
    "*.png",
    "*.jpg",
    "*.jpeg",
    "*.gif",
    "*.bmp",
    "*.tiff",
    "*.webp",
    "*.ico",
    "*.mp4",
    "*.mov",
    "*.avi",
    "*.mkv",
    "*.webm",
    "*.flv",
    "*.wmv",
    "*.mp3",
    "*.wav",
    "*.ogg",
    "*.aac",
    "*.flac",
    "*.m4a",
    "*.opus",
    "*.wma",
    // Archives
    "*.zip",
    "*.tar",
    "*.gz",
    "*.bz2",
    "*.xz",
    "*.7z",
];

// Directories that should be ignored during search (even if shown in tree)
pub const SEARCH_IGNORE_DIRS: &[&str] = &[
    // Build artifacts and output directories
    "target",
    "node_modules",
    "dist",
    "build",
    "out",
    "bin",
    "obj",
    // Version control
    ".git",
    ".anycode",
    // Python
    ".venv",
    "venv",
    "env",
    ".mypy_cache",
    ".tox",
    // JavaScript/TypeScript
    ".next",
    ".nuxt",
    ".output",
    "coverage",
    // Java
    ".gradle",
    ".m2",
    "classes",
    // System files
    ".DS_Store",
];

/// Get ignore directories with support for environment variable extension
pub fn get_ignore_dirs() -> Vec<&'static str> {
    let mut dirs = DEFAULT_IGNORE_DIRS.to_vec();

    if let Ok(extra_dirs) = std::env::var("ANYCODE_IGNORE_DIRS") {
        for dir in extra_dirs.split(',') {
            let dir = dir.trim();
            if !dir.is_empty() {
                // We need to leak the string to make it 'static
                // This is acceptable since ignore patterns are typically set once
                dirs.push(Box::leak(dir.to_string().into_boxed_str()));
            }
        }
    }

    dirs
}

/// Get ignore files with support for environment variable extension
pub fn get_ignore_files() -> Vec<&'static str> {
    let mut files = DEFAULT_IGNORE_FILES.to_vec();

    if let Ok(extra_files) = std::env::var("REDAI_IGNORE_FILES") {
        for file in extra_files.split(',') {
            let file = file.trim();
            if !file.is_empty() {
                // We need to leak the string to make it 'static
                // This is acceptable since ignore patterns are typically set once
                files.push(Box::leak(file.to_string().into_boxed_str()));
            }
        }
    }

    files
}

/// Checks if any part of the path matches an ignored directory
pub fn is_ignored_dir(path: &std::path::Path) -> bool {
    let ignore_dirs = get_ignore_dirs();
    path.iter()
        .any(|p| ignore_dirs.contains(&p.to_string_lossy().as_ref()))
}

/// Checks if a file should be ignored based on its name or extension
pub fn is_ignored_file(file_name: &str) -> bool {
    let ignore_files = get_ignore_files();
    ignore_files.iter().any(|&pattern| {
        if pattern.starts_with('*') && pattern.len() > 1 {
            // Handle wildcard patterns like "*.log"
            let extension = &pattern[1..];
            file_name.ends_with(extension)
        } else {
            // Exact match
            file_name == pattern
        }
    })
}

/// Checks if a path should be ignored (either directory or file)
pub fn is_ignored_path(path: &std::path::Path) -> bool {
    // Check if any directory in the path should be ignored
    if is_ignored_dir(path) {
        return true;
    }

    // Check if the file itself should be ignored
    if let Some(file_name) = path.file_name() {
        if let Some(file_name_str) = file_name.to_str() {
            return is_ignored_file(file_name_str);
        }
    }

    false
}

/// Checks if a directory should be ignored during search
pub fn is_search_ignored_dir(path: &std::path::Path) -> bool {
    path.iter()
        .any(|p| SEARCH_IGNORE_DIRS.contains(&p.to_string_lossy().as_ref()))
}

pub fn abs_file(input: &str) -> anyhow::Result<String> {
    let srcdir = std::path::PathBuf::from(input);
    match std::fs::canonicalize(&srcdir) {
        Ok(c) => Ok(c.to_string_lossy().to_string()),
        Err(e) => {
            if e.kind() == std::io::ErrorKind::NotFound {
                let normalized = normalize_watch_path(&srcdir);
                Ok(normalized.to_string_lossy().to_string())
            } else {
                Err(anyhow::Error::new(e))
            }
        }
    }
}

/// Normalize a path for watcher comparisons without requiring the file to exist.
///
/// This resolves `.` and `..` segments and makes relative paths absolute against the
/// current working directory, but does not follow symlinks.
pub fn normalize_watch_path(path: &Path) -> PathBuf {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        current_dir().join(path)
    };

    let mut normalized = PathBuf::new();

    for component in absolute.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::Normal(part) => normalized.push(part),
        }
    }

    normalized
}

pub fn file_name(input: &str) -> String {
    let path_buf = std::path::PathBuf::from(input);
    let file_name = path_buf.file_name().unwrap().to_string_lossy().into_owned();
    file_name
}

pub fn relative_path(input: &str) -> String {
    let input_path = std::path::Path::new(input);

    match std::env::current_dir() {
        Ok(current_dir) => {
            match diff_paths(input_path, &current_dir) {
                Some(relative_path) => relative_path.to_string_lossy().into_owned(),
                None => input.to_string(), // Fallback to input if diff fails
            }
        }
        Err(_) => input.to_string(), // Fallback if current_dir can't be retrieved
    }
}

pub fn relative_to_current_dir(path: &Path) -> Option<PathBuf> {
    let current_dir = std::env::current_dir().ok()?;
    path.strip_prefix(&current_dir)
        .ok()
        .map(|p| p.to_path_buf())
}

pub fn current_dir() -> PathBuf {
    std::env::current_dir().unwrap_or_else(|_| {
        // Fallback to home directory or platform-specific root
        dirs::home_dir().unwrap_or_else(|| {
            if cfg!(target_os = "windows") {
                PathBuf::from("C:\\")
            } else {
                PathBuf::from("/")
            }
        })
    })
}

pub fn get_file_name(input: &str) -> String {
    let path_buf = std::path::PathBuf::from(input);
    let file_name = path_buf.file_name().unwrap().to_string_lossy().into_owned();
    file_name
}

pub fn path_to_uri(path: &str) -> anyhow::Result<Uri> {
    let path_obj = std::path::Path::new(path);
    let canonical_path = path_obj
        .canonicalize()
        .unwrap_or_else(|_| path_obj.to_path_buf());

    let absolute_path = if canonical_path.is_absolute() {
        canonical_path
    } else {
        std::env::current_dir()?.join(canonical_path)
    };

    let url = url::Url::from_file_path(&absolute_path)
        .map_err(|_| anyhow::anyhow!("Failed to convert path to Url: {:?}", absolute_path))?;

    url.as_str()
        .parse()
        .map_err(|e| anyhow::anyhow!("Failed to parse URI: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_path_to_uri_with_spaces() {
        let path = if cfg!(target_os = "windows") {
            r"C:\Users\max\dev\anycode\code copy.ts"
        } else {
            "/Users/max/dev/anycode/code copy.ts"
        };
        let uri = path_to_uri(path).unwrap();
        assert!(uri.to_string().contains("code%20copy.ts"));
    }

    #[test]
    fn test_path_to_uri_relative() {
        let path = "src/utils.rs";
        let uri = path_to_uri(path).unwrap();
        assert!(uri.to_string().starts_with("file:///"));
        assert!(uri.to_string().ends_with("src/utils.rs"));
    }

    #[test]
    fn test_path_to_uri_cyrillic() {
        let path = if cfg!(target_os = "windows") {
            r"C:\Users\max\dev\anycode\привет мир.ts"
        } else {
            "/Users/max/dev/anycode/привет мир.ts"
        };
        let uri = path_to_uri(path).unwrap();
        assert!(uri.to_string().contains("%20"));
        // "привет" in UTF-8 percent-encoded is %D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82
        assert!(uri.to_string().contains("%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82"));
    }

    #[test]
    fn test_path_to_uri_special_chars() {
        let path = if cfg!(target_os = "windows") {
            r"C:\Users\max\dev\anycode\file#name?.ts"
        } else {
            "/Users/max/dev/anycode/file#name?.ts"
        };
        let uri = path_to_uri(path).unwrap();
        assert!(uri.to_string().contains("file%23name%3F.ts"));
    }
}

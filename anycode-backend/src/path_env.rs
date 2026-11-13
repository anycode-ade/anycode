//! Non-blocking shell `PATH` resolution for desktop launches on Unix.
//!
//! GUI apps on macOS and Linux do not inherit the user's interactive shell `PATH`.
//! Spawning a login shell synchronously during startup adds ~0.5-1s before the
//! first window appears. This module resolves the shell `PATH` in a background
//! thread without mutating global process environment (avoiding `setenv`/`getenv`
//! races across threads) and applies it to spawned child processes.

#[cfg(not(windows))]
mod imp {
    use std::sync::{Arc, Condvar, Mutex, OnceLock};
    use std::time::Duration;
    use tokio::sync::Notify;

    const RESOLVE_TIMEOUT: Duration = Duration::from_secs(5);
    const DELIM: &str = "_ANYCODE_PATH_DELIM_";

    struct PathState {
        value: Mutex<Option<Option<String>>>,
        cvar: Condvar,
        notify: Notify,
    }

    static PATH_STATE: OnceLock<Arc<PathState>> = OnceLock::new();

    /// Starts resolving the interactive login shell `PATH` on a background thread.
    /// Safe to call multiple times; only the first call spawns a thread.
    pub fn init_in_background() {
        PATH_STATE.get_or_init(|| {
            let state = Arc::new(PathState {
                value: Mutex::new(None),
                cvar: Condvar::new(),
                notify: Notify::new(),
            });
            let bg = Arc::clone(&state);
            let _ = std::thread::Builder::new()
                .name("anycode-path-env".to_string())
                .spawn(move || {
                    let resolved = resolve_shell_path();
                    if let Ok(mut guard) = bg.value.lock() {
                        *guard = Some(resolved);
                        bg.cvar.notify_all();
                    }
                    bg.notify.notify_waiters();
                });
            state
        });
    }

    /// Waits for background `PATH` resolution (if started) and returns the resolved `PATH`.
    pub async fn get_async() -> Option<String> {
        let Some(state) = PATH_STATE.get() else {
            return None;
        };

        let deadline = tokio::time::Instant::now() + RESOLVE_TIMEOUT;
        loop {
            let notified = state.notify.notified();
            if let Ok(guard) = state.value.lock() {
                if let Some(ref resolved) = *guard {
                    return resolved.clone();
                }
            }
            if tokio::time::timeout_at(deadline, notified).await.is_err() {
                return None;
            }
        }
    }

    /// Blocking variant for synchronous `std::process::Command` builders.
    pub fn get_blocking() -> Option<String> {
        let Some(state) = PATH_STATE.get() else {
            return None;
        };

        let Ok(mut guard) = state.value.lock() else {
            return None;
        };
        if let Some(ref resolved) = *guard {
            return resolved.clone();
        }
        let deadline = std::time::Instant::now() + RESOLVE_TIMEOUT;
        while guard.is_none() {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            if remaining.is_zero() {
                return None;
            }
            let Ok((next_guard, wait_res)) = state.cvar.wait_timeout(guard, remaining) else {
                return None;
            };
            guard = next_guard;
            if wait_res.timed_out() && guard.is_none() {
                return None;
            }
        }
        guard.as_ref().and_then(|v| v.clone())
    }

    pub fn apply_to_std_command(command: &mut std::process::Command) {
        if let Some(path) = get_blocking() {
            command.env("PATH", path);
        }
    }

    pub fn apply_resolved_to_tokio_command(
        command: &mut tokio::process::Command,
        resolved: Option<&str>,
    ) {
        if let Some(path) = resolved {
            command.env("PATH", path);
        }
    }

    pub async fn apply_to_tokio_command(command: &mut tokio::process::Command) {
        let resolved = get_async().await;
        apply_resolved_to_tokio_command(command, resolved.as_deref());
    }

    fn resolve_shell_path() -> Option<String> {
        let default_shell = if cfg!(target_os = "macos") {
            "/bin/zsh"
        } else {
            "/bin/sh"
        };
        let shell = std::env::var("SHELL").unwrap_or_else(|_| default_shell.to_string());

        let mut cmd = std::process::Command::new(shell);
        cmd.arg("-ilc")
            .arg(format!(r#"printf '{DELIM}%s{DELIM}' "$PATH""#))
            .env("DISABLE_AUTO_UPDATE", "true")
            .stdin(std::process::Stdio::null());

        if let Some(home) = dirs::home_dir() {
            cmd.current_dir(home);
        }

        let out = cmd.output().ok()?;
        if !out.status.success() {
            return None;
        }
        let stdout = String::from_utf8_lossy(&out.stdout);
        extract_delimited_path(&stdout)
    }

    pub(crate) fn extract_delimited_path(stdout: &str) -> Option<String> {
        let raw = stdout.split(DELIM).nth(1)?;
        let cleaned = strip_ansi_escapes(raw);
        let trimmed = cleaned.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    }

    fn strip_ansi_escapes(input: &str) -> String {
        let mut out = String::with_capacity(input.len());
        let mut chars = input.chars().peekable();
        while let Some(c) = chars.next() {
            if c == '\x1b' {
                match chars.peek().copied() {
                    Some('[') => {
                        chars.next();
                        for ch in chars.by_ref() {
                            if ('@'..='~').contains(&ch) {
                                break;
                            }
                        }
                    }
                    Some(']') => {
                        chars.next();
                        while let Some(ch) = chars.next() {
                            if ch == '\x07' {
                                break;
                            }
                            if ch == '\x1b' && chars.peek() == Some(&'\\') {
                                chars.next();
                                break;
                            }
                        }
                    }
                    Some(_) => {
                        chars.next();
                    }
                    None => {}
                }
            } else {
                out.push(c);
            }
        }
        out
    }

    #[cfg(test)]
    mod tests {
        use super::extract_delimited_path;

        #[test]
        fn extracts_path_ignoring_shell_noise_and_ansi() {
            let noisy = "\x1b[32mWelcome\x1b[0m\n_ANYCODE_PATH_DELIM_/opt/homebrew/bin:/usr/bin:/bin_ANYCODE_PATH_DELIM_\n";
            assert_eq!(
                extract_delimited_path(noisy).as_deref(),
                Some("/opt/homebrew/bin:/usr/bin:/bin")
            );
        }

        #[test]
        fn returns_none_when_delimiter_missing_or_empty() {
            assert_eq!(extract_delimited_path("no delimiter"), None);
            assert_eq!(
                extract_delimited_path("_ANYCODE_PATH_DELIM_   _ANYCODE_PATH_DELIM_"),
                None
            );
        }
    }
}

#[cfg(windows)]
mod imp {
    pub fn init_in_background() {}
    pub async fn get_async() -> Option<String> {
        None
    }
    pub fn apply_to_std_command(_command: &mut std::process::Command) {}
    pub fn apply_resolved_to_tokio_command(
        _command: &mut tokio::process::Command,
        _resolved: Option<&str>,
    ) {
    }
    pub async fn apply_to_tokio_command(_command: &mut tokio::process::Command) {}
}

pub use imp::{
    apply_resolved_to_tokio_command, apply_to_std_command, apply_to_tokio_command, get_async,
    init_in_background,
};

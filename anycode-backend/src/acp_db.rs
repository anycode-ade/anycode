use anyhow::{Context, Result};
use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, params};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tracing::{debug, info, warn};

const COMPRESSION_LEVEL: i32 = 3;

#[derive(Clone)]
pub struct AcpDb {
    conn: Arc<Mutex<Connection>>,
    db_path: Option<PathBuf>,
}

impl AcpDb {
    /// Open or create an SQLite database at the specified path.
    pub fn new(db_path: impl AsRef<Path>) -> Result<Self> {
        let db_path = db_path.as_ref().to_path_buf();
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("Failed to create database directory at {:?}", parent))?;
        }

        let conn = Connection::open(&db_path)
            .with_context(|| format!("Failed to open SQLite database at {:?}", db_path))?;

        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
            db_path: Some(db_path),
        };

        db.init_schema()?;
        Ok(db)
    }

    /// Create an in-memory database (useful for unit testing).
    pub fn in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory().context("Failed to open in-memory SQLite DB")?;
        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
            db_path: None,
        };
        db.init_schema()?;
        Ok(db)
    }

    /// Initialize database schema.
    fn init_schema(&self) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Mutex poisoned: {}", e))?;

        // Enable WAL mode for better concurrency and performance
        let _ = conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;");

        conn.execute(
            "CREATE TABLE IF NOT EXISTS tool_outputs (
                tool_id TEXT PRIMARY KEY,
                session_id TEXT,
                agent_id TEXT NOT NULL,
                command TEXT,
                created_at INTEGER NOT NULL,
                byte_size INTEGER NOT NULL,
                is_compressed INTEGER NOT NULL,
                output BLOB NOT NULL
            );",
            [],
        )
        .context("Failed to create tool_outputs table")?;

        // Migration for existing tables created without session_id
        let has_session_id = {
            let mut stmt = conn.prepare("PRAGMA table_info(tool_outputs);")?;
            let mut rows = stmt.query([])?;
            let mut found = false;
            while let Some(row) = rows.next()? {
                let name: String = row.get(1)?;
                if name == "session_id" {
                    found = true;
                    break;
                }
            }
            found
        };
        if !has_session_id {
            conn.execute("ALTER TABLE tool_outputs ADD COLUMN session_id TEXT;", [])
                .context("Failed to add session_id column to tool_outputs")?;
        }

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_tool_outputs_created_at ON tool_outputs(created_at);",
            [],
        )
        .context("Failed to create idx_tool_outputs_created_at")?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_tool_outputs_agent_id ON tool_outputs(agent_id);",
            [],
        )
        .context("Failed to create idx_tool_outputs_agent_id")?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_tool_outputs_session_id ON tool_outputs(session_id);",
            [],
        )
        .context("Failed to create idx_tool_outputs_session_id")?;

        debug!("AcpDb schema initialized");
        Ok(())
    }

    /// Save tool output to database, compressed with zstd level 3.
    pub fn save_tool_output(
        &self,
        tool_id: &str,
        session_id: Option<&str>,
        agent_id: &str,
        command: Option<&str>,
        output: &str,
    ) -> Result<()> {
        let raw_bytes = output.as_bytes();
        let byte_size = raw_bytes.len() as i64;

        let (blob, is_compressed) = match zstd::encode_all(raw_bytes, COMPRESSION_LEVEL) {
            Ok(compressed) if compressed.len() < raw_bytes.len() => (compressed, 1),
            Ok(_) => (raw_bytes.to_vec(), 0),
            Err(e) => {
                warn!("zstd compression failed, storing raw: {}", e);
                (raw_bytes.to_vec(), 0)
            }
        };

        let now = Utc::now().timestamp();

        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Mutex poisoned: {}", e))?;

        conn.execute(
            "INSERT INTO tool_outputs (tool_id, session_id, agent_id, command, created_at, byte_size, is_compressed, output)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(tool_id) DO UPDATE SET
                session_id = excluded.session_id,
                command = excluded.command,
                created_at = excluded.created_at,
                byte_size = excluded.byte_size,
                is_compressed = excluded.is_compressed,
                output = excluded.output;",
            params![tool_id, session_id, agent_id, command, now, byte_size, is_compressed, blob],
        )
        .with_context(|| format!("Failed to save tool output for tool_id={}", tool_id))?;

        debug!(
            "Saved tool output for tool_id={} (session: {:?}, original: {} bytes, stored: {} bytes, compressed: {})",
            tool_id, session_id, byte_size, blob.len(), is_compressed == 1
        );

        Ok(())
    }

    /// Delete all tool outputs for a specific session.
    pub fn delete_session_outputs(&self, session_id: &str) -> Result<usize> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Mutex poisoned: {}", e))?;
        let count = conn.execute(
            "DELETE FROM tool_outputs WHERE session_id = ?1;",
            params![session_id],
        )?;
        Ok(count)
    }


    /// Retrieve full tool output from database, decompressing if necessary.
    pub fn get_tool_output(&self, tool_id: &str) -> Result<Option<String>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Mutex poisoned: {}", e))?;

        let mut stmt = conn
            .prepare("SELECT is_compressed, output FROM tool_outputs WHERE tool_id = ?1 LIMIT 1;")
            .context("Failed to prepare get_tool_output statement")?;

        let result = stmt
            .query_row(params![tool_id], |row| {
                let is_compressed: i32 = row.get(0)?;
                let output_blob: Vec<u8> = row.get(1)?;
                Ok((is_compressed, output_blob))
            })
            .optional()
            .with_context(|| format!("Failed to query tool output for tool_id={}", tool_id))?;

        match result {
            Some((1, blob)) => {
                let decompressed = zstd::decode_all(blob.as_slice())
                    .with_context(|| format!("Failed to decompress tool output for tool_id={}", tool_id))?;
                let text = String::from_utf8(decompressed)
                    .with_context(|| format!("Decompressed output is not valid UTF-8 for tool_id={}", tool_id))?;
                Ok(Some(text))
            }
            Some((0, blob)) => {
                let text = String::from_utf8(blob)
                    .with_context(|| format!("Raw output is not valid UTF-8 for tool_id={}", tool_id))?;
                Ok(Some(text))
            }
            Some(_) => unreachable!(),
            None => Ok(None),
        }
    }

    /// Delete outputs older than `max_age_secs` and limit total rows to `max_records`.
    pub fn cleanup_old_outputs(&self, max_age_secs: u64, max_records: usize) -> Result<usize> {
        let cutoff = Utc::now().timestamp() - (max_age_secs as i64);

        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Mutex poisoned: {}", e))?;

        let mut deleted_count = 0;

        // 1. Delete expired records
        let count = conn
            .execute(
                "DELETE FROM tool_outputs WHERE created_at < ?1;",
                params![cutoff],
            )
            .context("Failed to delete expired tool outputs")?;
        deleted_count += count;

        // 2. Keep at most max_records (LRU retention)
        let count = conn
            .execute(
                "DELETE FROM tool_outputs WHERE tool_id NOT IN (
                    SELECT tool_id FROM tool_outputs ORDER BY created_at DESC LIMIT ?1
                );",
                params![max_records as i64],
            )
            .context("Failed to enforce max_records in tool_outputs")?;
        deleted_count += count;

        if deleted_count > 0 {
            info!("Cleaned up {} old tool outputs from database", deleted_count);
        }

        Ok(deleted_count)
    }

    /// Delete all outputs associated with a specific agent session.
    pub fn delete_agent_outputs(&self, agent_id: &str) -> Result<usize> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Mutex poisoned: {}", e))?;

        let count = conn
            .execute(
                "DELETE FROM tool_outputs WHERE agent_id = ?1;",
                params![agent_id],
            )
            .with_context(|| format!("Failed to delete tool outputs for agent_id={}", agent_id))?;

        debug!("Deleted {} tool outputs for agent_id={}", count, agent_id);
        Ok(count)
    }

    /// Get database file path, if file-backed.
    pub fn db_path(&self) -> Option<&Path> {
        self.db_path.as_deref()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_save_and_retrieve_tool_output() {
        let db = AcpDb::in_memory().expect("in_memory DB should initialize");

        let sample_output = "RUN v4.1.2 /Users/max/dev/anycode\n✓ 4 passed\nAll tests passed!";
        db.save_tool_output("tool-123", Some("session-1"), "agent-1", Some("npm test"), sample_output)
            .expect("save should succeed");

        let fetched = db
            .get_tool_output("tool-123")
            .expect("get should succeed")
            .expect("should find tool output");

        assert_eq!(fetched, sample_output);
    }

    #[test]
    fn test_zstd_compression_on_large_output() {
        let db = AcpDb::in_memory().expect("in_memory DB should initialize");

        // Generate 1000 lines of repetitive test output
        let mut large_output = String::new();
        for i in 0..1000 {
            large_output.push_str(&format!("Line {}: Test suite execution passed successfully\n", i));
        }

        db.save_tool_output("tool-large", Some("session-1"), "agent-1", Some("cargo test"), &large_output)
            .expect("save should succeed");

        let fetched = db
            .get_tool_output("tool-large")
            .expect("get should succeed")
            .expect("should find tool output");

        assert_eq!(fetched, large_output);
    }

    #[test]
    fn test_cleanup_expired_and_lru() {
        let db = AcpDb::in_memory().expect("in_memory DB should initialize");

        for i in 0..10 {
            db.save_tool_output(&format!("tool-{}", i), Some("session-1"), "agent-1", None, "output")
                .unwrap();
        }

        // Keep only top 3 records
        let deleted = db.cleanup_old_outputs(3600, 3).expect("cleanup should succeed");
        assert_eq!(deleted, 7);

        // Verify remaining count is 3
        let conn = db.conn.lock().unwrap();
        let remaining: i64 = conn
            .query_row("SELECT COUNT(*) FROM tool_outputs;", [], |r| r.get(0))
            .unwrap();
        assert_eq!(remaining, 3);
    }

    #[test]
    fn test_delete_agent_outputs() {
        let db = AcpDb::in_memory().expect("in_memory DB should initialize");

        db.save_tool_output("tool-1", Some("sess-1"), "agent-A", None, "output A1").unwrap();
        db.save_tool_output("tool-2", Some("sess-1"), "agent-A", None, "output A2").unwrap();
        db.save_tool_output("tool-3", Some("sess-2"), "agent-B", None, "output B1").unwrap();

        let deleted = db.delete_agent_outputs("agent-A").unwrap();
        assert_eq!(deleted, 2);

        assert!(db.get_tool_output("tool-1").unwrap().is_none());
        assert!(db.get_tool_output("tool-3").unwrap().is_some());
    }

    #[test]
    fn test_delete_session_outputs() {
        let db = AcpDb::in_memory().expect("in_memory DB should initialize");

        db.save_tool_output("tool-1", Some("sess-1"), "agent-A", None, "output A1").unwrap();
        db.save_tool_output("tool-2", Some("sess-2"), "agent-A", None, "output A2").unwrap();

        let deleted = db.delete_session_outputs("sess-1").unwrap();
        assert_eq!(deleted, 1);

        assert!(db.get_tool_output("tool-1").unwrap().is_none());
        assert!(db.get_tool_output("tool-2").unwrap().is_some());
    }
}


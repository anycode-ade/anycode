use crate::config::Config;
use crate::history::History;
use crate::utils::{self};
use ropey::Rope;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{BufReader, BufWriter};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Operation {
    Insert,
    Remove,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Edit {
    pub start: usize, // UTF-16 offset
    pub text: String,
    pub operation: Operation,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Change {
    pub edits: Vec<Edit>,
    pub timestamp: usize,
}

impl Change {
    pub fn new() -> Self {
        Self {
            edits: Vec::new(),
            timestamp: 0,
        }
    }
}

use crate::utils::FileMeta;

pub struct Code {
    pub file_name: String,
    pub abs_path: String,
    pub lang: String,
    pub text: ropey::Rope,
    pub changed: bool,
    pub applying_history: bool,
    pub history: History,
    pub change: Change,
    pub self_updated: bool,
    pub file_meta: Option<FileMeta>,
    pub has_bom: bool,
}

impl Code {
    pub fn new() -> Self {
        Self {
            text: Rope::new(),
            file_name: String::new(),
            abs_path: String::new(),
            changed: false,
            lang: String::new(),
            applying_history: true,
            history: History::new(1000),
            change: Change::new(),
            self_updated: false,
            file_meta: None,
            has_bom: false,
        }
    }

    pub fn get_content(&self) -> String {
        self.text.to_string()
    }

    #[allow(dead_code)]
    pub fn from_str(text: &str) -> Self {
        let (content, has_bom) = if let Some(stripped) = text.strip_prefix('\u{feff}') {
            (stripped, true)
        } else {
            (text, false)
        };
        let mut code = Self::new();
        code.has_bom = has_bom;
        code.applying_history = false;
        code.insert_text(content, 0);
        code.applying_history = true;
        code
    }

    pub fn new_empty(path: &str, conf: &Config) -> Self {
        let mut code = Self::new();
        code.abs_path = utils::abs_file(path).unwrap_or_else(|_| path.to_string());
        code.file_name = utils::get_file_name(path);
        code.lang = detect_lang::from_path(path)
            .map(|lang| lang.id().to_lowercase())
            .unwrap_or_else(|| {
                conf.language
                    .iter()
                    .find(|l| l.types.iter().any(|t| path.ends_with(t)))
                    .map(|lang| lang.name.clone())
                    .unwrap_or_else(|| "text".to_string())
            });
        code
    }

    pub fn from_file(path: &str, conf: &Config) -> std::io::Result<Self> {
        let mut file = File::open(path)?;
        use std::io::{Read, Seek, SeekFrom};
        let mut bom = [0u8; 3];
        let mut has_bom = false;
        let text = if file.read_exact(&mut bom).is_ok() && bom == [0xEF, 0xBB, 0xBF] {
            has_bom = true;
            Rope::from_reader(BufReader::new(file))?
        } else {
            file.seek(SeekFrom::Start(0))?;
            Rope::from_reader(BufReader::new(file))?
        };
        let abs_path =
            utils::abs_file(path).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        let file_name = utils::get_file_name(path);

        let lang = detect_lang::from_path(path)
            .map(|lang| lang.id().to_lowercase())
            .unwrap_or_else(|| {
                conf.language
                    .iter()
                    .find(|l| l.types.iter().any(|t| path.ends_with(t)))
                    .map(|lang| lang.name.clone())
                    .unwrap_or_else(|| "text".to_string())
            });

        let file_meta = FileMeta::query(std::path::Path::new(&abs_path));

        Ok(Self {
            text,
            file_name,
            abs_path,
            changed: false,
            lang,
            applying_history: true,
            history: History::new(1000),
            change: Change::new(),
            self_updated: false,
            file_meta,
            has_bom,
        })
    }

    pub fn save_file(&mut self) -> std::io::Result<()> {
        if !self.changed {
            return Ok(());
        }

        let path = std::path::Path::new(&self.abs_path);
        if let Some(parent) = path.parent() {
            if !parent.exists() {
                std::fs::create_dir_all(parent)?;
            }
        }

        let parent = path.parent().unwrap_or_else(|| std::path::Path::new("."));

        // Attempt atomic save via a temporary file in the same directory to avoid partial writes
        // and handle Windows transient sharing violations with retry backoff.
        let atomic_result = (|| -> std::io::Result<()> {
            let mut temp_file = tempfile::Builder::new()
                .prefix(".anycode_")
                .suffix(".anycode_tmp")
                .tempfile_in(parent)?;

            {
                let mut writer = BufWriter::new(&mut temp_file);
                use std::io::Write;
                if self.has_bom {
                    writer.write_all(b"\xef\xbb\xbf")?;
                }
                self.text.write_to(&mut writer)?;
                writer.flush()?;
            }

            if let Ok(metadata) = std::fs::metadata(path) {
                let _ = temp_file.as_file().set_permissions(metadata.permissions());
            }

            let mut attempts = 0;
            loop {
                match temp_file.persist(path) {
                    Ok(_) => return Ok(()),
                    Err(err) => {
                        attempts += 1;
                        if attempts >= 5 {
                            return Err(err.error);
                        }
                        std::thread::sleep(std::time::Duration::from_millis(15 * attempts as u64));
                        temp_file = err.file;
                    }
                }
            }
        })();

        // Fallback to direct write if atomic tempfile creation/persistence fails
        if atomic_result.is_err() {
            let file = File::create(&self.abs_path)?;
            let mut writer = BufWriter::new(file);
            use std::io::Write;
            if self.has_bom {
                writer.write_all(b"\xef\xbb\xbf")?;
            }
            self.text.write_to(&mut writer)?;
            writer.flush()?;
            drop(writer);
        }

        self.changed = false;
        self.self_updated = true;
        self.file_meta = FileMeta::query(std::path::Path::new(&self.abs_path));
        Ok(())
    }

    #[allow(dead_code)]
    pub fn set_file_name(&mut self, file_name: String) {
        self.file_name = file_name;
    }

    #[allow(dead_code)]
    pub fn position(&self, offset: usize) -> (usize, usize) {
        let line_idx = self.text.char_to_line(offset);
        let line_char_index = self.text.line_to_char(line_idx);
        (line_idx, offset - line_char_index)
    }

    pub fn utf16_to_char_offset(&self, utf16_offset: usize) -> usize {
        self.text.utf16_cu_to_char(utf16_offset)
    }

    #[allow(dead_code)]
    pub fn char_to_utf16_offset(&self, char_offset: usize) -> usize {
        self.text.char_to_utf16_cu(char_offset)
    }

    pub fn char_to_position(&self, char_offset: usize) -> (usize, usize) {
        let line_idx = self.text.char_to_line(char_offset);
        let line_char_start = self.text.line_to_char(line_idx);
        let abs_utf16_cu_at_pos = self.text.char_to_utf16_cu(char_offset);
        let abs_utf16_cu_at_line = self.text.char_to_utf16_cu(line_char_start);
        (line_idx, abs_utf16_cu_at_pos - abs_utf16_cu_at_line)
    }

    fn insert(&mut self, text: &str, from: usize) {
        self.text.insert(from, text);
        self.changed = true;
    }

    pub fn insert_text(&mut self, text: &str, offset: usize) {
        self.insert(text, offset);

        if self.applying_history {
            self.change.edits.push(Edit {
                start: offset,
                text: text.to_string(),
                operation: Operation::Insert,
            });
        }
    }

    fn remove(&mut self, from: usize, to: usize) {
        self.text.remove(from..to);
        self.changed = true;
    }

    pub fn remove_text(&mut self, from: usize, to: usize) {
        let text = self.text.slice(from..to).to_string();

        self.remove(from, to);

        if self.applying_history {
            self.change.edits.push(Edit {
                start: from,
                text: text.to_string(),
                operation: Operation::Remove,
            });
        }
    }

    pub fn tx(&mut self) {
        self.change = Change::new();
        self.applying_history = true;
    }

    pub fn commit(&mut self) {
        if !self.change.edits.is_empty() {
            self.history.push(self.change.clone());
            self.change = Change::new();
        }
    }

    pub fn undo_change(&mut self) -> Option<Change> {
        self.history.undo()
    }

    pub fn redo_change(&mut self) -> Option<Change> {
        self.history.redo()
    }
}

#[cfg(test)]
mod code_undo_tests {
    use super::*;

    #[test]
    fn test_code_empty() {
        let buffer = Code::new();
        assert_eq!(buffer.text.to_string(), "");
    }

    #[test]
    fn test_code_from_str() {
        let buffer = Code::from_str("hello");
        assert_eq!(buffer.text.to_string(), "hello");
    }

    #[test]
    fn test_code_insert() {
        let mut buffer = Code::new();
        buffer.insert_text("hello", 0);
        buffer.insert_text(" world", 5);
        assert_eq!(buffer.text.to_string(), "hello world");
    }

    #[test]
    fn test_code_remove() {
        let mut buffer = Code::new();

        buffer.insert_text("hello world", 0);
        assert_eq!(buffer.text.to_string(), "hello world");

        buffer.remove_text(5, 11);
        assert_eq!(buffer.text.to_string(), "hello");
    }

    #[test]
    fn test_code_char_at_end() {
        let text = "console.log(\"Hello, World!\")";
        let buffer = Code::from_str(text);
        assert_eq!(buffer.char_to_position(0), (0, 0));
        assert_eq!(buffer.char_to_position(text.len()), (0, text.len()));
    }

    #[test]
    fn test_undo() {
        let mut code = Code::new();

        code.tx();
        code.insert_text("Hello ", 0);
        code.commit();

        code.tx();
        code.insert_text("World", 6);
        code.commit();

        assert_eq!(code.get_content().to_string(), "Hello World");
        assert_eq!(code.history.index, 2);

        let batch = code.undo_change().expect("undo should return batch");
        assert_eq!(code.history.index, 1);
        assert_eq!(
            batch.edits[0],
            Edit {
                start: 6,
                text: "World".to_string(),
                operation: Operation::Insert
            }
        );

        let batch = code.undo_change().expect("undo should return batch");
        assert_eq!(code.history.index, 0);
        assert_eq!(
            batch.edits[0],
            Edit {
                start: 0,
                text: "Hello ".to_string(),
                operation: Operation::Insert
            }
        );

        assert!(code.undo_change().is_none());
    }

    #[test]
    fn test_redo() {
        let mut code = Code::new();

        code.tx();
        code.insert_text("Hello", 0);
        code.commit();

        assert_eq!(code.history.index, 1);

        let batch = code.undo_change().expect("undo should return batch");
        assert_eq!(code.history.index, 0);
        assert_eq!(
            batch.edits[0],
            Edit {
                start: 0,
                text: "Hello".to_string(),
                operation: Operation::Insert
            }
        );

        let batch = code.redo_change().expect("redo should return batch");
        assert_eq!(code.history.index, 1);
        assert_eq!(
            batch.edits[0],
            Edit {
                start: 0,
                text: "Hello".to_string(),
                operation: Operation::Insert
            }
        );

        let batch = code.redo_change();
        assert!(batch.is_none());
    }

    #[test]
    fn test_code_from_str_with_bom() {
        let text_with_bom = "\u{feff}<Project Sdk=\"Microsoft.NET.Sdk\">";
        let code = Code::from_str(text_with_bom);
        assert!(code.has_bom);
        assert_eq!(code.get_content(), "<Project Sdk=\"Microsoft.NET.Sdk\">");
        assert_eq!(code.text.len_chars(), 33);
    }

    #[test]
    fn test_code_from_file_with_bom_and_save() -> std::io::Result<()> {
        let temp_dir = tempfile::tempdir()?;
        let file_path = temp_dir.path().join("Project.csproj");
        let initial_content = b"\xef\xbb\xbf<ItemGroup>\n  <PackageReference Include=\"Google.Protobuf\" />\n</ItemGroup>\n";
        std::fs::write(&file_path, initial_content)?;

        let config = Config::default();
        let mut code = Code::from_file(file_path.to_str().unwrap(), &config)?;
        assert!(code.has_bom, "Code must detect UTF-8 BOM");

        // The text must NOT contain the BOM character
        assert_eq!(
            code.get_content(),
            "<ItemGroup>\n  <PackageReference Include=\"Google.Protobuf\" />\n</ItemGroup>\n"
        );

        // Edit at frontend coordinates (e.g. inserting Version attribute)
        // Find offset of ' />' in content without BOM
        let content = code.get_content();
        let offset = content.find(" />").unwrap();
        assert_eq!(offset, 57);

        code.insert_text(" Version=\"3.30.2\"", offset);
        code.save_file()?;

        // Verify the saved file on disk starts with BOM bytes and has correct content
        let saved_bytes = std::fs::read(&file_path)?;
        assert_eq!(
            &saved_bytes[..3],
            b"\xef\xbb\xbf",
            "Saved file must preserve BOM bytes on disk"
        );

        let saved_text = std::str::from_utf8(&saved_bytes).unwrap();
        assert_eq!(
            saved_text,
            "\u{feff}<ItemGroup>\n  <PackageReference Include=\"Google.Protobuf\" Version=\"3.30.2\" />\n</ItemGroup>\n"
        );

        Ok(())
    }

    #[test]
    fn test_atomic_save_leaves_no_temp_files() -> std::io::Result<()> {
        let temp_dir = tempfile::tempdir()?;
        let file_path = temp_dir.path().join("atomic_test.txt");
        std::fs::write(&file_path, "initial content")?;

        let config = Config::default();
        let mut code = Code::from_file(file_path.to_str().unwrap(), &config)?;
        code.insert_text(" updated", 15);
        code.save_file()?;

        assert_eq!(std::fs::read_to_string(&file_path)?, "initial content updated");

        // Verify no leftover .anycode_tmp files in parent dir
        let temp_files: Vec<_> = std::fs::read_dir(temp_dir.path())?
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".anycode_tmp"))
            .collect();
        assert!(temp_files.is_empty(), "No temporary atomic files should remain");

        Ok(())
    }
}

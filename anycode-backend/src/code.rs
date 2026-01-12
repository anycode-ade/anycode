use ropey::Rope;
use std::fs::File;
use std::io::{BufReader, BufWriter};
use crate::config::{Config};
use crate::utils::{self};
use serde::{Deserialize, Serialize};
use crate::history::History;

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
        }
    }

    pub fn get_content(&self) -> String {
        self.text.to_string()
    }

    pub fn from_str(text: &str) -> Self {
        let mut code = Self::new();
        code.applying_history = false;
        code.insert_text(text, 0);
        code.applying_history = true;
        code
    }

    pub fn from_file(path: &str, conf: &Config) -> std::io::Result<Self> {
        let file = File::open(path)?;
        let text = Rope::from_reader(BufReader::new(file))?;
        let abs_path = utils::abs_file(path)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        let file_name = utils::get_file_name(path);

        let lang = detect_lang::from_path(path)
            .map(|lang| lang.id().to_lowercase())
            .unwrap_or_else(|| {
                conf.language.iter()
                    .find(|l| l.types.iter().any(|t| path.ends_with(t)))
                    .map(|lang| lang.name.clone())
                    .unwrap_or_else(|| "text".to_string())
            });

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
        })
    }

    pub fn save_file(&mut self) -> std::io::Result<()> {
        if !self.changed {
            return Ok(());
        }

        let file = File::create(&self.abs_path)?;
        let saved = self.text.write_to(BufWriter::new(file));
        self.changed = false;
        self.self_updated = true;
        saved
    }

    pub fn set_file_name(&mut self, file_name: String) {
        self.file_name = file_name;
    }

    pub fn position(&self, offset: usize) -> (usize, usize) {
        let line_idx = self.text.char_to_line(offset);
        let line_char_index = self.text.line_to_char(line_idx);
        (line_idx, offset - line_char_index)
    }

    pub fn utf16_to_char_offset(&self, utf16_offset: usize) -> usize {
        self.text.utf16_cu_to_char(utf16_offset)
    }

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
                start: offset, text: text.to_string(), operation: Operation::Insert,
            });
        }
    }

    fn remove(&mut self, from: usize, to: usize)  {
        self.text.remove(from..to);
        self.changed = true;
    }

    pub fn remove_text(&mut self, from: usize, to: usize) {
        let text = self.text.slice(from..to).to_string();

        self.remove(from, to);

        if self.applying_history {
            self.change.edits.push(Edit {
                start: from, text: text.to_string(), operation: Operation::Remove,
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
        assert_eq!(batch.edits[0], Edit {
            start: 6, text: "World".to_string(), operation: Operation::Insert 
        });

        let batch = code.undo_change().expect("undo should return batch");
        assert_eq!(code.history.index, 0);
        assert_eq!(batch.edits[0], Edit {
            start: 0, text: "Hello ".to_string(), operation: Operation::Insert 
        });

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
        assert_eq!(batch.edits[0], Edit { 
            start: 0, text: "Hello".to_string(), operation: Operation::Insert 
        });

        let batch = code.redo_change().expect("redo should return batch");
        assert_eq!(code.history.index, 1);
        assert_eq!(batch.edits[0], Edit { 
            start: 0, text: "Hello".to_string(), operation: Operation::Insert 
        });

        let batch = code.redo_change();
        assert!(batch.is_none());
    }
}
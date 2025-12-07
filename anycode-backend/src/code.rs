use ropey::Rope;
use std::fs;
use std::fs::File;
use std::io::{BufReader, BufWriter};
use std::path::Path;

use crate::config::{Config};
use crate::utils::{self};
use log2::*;

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum Operation {
    Insert,
    Remove,
    Start,
    End,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Change {
    pub start: usize,
    pub operation: Operation,
    pub text: String,
}

pub struct Code {
    pub file_name: String,
    pub abs_path: String,
    pub lang: String,
    pub text: ropey::Rope,
    pub changed: bool,
    pub undo_history: Vec<Change>,
    pub redo_history: Vec<Change>,
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
            undo_history: Vec::new(),
            redo_history: Vec::new(),
            self_updated: false,
        }
    }

    pub fn from_str(text: &str) -> Self {
        let mut code = Self::new();
        code.insert_text(text, 0, 0);
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
            undo_history: Vec::new(),
            redo_history: Vec::new(),
            self_updated: false,
        })
    }


    pub fn set_text(&mut self, text: &str) {
        self.text = Rope::new();
        self.text.insert(0, text);
        self.changed = true;
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

    pub fn ensure_file_exists(&mut self) -> std::io::Result<()> {
        if !Path::new(&self.file_name).exists() {
            fs::create_dir_all(Path::new(&self.file_name).parent().unwrap())?;
            fs::File::create(&self.file_name)?;

            self.abs_path = utils::abs_file(&self.file_name)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;       
        }
        Ok(())
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

    pub fn insert_text(&mut self, text: &str, row: usize, column: usize) {
        let from = self.text.line_to_char(row) + column;
        self.insert(text, from);

        self.undo_history.push(Change {
            start: from,
            operation: Operation::Insert,
            text: text.to_string(),
        });

        self.redo_history.clear();
    }

    pub fn insert_text_at(&mut self, text: &str, offset: usize) {
        self.insert(text, offset);

        self.undo_history.push(Change {
            start: offset,
            operation: Operation::Insert,
            text: text.to_string(),
        });

        self.redo_history.clear();
    }

    fn remove(&mut self, from: usize, to: usize)  {
        self.text.remove(from..to);
        self.changed = true;
    }

    pub fn remove_text(&mut self, row: usize, col: usize, row1: usize, col1: usize) {
        let from = self.text.line_to_char(row) + col;
        let to = self.text.line_to_char(row1) + col1;
        let text = self.text.slice(from..to).to_string();

        self.remove(from, to);

        self.undo_history.push(Change {
            start: from,
            operation: Operation::Remove,
            text: text.to_string(),
        });

        self.redo_history.clear();
    }

    pub fn remove_text2(&mut self, from: usize, to: usize) {
        let text = self.text.slice(from..to).to_string();

        self.remove(from, to);

        self.undo_history.push(Change {
            start: from,
            operation: Operation::Remove,
            text: text.to_string(),
        });

        self.redo_history.clear();
    }


    pub fn line_len(&self, idx: usize) -> usize {
        let line = self.text.line(idx);
        let len = line.len_chars();
        if idx == self.text.len_lines() - 1 {
            len
        } else {
            len.saturating_sub(1)
        }
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
        buffer.insert_text("hello", 0, 0);
        buffer.insert_text(" world", 0, 5);
        assert_eq!(buffer.text.to_string(), "hello world");
    }

    #[test]
    fn test_code_remove() {
        let mut buffer = Code::new();
        
        buffer.insert_text("hello world", 0, 0);
        assert_eq!(buffer.text.to_string(), "hello world");
    
        buffer.remove_text(0, 5, 0, 11);
        assert_eq!(buffer.text.to_string(), "hello");
    }

    #[test]
    fn test_code_char_at_end() {
        let text = "console.log(\"Hello, World!\")";
        let buffer = Code::from_str(text);
        assert_eq!(buffer.char_to_position(0), (0, 0));
        assert_eq!(buffer.char_to_position(text.len()), (0, text.len()));
    }
}
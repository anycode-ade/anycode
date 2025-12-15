use unicode_segmentation::UnicodeSegmentation;
use similar::{Algorithm, ChangeTag};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Operation {
    Insert,
    Delete,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Edit {
    pub start: usize, // UTF-16 offset
    pub text: String,
    pub operation: Operation,
}

/// Calculate text edits with offsets in UTF-16 code units
pub fn compute_text_edits(old: &str, new: &str) -> Vec<Edit> {
    // Split into graphemes
    let old_gr: Vec<&str> = old.graphemes(true).collect();
    let new_gr: Vec<&str> = new.graphemes(true).collect();

    // Diff by graphemes
    let changes = similar::utils::diff_slices(Algorithm::Myers, &old_gr, &new_gr);

    let mut edits = Vec::new();
    let mut utf16_offset = 0usize; // position in UTF-16 units

    for (tag, slice) in changes {
        match tag {
            ChangeTag::Equal => {
                // Calculate UTF-16 length of each grapheme
                for g in slice {
                    utf16_offset += g.encode_utf16().count();
                }
            }
            ChangeTag::Delete => {
                // Combine graphemes into text
                let text = slice.concat();
                edits.push(Edit {
                    start: utf16_offset,
                    text: text.clone(),
                    operation: Operation::Delete,
                });
                // Deletion does not move offset forward
            }
            ChangeTag::Insert => {
                let text = slice.concat();
                edits.push(Edit {
                    start: utf16_offset,
                    text: text.clone(),
                    operation: Operation::Insert,
                });
                // Insertion moves offset forward
                for g in slice {
                    utf16_offset += g.encode_utf16().count();
                }
            }
        }
    }

    edits
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_edits_simple() {
        let before = "let mut foo = 2;\nfoo *= 50;";
        let after =  "let mut foo = 5;\naaaa foo *= 50;";

        let edits = compute_text_edits(before, after);

        assert_eq!(
            edits,
            vec![
                Edit { start: 14, text: "2".to_string(), operation: Operation::Delete },
                Edit { start: 14, text: "5".to_string(), operation: Operation::Insert },
                Edit { start: 17, text: "aaaa ".to_string(), operation: Operation::Insert },
            ]
        );
    }

    #[test]
    fn test_compute_edits_simple2() {
        let before = r#"println!("Current value: {}", );"#;
        let after =  r#"println!("Current value: {}", i);"#;

        let edits = compute_text_edits(before, after);

        assert_eq!(edits, vec![
            Edit { start: 30, text: "i".to_string(), operation: Operation::Insert },
        ])
    }

    #[test]
    fn test_compute_edits_simple3() {
        let before = r#"test"#;
        let after =  r#"print()"#;

        let edits = compute_text_edits(before, after);

        assert_eq!(edits, vec![
            Edit { start: 0, text: "tes".to_string(), operation: Operation::Delete },
            Edit { start: 0, text: "prin".to_string(), operation: Operation::Insert },
            Edit { start: 5, text: "()".to_string(), operation: Operation::Insert },
        ])
    }

    #[test]
    fn test_compute_edits_simple4() {
        let before = r#"print()"#;
        let after =  r#"hi"#;

        let edits = compute_text_edits(before, after);

        assert_eq!(edits, vec![
            Edit { start: 0, text: "pr".to_string(), operation: Operation::Delete },
            Edit { start: 0, text: "h".to_string(), operation: Operation::Insert },
            Edit { start: 2, text: "nt()".to_string(), operation: Operation::Delete },
        ])
    }

    #[test]
    fn test_compute_edits_simple5() {
        let before = "hello world and universe";
        let after  = "hello Rust and galaxy";
        
        let edits = compute_text_edits(before, after);
        for e in &edits {
            println!("{:?}", e);
        }
    }

    #[test]
    fn test_compute_edits_simple6() {
        let before = r#"print()"#;
        let after =  r#"hi"#;

        let edits = compute_text_edits(before, after);

        assert_eq!(edits, vec![
            Edit { start: 0, text: "pr".to_string(), operation: Operation::Delete },
            Edit { start: 0, text: "h".to_string(), operation: Operation::Insert },
            Edit { start: 2, text: "nt()".to_string(), operation: Operation::Delete },
        ])
    }

    #[test]
    fn test_compute_edits_unicode() {
        let before = r#"println!("Current значение: {}", i);"#;
        let after =  r#"println!("Current value: {}", i);"#;

        let edits = compute_text_edits(before, after);

        assert_eq!(edits, vec![
            Edit { start: 18, text: "значение".to_string(), operation: Operation::Delete },
            Edit { start: 18, text: "value".to_string(), operation: Operation::Insert },
        ])
    }

    #[test]
    fn test_compute_edits_unicod2() {
        let before = r#"println!("Current значение: {}", i);"#;
        let after =  r#"println!("Current значение: {}", иии);"#;

        let edits = compute_text_edits(before, after);

        assert_eq!(edits, vec![
            Edit { start: 33, text: "i".to_string(), operation: Operation::Delete },
            Edit { start: 33, text: "иии".to_string(), operation: Operation::Insert },
        ])
    }
}
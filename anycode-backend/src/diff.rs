use similar::{ChangeTag, Algorithm};
use similar::utils::diff_chars;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Operation {
    Insert,
    Delete,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Edit {
    pub start: usize,
    pub text: String,
    pub operation: Operation,
}

pub fn compute_text_edits(old: &str, new: &str) -> Vec<Edit> {
    let mut edits = Vec::new();
    let mut old_offset = 0usize;
    let mut offset_correction: isize = 0;

    let changes = diff_chars(Algorithm::Myers, old, new);

    for (tag, text) in changes {
        match tag {
            ChangeTag::Equal => {
                old_offset += text.len();
            }
            ChangeTag::Delete => {
                edits.push(Edit {
                    start: (old_offset as isize + offset_correction) as usize,
                    text: text.to_string(),
                    operation: Operation::Delete,
                });
                old_offset += text.len();
                offset_correction -= text.len() as isize;
            }
            ChangeTag::Insert => {
                edits.push(Edit {
                    start: (old_offset as isize + offset_correction) as usize,
                    text: text.to_string(),
                    operation: Operation::Insert,
                });
                offset_correction += text.len() as isize;
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
}
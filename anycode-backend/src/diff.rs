use similar::{ChangeTag, TextDiff};
use crate::utils::offset_to_byte;
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
    pub end: usize,
    pub text: String,
    pub operation: Operation,
}

pub fn compute_text_edits(old: &str, new: &str) -> Vec<Edit> {
    let diff = TextDiff::from_chars(old, new);
    let mut edits: Vec<Edit> = Vec::new();

    let mut old_pos_chars = 0;

    for change in diff.iter_all_changes() {
        let value = change.value();
        let value_char_len = value.chars().count();

        match change.tag() {
            ChangeTag::Equal => {
                old_pos_chars += value_char_len;
            }
            ChangeTag::Delete => {
                let start = old_pos_chars;
                let end = start + value_char_len;

                if let Some(last_edit) = edits.last_mut() {
                    if last_edit.end == start && last_edit.text.is_empty() {
                        last_edit.end = end;
                    } else {
                        edits.push(Edit {
                            start,
                            end,
                            text: String::new(),
                            operation: Operation::Delete,
                        });
                    }
                } else {
                    edits.push(Edit {
                        start,
                        end,
                        text: String::new(),
                        operation: Operation::Delete,
                    });
                }

                old_pos_chars = end;
            }
            ChangeTag::Insert => {
                if let Some(last_edit) = edits.last_mut() {
                    if last_edit.end == old_pos_chars {
                        last_edit.text.push_str(value);
                    } else {
                        edits.push(Edit {
                            start: old_pos_chars,
                            end: old_pos_chars,
                            text: value.to_string(),
                            operation: Operation::Insert,
                        });
                    }
                } else {
                    edits.push(Edit {
                        start: old_pos_chars,
                        end: old_pos_chars,
                        text: value.to_string(),
                        operation: Operation::Insert,
                    });
                }
            }
        }
    }

    let mut result = edits.iter()
        .flat_map(split_replace_edit)
        .collect::<Vec<_>>();

    for edit in &mut result {
        if edit.start != edit.end && edit.operation == Operation::Delete {
            let byte_start = offset_to_byte(edit.start, old);
            let byte_end = offset_to_byte(edit.end, old);

            if byte_start <= old.len() && byte_end <= old.len() {
                edit.text = old[byte_start..byte_end].to_string();
            }
        }
    }

    result
}

fn split_replace_edit(edit: &Edit) -> Vec<Edit> {
    if edit.start == edit.end || edit.text.is_empty() {
        vec![edit.clone()]
    } else {
        vec![
            Edit {
                start: edit.start,
                end: edit.end,
                text: String::new(),
                operation: Operation::Delete,
            },
            Edit {
                start: edit.start,
                end: edit.start,
                text: edit.text.clone(),
                operation: Operation::Insert,
            },
        ]
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChangedRange {
    pub start: usize,
    pub end: usize,
    pub kind: ChangedRangeKind,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChangedRangeKind {
    Insert,
    Delete,
}

pub fn compute_changed_ranges_normalized(edits: &[Edit]) -> Vec<ChangedRange> {
    // Sort edits by their start offset
    let mut sorted_edits = edits.to_vec();
    sorted_edits.sort_by_key(|e| e.start);

    let mut changed_ranges = Vec::new();
    let mut offset_shift: usize = 0;

    for edit in sorted_edits.iter() {
        let offset = edit.start;
        match edit.operation {
            Operation::Insert => {
                let start = offset + offset_shift;
                let end = start + edit.text.chars().count();
                changed_ranges.push(ChangedRange {
                    start,
                    end,
                    kind: ChangedRangeKind::Insert,
                });
                offset_shift += edit.text.chars().count();
            }
            Operation::Delete => {
                let start = offset + offset_shift;
                let removed_len = edit.text.chars().count();
                let end = start + removed_len;
                changed_ranges.push(ChangedRange {
                    start,
                    end,
                    kind: ChangedRangeKind::Delete,
                });
                offset_shift = offset_shift.saturating_sub(removed_len);
            }
        }
    }

    changed_ranges
}

pub fn diff_without_unchanged(old: &str, new: &str) -> String {
    let diff = TextDiff::configure()
        .algorithm(similar::Algorithm::Myers)
        .diff_lines(old, new);

    let mut result = String::new();

    for change in diff.iter_all_changes() {
        match change.tag() {
            ChangeTag::Delete => result.push_str(&format!("-{}", change)),
            ChangeTag::Insert => result.push_str(&format!("+{}", change)),
            ChangeTag::Equal => {} 
        }
    }

    result
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
                Edit { start: 14, end: 15, text: "2".to_string(), operation: Operation::Delete },
                Edit { start: 14, end: 14, text: "5".to_string(), operation: Operation::Insert },
                Edit { start: 17, end: 17, text: "aaaa ".to_string(), operation: Operation::Insert },
            ]
        );
    }

    #[test]
    fn test_compute_edits_simple2() {
        let before = r#"println!("Current value: {}", );"#;
        let after =  r#"println!("Current value: {}", i);"#;

        let edits = compute_text_edits(before, after);

        assert_eq!(edits, vec![
            Edit { start: 30, end: 30, text: "i".to_string(), operation: Operation::Insert },
        ])
    }

    #[test]
    fn test_compute_edits_unicode() {
        let before = r#"println!("Current значение: {}", i);"#;
        let after =  r#"println!("Current value: {}", i);"#;

        let edits = compute_text_edits(before, after);

        assert_eq!(edits, vec![
            Edit { start: 18, end: 18 + 8, text: "значение".to_string(), operation: Operation::Delete },
            Edit { start: 18, end: 18, text: "value".to_string(), operation: Operation::Insert },
        ])
    }

    #[test]
    fn test_compute_changed_ranges_normalized() {
        let before = r#"println!("Current value: {}", );"#;
        let after =  r#"println!("Current value: {}", i);"#;
    
        let edits = compute_text_edits(before, after);
        let changed_ranges = compute_changed_ranges_normalized(&edits);
        
        assert_eq!(edits, vec![
            Edit { start: 30, end: 30, text: "i".to_string(), operation: Operation::Insert },
        ]);
        assert_eq!(changed_ranges, vec![
            ChangedRange { start: 30, end: 31, kind: ChangedRangeKind::Insert },
        ]);
    }


    #[test]
    fn test_compute_changed_ranges_normalized_unicode() {
        let before = r#"println!("Current value: {}", i);"#;
        let after =  r#"println!("Current значение: {}", i);"#;

        let edits = compute_text_edits(before, after);
        let changed_ranges = compute_changed_ranges_normalized(&edits);

        assert_eq!(edits, vec![
            Edit { start: 18, end: 23, text: "value".to_string(), operation: Operation::Delete },
            Edit { start: 18, end: 18, text: "значение".to_string(), operation: Operation::Insert },
        ]);
        assert_eq!(changed_ranges, vec![
            ChangedRange { start: 18, end: 23, kind: ChangedRangeKind::Delete },
            ChangedRange { start: 18, end: 26, kind: ChangedRangeKind::Insert },
        ]);
    }
}
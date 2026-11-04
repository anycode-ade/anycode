/// Strips single-line (`//`) and multi-line (`/* */`) comments from a JSON string,
/// and trailing commas before `}` or `]`, while preserving string literals and escapes.
pub fn strip_jsonc_comments(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let chars: Vec<char> = input.chars().collect();
    let len = chars.len();
    let mut i = 0;

    let mut in_string = false;
    let mut escaped = false;

    while i < len {
        let ch = chars[i];

        if in_string {
            output.push(ch);
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            i += 1;
            continue;
        }

        // Not in string
        if ch == '"' {
            in_string = true;
            output.push(ch);
            i += 1;
            continue;
        }

        // Check for line comment //
        if ch == '/' && i + 1 < len && chars[i + 1] == '/' {
            i += 2;
            while i < len && chars[i] != '\n' && chars[i] != '\r' {
                i += 1;
            }
            continue;
        }

        // Check for block comment /* */
        if ch == '/' && i + 1 < len && chars[i + 1] == '*' {
            i += 2;
            while i + 1 < len && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            if i + 1 < len {
                i += 2; // skip */
            } else {
                i = len;
            }
            continue;
        }

        // Check for trailing comma before } or ]
        if ch == ',' {
            // Peek ahead to find next non-whitespace / non-comment char
            let mut j = i + 1;
            let mut is_trailing = false;
            while j < len {
                let next_ch = chars[j];
                if next_ch.is_whitespace() {
                    j += 1;
                } else if next_ch == '/' && j + 1 < len && chars[j + 1] == '/' {
                    // skip line comment
                    j += 2;
                    while j < len && chars[j] != '\n' && chars[j] != '\r' {
                        j += 1;
                    }
                } else if next_ch == '/' && j + 1 < len && chars[j + 1] == '*' {
                    // skip block comment
                    j += 2;
                    while j + 1 < len && !(chars[j] == '*' && chars[j + 1] == '/') {
                        j += 1;
                    }
                    if j + 1 < len {
                        j += 2;
                    } else {
                        j = len;
                    }
                } else {
                    if next_ch == '}' || next_ch == ']' {
                        is_trailing = true;
                    }
                    break;
                }
            }

            if is_trailing {
                // Skip the comma!
                i += 1;
                continue;
            }
        }

        output.push(ch);
        i += 1;
    }

    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_comments_and_trailing_commas() {
        let input = r##"
        {
            // This is a line comment
            "name": "dracula", /* block comment */
            "colors": {
                "editor.background": "#282a36",
                "editor.foreground": "#f8f8f2", // another comment
            },
            "tokens": [
                "a",
                "b", // comment here
            ],
        }
        "##;

        let stripped = strip_jsonc_comments(input);
        let val: serde_json::Value = serde_json::from_str(&stripped).expect("valid json");
        assert_eq!(val["name"], "dracula");
        assert_eq!(val["colors"]["editor.background"], "#282a36");
        assert_eq!(val["tokens"].as_array().unwrap().len(), 2);
    }
}

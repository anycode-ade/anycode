import type { Lang } from "../lang";

const query = `
(setext_heading
  (paragraph) @type
  [(setext_h1_underline) (setext_h2_underline)] @punctuation.special)

(atx_heading) @type
[
  (atx_h1_marker)
  (atx_h2_marker)
  (atx_h3_marker)
  (atx_h4_marker)
  (atx_h5_marker)
  (atx_h6_marker)
] @punctuation.special

(info_string) @type
(indented_code_block) @string
(fenced_code_block) @string
(fenced_code_block_delimiter) @punctuation.special

[
  (link_destination)
  (link_title)
  (link_label)
] @string.special

[
  (list_marker_plus)
  (list_marker_minus)
  (list_marker_star)
  (list_marker_dot)
  (list_marker_parenthesis)
  (task_list_marker_unchecked)
  (task_list_marker_checked)
] @punctuation.special

(thematic_break) @punctuation.special
(block_quote) @comment
(block_quote_marker) @punctuation.special
(backslash_escape) @string.escape

((html_block) @injection.content.html)

([
  (inline)
  (pipe_table_cell)
] @injection.content.markdown_inline)

(fenced_code_block
  (info_string (language) @_language)
  (code_fence_content) @injection.content.javascript
  (#any-of? @_language "js" "jsx" "javascript"))

(fenced_code_block
  (info_string (language) @_language)
  (code_fence_content) @injection.content.typescript
  (#any-of? @_language "ts" "tsx" "typescript"))

(fenced_code_block
  (info_string (language) @_language)
  (code_fence_content) @injection.content.python
  (#any-of? @_language "py" "python"))

(fenced_code_block
  (info_string (language) @_language)
  (code_fence_content) @injection.content.rust
  (#eq? @_language "rust"))

(fenced_code_block
  (info_string (language) @_language)
  (code_fence_content) @injection.content.bash
  (#any-of? @_language "bash" "sh" "shell"))

(fenced_code_block
  (info_string (language) @_language)
  (code_fence_content) @injection.content.json
  (#eq? @_language "json"))

(fenced_code_block
  (info_string (language) @_language)
  (code_fence_content) @injection.content.yaml
  (#any-of? @_language "yaml" "yml"))

(fenced_code_block
  (info_string (language) @_language)
  (code_fence_content) @injection.content.html
  (#eq? @_language "html"))

(fenced_code_block
  (info_string (language) @_language)
  (code_fence_content) @injection.content.css
  (#eq? @_language "css"))
`;

const foldsQuery = `
[
  (section)
  (fenced_code_block)
  (block_quote)
  (list)
] @fold
`;

const indent = { width: 2, unit: " " };
const comment = "";

export default {
  query, foldsQuery, indent, comment
} satisfies Lang;

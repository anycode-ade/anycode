import type { Lang } from "../lang";

const query = `
(code_span) @string
(code_span_delimiter) @punctuation.special

(emphasis) @keyword
(strong_emphasis) @type
(strikethrough) @comment
(emphasis_delimiter) @punctuation.special

[
  (backslash_escape)
  (hard_line_break)
] @string.escape

[
  (link_destination)
  (uri_autolink)
] @string.special

[
  (link_label)
  (link_text)
  (link_title)
  (image_description)
] @string

(entity_reference) @constant
`;

const indent = { width: 2, unit: " " };
const comment = "";

export default {
  query, indent, comment
} satisfies Lang;

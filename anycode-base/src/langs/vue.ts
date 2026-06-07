import type { Lang } from "../lang";

const query = `
(tag_name) @tag
(comment) @comment

(attribute_name) @variable
(attribute
  (quoted_attribute_value) @string)

(directive_name) @keyword
(directive_value) @property
(directive_modifier) @function.method
(dynamic_directive_inner_value) @variable

[
  "<"
  ">"
  "</"
  "/>"
] @punctuation.bracket

[
  "="
  "@"
  ":"
  "."
] @operator

(interpolation
  (raw_text) @injection.content.javascript)

(directive_attribute
  (quoted_attribute_value
    (attribute_value) @injection.content.javascript))

(script_element
  (raw_text) @injection.content.typescript)

(style_element
  (raw_text) @injection.content.css)
`;

const foldsQuery = `
[
  (template_element)
  (script_element)
  (style_element)
  (element)
  (comment)
] @fold
`;

const indent = { width: 2, unit: " " };
const comment = "<!-- -->";

export default {
  query, foldsQuery, indent, comment
} satisfies Lang;

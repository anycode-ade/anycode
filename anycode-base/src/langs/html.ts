import type { Lang } from "../lang";

const query = `
(tag_name) @type
(erroneous_end_tag_name) @tag.error
(doctype) @constant
(attribute_name) @variable
(attribute_value) @string
(comment) @comment

[
  "<"
  ">"
  "</"
  "/>"
] @punctuation.bracket

(script_element
  (raw_text) @injection.content.javascript)
 (#set! injection.language "javascript")

(style_element
  (raw_text) @injection.content.css)
 (#set! injection.language "css")
`

let indent = { width: 4, unit: " " };
let comment = "";

let foldsQuery = `
[
  (element)
  (script_element)
  (style_element)
  (comment)
] @fold
`

export default {
  query, foldsQuery, indent, comment
} satisfies Lang
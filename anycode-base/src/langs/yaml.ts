import type { Lang } from "../lang";

const query = `

(block_mapping_pair
  key: (flow_node [(double_quote_scalar) (single_quote_scalar)] @type))
(block_mapping_pair
  key: (flow_node (plain_scalar (string_scalar) @type)))

(flow_mapping
  (_ key: (flow_node [(double_quote_scalar) (single_quote_scalar)] @type)))
(flow_mapping
  (_ key: (flow_node (plain_scalar (string_scalar) @type))))

(boolean_scalar) @boolean
(null_scalar) @constant.builtin
(double_quote_scalar) @string
(single_quote_scalar) @string
((block_scalar) @string (#set! "priority" 99))
; Prefer key @type over general string when both match the same node
(string_scalar) @string
(escape_sequence) @string.escape
(integer_scalar) @number
(float_scalar) @number
(comment) @comment @spell
(anchor_name) @type
(alias_name) @type
(tag) @type
(ERROR) @error

[
  (yaml_directive)
  (tag_directive)
  (reserved_directive)
] @preproc


[
 ","
 "-"
 ":"
 ">"
 "?"
 "|"
] @punctuation.delimiter

[
 "["
 "]"
 "{"
 "}"
] @punctuation.bracket

[
 "*"
 "&"
 "---"
 "..."
] @punctuation.special
`

let indent = { width: 4, unit: " " };
let comment = "#";

let foldsQuery = `
[
  (block_mapping_pair)
  (block_sequence_item)
  (flow_mapping)
  (flow_sequence)
  (block_scalar)
  (comment)
] @fold
`

export default {
  query, foldsQuery, indent, comment
} satisfies Lang
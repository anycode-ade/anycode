import type { Lang } from "../lang";

const query = `
[
  (true)
  (false)
] @constant.builtin.boolean
(null) @constant.builtin
(number) @constant.numeric
(pair
  key: (_) @variable)

(string) @string
(escape_sequence) @constant.character.escape
(ERROR) @error
`

let indent = { width: 4, unit: " " };
let comment = "//";

export default {
  query, indent, comment
} satisfies Lang
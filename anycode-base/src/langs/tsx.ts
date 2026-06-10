import type { Lang } from "../lang";
import {
  cmd,
  cmdTest,
  executable,
  foldsQuery as typescriptFoldsQuery,
  query as typescriptQuery,
} from "./typescript";

const jsxQuery = `
; JSX elements

(jsx_opening_element
  (identifier) @tag)

(jsx_closing_element
  (identifier) @tag)

(jsx_self_closing_element
  (identifier) @tag)

[
  (jsx_opening_element (member_expression) @constructor)
  (jsx_closing_element (member_expression) @constructor)
  (jsx_self_closing_element (member_expression) @constructor)
]

(jsx_attribute
  (property_identifier) @attribute)

[
  "<"
  ">"
  "</"
  "/>"
] @punctuation.bracket

(jsx_attribute
  "=" @operator)

(jsx_text) @string
(html_character_reference) @string.special
`;

const query = `${jsxQuery}\n${typescriptQuery}`;

const foldsQuery = `${typescriptFoldsQuery}
[
  (jsx_element)
  (jsx_expression)
] @fold
`;

const indent = { width: 2, unit: " " };
const comment = "//";

export default {
  query,
  foldsQuery,
  executable,
  cmd,
  cmdTest,
  indent,
  comment,
} satisfies Lang;

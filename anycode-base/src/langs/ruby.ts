import type { Lang } from "../lang";

const query = `
[
  "alias"
  "and"
  "begin"
  "break"
  "case"
  "class"
  "def"
  "do"
  "else"
  "elsif"
  "end"
  "ensure"
  "for"
  "if"
  "in"
  "module"
  "next"
  "or"
  "rescue"
  "retry"
  "return"
  "then"
  "unless"
  "until"
  "when"
  "while"
  "yield"
] @keyword

((identifier) @keyword
  (#match? @keyword "^(private|protected|public)$"))

(constant) @constructor

(call
  method: [(identifier) (constant)] @function.method)

((method name: [(identifier) (constant)] @function.method)
  (#set! priority 110))
((singleton_method name: [(identifier) (constant)] @function.method)
  (#set! priority 110))

[
  (class_variable)
  (instance_variable)
] @property

[
  (self)
  (super)
] @variable.builtin

(block_parameter (identifier) @variable.parameter)
(block_parameters (identifier) @variable.parameter)
(method_parameters (identifier) @variable.parameter)
(optional_parameter name: (identifier) @variable.parameter)
(keyword_parameter name: (identifier) @variable.parameter)

(identifier) @variable

[
  (string)
  (bare_string)
  (subshell)
  (heredoc_body)
  (heredoc_beginning)
] @string

[
  (simple_symbol)
  (delimited_symbol)
  (hash_key_symbol)
  (bare_symbol)
] @string.special

(regex) @string.regex
(escape_sequence) @string.escape

[
  (integer)
  (float)
] @number

[
  (nil)
  (true)
  (false)
] @constant.builtin

(comment) @comment

[
  "="
  "=>"
  "->"
] @operator

[
  ","
  ";"
  "."
] @punctuation.delimiter

[
  "("
  ")"
  "["
  "]"
  "{"
  "}"
  "%w("
  "%i("
] @punctuation.bracket
`;

const foldsQuery = `
[
  (class)
  (module)
  (method)
  (singleton_method)
  (do_block)
  (block)
  (if)
  (unless)
  (case)
  (while)
  (until)
  (for)
  (begin)
  (hash)
  (array)
  (comment)
] @fold
`;

const indent = { width: 2, unit: " " };
const comment = "#";

export default {
  query, foldsQuery, indent, comment
} satisfies Lang;

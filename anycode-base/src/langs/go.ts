import type { Lang } from "../lang";

const query = `
; Function calls

(call_expression
    function: (identifier) @function.builtin
    (.match? @function.builtin "^(append|cap|close|complex|copy|delete|imag|len|make|new|panic|print|println|real|recover)$"))

(call_expression
    function: (identifier) @function)

(call_expression
    function: (selector_expression
    field: (field_identifier) @function.method))

; Function definitions

(function_declaration
    name: (identifier) @function)

(method_declaration
    name: (field_identifier) @function.method)

; Identifiers

(type_identifier) @type
(field_identifier) @property
(identifier) @variable

; Operators

[
    "--"
    "-"
    "-="
    ":="
    "!"
    "!="
    "..."
    "*"
    "*"
    "*="
    "/"
    "/="
    "&"
    "&&"
    "&="
    "%"
    "%="
    "^"
    "^="
    "+"
    "++"
    "+="
    "<-"
    "<"
    "<<"
    "<<="
    "<="
    "="
    "=="
    ">"
    ">="
    ">>"
    ">>="
    "|"
    "|="
    "||"
    "~"
] @operator

; Keywords

[
    "break"
    "case"
    "chan"
    "const"
    "continue"
    "default"
    "defer"
    "else"
    "fallthrough"
    "for"
    "func"
    "go"
    "goto"
    "if"
    "import"
    "interface"
    "map"
    "package"
    "range"
    "return"
    "select"
    "struct"
    "switch"
    "type"
    "var"
] @keyword

; Literals

[
    (interpreted_string_literal)
    (raw_string_literal)
    (rune_literal)
] @string

(escape_sequence) @escape

[
    (int_literal)
    (float_literal)
    (imaginary_literal)
] @number

[
    (true)
    (false)
    (nil)
    (iota)
] @constant.builtin

(comment) @comment
`

let foldsQuery = `
[
  (block)
  (literal_value)
  (struct_type)
  (interface_type)
  (import_spec_list)
  (comment)
] @fold

[
  (function_declaration)
  (method_declaration)
  (const_declaration)
  (var_declaration)
  (expression_case)
  (type_case)
  (default_case)
  (communication_case)
  (expression_switch_statement)
  (type_switch_statement)
  (select_statement)
] @fold
`

let indent = { width: 4, unit: " " };
let comment = "//";

export default {
    query, foldsQuery, indent, comment
} satisfies Lang
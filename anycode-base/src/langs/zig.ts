import type { Lang } from "../lang";

const query = `
[
  (container_doc_comment)
  (doc_comment)
] @comment

[
  (line_comment)
] @comment

;; assume TitleCase is a type
(
  [
    variable_type_function: (IDENTIFIER)
    field_access: (IDENTIFIER)
    parameter: (IDENTIFIER)
  ] @type
  (#match? @type "^[A-Z]([a-z]+[A-Za-z0-9]*)+$")
)

;; assume camelCase is a function
(
  [
    variable_type_function: (IDENTIFIER)
    field_access: (IDENTIFIER)
    parameter: (IDENTIFIER)
  ] @function
  (#match? @function "^[a-z]+([A-Z][a-z0-9]*)+$")
)

;; assume all CAPS_1 is a constant
(
  [
    variable_type_function: (IDENTIFIER)
    field_access: (IDENTIFIER)
  ] @constant
  (#match? @constant "^[A-Z][A-Z_0-9]+$")
)

;; _
(
  (IDENTIFIER) @variable.builtin
  (#eq? @variable.builtin "_")
)

;; C Pointers [*c]T
(PtrTypeStart "c" @variable.builtin)

[
  variable: (IDENTIFIER)
  variable_type_function: (IDENTIFIER)
] @variable

parameter: (IDENTIFIER) @variable.parameter

[
  field_member: (IDENTIFIER)
  field_access: (IDENTIFIER)
] @variable

[
  function_call: (IDENTIFIER)
  function: (IDENTIFIER)
] @function

exception: "!" @keyword

field_constant: (IDENTIFIER) @constant

(BUILTINIDENTIFIER) @function.builtin

((BUILTINIDENTIFIER) @keyword.control.import
  (#any-of? @keyword.control.import "@import" "@cImport"))

(INTEGER) @constant

(FLOAT) @constant

[
  (LINESTRING)
  (STRINGLITERALSINGLE)
] @string

(CHAR_LITERAL) @constant
(EscapeSequence) @constant
(FormatSequence) @string

[
  "anytype"
  "anyframe"
  (BuildinTypeExpr)
] @type

(BreakLabel (IDENTIFIER) @label)
(BlockLabel (IDENTIFIER) @label)

[
  "true"
  "false"
] @constant

[
  "undefined"
  "unreachable"
  "null"
] @constant

[
  "else"
  "if"
  "switch"
] @keyword

[
  "for"
  "while"
] @keyword

[
  "or"
  "and"
  "orelse"
] @keyword

[
  "enum"
] @type

[
  "struct"
  "union"
  "packed"
  "opaque"
  "export"
  "extern"
  "linksection"
] @keyword

[
  "const"
  "var"
  "threadlocal"
  "allowzero"
  "volatile"
  "align"
] @keyword

[
  "try"
  "error"
  "catch"
] @keyword

[
  "fn"
] @keyword

[
  "test"
] @keyword

[
  "pub"
  "usingnamespace"
] @keyword

[
  "return"
  "break"
  "continue"
] @keyword

[
  "defer"
  "errdefer"
  "async"
  "nosuspend"
  "await"
  "suspend"
  "resume"
] @keyword

[
  "comptime"
  "inline"
  "noinline"
  "asm"
  "callconv"
  "noalias"
] @keyword

[
  (CompareOp)
  (BitwiseOp)
  (BitShiftOp)
  (AdditionOp)
  (AssignOp)
  (MultiplyOp)
  (PrefixOp)
  "*"
  "**"
  "->"
  ".?"
  ".*"
  "?"
] @operator

[
  ";"
  "."
  ","
  ":"
] @punctuation.delimiter

[
  ".."
  "..."
] @punctuation.special

[
  "["
  "]"
  "("
  ")"
  "{"
  "}"
  (Payload "|")
  (PtrPayload "|")
  (PtrIndexPayload "|")
] @punctuation.bracket

;(ERROR) @keyword.control.exception

`

let indent = { width: 4, unit: " " };
let comment = "//";

export default {
  query, indent, comment
} satisfies Lang
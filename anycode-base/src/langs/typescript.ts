import type { Lang } from "../lang";

const query = `
; Special identifiers
;--------------------

([
    (identifier)
    (shorthand_property_identifier)
    (shorthand_property_identifier_pattern)
    ] @constant
    (#match? @constant "^[A-Z_][A-Z\\d_]+$"))


((identifier) @constructor
    (#match? @constructor "^[A-Z]"))

((identifier) @variable.builtin
    (#match? @variable.builtin "^(arguments|module|console|window|document)$")
    (#is-not? local))

((identifier) @function.builtin
    (#eq? @function.builtin "require")
    (#is-not? local))

; Function and method definitions
;--------------------------------

;(function_expression
;    name: (identifier) @function)
(function_declaration
    name: (identifier) @function)
(method_definition
    name: (property_identifier) @function.method)

;(pair
;    key: (property_identifier) @function.method
;    value: [(function_expression) (arrow_function)])

;(assignment_expression
;    left: (member_expression
;    property: (property_identifier) @function.method)
;    right: [(function_expression) (arrow_function)])

;(variable_declarator
;    name: (identifier) @function
;    value: [(function_expression) (arrow_function)])

;(assignment_expression
;    left: (identifier) @function
;    right: [(function_expression) (arrow_function)])

; Function and method calls
;--------------------------

(call_expression
    function: (identifier) @function)

(call_expression
    function: (member_expression
    property: (property_identifier) @function.method))

; Variables
;----------

(identifier) @variable

; Properties
;-----------

(property_identifier) @property

; Literals
;---------

(this) @variable.builtin
(super) @variable.builtin

[
    (true)
    (false)
    (null)
    (undefined)
] @constant.builtin

(comment) @comment

[
    (string)
    (template_string)
] @string

(regex) @string.special
(number) @number

; Tokens
;-------



[
    ";"
    (optional_chain)
    "."
    ","
] @punctuation.delimiter

[
    "-"
    "--"
    "-="
    "+"
    "++"
    "+="
    "*"
    "*="
    "**"
    "**="
    "/"
    "/="
    "%"
    "%="
    "<"
    "<="
    "<<"
    "<<="
    "="
    "=="
    "==="
    "!"
    "!="
    "!=="
    "=>"
    ">"
    ">="
    ">>"
    ">>="
    ">>>"
    ">>>="
    "~"
    "^"
    "&"
    "|"
    "^="
    "&="
    "|="
    "&&"
    "||"
    "??"
    "&&="
    "||="
    "??="
] @operator

[
    "("
    ")"
    "["
    "]"
    "{"
    "}"
]  @punctuation.bracket

[
    "as"
    "async"
    "await"
    "break"
    "case"
    "catch"
    "class"
    "const"
    "continue"
    "debugger"
    "default"
    "delete"
    "do"
    "else"
    "export"
    "extends"
    "finally"
    "for"
    "from"
    "function"
    "get"
    "if"
    "import"
    "in"
    "instanceof"
    "let"
    "new"
    "of"
    "return"
    "set"
    "static"
    "switch"
    "target"
    "throw"
    "try"
    "typeof"
    "var"
    "void"
    "while"
    "with"
    "yield"
] @keyword


; Variables

(identifier) @variable

; Properties

(property_identifier) @property
(shorthand_property_identifier) @property
(shorthand_property_identifier_pattern) @property

; Function and method calls

(call_expression
  function: (identifier) @function)

(call_expression
  function: (member_expression
    property: (property_identifier) @function.method))

; Function and method definitions

(function_expression
  name: (identifier) @function)
(function_declaration
  name: (identifier) @function)
(method_definition
  name: (property_identifier) @function.method)

(pair
  key: (property_identifier) @function.method
  value: [(function_expression) (arrow_function)])

(assignment_expression
  left: (member_expression
    property: (property_identifier) @function.method)
  right: [(function_expression) (arrow_function)])

(variable_declarator
  name: (identifier) @function
  value: [(function_expression) (arrow_function)])

(assignment_expression
  left: (identifier) @function
  right: [(function_expression) (arrow_function)])

; Special identifiers

((identifier) @constructor
 (#match? @constructor "^[A-Z]"))

((identifier) @type
 (#match? @type "^[A-Z]"))
(type_identifier) @type
(predefined_type) @type.builtin

([
  (identifier)
  (shorthand_property_identifier)
  (shorthand_property_identifier_pattern)
 ] @constant
 (#match? @constant "^_*[A-Z_][A-Z\\d_]*$"))

; Literals

(this) @variable.special
(super) @variable.special

[
  (null)
  (undefined)
] @constant.builtin

[
  (true)
  (false)
] @boolean

(comment) @comment

[
  (string)
  (template_string)
  (template_literal_type)
] @string

(escape_sequence) @string.escape

(regex) @string.regex
(number) @number

; Tokens

[
  ";"
  "?."
  "."
  ","
  ":"
  "?"
] @punctuation.delimiter

[
  "..."
  "-"
  "--"
  "-="
  "+"
  "++"
  "+="
  "*"
  "*="
  "**"
  "**="
  "/"
  "/="
  "%"
  "%="
  "<"
  "<="
  "<<"
  "<<="
  "="
  "=="
  "==="
  "!"
  "!="
  "!=="
  "=>"
  ">"
  ">="
  ">>"
  ">>="
  ">>>"
  ">>>="
  "~"
  "^"
  "&"
  "|"
  "^="
  "&="
  "|="
  "&&"
  "||"
  "??"
  "&&="
  "||="
  "??="
] @operator

[
  "("
  ")"
  "["
  "]"
  "{"
  "}"
]  @punctuation.bracket

(ternary_expression
  [
    "?"
    ":"
  ] @operator
)

[
  "as"
  "async"
  "await"
  "break"
  "case"
  "catch"
  "class"
  "const"
  "continue"
  "debugger"
  "default"
  "delete"
  "do"
  "else"
  "export"
  "extends"
  "finally"
  "for"
  "from"
  "function"
  "get"
  "if"
  "import"
  "in"
  "instanceof"
  "is"
  "let"
  "new"
  "of"
  "return"
  "satisfies"
  "set"
  "static"
  "switch"
  "target"
  "throw"
  "try"
  "typeof"
  "using"
  "var"
  "void"
  "while"
  "with"
  "yield"
] @keyword


; Keywords

["abstract"
  "declare"
"enum"
"export"
"implements"
"infer"
"interface"
"keyof"
"namespace"
"private"
"protected"
"public"
"type"
"readonly"
"override"
]@keyword
`

let indent = { width: 4, unit: " " };
let comment = "//";

let runnablesQuery = `
(
    (call_expression
        function: [
            (identifier) @_name
            (member_expression
                object: [
                    (identifier) @_name
                    (member_expression object: (identifier) @_name)
                ]
            )
        ]
        (#any-of? @_name "it" "test" "describe" "context" "suite")
        arguments: (
            arguments . (string (string_fragment) @test-name)
        )
    ) @_js-test

    (#set! tag js-test)
)
`

let executable = true;
let cmd = "node {file}"
let cmdTest = "npx jest {file} -t \"{test-name}\""

export default {
  query, runnablesQuery, executable, cmd, cmdTest, indent, comment
} satisfies Lang
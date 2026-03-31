import type { Lang } from "../lang";

const query = `
; Imports

(dotted_name
  (identifier)* @namespace)

(aliased_import
  alias: (identifier) @namespace)

; Builtin functions

((call
  function: (identifier) @function.builtin)
 (#match?
   @function.builtin
   "^(abs|all|any|ascii|bin|bool|breakpoint|bytearray|bytes|callable|chr|classmethod|compile|complex|delattr|dict|dir|divmod|enumerate|eval|exec|filter|float|format|frozenset|getattr|globals|hasattr|hash|help|hex|id|input|int|isinstance|issubclass|iter|len|list|locals|map|max|memoryview|min|next|object|oct|open|ord|pow|print|property|range|repr|reversed|round|set|setattr|slice|sorted|staticmethod|str|sum|super|tuple|type|vars|zip|__import__)$"))

; Function calls

[
  "def"
  "lambda"
] @keyword

(call
  function: (attribute attribute: (identifier) @constructor)
 (#match? @constructor "^[A-Z]"))
(call
  function: (identifier) @constructor
 (#match? @constructor "^[A-Z]"))

(call
  function: (attribute attribute: (identifier) @function.method))

(call
  function: (identifier) @function)

; Function definitions

(function_definition
  name: (identifier) @constructor
 (#match? @constructor "^(__new__|__init__)$"))

(function_definition
  name: (identifier) @function)

; Decorators

(decorator) @function
(decorator (identifier) @function)
(decorator (attribute attribute: (identifier) @function))
(decorator (call
  function: (attribute attribute: (identifier) @function)))

; Parameters

((identifier) @variable.builtin
 (#match? @variable.builtin "^(self|cls)$"))

(parameters (identifier) @variable.parameter)
(parameters (typed_parameter (identifier) @variable.parameter))
(parameters (default_parameter name: (identifier) @variable.parameter))
(parameters (typed_default_parameter name: (identifier) @variable.parameter))

(parameters
  (list_splat_pattern ; *args
    (identifier) @variable.parameter))
(parameters
  (dictionary_splat_pattern ; **kwargs
    (identifier) @variable.parameter))

(lambda_parameters
  (identifier) @variable.parameter)

; Types

((identifier) @type.builtin
 (#match?
   @type.builtin
   "^(bool|bytes|dict|float|frozenset|int|list|set|str|tuple)$"))

; In type hints make everything types to catch non-conforming identifiers
; (e.g., datetime.datetime) and None
(type [(identifier) (none)] @type)
; Handle [] . and | nesting 4 levels deep
(type
  (_ [(identifier) (none)]? @type
    (_ [(identifier) (none)]? @type
      (_ [(identifier) (none)]? @type
        (_ [(identifier) (none)]? @type)))))

(class_definition name: (identifier) @type)
(class_definition superclasses: (argument_list (identifier) @type))

; Variables

((identifier) @constant
 (#match? @constant "^_*[A-Z][A-Z\\d_]*$"))

((identifier) @type
 (#match? @type "^[A-Z]"))

(attribute attribute: (identifier) @variable.other.member)
(identifier) @variable

; Literals
(none) @constant.builtin
[
  (true)
  (false)
] @constant

(integer) @constant
(float) @constant
(comment) @comment
(string) @string
(escape_sequence) @constant.character.escape

["," "." ":" ";" (ellipsis)] @punctuation.delimiter
(interpolation
  "{" @punctuation.special
  "}" @punctuation.special) @embedded
["(" ")" "[" "]" "{" "}"] @punctuation.bracket

[
  "-"
  "-="
  "!="
  "*"
  "**"
  "**="
  "*="
  "/"
  "//"
  "//="
  "/="
  "&"
  "%"
  "%="
  "^"
  "+"
  "->"
  "+="
  "<"
  "<<"
  "<="
  "<>"
  "="
  ":="
  "=="
  ">"
  ">="
  ">>"
  "|"
  "~"
] @operator

[
  "as"
  "assert"
  "await"
  "from"
  "pass"

  "with"
] @keyword

[
  "if"
  "elif"
  "else"
  "match"
  "case"
] @keyword

[
  "while"
  "for"
  "break"
  "continue"
] @keyword

[
  "return"
  "yield"
] @keyword
(yield "from" @keyword)

[
  "raise"
  "try"
  "except"
  "finally"
] @keyword

(raise_statement "from" @keyword)
"import" @keyword

(for_statement "in" @keyword)
(for_in_clause "in" @keyword)

[
  "and"
  "async"
  "class"
  "exec"
  "global"
  "nonlocal"
  "print"
] @keyword

[
  "and"
  "or"
  "in"
  "not"
  "del"
  "is"
] @keyword

((identifier) @type.builtin
  (#match? @type.builtin
    "^(BaseException|Exception|ArithmeticError|BufferError|LookupError|AssertionError|AttributeError|EOFError|FloatingPointError|GeneratorExit|ImportError|ModuleNotFoundError|IndexError|KeyError|KeyboardInterrupt|MemoryError|NameError|NotImplementedError|OSError|OverflowError|RecursionError|ReferenceError|RuntimeError|StopIteration|StopAsyncIteration|SyntaxError|IndentationError|TabError|SystemError|SystemExit|TypeError|UnboundLocalError|UnicodeError|UnicodeEncodeError|UnicodeDecodeError|UnicodeTranslateError|ValueError|ZeroDivisionError|EnvironmentError|IOError|WindowsError|BlockingIOError|ChildProcessError|ConnectionError|BrokenPipeError|ConnectionAbortedError|ConnectionRefusedError|ConnectionResetError|FileExistsError|FileNotFoundError|InterruptedError|IsADirectoryError|NotADirectoryError|PermissionError|ProcessLookupError|TimeoutError|Warning|UserWarning|DeprecationWarning|PendingDeprecationWarning|SyntaxWarning|RuntimeWarning|FutureWarning|ImportWarning|UnicodeWarning|BytesWarning|ResourceWarning)$"))

(ERROR) @error
`

let runnablesQuery = `
(
  (class_definition
    body: (block
    (function_definition
      name: (identifier) @method @test-name)))
  (#match? @method "test")
)

(
  class_definition name: (identifier) @test-name
  (#match? @test-name "[Tt]est")
)
`

let executable = true;

let cmd = "python3 {file}";
let cmdTest = "python3 -m pytest -k {test-name} {file}";

let indent = { width: 4, unit: " " };
let comment = "#";

export default {
  query, runnablesQuery, executable, cmd, cmdTest, indent, comment
} satisfies Lang
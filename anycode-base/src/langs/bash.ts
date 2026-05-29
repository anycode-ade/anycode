import type { Lang } from "../lang";

const query = `
[
 (string)
 (raw_string)
 ;(ansi_c_string)
 (heredoc_body)
] @string

(variable_assignment (word) @string)
;(command argument: "$" @string)


[
 "if"
 "then"
 "else"
 "elif"
 "fi"
 "case"
 "in"
 "esac"
] @keyword


[
 "for"
 "do"
 "done"
 ;"select"
 ;"until"
 "while"
] @keyword

[
  "declare"
  "typeset"
  "export"
  "readonly"
  "local"
  "unset"
  "unsetenv"
] @keyword

"function" @keyword.function
(special_variable_name) @constant

; trap -l
((word) @constant.builtin
 (#match? @constant.builtin "^SIG(HUP|INT|QUIT|ILL|TRAP|ABRT|BUS|FPE|KILL|USR[12]|SEGV|PIPE|ALRM|TERM|STKFLT|CHLD|CONT|STOP|TSTP|TT(IN|OU)|URG|XCPU|XFSZ|VTALRM|PROF|WINCH|IO|PWR|SYS|RTMIN([+]([1-9]|1[0-5]))?|RTMAX(-([1-9]|1[0-4]))?)$"))

((word) @boolean
 (#any-of? @boolean "true" "false"))

(comment) @comment @spell

(test_operator) @operator

(function_definition
  name: (word) @function)

(command_name (word) @function.call)

(variable_name) @variable @identifier

(case_item
  value: (word) @parameter)


((program . (comment) @preproc)
 (#lua-match? @preproc "^#!/"))

[
  "("
  ")"
  "["
  "]"
  "{"
  "}"
] @punctuation.bracket
`

let indent = { width: 4, unit: " " };
let comment = "#";

let foldsQuery = `
[
  (function_definition)
  (if_statement)
  (for_statement)
  (while_statement)
  (case_statement)
  (case_item)
  (subshell)
  (compound_statement)
  (heredoc_body)
  (comment)
] @fold
`

let executable = true;
let cmd = "./{file}";

export default {
  query, foldsQuery, executable, cmd, indent, comment
} satisfies Lang
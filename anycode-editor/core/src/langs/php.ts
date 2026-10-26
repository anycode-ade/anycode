import type { Lang } from "../lang";

const query = `
[
  (php_tag)
  (php_end_tag)
] @tag

[
  "and"
  "as"
  "break"
  "case"
  "catch"
  "class"
  "clone"
  "const"
  "continue"
  "declare"
  "default"
  "do"
  "echo"
  "else"
  "elseif"
  "enum"
  "exit"
  "extends"
  "finally"
  "fn"
  "for"
  "foreach"
  "function"
  "global"
  "if"
  "implements"
  "include"
  "include_once"
  "instanceof"
  "interface"
  "match"
  "namespace"
  "new"
  "print"
  "private"
  "protected"
  "public"
  "readonly"
  "require"
  "require_once"
  "return"
  "static"
  "switch"
  "throw"
  "trait"
  "try"
  "use"
  "while"
  "yield"
  (abstract_modifier)
  (final_modifier)
  (readonly_modifier)
  (static_modifier)
  (visibility_modifier)
] @keyword

(namespace_name (name) @namespace)
(variable_name) @variable

(object_creation_expression
  [(name) (qualified_name (name))] @constructor)

(primitive_type) @type.builtin
(cast_type) @type.builtin
(named_type [(name) (qualified_name (name))] @type)

(method_declaration name: (name) @function.method)
(function_definition name: (name) @function)
(function_call_expression
  function: [(name) (qualified_name (name))] @function)
(member_call_expression name: (name) @function.method)
(scoped_call_expression name: (name) @function.method)

(property_element (variable_name) @property)
(member_access_expression name: [(name) (variable_name)] @property)

[
  (string)
  (string_content)
  (encapsed_string)
  (heredoc)
  (heredoc_body)
  (nowdoc_body)
] @string

[
  (boolean)
  (null)
] @constant.builtin

[
  (integer)
  (float)
] @number

(comment) @comment

[
  "$"
  "->"
  "?->"
  "::"
  "=>"
] @operator

((text) @injection.content.html)
`;

const foldsQuery = `
[
  (compound_statement)
  (class_declaration)
  (interface_declaration)
  (trait_declaration)
  (enum_declaration)
  (function_definition)
  (method_declaration)
  (array_creation_expression)
  (comment)
] @fold
`;

const indent = { width: 4, unit: " " };
const comment = "//";

export default {
  query, foldsQuery, indent, comment
} satisfies Lang;

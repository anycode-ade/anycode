import type { Lang } from "../lang";

const query = `
(invocation
  (object_reference
    name: (identifier) @function.call))

(object_reference
  name: (identifier) @type)

(relation
  alias: (identifier) @variable)

(field
  name: (identifier) @property)

(term
  alias: (identifier) @variable)

(comment) @comment
(marginalia) @comment
(parameter) @variable.parameter

[
  (keyword_true)
  (keyword_false)
  (keyword_null)
] @constant.builtin

((literal) @string
  (#not-match? @string "^(?i:true|false|null)$"))

[
  (keyword_int)
  (keyword_boolean)
  (keyword_smallint)
  (keyword_bigint)
  (keyword_decimal)
  (keyword_float)
  (keyword_double)
  (keyword_numeric)
  (keyword_real)
  (keyword_char)
  (keyword_varchar)
  (keyword_text)
  (keyword_uuid)
  (keyword_json)
  (keyword_jsonb)
  (keyword_date)
  (keyword_time)
  (keyword_timestamp)
  (keyword_interval)
] @type.builtin

[
  (keyword_select)
  (keyword_from)
  (keyword_where)
  (keyword_join)
  (keyword_left)
  (keyword_right)
  (keyword_outer)
  (keyword_inner)
  (keyword_full)
  (keyword_cross)
  (keyword_on)
  (keyword_group)
  (keyword_by)
  (keyword_order)
  (keyword_having)
  (keyword_limit)
  (keyword_offset)
  (keyword_with)
  (keyword_recursive)
  (keyword_as)
  (keyword_distinct)
  (keyword_insert)
  (keyword_into)
  (keyword_values)
  (keyword_update)
  (keyword_set)
  (keyword_delete)
  (keyword_returning)
  (keyword_create)
  (keyword_alter)
  (keyword_drop)
  (keyword_table)
  (keyword_view)
  (keyword_index)
  (keyword_primary)
  (keyword_key)
  (keyword_foreign)
  (keyword_references)
  (keyword_constraint)
  (keyword_if)
  (keyword_exists)
  (keyword_begin)
  (keyword_commit)
  (keyword_rollback)
  (keyword_transaction)
  (keyword_case)
  (keyword_when)
  (keyword_then)
  (keyword_else)
  (keyword_end)
  (keyword_union)
  (keyword_all)
  (keyword_explain)
  (keyword_analyze)
  (keyword_asc)
  (keyword_desc)
] @keyword

[
  (keyword_in)
  (keyword_and)
  (keyword_or)
  (keyword_not)
  (keyword_is)
  (keyword_between)
  (keyword_like)
] @keyword.operator

[
  "+"
  "-"
  "*"
  "/"
  "%"
  "^"
  ":="
  "="
  "<"
  "<="
  "!="
  ">="
  ">"
  "<>"
  (op_other)
  (op_unary_other)
] @operator

[
  "("
  ")"
] @punctuation.bracket

[
  ";"
  ","
  "."
] @punctuation.delimiter
`;

const foldsQuery = `
[
  (statement)
  (cte)
  (select)
  (create_table)
  (insert)
  (update)
  (delete)
  (comment)
] @fold
`;

const indent = { width: 2, unit: " " };
const comment = "--";

export default {
  query, foldsQuery, indent, comment
} satisfies Lang;

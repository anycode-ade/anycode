import type { Lang } from "../lang";

const query = `
[
  "FROM"
  "AS"
  "RUN"
  "CMD"
  "LABEL"
  "EXPOSE"
  "ENV"
  "ADD"
  "COPY"
  "ENTRYPOINT"
  "VOLUME"
  "USER"
  "WORKDIR"
  "ARG"
  "ONBUILD"
  "STOPSIGNAL"
  "HEALTHCHECK"
  "SHELL"
  "MAINTAINER"
  "CROSS_BUILD"
  (heredoc_marker)
  (heredoc_end)
] @keyword

(comment) @comment

[
  (double_quoted_string)
  (single_quoted_string)
  (json_string)
  (heredoc_line)
] @string

(image_name) @type
(image_tag) @constant
(image_digest) @constant
(image_alias) @type

[
  (path)
  (expose_port)
] @string.special

(expansion
  (variable) @variable)

[
  ":"
  "@"
  "="
] @operator

(run_instruction
  (shell_command) @injection.content.bash)

(cmd_instruction
  (shell_command) @injection.content.bash)

(entrypoint_instruction
  (shell_command) @injection.content.bash)
`;

const foldsQuery = `
[
  (run_instruction)
  (cmd_instruction)
  (entrypoint_instruction)
  (copy_instruction)
  (add_instruction)
  (heredoc_block)
] @fold
`;

const indent = { width: 4, unit: " " };
const comment = "#";

export default {
  query, foldsQuery, indent, comment
} satisfies Lang;

import { HighlighedNode } from "./code";

export type TokenType =
    | "keyword"
    | "type"
    | "function"
    | "string"
    | "number"
    | "comment"
    | "operator"
    | "property"
    | "variable"
    | "punctuation.bracket"
    | "punctuation.delimiter"
    | "diff.added"
    | "diff.deleted"
    | "diff.hunk"
    | null;

/**
 * Extension and alias mappings to normalized language identifiers.
 */
const EXT_TO_LANG: Readonly<Record<string, string>> = {
    // Rust
    rs: "rust",
    rust: "rust",
    // TypeScript & JavaScript
    ts: "typescript",
    tsx: "typescript",
    typescript: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    javascript: "javascript",
    // Python
    py: "python",
    pyw: "python",
    python: "python",
    // Go
    go: "go",
    golang: "go",
    // C / C++
    c: "c",
    h: "c",
    cpp: "cpp",
    cc: "cpp",
    cxx: "cpp",
    hpp: "cpp",
    hxx: "cpp",
    "c++": "cpp",
    // Java & JVM
    java: "java",
    kt: "kotlin",
    kts: "kotlin",
    kotlin: "kotlin",
    scala: "scala",
    // C# / .NET
    cs: "csharp",
    csharp: "csharp",
    dotnet: "csharp",
    // Systems & Modern
    zig: "zig",
    swift: "swift",
    // Shell & Scripting
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    shell: "bash",
    fish: "bash",
    rb: "ruby",
    ruby: "ruby",
    lua: "lua",
    php: "php",
    // Data & Config
    json: "json",
    jsonc: "json",
    toml: "toml",
    yaml: "yaml",
    yml: "yaml",
    // Markup & Styles
    html: "html",
    htm: "html",
    xml: "xml",
    svg: "xml",
    css: "css",
    scss: "css",
    sass: "css",
    less: "css",
    md: "markdown",
    markdown: "markdown",
    // Query & Containers
    sql: "sql",
    dockerfile: "dockerfile",
    containerfile: "dockerfile",
    makefile: "makefile",
    mk: "makefile",
    // Diffs & Patches
    diff: "diff",
    patch: "diff",
};

/**
 * Exact filename mappings to normalized language identifiers.
 */
const FILENAME_TO_LANG: Readonly<Record<string, string>> = {
    "cargo.lock": "toml",
    "cargo.toml": "toml",
    "package.json": "json",
    "package-lock.json": "json",
    "tsconfig.json": "json",
    "composer.json": "json",
    dockerfile: "dockerfile",
    containerfile: "dockerfile",
    makefile: "makefile",
    gnumakefile: "makefile",
    ".gitignore": "bash",
    ".env": "bash",
};

// ---------------------------------------------------------------------------
// Language Keyword Dictionaries (O(1) Set Lookups)
// ---------------------------------------------------------------------------

const TS_KEYWORDS = new Set([
    "function", "class", "interface", "type", "const", "let", "var", "import",
    "export", "from", "default", "return", "if", "else", "switch", "case",
    "for", "while", "do", "break", "continue", "try", "catch", "finally",
    "throw", "async", "await", "new", "this", "null", "undefined", "true",
    "false", "typeof", "instanceof", "as", "is", "package", "private",
    "protected", "public", "readonly", "static", "extends", "implements",
    "constructor", "super", "yield", "debugger", "enum", "declare", "namespace"
]);

const RUST_KEYWORDS = new Set([
    "as", "break", "const", "continue", "crate", "else", "enum", "extern",
    "false", "fn", "for", "if", "impl", "in", "let", "loop", "match",
    "mod", "move", "mut", "pub", "ref", "return", "self", "Self",
    "static", "struct", "super", "trait", "true", "type", "unsafe",
    "use", "where", "while", "async", "await", "dyn", "yield", "default"
]);

const PYTHON_KEYWORDS = new Set([
    "def", "class", "import", "from", "return", "if", "elif", "else",
    "for", "while", "break", "continue", "try", "except", "finally",
    "raise", "with", "as", "yield", "async", "await", "lambda",
    "pass", "True", "False", "None", "self", "cls", "in", "is", "not",
    "and", "or", "global", "nonlocal", "match", "case"
]);

const GO_KEYWORDS = new Set([
    "func", "package", "import", "type", "struct", "interface", "return",
    "if", "else", "switch", "case", "default", "for", "range", "break",
    "continue", "var", "const", "go", "chan", "select", "defer",
    "nil", "true", "false", "map"
]);

const CPP_KEYWORDS = new Set([
    "auto", "break", "case", "const", "continue", "default", "do", "else",
    "enum", "extern", "for", "goto", "if", "inline", "register",
    "restrict", "return", "sizeof", "static", "struct", "switch",
    "typedef", "union", "volatile", "while", "class", "namespace",
    "template", "typename", "using", "public", "private", "protected",
    "virtual", "override", "constexpr", "nullptr", "true", "false"
]);

const JAVA_CS_KEYWORDS = new Set([
    "abstract", "assert", "boolean", "break", "byte", "case", "catch", "char",
    "class", "const", "continue", "default", "do", "double", "else", "enum",
    "extends", "final", "finally", "float", "for", "goto", "if", "implements",
    "import", "instanceof", "int", "interface", "long", "native", "new", "package",
    "private", "protected", "public", "return", "short", "static", "strictfp",
    "super", "switch", "synchronized", "this", "throw", "throws", "transient",
    "try", "void", "volatile", "while", "true", "false", "null",
    "namespace", "using", "var", "async", "await", "yield", "record", "sealed", "override"
]);

const BASH_KEYWORDS = new Set([
    "if", "then", "else", "elif", "fi", "case", "esac", "for", "while", "until",
    "do", "done", "in", "function", "return", "exit", "local", "readonly", "export",
    "echo", "printf", "set", "unset", "source", "alias", "shift", "trap", "exec",
    "sudo", "cd", "pwd", "ls", "cat", "grep", "mkdir", "rm", "cp", "mv", "chmod",
    "chown", "curl", "wget", "git", "cargo", "npm", "pnpm", "yarn", "node", "bun",
    "docker", "make", "true", "false"
]);

const SQL_KEYWORDS = new Set([
    "select", "from", "where", "insert", "into", "update", "delete", "create",
    "table", "drop", "alter", "join", "inner", "left", "right", "outer", "full",
    "cross", "on", "group", "by", "order", "having", "limit", "offset", "union",
    "all", "and", "or", "not", "in", "is", "null", "as", "distinct", "case",
    "when", "then", "else", "end", "primary", "key", "foreign", "references",
    "index", "view", "cascade", "default", "check", "constraint", "set", "values",
    "with", "exists", "between", "like", "ilike", "asc", "desc", "true", "false"
]);

const DOCKERFILE_KEYWORDS = new Set([
    "from", "run", "cmd", "label", "maintainer", "expose", "env", "add", "copy",
    "entrypoint", "volume", "user", "workdir", "arg", "onbuild", "stopsignal",
    "healthcheck", "shell"
]);

const LUA_KEYWORDS = new Set([
    "and", "break", "do", "else", "elseif", "end", "false", "for", "function",
    "goto", "if", "in", "local", "nil", "not", "or", "repeat", "return",
    "then", "true", "until", "while"
]);

const GENERIC_KEYWORDS = new Set([
    "fn", "func", "function", "def", "class", "struct", "enum", "let", "var",
    "const", "return", "if", "else", "for", "while", "import", "export",
    "public", "private", "protected", "true", "false", "null", "nil",
    "package", "type", "interface", "void", "static"
]);

const COMMON_PRIMITIVE_TYPES = new Set([
    // TS / JS
    "number", "string", "boolean", "any", "never", "unknown", "void", "symbol", "bigint",
    "Record", "Array", "Promise", "Map", "Set", "Object", "Function", "Error",
    // Rust
    "u8", "u16", "u32", "u64", "u128", "usize",
    "i8", "i16", "i32", "i64", "i128", "isize",
    "f32", "f64", "bool", "char", "str", "c_void",
    "Some", "None", "Ok", "Err", "Result", "Option", "Vec", "String",
    // C / C++ / Java / C#
    "void", "int", "float", "double", "long", "short", "byte",
    "unsigned", "signed", "size_t", "int32_t", "uint32_t",
    "int64_t", "uint64_t", "int16_t", "uint16_t", "int8_t", "uint8_t"
]);

const LANG_KEYWORD_MAP: Readonly<Record<string, ReadonlySet<string>>> = {
    typescript: TS_KEYWORDS,
    javascript: TS_KEYWORDS,
    rust: RUST_KEYWORDS,
    python: PYTHON_KEYWORDS,
    go: GO_KEYWORDS,
    c: CPP_KEYWORDS,
    cpp: CPP_KEYWORDS,
    java: JAVA_CS_KEYWORDS,
    kotlin: JAVA_CS_KEYWORDS,
    csharp: JAVA_CS_KEYWORDS,
    bash: BASH_KEYWORDS,
    sql: SQL_KEYWORDS,
    dockerfile: DOCKERFILE_KEYWORDS,
    lua: LUA_KEYWORDS,
};

const OPERATOR_CHARS = new Set("+-*/%=!<>|&^~?:".split(""));
const BRACKET_CHARS = new Set("{}()[]".split(""));
const DELIMITER_CHARS = new Set(".,;".split(""));

/**
 * High-performance, zero-dependency heuristic syntax highlighter.
 * 
 * Optimized for O(N) throughput with zero AST parsing overhead.
 * Serves as the ultra-fast fallback for massive files (>30K lines)
 * and powers instant Markdown code block preview rendering at 120 FPS.
 */
export class FastSyntaxHighlighter {
    /**
     * Resolves a language identifier from a file path, file name, or language alias.
     */
    public static detectLanguage(filenameOrPath: string): string {
        const clean = filenameOrPath.trim();
        if (!clean) return "plain";

        const parts = clean.split(/[/\\]/);
        const name = (parts[parts.length - 1] || "").toLowerCase();

        if (FILENAME_TO_LANG[name]) {
            return FILENAME_TO_LANG[name];
        }

        const ext = name.includes(".") ? name.split(".").pop()! : name;
        return EXT_TO_LANG[ext] ?? "plain";
    }

    private static isLineComment(line: string, i: number, len: number, lang: string): boolean {
        const ch = line[i];
        if (ch === "/" && i + 1 < len && line[i + 1] === "/") return true;
        if (ch === "#" && (lang === "python" || lang === "bash" || lang === "yaml" || lang === "toml" || lang === "dockerfile" || lang === "makefile")) return true;
        if (ch === "-" && i + 1 < len && line[i + 1] === "-" && (lang === "sql" || lang === "lua")) return true;
        return false;
    }

    /**
     * Scans a delimited string literal (e.g. `'...'`, `"..."`, `` `...` ``, `"""..."""`).
     * Handles character escape sequences `\` cleanly.
     */
    private static scanDelimited(line: string, start: number, len: number, delimiter: string): number {
        const delimLen = delimiter.length;
        let i = start + delimLen;
        while (i < len) {
            if (line[i] === "\\" && i + 1 < len) {
                i += 2;
                continue;
            }
            if (delimLen === 1) {
                if (line[i] === delimiter) {
                    return i + 1;
                }
                i++;
            } else {
                if (line.startsWith(delimiter, i)) {
                    return i + delimLen;
                }
                i++;
            }
        }
        return len;
    }

    private static isNumberStart(ch: string, nextCh: string | null): boolean {
        return (ch >= "0" && ch <= "9") || (ch === "." && nextCh !== null && nextCh >= "0" && nextCh <= "9");
    }

    /**
     * Scans numbers: decimal floats/ints, hex (0x), binary (0b), octal (0o),
     * underscores (1_000_000), exponents (1e-4), and language type suffixes (100u32, 42L).
     */
    private static scanNumber(line: string, start: number, len: number): number {
        let i = start;

        // Hexadecimal (0x...), Binary (0b...), Octal (0o...)
        if (line[i] === "0" && i + 1 < len) {
            const radix = line[i + 1].toLowerCase();
            if (radix === "x" || radix === "b" || radix === "o") {
                i += 2;
                while (i < len) {
                    const c = line[i];
                    if (
                        (c >= "0" && c <= "9") ||
                        (c >= "a" && c <= "f") ||
                        (c >= "A" && c <= "F") ||
                        c === "_"
                    ) {
                        i++;
                    } else {
                        break;
                    }
                }
                // Optional integer type suffix (e.g. 0xFFu32, 0b1010L)
                while (i < len && ((line[i] >= "a" && line[i] <= "z") || (line[i] >= "A" && line[i] <= "Z") || (line[i] >= "0" && line[i] <= "9") || line[i] === "_")) {
                    i++;
                }
                return i;
            }
        }

        // Standard decimal float / integer
        let hasDot = line[i] === ".";
        i++;
        while (i < len) {
            const c = line[i];
            if (c >= "0" && c <= "9") {
                i++;
            } else if (c === "_" && i + 1 < len && line[i + 1] >= "0" && line[i + 1] <= "9") {
                i++;
            } else if (c === "." && !hasDot && i + 1 < len && line[i + 1] >= "0" && line[i + 1] <= "9") {
                // Must be followed by a digit to be a fractional dot; otherwise it's member access (e.g. 42.toString())
                hasDot = true;
                i++;
            } else if ((c === "e" || c === "E") && i + 1 < len) {
                let exp = i + 1;
                if (line[exp] === "+" || line[exp] === "-") exp++;
                if (exp < len && line[exp] >= "0" && line[exp] <= "9") {
                    i = exp + 1;
                    while (i < len && ((line[i] >= "0" && line[i] <= "9") || line[i] === "_")) i++;
                } else {
                    break;
                }
            } else {
                break;
            }
        }

        // Optional numeric/unit type suffixes (e.g. 100u32, 1.5f64, 42L, 10px)
        while (i < len && ((line[i] >= "a" && line[i] <= "z") || (line[i] >= "A" && line[i] <= "Z") || (line[i] >= "0" && line[i] <= "9") || line[i] === "_")) {
            i++;
        }
        return i;
    }

    private static isIdentifierStart(ch: string): boolean {
        return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch === "$";
    }

    private static scanIdentifier(line: string, start: number, len: number): number {
        let i = start + 1;
        while (i < len) {
            const c = line[i];
            if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_" || c === "$") {
                i++;
            } else {
                break;
            }
        }
        return i;
    }

    private static classifyWord(word: string, language: string, nextChar: string | null): TokenType {
        // Case-insensitive keywords for SQL and Dockerfile
        if (language === "sql") {
            if (SQL_KEYWORDS.has(word.toLowerCase())) return "keyword";
        } else if (language === "dockerfile") {
            if (DOCKERFILE_KEYWORDS.has(word.toLowerCase())) return "keyword";
        }

        const keywords = LANG_KEYWORD_MAP[language] ?? GENERIC_KEYWORDS;
        if (keywords.has(word)) {
            return "keyword";
        }

        if (COMMON_PRIMITIVE_TYPES.has(word)) {
            return "type";
        }

        // PascalCase convention: Types, Classes, Interfaces, Structs (e.g. MyService, PieceTree)
        if (word.length > 1 && word[0] >= "A" && word[0] <= "Z" && word !== word.toUpperCase()) {
            return "type";
        }

        // Identifier followed by '(' is a function invocation or declaration
        if (nextChar === "(") {
            return "function";
        }

        return null;
    }

    /**
     * Tokenizes a single line of text into highlighted tokens.
     */
    public static tokenize(line: string, language: string = ""): HighlighedNode[] {
        if (!line) {
            return [{ name: null, text: "" }];
        }
        if (line === "\u200B") {
            return [{ name: null, text: "\u200B" }];
        }

        const lang = language ? language.toLowerCase() : "plain";
        const nodes: HighlighedNode[] = [];
        const len = line.length;
        let i = 0;

        const append = (name: TokenType, text: string) => {
            if (nodes.length > 0 && nodes[nodes.length - 1].name === name && (!name || !name.includes("bracket"))) {
                nodes[nodes.length - 1].text += text;
            } else {
                nodes.push({ name, text });
            }
        };

        while (i < len) {
            const ch = line[i];

            // 1. Line comment
            if (this.isLineComment(line, i, len, lang)) {
                append("comment", line.substring(i));
                break;
            }

            // 2. Block comment /* ... */
            if (ch === "/" && i + 1 < len && line[i + 1] === "*") {
                const endIdx = line.indexOf("*/", i + 2);
                if (endIdx !== -1) {
                    append("comment", line.substring(i, endIdx + 2));
                    i = endIdx + 2;
                    continue;
                } else {
                    append("comment", line.substring(i));
                    break;
                }
            }

            // 3. HTML / XML comments <!-- ... -->
            if (ch === "<" && i + 3 < len && line[i + 1] === "!" && line[i + 2] === "-" && line[i + 3] === "-") {
                const endIdx = line.indexOf("-->", i + 4);
                if (endIdx !== -1) {
                    append("comment", line.substring(i, endIdx + 3));
                    i = endIdx + 3;
                    continue;
                } else {
                    append("comment", line.substring(i));
                    break;
                }
            }

            // 4. String literals (including Python """ / ''' and JS template ` )
            if (ch === '"' || ch === "'" || ch === "`") {
                let delimiter = ch;
                if ((ch === '"' || ch === "'") && (lang === "python" || lang === "plain")) {
                    if (i + 2 < len && line[i + 1] === ch && line[i + 2] === ch) {
                        delimiter = ch + ch + ch;
                    }
                }

                const end = this.scanDelimited(line, i, len, delimiter);
                const strText = line.substring(i, end);

                let isProperty = false;
                if (delimiter.length === 1 && (lang === "json" || lang === "javascript" || lang === "typescript" || lang === "yaml")) {
                    let nextIdx = end;
                    while (nextIdx < len && (line[nextIdx] === " " || line[nextIdx] === "\t")) nextIdx++;
                    if (nextIdx < len && line[nextIdx] === ":") isProperty = true;
                }

                append(isProperty ? "property" : "string", strText);
                i = end;
                continue;
            }

            // 5. Numbers
            if (this.isNumberStart(ch, i + 1 < len ? line[i + 1] : null)) {
                const end = this.scanNumber(line, i, len);
                append("number", line.substring(i, end));
                i = end;
                continue;
            }

            // 6. Shell / PHP variables ($VAR or ${VAR})
            if ((lang === "bash" || lang === "php") && ch === "$") {
                let end = i + 1;
                if (end < len && line[end] === "{") {
                    const closeBrace = line.indexOf("}", end + 1);
                    end = closeBrace !== -1 ? closeBrace + 1 : len;
                } else {
                    while (end < len && this.isIdentifierStart(line[end])) end++;
                }
                append("variable", line.substring(i, end));
                i = end;
                continue;
            }

            // 7. Identifiers / Keywords / Types / Functions
            if (this.isIdentifierStart(ch)) {
                const end = this.scanIdentifier(line, i, len);
                const word = line.substring(i, end);

                let nextIdx = end;
                while (nextIdx < len && (line[nextIdx] === " " || line[nextIdx] === "\t")) nextIdx++;
                const nextChar = nextIdx < len ? line[nextIdx] : null;

                append(this.classifyWord(word, lang, nextChar), word);
                i = end;
                continue;
            }

            // 8. Operators
            if (OPERATOR_CHARS.has(ch)) {
                const start = i++;
                while (i < len && OPERATOR_CHARS.has(line[i])) i++;
                append("operator", line.substring(start, i));
                continue;
            }

            // 9. Punctuation & Brackets
            if (BRACKET_CHARS.has(ch)) {
                append("punctuation.bracket", ch);
                i++;
                continue;
            }
            if (DELIMITER_CHARS.has(ch)) {
                append("punctuation.delimiter", ch);
                i++;
                continue;
            }

            // 10. Plain text and whitespace
            const start = i++;
            while (
                i < len &&
                line[i] !== " " &&
                line[i] !== "\t" &&
                !OPERATOR_CHARS.has(line[i]) &&
                !BRACKET_CHARS.has(line[i]) &&
                !DELIMITER_CHARS.has(line[i]) &&
                !this.isIdentifierStart(line[i]) &&
                !this.isNumberStart(line[i], i + 1 < len ? line[i + 1] : null) &&
                line[i] !== '"' && line[i] !== "'" && line[i] !== "`" && line[i] !== "/" && line[i] !== "#" && line[i] !== "<"
            ) {
                i++;
            }
            append(null, line.substring(start, i));
        }

        return nodes.length > 0 ? nodes : [{ name: null, text: line }];
    }

    /**
     * Tokenizes a multi-line code block, maintaining cross-line state for block
     * comments, multiline template literals, and diff headers.
     */
    public static tokenizeLines(text: string, language: string = ""): HighlighedNode[][] {
        if (!text) return [];
        const lang = language ? this.detectLanguage(language) : "plain";
        const lines = text.split("\n");

        // Fast path for diff / patch views
        if (lang === "diff") {
            return lines.map((line) => {
                if (!line) return [{ name: null, text: "" }];
                if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ")) {
                    return [{ name: "comment", text: line }];
                }
                if (line.startsWith("+")) return [{ name: "diff.added", text: line }];
                if (line.startsWith("-")) return [{ name: "diff.deleted", text: line }];
                if (line.startsWith("@@")) return [{ name: "diff.hunk", text: line }];
                return [{ name: null, text: line }];
            });
        }

        let inBlockComment = false;
        let inHtmlComment = false;
        let inMultilineQuote: string | null = null;
        const result: HighlighedNode[][] = [];

        for (const line of lines) {
            if (!line) {
                result.push([{ name: null, text: "" }]);
                continue;
            }

            const nodes: HighlighedNode[] = [];
            let rest = line;

            // Handle continuation of C-style /* ... */ comment
            if (inBlockComment) {
                const endIdx = rest.indexOf("*/");
                if (endIdx !== -1) {
                    nodes.push({ name: "comment", text: rest.substring(0, endIdx + 2) });
                    rest = rest.substring(endIdx + 2);
                    inBlockComment = false;
                } else {
                    nodes.push({ name: "comment", text: rest });
                    result.push(nodes);
                    continue;
                }
            }

            // Handle continuation of HTML <!-- ... --> comment
            if (inHtmlComment) {
                const endIdx = rest.indexOf("-->");
                if (endIdx !== -1) {
                    nodes.push({ name: "comment", text: rest.substring(0, endIdx + 3) });
                    rest = rest.substring(endIdx + 3);
                    inHtmlComment = false;
                } else {
                    nodes.push({ name: "comment", text: rest });
                    result.push(nodes);
                    continue;
                }
            }

            // Handle continuation of multiline string (e.g. ` template or """ docstring)
            if (inMultilineQuote) {
                const quote = inMultilineQuote;
                let quoteEnd = -1;
                let k = 0;
                while (k < rest.length) {
                    if (rest[k] === "\\" && k + 1 < rest.length) {
                        k += 2;
                        continue;
                    }
                    if (rest.startsWith(quote, k)) {
                        quoteEnd = k;
                        break;
                    }
                    k++;
                }

                if (quoteEnd !== -1) {
                    nodes.push({ name: "string", text: rest.substring(0, quoteEnd + quote.length) });
                    rest = rest.substring(quoteEnd + quote.length);
                    inMultilineQuote = null;
                } else {
                    nodes.push({ name: "string", text: rest });
                    result.push(nodes);
                    continue;
                }
            }

            if (rest) {
                const lineTokens = this.tokenize(rest, lang);
                const lastToken = lineTokens[lineTokens.length - 1];

                if (lastToken?.name === "comment" && lastToken.text.startsWith("/*") && !lastToken.text.endsWith("*/")) {
                    inBlockComment = true;
                }

                if (lastToken?.name === "comment" && lastToken.text.startsWith("<!--") && !lastToken.text.endsWith("-->")) {
                    inHtmlComment = true;
                }

                if (
                    lastToken?.name === "string" &&
                    (lastToken.text.startsWith("`") || lastToken.text.startsWith('"""') || lastToken.text.startsWith("'''"))
                ) {
                    const q = lastToken.text.startsWith('"""') ? '"""' : lastToken.text.startsWith("'''") ? "'''" : "`";
                    const isClosed = lastToken.text.length > q.length && lastToken.text.endsWith(q);
                    if (!isClosed) inMultilineQuote = q;
                }

                nodes.push(...lineTokens);
            }

            result.push(nodes.length > 0 ? nodes : [{ name: null, text: line }]);
        }

        return result;
    }
}

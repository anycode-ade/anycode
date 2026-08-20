import { HighlighedNode } from "./code";

const TS_JS_KEYWORDS = new Set([
    "function", "class", "interface", "type", "const", "let", "var", "import",
    "export", "from", "default", "return", "if", "else", "switch", "case",
    "for", "while", "do", "break", "continue", "try", "catch", "finally",
    "throw", "async", "await", "new", "this", "null", "undefined", "true",
    "false", "typeof", "instanceof", "as", "is", "package", "private",
    "protected", "public", "readonly", "static", "extends", "implements",
    "constructor", "super", "yield", "debugger", "enum"
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
    "pass", "True", "False", "None", "self", "cls", "in", "is", "not", "and", "or", "global", "nonlocal"
]);

const GO_KEYWORDS = new Set([
    "func", "package", "import", "type", "struct", "interface", "return",
    "if", "else", "switch", "case", "default", "for", "range", "break",
    "continue", "var", "const", "go", "chan", "select", "defer",
    "nil", "true", "false", "map"
]);

const CPP_C_KEYWORDS = new Set([
    "auto", "break", "case", "const", "continue", "default", "do", "else",
    "enum", "extern", "for", "goto", "if", "inline", "register",
    "restrict", "return", "sizeof", "static", "struct", "switch",
    "typedef", "union", "volatile", "while", "class", "namespace",
    "template", "typename", "using", "public", "private", "protected",
    "virtual", "override", "constexpr", "nullptr", "true", "false"
]);

const GENERIC_KEYWORDS = new Set([
    "fn", "func", "function", "def", "class", "struct", "enum", "let", "var",
    "const", "return", "if", "else", "for", "while", "import", "export",
    "public", "private", "protected", "true", "false", "null", "nil",
    "package", "type", "interface", "void", "static"
]);

const PRIMITIVE_TYPES = new Set([
    "number", "string", "boolean", "any", "never", "unknown", "void", "symbol", "bigint",
    "Record", "Array", "Promise", "Map", "Set", "Object", "Function", "Error",
    "u8", "u16", "u32", "u64", "u128", "usize",
    "i8", "i16", "i32", "i64", "i128", "isize",
    "f32", "f64", "bool", "char", "str", "c_void",
    "void", "int", "float", "double", "long", "short",
    "unsigned", "signed", "size_t", "int32_t", "uint32_t",
    "int64_t", "uint64_t", "int16_t", "uint16_t", "int8_t", "uint8_t",
    "Some", "None", "Ok", "Err", "Result", "Option", "Vec", "String"
]);

export class FastSyntaxHighlighter {
    public static detectLanguage(filenameOrPath: string): string {
        const parts = filenameOrPath.split(/[/\\]/);
        const name = parts[parts.length - 1] || "";
        const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";

        switch (ext) {
            case "rs": return "rust";
            case "ts":
            case "tsx": return "typescript";
            case "js":
            case "jsx":
            case "mjs":
            case "cjs": return "javascript";
            case "py":
            case "pyw": return "python";
            case "go": return "go";
            case "c":
            case "h": return "c";
            case "cpp":
            case "cc":
            case "cxx":
            case "hpp":
            case "hxx": return "cpp";
            case "java": return "java";
            case "kt":
            case "kts": return "kotlin";
            case "rb": return "ruby";
            case "sh":
            case "bash":
            case "zsh": return "bash";
            case "json": return "json";
            case "toml": return "toml";
            case "yaml":
            case "yml": return "yaml";
            case "html":
            case "htm": return "html";
            case "css":
            case "scss":
            case "sass":
            case "less": return "css";
            case "md":
            case "markdown": return "markdown";
            case "sql": return "sql";
            default: {
                const lowerName = name.toLowerCase();
                if (lowerName === "cargo.lock" || lowerName === "cargo.toml") return "toml";
                if (lowerName === "package.json" || lowerName === "tsconfig.json") return "json";
                if (lowerName === "dockerfile") return "dockerfile";
                return "plain";
            }
        }
    }

    private static classifyWord(word: string, language: string, nextChar: string | null): string | null {
        let isKeyword = false;
        switch (language) {
            case "typescript":
            case "javascript":
            case "tsx":
                isKeyword = TS_JS_KEYWORDS.has(word);
                break;
            case "rust":
                isKeyword = RUST_KEYWORDS.has(word);
                break;
            case "python":
                isKeyword = PYTHON_KEYWORDS.has(word);
                break;
            case "go":
                isKeyword = GO_KEYWORDS.has(word);
                break;
            case "c":
            case "cpp":
                isKeyword = CPP_C_KEYWORDS.has(word);
                break;
            default:
                isKeyword = GENERIC_KEYWORDS.has(word);
                break;
        }

        if (isKeyword) {
            return "keyword";
        }

        if (PRIMITIVE_TYPES.has(word)) {
            return "type";
        }

        // PascalCase identifiers are usually types/interfaces/classes
        if (word.length > 0 && word[0] >= "A" && word[0] <= "Z" && word !== word.toUpperCase()) {
            return "type";
        }

        // If next non-whitespace char is '(', it is a function call or definition
        if (nextChar === "(") {
            return "function";
        }

        return null;
    }

    public static tokenize(line: string, language: string = ""): HighlighedNode[] {
        if (!line || line === "\u200B") {
            return [{ name: null, text: line || "\u200B" }];
        }

        const lang = language ? language.toLowerCase() : "plain";
        const nodes: HighlighedNode[] = [];
        const len = line.length;
        let i = 0;

        const append = (name: string | null, text: string) => {
            if (nodes.length > 0 && nodes[nodes.length - 1].name === name && (!name || !name.includes("bracket"))) {
                nodes[nodes.length - 1].text += text;
            } else {
                nodes.push({ name, text });
            }
        };

        while (i < len) {
            const ch = line[i];

            // 1. Line comments: // or # or --
            if (
                (ch === "/" && i + 1 < len && line[i + 1] === "/") ||
                ((lang === "python" || lang === "bash" || lang === "yaml" || lang === "toml" || lang === "dockerfile") && ch === "#") ||
                ((lang === "sql" || lang === "lua") && ch === "-" && i + 1 < len && line[i + 1] === "-")
            ) {
                append("comment", line.substring(i));
                break;
            }

            // 2. Block comments on a single line: /* ... */
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

            // 3. String literals: "...", '...', `...`
            if (ch === "\"" || ch === "'" || ch === "`") {
                const quote = ch;
                const start = i;
                i++;
                while (i < len) {
                    if (line[i] === "\\" && i + 1 < len) {
                        i += 2;
                        continue;
                    }
                    if (line[i] === quote) {
                        i++;
                        break;
                    }
                    i++;
                }
                append("string", line.substring(start, i));
                continue;
            }

            // 4. Numbers: 0-9 or .[0-9]
            if ((ch >= "0" && ch <= "9") || (ch === "." && i + 1 < len && line[i + 1] >= "0" && line[i + 1] <= "9")) {
                const start = i;
                i++;
                while (i < len) {
                    const c = line[i];
                    if ((c >= "0" && c <= "9") || (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "." || c === "_") {
                        i++;
                    } else {
                        break;
                    }
                }
                append("number", line.substring(start, i));
                continue;
            }

            // 5. Identifiers, keywords, types, functions
            if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch === "$") {
                const start = i;
                i++;
                while (i < len) {
                    const c = line[i];
                    if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_" || c === "$") {
                        i++;
                    } else {
                        break;
                    }
                }
                const word = line.substring(start, i);

                // Look ahead for function call '('
                let nextIdx = i;
                while (nextIdx < len && (line[nextIdx] === " " || line[nextIdx] === "\t")) {
                    nextIdx++;
                }
                const nextChar = nextIdx < len ? line[nextIdx] : null;

                const tokenType = this.classifyWord(word, lang, nextChar);
                append(tokenType, word);
                continue;
            }

            // 6. Operators: +, -, *, /, %, =, !, <, >, |, &, ^, ~, ?, :
            if ("+-*/%=!<>|&^~?:".includes(ch)) {
                const start = i;
                i++;
                while (i < len && "+-*/%=!<>|&^~?:".includes(line[i])) {
                    i++;
                }
                append("operator", line.substring(start, i));
                continue;
            }

            // 7. Punctuation & Brackets
            if ("{}()[].,;".includes(ch)) {
                const name = "{}()[]".includes(ch) ? "punctuation.bracket" : "punctuation.delimiter";
                append(name, ch);
                i++;
                continue;
            }

            // 8. Whitespace and other characters
            const start = i;
            i++;
            while (i < len) {
                const c = line[i];
                if (c === " " || c === "\t" || (!((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || "+-*/%=!<>|&^~?:{}()[].,;\"'`/#_$\n\r".includes(c)))) {
                    i++;
                } else {
                    break;
                }
            }
            append(null, line.substring(start, i));
        }

        return nodes.length > 0 ? nodes : [{ name: null, text: line }];
    }
}

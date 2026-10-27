// A mock language server for the LSP demo. It does not parse TypeScript: it finds
// declarations and identifiers with regular expressions. Answers come back after
// a short delay, like a real server. To use a real server, implement the same
// methods on top of its LSP responses.

const DECLARATION = /\b(function|class|interface|type|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
const DECLARATION_KIND = { function: 3, class: 7, interface: 8, type: 25, const: 6, let: 6, var: 6 };
const KEYWORD_KIND = 14;
const KEYWORDS = ['const', 'let', 'function', 'return', 'export', 'interface', 'type', 'class'];
const DIAGNOSTIC_RULES = [
    { pattern: /\bvar\s/, message: 'Use let or const instead of var.' },
    { pattern: /:\s*any\b/, message: 'Unexpected any. Specify a more precise type.' },
];
const WORD_CHAR = /[\w$]/;

const later = (value) => new Promise((resolve) => setTimeout(() => resolve(value), 80));

function positionAt(text, offset) {
    const before = text.slice(0, offset);
    return {
        line: before.split('\n').length - 1,
        character: offset - (before.lastIndexOf('\n') + 1),
    };
}

// Returns the identifier around (row, column) and the part of it before the column.
function wordAt(text, row, column) {
    const line = text.split('\n')[row] ?? '';
    let start = column;
    while (start > 0 && WORD_CHAR.test(line[start - 1])) start--;
    let end = column;
    while (end < line.length && WORD_CHAR.test(line[end])) end++;
    return { word: line.slice(start, end), prefix: line.slice(start, column) };
}

function declarations(text) {
    return [...text.matchAll(DECLARATION)].map((match) => {
        const name = match[2];
        const start = positionAt(text, match.index + match[0].length - name.length);
        return {
            name,
            keyword: match[1],
            start,
            end: { line: start.line, character: start.character + name.length },
        };
    });
}

export function createMockLsp(getText) {
    return {
        async completion({ row, column }) {
            const text = getText();
            const { prefix } = wordAt(text, row, column);
            const items = [
                ...declarations(text).map((d) => ({
                    label: d.name,
                    kind: DECLARATION_KIND[d.keyword],
                    detail: d.keyword,
                })),
                ...KEYWORDS.map((label) => ({ label, kind: KEYWORD_KIND })),
            ];
            return later(items.filter((item) => item.label.startsWith(prefix)));
        },

        async hover({ row, column }) {
            const text = getText();
            const { word } = wordAt(text, row, column);
            const declaration = declarations(text).find((d) => d.name === word);
            if (!declaration) return later(null);
            const line = text.split('\n')[declaration.start.line];
            return later(line.trim().replace(/\s*\{$/, ''));
        },

        async definition({ file, row, column }) {
            const text = getText();
            const { word } = wordAt(text, row, column);
            const declaration = declarations(text).find((d) => d.name === word);
            if (!declaration) return later(null);
            return later({ uri: file, range: { start: declaration.start, end: declaration.end } });
        },

        async references({ file, row, column }) {
            const text = getText();
            const { word } = wordAt(text, row, column);
            if (!word) return later([]);
            const pattern = new RegExp(`(?<![\\w$])${word.replace(/[$]/g, '\\$')}(?![\\w$])`, 'g');
            const references = [...text.matchAll(pattern)].map((match) => {
                const start = positionAt(text, match.index);
                const end = { line: start.line, character: start.character + word.length };
                return { uri: file, file, range: { start, end } };
            });
            return later(references);
        },

        // Diagnostics are computed synchronously, so a slow answer can never
        // overwrite a newer one.
        diagnostics() {
            const lines = getText().split('\n');
            return lines.flatMap((line, row) =>
                DIAGNOSTIC_RULES
                    .filter((rule) => rule.pattern.test(line))
                    .map((rule) => ({ line: row, message: rule.message })),
            );
        },
    };
}

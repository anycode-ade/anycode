import { describe, it, expect } from 'vitest';
import { FastSyntaxHighlighter } from '../src/fastSyntax';
import { Code } from '../src/code';

describe('FastSyntaxHighlighter', () => {
    it('detects language from file path/extension correctly', () => {
        expect(FastSyntaxHighlighter.detectLanguage('foo.ts')).toBe('typescript');
        expect(FastSyntaxHighlighter.detectLanguage('path/to/bar.rs')).toBe('rust');
        expect(FastSyntaxHighlighter.detectLanguage('script.py')).toBe('python');
        expect(FastSyntaxHighlighter.detectLanguage('server.go')).toBe('go');
        expect(FastSyntaxHighlighter.detectLanguage('main.cpp')).toBe('cpp');
        expect(FastSyntaxHighlighter.detectLanguage('package.json')).toBe('json');
        expect(FastSyntaxHighlighter.detectLanguage('Cargo.toml')).toBe('toml');
        expect(FastSyntaxHighlighter.detectLanguage('unknown.xyz')).toBe('plain');
    });

    it('tokenizes TypeScript code line on the fly', () => {
        const line = 'export function processRecord(payload: Record<string, unknown>): number {';
        const tokens = FastSyntaxHighlighter.tokenize(line, 'typescript');

        expect(tokens).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'keyword', text: 'export' }),
                expect.objectContaining({ name: 'keyword', text: 'function' }),
                expect.objectContaining({ name: 'function', text: 'processRecord' }),
                expect.objectContaining({ name: 'type', text: 'Record' }),
                expect.objectContaining({ name: 'type', text: 'string' }),
                expect.objectContaining({ name: 'type', text: 'unknown' }),
                expect.objectContaining({ name: 'type', text: 'number' }),
            ])
        );
    });

    it('tokenizes Rust code line on the fly', () => {
        const line = 'pub fn calculate_sum(items: &[i32]) -> i32 { // compute total';
        const tokens = FastSyntaxHighlighter.tokenize(line, 'rust');

        expect(tokens).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'keyword', text: 'pub' }),
                expect.objectContaining({ name: 'keyword', text: 'fn' }),
                expect.objectContaining({ name: 'function', text: 'calculate_sum' }),
                expect.objectContaining({ name: 'type', text: 'i32' }),
                expect.objectContaining({ name: 'comment', text: '// compute total' }),
            ])
        );
    });

    it('tokenizes Python code line with hash comment and strings', () => {
        const line = 'def greet(name: str = "world"): # greeting function';
        const tokens = FastSyntaxHighlighter.tokenize(line, 'python');

        expect(tokens).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'keyword', text: 'def' }),
                expect.objectContaining({ name: 'function', text: 'greet' }),
                expect.objectContaining({ name: 'type', text: 'str' }),
                expect.objectContaining({ name: 'string', text: '"world"' }),
                expect.objectContaining({ name: 'comment', text: '# greeting function' }),
            ])
        );
    });

    it('falls back to generic keywords for unknown languages', () => {
        const line = 'let value = 123; // custom lang';
        const tokens = FastSyntaxHighlighter.tokenize(line, 'unknown');

        expect(tokens).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'keyword', text: 'let' }),
                expect.objectContaining({ name: 'number', text: '123' }),
                expect.objectContaining({ name: 'comment', text: '// custom lang' }),
            ])
        );
    });

    it('Code uses fast syntax highlighter for files over 30,000 lines', async () => {
        const lines = Array.from({ length: 30005 }, (_, i) => `export const line_${i} = ${i};`).join('\n');
        const code = new Code(lines, 'large.ts', 'typescript');
        await code.init();

        const nodeTokens = code.getLineNodes(0);
        expect(nodeTokens).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'keyword', text: 'export' }),
                expect.objectContaining({ name: 'keyword', text: 'const' }),
                expect.objectContaining({ name: 'number', text: '0' }),
            ])
        );
    });

    it('tokenizeLines parses multiline blocks and handles language names directly', () => {
        expect(FastSyntaxHighlighter.detectLanguage('ts')).toBe('typescript');
        expect(FastSyntaxHighlighter.detectLanguage('rust')).toBe('rust');
        expect(FastSyntaxHighlighter.detectLanguage('bash')).toBe('bash');
        expect(FastSyntaxHighlighter.detectLanguage('diff')).toBe('diff');

        const block = 'const a = 1;\n/* comment\nmultiline */\nreturn a;';
        const lines = FastSyntaxHighlighter.tokenizeLines(block, 'typescript');
        expect(lines).toHaveLength(4);
        expect(lines[0]).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'keyword', text: 'const' })]));
        expect(lines[1]).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'comment' })]));
        expect(lines[2]).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'comment' })]));
        expect(lines[3]).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'keyword', text: 'return' })]));
    });

    it('tokenizeLines parses diff lines correctly', () => {
        const diffBlock = '--- a/file.ts\n+++ b/file.ts\n@@ -1,2 +1,2 @@\n-old line\n+new line';
        const lines = FastSyntaxHighlighter.tokenizeLines(diffBlock, 'diff');
        expect(lines).toHaveLength(5);
        expect(lines[0][0].name).toBe('comment');
        expect(lines[2][0].name).toBe('diff.hunk');
        expect(lines[3][0].name).toBe('diff.deleted');
        expect(lines[4][0].name).toBe('diff.added');
    });

    it('tokenizes SQL case-insensitively', () => {
        const line = 'SELECT id, name FROM users WHERE active = true;';
        const tokens = FastSyntaxHighlighter.tokenize(line, 'sql');
        expect(tokens).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'keyword', text: 'SELECT' }),
                expect.objectContaining({ name: 'keyword', text: 'FROM' }),
                expect.objectContaining({ name: 'keyword', text: 'WHERE' }),
                expect.objectContaining({ name: 'keyword', text: 'true' }),
            ])
        );
    });

    it('tokenizes Python multiline docstrings cleanly', () => {
        const pyCode = 'def hello():\n    """Multiline\n    docstring"""\n    return 42';
        const lines = FastSyntaxHighlighter.tokenizeLines(pyCode, 'python');
        expect(lines).toHaveLength(4);
        expect(lines[1]).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'string' })]));
        expect(lines[2]).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'string' })]));
        expect(lines[3]).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'keyword', text: 'return' })]));
    });

    it('distinguishes number from method call', () => {
        const line = 'const str = 42.toString(); const pi = 3.14;';
        const tokens = FastSyntaxHighlighter.tokenize(line, 'typescript');
        expect(tokens).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'number', text: '42' }),
                expect.objectContaining({ name: 'punctuation.delimiter', text: '.' }),
                expect.objectContaining({ name: 'function', text: 'toString' }),
                expect.objectContaining({ name: 'number', text: '3.14' }),
            ])
        );
    });

    it('classifies JSON keys as properties and values as strings/numbers', () => {
        const line = '  "status": "success", "count": 100';
        const tokens = FastSyntaxHighlighter.tokenize(line, 'json');
        expect(tokens).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'property', text: '"status"' }),
                expect.objectContaining({ name: 'string', text: '"success"' }),
                expect.objectContaining({ name: 'property', text: '"count"' }),
                expect.objectContaining({ name: 'number', text: '100' }),
            ])
        );
    });

    it('handles escaped quotes inside strings without breaking', () => {
        const line = 'const str = "escaped \\" quote and \\\\ backslash";';
        const tokens = FastSyntaxHighlighter.tokenize(line, 'typescript');
        const strToken = tokens.find((t) => t.name === 'string');
        expect(strToken?.text).toBe('"escaped \\" quote and \\\\ backslash"');
    });

    it('handles multiline template strings across lines', () => {
        const templateCode = 'const msg = `hello\nworld\nend`;';
        const lines = FastSyntaxHighlighter.tokenizeLines(templateCode, 'typescript');
        expect(lines).toHaveLength(3);
        expect(lines[0]).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'string' })]));
        expect(lines[1]).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'string', text: 'world' })]));
        expect(lines[2]).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'string', text: 'end`' })]));
    });

    it('handles multiline HTML comments and mid-line recovery', () => {
        const htmlCode = '<!-- start\nend --><div>text</div>';
        const lines = FastSyntaxHighlighter.tokenizeLines(htmlCode, 'html');
        expect(lines).toHaveLength(2);
        expect(lines[0][0]).toEqual(expect.objectContaining({ name: 'comment', text: '<!-- start' }));
        expect(lines[1][0]).toEqual(expect.objectContaining({ name: 'comment', text: 'end -->' }));
    });

    it('resumes parsing code on the same line after closing a block comment', () => {
        const code = '/* note */ const active = true;';
        const tokens = FastSyntaxHighlighter.tokenize(code, 'typescript');
        expect(tokens[0]).toEqual(expect.objectContaining({ name: 'comment', text: '/* note */' }));
        expect(tokens).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'keyword', text: 'const' }),
                expect.objectContaining({ name: 'keyword', text: 'true' }),
            ])
        );
    });

    it('highlights bash variables and commands', () => {
        const line = 'echo "$HOME and ${USER_DIR}"';
        const tokens = FastSyntaxHighlighter.tokenize(line, 'bash');
        expect(tokens).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'keyword', text: 'echo' }),
                expect.objectContaining({ name: 'string' }),
            ])
        );

        const unquoted = 'export PATH=$PATH:/usr/bin';
        const unquotedTokens = FastSyntaxHighlighter.tokenize(unquoted, 'bash');
        expect(unquotedTokens).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'keyword', text: 'export' }),
                expect.objectContaining({ name: 'variable', text: '$PATH' }),
            ])
        );
    });

    it('scans hex, binary, octal, underscores and number suffixes', () => {
        const line = 'const hex = 0xFF; const bin = 0b1010; const large = 1_000_000u64;';
        const tokens = FastSyntaxHighlighter.tokenize(line, 'rust');
        expect(tokens).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'number', text: '0xFF' }),
                expect.objectContaining({ name: 'number', text: '0b1010' }),
                expect.objectContaining({ name: 'number', text: '1_000_000u64' }),
            ])
        );
    });

    it('handles empty lines and zero-width spaces without errors', () => {
        expect(FastSyntaxHighlighter.tokenize('')).toEqual([{ name: null, text: '' }]);
        expect(FastSyntaxHighlighter.tokenize('\u200B')).toEqual([{ name: null, text: '\u200B' }]);
        expect(FastSyntaxHighlighter.tokenizeLines('')).toEqual([]);
        expect(FastSyntaxHighlighter.tokenizeLines('\n\n')).toEqual([
            [{ name: null, text: '' }],
            [{ name: null, text: '' }],
            [{ name: null, text: '' }],
        ]);
    });
});

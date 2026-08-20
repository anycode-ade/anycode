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
});

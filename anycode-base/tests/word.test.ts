import { describe, it, expect } from 'vitest';
import { Code } from '../src/code';

describe('Code.getWordAtPosition', () => {
    it('should return correct words under cursor', () => {
        const code = new Code('const find_tree = 123;\n  another_word\n', 'test.js', 'javascript');

        // Line 0: "const find_tree = 123;"
        // "const" is cols 0-5
        expect(code.getWordAtPosition(0, 0)).toEqual({ text: 'const', token: null });
        expect(code.getWordAtPosition(0, 3)).toEqual({ text: 'const', token: null });
        expect(code.getWordAtPosition(0, 5)).toEqual({ text: 'const', token: null });

        // Space at col 5 is adjacent to both "const" and "find_tree" (since index 5 is space and index 4 is 't')
        // Actually, let's verify if index 5 is space:
        // 'c'(0), 'o'(1), 'n'(2), 's'(3), 't'(4), ' '(5)
        // At col 5, index 5 is ' ', index 4 is 't' (word char). So it touches "const"
        expect(code.getWordAtPosition(0, 5)).toEqual({ text: 'const', token: null });

        // Col 6 is 'f'. Touches "find_tree"
        expect(code.getWordAtPosition(0, 6)).toEqual({ text: 'find_tree', token: null });
        expect(code.getWordAtPosition(0, 10)).toEqual({ text: 'find_tree', token: null }); // 't' in tree
        expect(code.getWordAtPosition(0, 15)).toEqual({ text: 'find_tree', token: null }); // right after 'e' (touches it)
        // Space at col 16: "const find_tree = 123;"
        // Index 15 is '=' (not word char), index 16 is ' '. Neither is word char.
        expect(code.getWordAtPosition(0, 16)).toBe(null);

        // "123" is cols 18-21
        expect(code.getWordAtPosition(0, 18)).toEqual({ text: '123', token: null });
        expect(code.getWordAtPosition(0, 21)).toEqual({ text: '123', token: null });

        // Line 1: "  another_word"
        expect(code.getWordAtPosition(1, 0)).toBe(null); // too far from word
        expect(code.getWordAtPosition(1, 1)).toBe(null); // too far
        expect(code.getWordAtPosition(1, 2)).toEqual({ text: 'another_word', token: null }); // at 'a'
    });

    it('should retrieve words by offset', () => {
        const code = new Code('abc def', 'test.js', 'javascript');
        // 'a'(0), 'b'(1), 'c'(2), ' '(3), 'd'(4), 'e'(5), 'f'(6)
        expect(code.getWordAtOffset(0)).toEqual({ text: 'abc', token: null });
        expect(code.getWordAtOffset(1)).toEqual({ text: 'abc', token: null });
        expect(code.getWordAtOffset(3)).toEqual({ text: 'abc', token: null }); // touches 'c'
        expect(code.getWordAtOffset(4)).toEqual({ text: 'def', token: null });
        expect(code.getWordAtOffset(7)).toEqual({ text: 'def', token: null }); // touches 'f'
        expect(code.getWordAtOffset(8)).toBe(null); // out of range
    });

    it('should detect unicode words (cyrillic and cjk)', () => {
        const code = new Code('привет 你好 _x42', 'test.js', 'javascript');

        // Cyrillic
        expect(code.getWordAtPosition(0, 0)).toEqual({ text: 'привет', token: null });
        expect(code.getWordAtPosition(0, 3)).toEqual({ text: 'привет', token: null });
        expect(code.getWordAtPosition(0, 6)).toEqual({ text: 'привет', token: null }); // right boundary touch

        // CJK
        expect(code.getWordAtPosition(0, 7)).toEqual({ text: '你好', token: null });
        expect(code.getWordAtPosition(0, 8)).toEqual({ text: '你好', token: null });
        expect(code.getWordAtPosition(0, 9)).toEqual({ text: '你好', token: null }); // right boundary touch

        // underscore + digits still works
        expect(code.getWordAtPosition(0, 10)).toEqual({ text: '_x42', token: null });
        expect(code.getWordAtPosition(0, 14)).toEqual({ text: '_x42', token: null }); // right boundary touch
    });

    it('should not treat emoji grapheme clusters as word characters', () => {
        const code = new Code('foo 👨‍👩‍👧‍👦 bar', 'test.js', 'javascript');

        expect(code.getWordAtPosition(0, 1)).toEqual({ text: 'foo', token: null });
        expect(code.getWordAtPosition(0, 3)).toEqual({ text: 'foo', token: null }); // boundary touch
        expect(code.getWordAtPosition(0, 5)).toBe(null); // emoji start
        expect(code.getWordAtPosition(0, 10)).toBe(null); // inside emoji cluster (code unit index)
        expect(code.getWordAtPosition(0, 15)).toBe(null); // whitespace after emoji cluster
        expect(code.getWordAtPosition(0, 16)).toEqual({ text: 'bar', token: null });
    });
});

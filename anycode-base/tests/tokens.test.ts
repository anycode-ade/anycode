import { describe, it, expect } from 'vitest';
import { TokenDictionary, BinaryTokens } from '../src/tokens';
import type { HighlighedNode } from '../src/code';

describe('TokenDictionary', () => {
    it('should assign unique numeric IDs to token names', () => {
        const id1 = TokenDictionary.getId('keyword');
        const id2 = TokenDictionary.getId('string');
        const id3 = TokenDictionary.getId('keyword');
        const idNull = TokenDictionary.getId(null);

        expect(idNull).toBe(0);
        expect(id1).toBeGreaterThan(0);
        expect(id2).toBeGreaterThan(0);
        expect(id1).not.toBe(id2);
        expect(id3).toBe(id1);
    });

    it('should precompute CSS class strings with fallback parts', () => {
        const id = TokenDictionary.getId('function.method');
        const classString = TokenDictionary.getClassString(id);

        expect(classString).toBe('function.method function method');
    });
});

describe('BinaryTokens', () => {
    it('should encode and decode nodes losslessly', () => {
        const lineText = 'const x = 42;';
        const nodes: HighlighedNode[] = [
            { name: 'keyword', text: 'const' },
            { name: null, text: ' ' },
            { name: 'variable', text: 'x' },
            { name: null, text: ' = ' },
            { name: 'number', text: '42' },
            { name: null, text: ';' },
        ];

        const binary = BinaryTokens.encode(nodes);
        expect(binary).toBeInstanceOf(Uint32Array);
        expect(binary.length).toBe(nodes.length * 2);

        const decoded = BinaryTokens.decode(binary, lineText);
        expect(decoded).toEqual(nodes);
    });

    it('should produce fast and deterministic hash', () => {
        const lineText = 'function test() {}';
        const nodes: HighlighedNode[] = [
            { name: 'keyword', text: 'function' },
            { name: null, text: ' ' },
            { name: 'function', text: 'test' },
            { name: null, text: '() {}' },
        ];

        const binary = BinaryTokens.encode(nodes);
        const hash1 = BinaryTokens.fastHash(binary, lineText);
        const hash2 = BinaryTokens.fastHash(binary, lineText);

        expect(hash1).toBeTypeOf('number');
        expect(hash1).toBe(hash2);
    });
});

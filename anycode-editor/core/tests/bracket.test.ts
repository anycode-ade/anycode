import { describe, it, expect } from 'vitest';
import { Code } from '../src/code';

describe('Code.getMatchingBracket', () => {
    it('should match basic brackets', () => {
        const code = new Code('const a = (1 + 2);', 'test.js', 'javascript');
        
        // Under cursor is '(' (offset 10)
        expect(code.getMatchingBracket(10)).toEqual({ openOffset: 10, closeOffset: 16 });
        
        // Right after '(' (offset 11) is also matching because offset-1 is '('
        expect(code.getMatchingBracket(11)).toEqual({ openOffset: 10, closeOffset: 16 });
        
        // Under cursor is ')' (offset 16)
        expect(code.getMatchingBracket(16)).toEqual({ openOffset: 10, closeOffset: 16 });
        
        // Right after ')' (offset 17) is also matching because offset-1 is ')'
        expect(code.getMatchingBracket(17)).toEqual({ openOffset: 10, closeOffset: 16 });
    });

    it('should handle nested brackets', () => {
        const code = new Code('{ [ ( ) ] }', 'test.js', 'javascript');
        
        // '{' is at 0, '}' is at 10
        expect(code.getMatchingBracket(0)).toEqual({ openOffset: 0, closeOffset: 10 });
        expect(code.getMatchingBracket(1)).toEqual({ openOffset: 0, closeOffset: 10 });
        
        // '[' is at 2, ']' is at 8
        expect(code.getMatchingBracket(2)).toEqual({ openOffset: 2, closeOffset: 8 });
        expect(code.getMatchingBracket(3)).toEqual({ openOffset: 2, closeOffset: 8 });
        
        // '(' is at 4, ')' is at 6
        expect(code.getMatchingBracket(4)).toEqual({ openOffset: 4, closeOffset: 6 });
        expect(code.getMatchingBracket(5)).toEqual({ openOffset: 4, closeOffset: 6 });
    });

    it('should ignore unmatched brackets', () => {
        const code = new Code('const a = (1 + 2;', 'test.js', 'javascript');
        expect(code.getMatchingBracket(10)).toBeNull();
    });
});

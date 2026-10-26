import { describe, it, expect } from 'vitest';
import { Code, Edit, Operation } from '../src/code';
import { applyEditsKeepingPoints, transformOffset } from '../src/remoteEdits';

const insert = (start: number, text: string): Edit => ({ operation: Operation.Insert, start, text });
const remove = (start: number, text: string): Edit => ({ operation: Operation.Remove, start, text });

describe('transformOffset', () => {
    it('moves offsets at or after an insert, not before it', () => {
        expect(transformOffset(5, insert(5, 'ab'))).toBe(7);
        expect(transformOffset(9, insert(5, 'ab'))).toBe(11);
        expect(transformOffset(4, insert(5, 'ab'))).toBe(4);
    });

    it('moves offsets after a removal left by its length, and collapses offsets inside it', () => {
        expect(transformOffset(10, remove(3, 'xy'))).toBe(8); // after the range
        expect(transformOffset(3, remove(3, 'xy'))).toBe(3); // at the start
        expect(transformOffset(4, remove(3, 'xy'))).toBe(3); // inside
        expect(transformOffset(5, remove(3, 'xy'))).toBe(3); // at the end
        expect(transformOffset(2, remove(3, 'xy'))).toBe(2); // before
    });
});

describe('applyEditsKeepingPoints', () => {
    it('keeps the caret before a closing quote when a character to its left is removed', () => {
        // X="Protobuf" -- caret sits right before the closing quote (offset 11).
        const code = new Code('X="Protobuf"', 'test.js', 'javascript');
        const [caret] = applyEditsKeepingPoints(code, [remove(10, 'f')], [{ row: 0, column: 11 }]);

        expect(code.line(0)).toBe('X="Protobu"');
        expect(caret).toEqual({ row: 0, column: 10 });
        expect(code.line(0)[caret.column]).toBe('"');
    });

    it('moves the caret after text inserted before it, and leaves it when inserted after', () => {
        const code = new Code('abcdef', 'test.js', 'javascript');
        const [caret] = applyEditsKeepingPoints(code, [insert(2, 'XY')], [{ row: 0, column: 4 }]);
        expect(caret).toEqual({ row: 0, column: 6 });

        const code2 = new Code('abcdef', 'test.js', 'javascript');
        const [caret2] = applyEditsKeepingPoints(code2, [insert(5, 'XY')], [{ row: 0, column: 4 }]);
        expect(caret2).toEqual({ row: 0, column: 4 });
    });

    it('collapses the caret to the start of a removed range that contains it', () => {
        const code = new Code('abcdef', 'test.js', 'javascript');
        const [caret] = applyEditsKeepingPoints(code, [remove(1, 'bcd')], [{ row: 0, column: 3 }]);
        expect(code.line(0)).toBe('aef');
        expect(caret).toEqual({ row: 0, column: 1 });
    });

    it('treats each edit offset as relative to the buffer after the previous edit', () => {
        const code = new Code('abcdef', 'test.js', 'javascript');
        const [caret] = applyEditsKeepingPoints(
            code,
            [remove(0, 'a'), remove(0, 'b')],
            [{ row: 0, column: 6 }],
        );
        expect(code.line(0)).toBe('cdef');
        expect(caret).toEqual({ row: 0, column: 4 });
    });

    it('maps several points consistently across lines', () => {
        const code = new Code('one\ntwo\nthree', 'test.js', 'javascript');
        // Joining "one" and "two": points on the following lines move up by one row.
        const [a, b] = applyEditsKeepingPoints(
            code,
            [remove(3, '\n')],
            [{ row: 1, column: 1 }, { row: 2, column: 2 }],
        );
        expect(code.line(0)).toBe('onetwo');
        expect(a).toEqual({ row: 0, column: 4 });
        expect(b).toEqual({ row: 1, column: 2 });
    });
});

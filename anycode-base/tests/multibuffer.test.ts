import { describe, expect, it } from 'vitest';
import { Code } from '../src/code';
import { MultiBufferCode } from '../src/multibuffer';

describe('MultiBufferCode', () => {
    it('keeps deleted-file entries read-only', () => {
        const currentCode = new Code('', 'deleted.ts', '');
        const multibuffer = new MultiBufferCode([{
            id: 'deleted.ts',
            path: 'deleted.ts',
            readOnly: true,
            code: currentCode,
            originalCode: new Code('export const removed = true;\n', 'deleted.ts', ''),
        }]);

        multibuffer.insert('unexpected', multibuffer.getOffset(1, 0));

        expect(currentCode.getContent()).toBe('');
    });

    it('uses the active file Code history for undo and redo', () => {
        const firstCode = new Code('first', 'first.ts', '');
        const secondCode = new Code('second', 'second.ts', '');
        const multibuffer = new MultiBufferCode([
            { id: 'first.ts', path: 'first.ts', code: firstCode, originalCode: new Code('', 'first.ts', '') },
            { id: 'second.ts', path: 'second.ts', code: secondCode, originalCode: new Code('', 'second.ts', '') },
        ]);

        const firstOffset = multibuffer.getOffset(1, firstCode.getContentLength());
        multibuffer.insert('!', firstOffset);
        const secondOffset = multibuffer.getOffset(3, secondCode.getContentLength());
        multibuffer.insert('?', secondOffset);

        expect(multibuffer.undo(secondOffset)).toBeDefined();
        expect(firstCode.getContent()).toBe('first!');
        expect(secondCode.getContent()).toBe('second');
        expect(multibuffer.undo(secondOffset)).toBeUndefined();

        expect(multibuffer.undo(firstOffset)).toBeDefined();
        expect(firstCode.getContent()).toBe('first');
        expect(multibuffer.redo(firstOffset)).toBeDefined();
        expect(firstCode.getContent()).toBe('first!');
    });
});

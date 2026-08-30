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

    it('updates cursor position correctly on Enter when header stats change', async () => {
        const initialText = '## English Documentation\n\n### 1. Overview';
        const currentCode = new Code(initialText, 'multibuffer.md', '');
        const originalCode = new Code(initialText, 'multibuffer.md', '');
        const multibuffer = new MultiBufferCode([
            { id: 'multibuffer.md', path: 'multibuffer.md', code: currentCode, originalCode }
        ]);

        // Line 0: Header (▾ multibuffer.md)
        // Line 1: ## English Documentation
        // Line 2: (empty line)
        // Line 3: ### 1. Overview
        const line2Offset = multibuffer.getOffset(2, 0);
        const { handleEnter } = await import('../src/actions');

        const result = handleEnter({
            code: multibuffer,
            offset: line2Offset,
        });

        expect(result.changed).toBe(true);
        const pos = multibuffer.getPosition(result.ctx.offset);
        expect(pos.line).toBe(3);
        expect(pos.column).toBe(0);
    });

    it('updates cursor position correctly on text input and backspace across diff changes', async () => {
        const initialText = 'hello\nworld';
        const currentCode = new Code(initialText, 'test.txt', '');
        const originalCode = new Code(initialText, 'test.txt', '');
        const multibuffer = new MultiBufferCode([
            { id: 'test.txt', path: 'test.txt', code: currentCode, originalCode }
        ]);

        const { handleTextInput, handleBackspace } = await import('../src/actions');

        // Initial cursor at Line 1 (hello), Column 5
        let offset = multibuffer.getOffset(1, 5);
        let result = handleTextInput({
            code: multibuffer,
            offset,
            event: { key: '!' } as any,
        });

        expect(result.changed).toBe(true);
        let pos = multibuffer.getPosition(result.ctx.offset);
        expect(pos.line).toBe(1);
        expect(pos.column).toBe(6);

        // Now backspace the '!'
        result = handleBackspace({
            code: multibuffer,
            offset: result.ctx.offset,
        });

        expect(result.changed).toBe(true);
        pos = multibuffer.getPosition(result.ctx.offset);
        expect(pos.line).toBe(1);
        expect(pos.column).toBe(5);
        expect(currentCode.getContent()).toBe('hello\nworld');
    });

    it('handles 10 consecutive Enter presses with verification on each step', async () => {
        const initialText = '## English Documentation\n\n### 1. Overview';
        const currentCode = new Code(initialText, 'multibuffer.md', '');
        const originalCode = new Code(initialText, 'multibuffer.md', '');
        const multibuffer = new MultiBufferCode([
            { id: 'multibuffer.md', path: 'multibuffer.md', code: currentCode, originalCode }
        ]);

        const { handleEnter } = await import('../src/actions');

        // Line 0: Header (▾ multibuffer.md)
        // Line 1: ## English Documentation
        // Line 2: (empty line)
        // Line 3: ### 1. Overview
        let currentOffset = multibuffer.getOffset(2, 0);

        for (let i = 1; i <= 10; i++) {
            const result = handleEnter({
                code: multibuffer,
                offset: currentOffset,
            });

            expect(result.changed).toBe(true);
            const pos = multibuffer.getPosition(result.ctx.offset);

            // After each Enter, cursor must move down exactly 1 line
            const expectedLine = 2 + i;
            expect(pos.line).toBe(expectedLine);
            expect(pos.column).toBe(0);

            // The line at cursor must be empty (new line)
            expect(multibuffer.line(pos.line)).toBe('');

            // Update offset for the next Enter key press
            currentOffset = result.ctx.offset;
        }

        // Total lines: 1 (header) + 2 (docs & overview) + 11 (empty lines) = 14 rows
        expect(multibuffer.linesLength()).toBe(14);
    });

    it('handles 10 consecutive Enter presses in the second file of a multi-file buffer', async () => {
        const file1Code = new Code('line1\nline2', 'file1.ts', '');
        const file1Original = new Code('', 'file1.ts', '');
        const file2Code = new Code('start\nmiddle\nend', 'file2.ts', '');
        const file2Original = new Code('start\nmiddle\nend', 'file2.ts', '');

        const multibuffer = new MultiBufferCode([
            { id: 'file1.ts', path: 'file1.ts', code: file1Code, originalCode: file1Original },
            { id: 'file2.ts', path: 'file2.ts', code: file2Code, originalCode: file2Original },
        ]);

        const { handleEnter } = await import('../src/actions');

        // File 1 header: Line 0
        // File 1 line1: Line 1
        // File 1 line2: Line 2
        // File 2 header: Line 3
        // File 2 start: Line 4
        // File 2 middle: Line 5
        // File 2 end: Line 6
        let currentOffset = multibuffer.getOffset(5, 0);

        for (let i = 1; i <= 10; i++) {
            const result = handleEnter({
                code: multibuffer,
                offset: currentOffset,
            });

            expect(result.changed).toBe(true);
            const pos = multibuffer.getPosition(result.ctx.offset);

            const expectedLine = 5 + i;
            expect(pos.line).toBe(expectedLine);
            expect(pos.column).toBe(0);

            currentOffset = result.ctx.offset;
        }

        expect(file2Code.linesLength()).toBe(13); // 3 original + 10 added
    });
});

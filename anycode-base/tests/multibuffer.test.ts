import { beforeAll, describe, expect, it } from 'vitest';
import { Code } from '../src/code';
import { MultiBufferCode } from '../src/multibuffer';
import { Selection } from '../src/selection';
import { setWasmBasePath } from '../src/utils';
import * as path from 'path';

describe('MultiBufferCode', () => {
    beforeAll(() => {
        setWasmBasePath(path.resolve(__dirname, '../wasm') + '/');
    });
    it('keeps deleted-file entries read-only', () => {
        const currentCode = new Code('', 'deleted.ts', '');
        const multibuffer = new MultiBufferCode([{
            id: 'deleted.ts',
            path: 'deleted.ts',
            readOnly: true,
            code: currentCode,
            originalCode: new Code('export const removed = true;\n', 'deleted.ts', ''),
        }]);

        multibuffer.insertAt({ row: 1, column: 0 }, 'unexpected');

        expect(currentCode.getContent()).toBe('');
    });

    it('uses the active file Code history for undo and redo', () => {
        const firstCode = new Code('first', 'first.ts', '');
        const secondCode = new Code('second', 'second.ts', '');
        const multibuffer = new MultiBufferCode([
            { id: 'first.ts', path: 'first.ts', code: firstCode, originalCode: new Code('', 'first.ts', '') },
            { id: 'second.ts', path: 'second.ts', code: secondCode, originalCode: new Code('', 'second.ts', '') },
        ]);

        const firstPoint = { row: 1, column: firstCode.getContentLength() };
        multibuffer.insertAt(firstPoint, '!', true);
        const secondPoint = { row: 3, column: secondCode.getContentLength() };
        multibuffer.insertAt(secondPoint, '?', true);

        expect(multibuffer.undo(secondPoint)).toBeDefined();
        expect(firstCode.getContent()).toBe('first!');
        expect(secondCode.getContent()).toBe('second');
        expect(multibuffer.undo(secondPoint)).toBeUndefined();

        expect(multibuffer.undo(firstPoint)).toBeDefined();
        expect(firstCode.getContent()).toBe('first');
        expect(multibuffer.redo(firstPoint)).toBeDefined();
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
        const { handleEnter } = await import('../src/actions');

        const result = handleEnter({
            code: multibuffer,
            cursor: { row: 2, column: 0 },
        });

        expect(result.changed).toBe(true);
        expect(result.ctx.cursor.row).toBe(3);
        expect(result.ctx.cursor.column).toBe(0);
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
        let result = handleTextInput({
            code: multibuffer,
            cursor: { row: 1, column: 5 },
            event: { key: '!' } as any,
        });

        expect(result.changed).toBe(true);
        expect(result.ctx.cursor.row).toBe(1);
        expect(result.ctx.cursor.column).toBe(6);

        // Now backspace the '!'
        result = handleBackspace({
            code: multibuffer,
            cursor: result.ctx.cursor,
        });

        expect(result.changed).toBe(true);
        expect(result.ctx.cursor.row).toBe(1);
        expect(result.ctx.cursor.column).toBe(5);
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
        let currentCursor: Point = { row: 2, column: 0 };

        for (let i = 1; i <= 10; i++) {
            const result = handleEnter({
                code: multibuffer,
                cursor: currentCursor,
            });

            expect(result.changed).toBe(true);

            // After each Enter, cursor must move down exactly 1 line
            const expectedLine = 2 + i;
            expect(result.ctx.cursor.row).toBe(expectedLine);
            expect(result.ctx.cursor.column).toBe(0);

            // The line at cursor must be empty (new line)
            expect(multibuffer.line(result.ctx.cursor.row)).toBe('');

            // Update cursor for the next Enter key press
            currentCursor = result.ctx.cursor;
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
        let currentCursor: Point = { row: 5, column: 0 };

        for (let i = 1; i <= 10; i++) {
            const result = handleEnter({
                code: multibuffer,
                cursor: currentCursor,
            });

            expect(result.changed).toBe(true);

            const expectedLine = 5 + i;
            expect(result.ctx.cursor.row).toBe(expectedLine);
            expect(result.ctx.cursor.column).toBe(0);

            currentCursor = result.ctx.cursor;
        }

        expect(file2Code.linesLength()).toBe(13); // 3 original + 10 added
    });

    it('identifies editable lines and clamps points away from header rows', () => {
        const file1Code = new Code('line1\nline2', 'file1.ts', '');
        const file2Code = new Code('lineA\nlineB', 'file2.ts', '');

        const multibuffer = new MultiBufferCode([
            { id: 'file1.ts', path: 'file1.ts', code: file1Code },
            { id: 'file2.ts', path: 'file2.ts', code: file2Code },
        ]);

        // Row 0: Header (file1.ts)
        // Row 1: line1
        // Row 2: line2
        // Row 3: Header (file2.ts)
        // Row 4: lineA
        // Row 5: lineB
        expect(multibuffer.isLineEditable(0)).toBe(false);
        expect(multibuffer.isLineEditable(1)).toBe(true);
        expect(multibuffer.isLineEditable(2)).toBe(true);
        expect(multibuffer.isLineEditable(3)).toBe(false);
        expect(multibuffer.isLineEditable(4)).toBe(true);
        expect(multibuffer.isLineEditable(5)).toBe(true);

        expect(multibuffer.findFirstEditableLine()).toBe(1);

        // Clamping row 0 should move down to row 1
        expect(multibuffer.clampPoint({ row: 0, column: 0 })).toEqual({ row: 1, column: 0 });
        // Clamping row 3 should move to row 4 (or 2 if preferDirection is -1)
        expect(multibuffer.clampPoint({ row: 3, column: 0 }, 1)).toEqual({ row: 4, column: 0 });
        expect(multibuffer.clampPoint({ row: 3, column: 0 }, -1)).toEqual({ row: 2, column: 0 });
    });

    it('prevents arrow navigation and backspace from moving cursor to header row', async () => {
        const file1Code = new Code('line1', 'file1.ts', '');
        const file2Code = new Code('lineA', 'file2.ts', '');

        const multibuffer = new MultiBufferCode([
            { id: 'file1.ts', path: 'file1.ts', code: file1Code },
            { id: 'file2.ts', path: 'file2.ts', code: file2Code },
        ]);

        const { moveArrowUp, moveArrowDown, handleBackspace } = await import('../src/actions');

        // Arrow Up at row 1 col 0: should stay at row 1, never go to row 0 header
        const upResult = moveArrowUp({
            code: multibuffer,
            cursor: { row: 1, column: 0 },
        });
        expect(upResult.ctx.cursor.row).toBe(1);

        // Arrow Down at row 1: next line is row 2? Wait: row 0=header, row 1=line1, row 2=header2, row 3=lineA
        // Arrow Down from row 1 should jump over row 2 header to row 3 lineA
        const downResult = moveArrowDown({
            code: multibuffer,
            cursor: { row: 1, column: 0 },
        });
        expect(downResult.ctx.cursor.row).toBe(3);

        // Arrow Up from row 3 should jump over row 2 header to row 1
        const upFrom3 = moveArrowUp({
            code: multibuffer,
            cursor: { row: 3, column: 0 },
        });
        expect(upFrom3.ctx.cursor.row).toBe(1);

        // Backspace at row 1 col 0: should do nothing, never delete into or jump to row 0 header
        const bsResult = handleBackspace({
            code: multibuffer,
            cursor: { row: 1, column: 0 },
        });
        expect(bsResult.changed).toBe(false);
        expect(bsResult.ctx.cursor.row).toBe(1);

        // Backspace at row 3 col 0 (first line of file 2): should do nothing, never delete into or jump to file 1
        const bsResultFile2 = handleBackspace({
            code: multibuffer,
            cursor: { row: 3, column: 0 },
        });
        expect(bsResultFile2.changed).toBe(false);
        expect(bsResultFile2.ctx.cursor.row).toBe(3);
    });

    it('supports undo and redo with actions (handleTextInput, handleEnter) restoring cursor', async () => {
        const fileCode = new Code('const x = 1;', 'file.ts', '');
        const multibuffer = new MultiBufferCode([
            { id: 'file.ts', path: 'file.ts', code: fileCode, originalCode: new Code('const x = 1;', 'file.ts', '') },
        ]);

        const { handleTextInput, handleUndo, handleRedo } = await import('../src/actions');

        // Row 0: Header
        // Row 1: const x = 1;
        const initialCursor = { row: 1, column: 12 };
        const inputResult = handleTextInput({
            code: multibuffer,
            cursor: initialCursor,
            event: { key: ' // note' } as any,
        });

        expect(inputResult.changed).toBe(true);
        expect(fileCode.getContent()).toBe('const x = 1; // note');
        expect(inputResult.ctx.cursor).toEqual({ row: 1, column: 20 });

        // Undo
        const undoResult = handleUndo({
            code: multibuffer,
            cursor: inputResult.ctx.cursor,
        });

        expect(undoResult.changed).toBe(true);
        expect(fileCode.getContent()).toBe('const x = 1;');
        expect(undoResult.ctx.cursor).toEqual({ row: 1, column: 12 });

        // Redo
        const redoResult = handleRedo({
            code: multibuffer,
            cursor: undoResult.ctx.cursor,
        });

        expect(redoResult.changed).toBe(true);
        expect(fileCode.getContent()).toBe('const x = 1; // note');
        expect(redoResult.ctx.cursor).toEqual({ row: 1, column: 20 });
    });

    it('selects entire document on handleSelectAll without moving cursor', async () => {
        const file1Code = new Code('line1\nline2', 'file1.ts', '');
        const file2Code = new Code('lineA\nlineB', 'file2.ts', '');

        const multibuffer = new MultiBufferCode([
            { id: 'file1.ts', path: 'file1.ts', code: file1Code },
            { id: 'file2.ts', path: 'file2.ts', code: file2Code },
        ]);

        const { handleSelectAll } = await import('../src/actions');

        const initialCursor = { row: 2, column: 3 };
        const result = handleSelectAll({
            code: multibuffer,
            cursor: initialCursor,
        });

        expect(result.changed).toBe(false);
        // Cursor position should NOT be altered to the end of the buffer
        expect(result.ctx.cursor).toEqual(initialCursor);
        // Selection should span first editable line to the end of the document
        expect(result.ctx.selection).toBeDefined();
        const [start, end] = result.ctx.selection!.sorted();
        expect(start).toEqual({ row: 1, column: 0 });
        expect(end).toEqual({ row: 5, column: 5 });
    });

    it('notifies file change exactly once on edit in multibuffer without duplicates', async () => {
        const fileCode = new Code('const x = 1;', 'file.ts', '');
        let codeChangeCalls = 0;
        let receivedEditsCount = 0;

        fileCode.setOnChange((change) => {
            codeChangeCalls++;
            receivedEditsCount += change.edits.length;
        });

        const multibuffer = new MultiBufferCode([
            { id: 'file.ts', path: 'file.ts', code: fileCode },
        ]);

        const { handleTextInput } = await import('../src/actions');
        handleTextInput({
            code: multibuffer,
            cursor: { row: 1, column: 12 },
            event: { key: '!' } as any,
        });

        expect(codeChangeCalls).toBe(1);
        expect(receivedEditsCount).toBe(1);
    });

    it('dynamically resolves file context (indent, comment, resolvePosition) per line', async () => {
        const file1 = new Code('line1\nline2', 'src/file1.py', 'python');
        const file2 = new Code('lineA\nlineB', 'src/file2.tsx', 'tsx');

        const multibuffer = new MultiBufferCode([
            { id: 'src/file1.py', path: 'src/file1.py', code: file1 },
            { id: 'src/file2.tsx', path: 'src/file2.tsx', code: file2 },
        ]);

        // File 1 is rows 1..2; File 2 is rows 4..5 (row 0 and 3 are headers)
        expect(multibuffer.getComment(1)).toBe('#');
        expect(multibuffer.getIndent(1)).toEqual({ unit: ' ', width: 4 });

        expect(multibuffer.getComment(4)).toBe('//');
        expect(multibuffer.getIndent(4)).toEqual({ unit: ' ', width: 2 });

        // resolvePosition should correctly map global rows to local lines
        expect(multibuffer.resolvePosition(1, 3)).toEqual({ file: 'src/file1.py', line: 0, column: 3 });
        expect(multibuffer.resolvePosition(5, 2)).toEqual({ file: 'src/file2.tsx', line: 1, column: 2 });

        // Actions like handleToggleComment should use the line-specific comment
        const { handleToggleComment, handleTab, handleUnTab, handleDuplicate, handleTextInput, handleBackspace, handleEnter } = await import('../src/actions');
        handleToggleComment({
            code: multibuffer,
            cursor: { row: 4, column: 0 },
        });
        expect(multibuffer.line(4)).toBe('//lineA');
    });

    it('safely rejects editing actions when selection spans across multiple files', async () => {
        const file1 = new Code('line1\nline2', 'file1.ts', 'typescript');
        const file2 = new Code('lineA\nlineB', 'file2.ts', 'typescript');

        const multibuffer = new MultiBufferCode([
            { id: 'file1.ts', path: 'file1.ts', code: file1 },
            { id: 'file2.ts', path: 'file2.ts', code: file2 },
        ]);

        const {
            handleTextInput,
            handleBackspace,
            handleEnter,
            handleTab,
            handleUnTab,
            handleToggleComment,
            handleDuplicate,
        } = await import('../src/actions');

        const crossSelection = new Selection({ row: 1, column: 0 }, { row: 4, column: 3 });

        // Text input across files -> rejected
        const textResult = handleTextInput({
            code: multibuffer,
            cursor: { row: 1, column: 0 },
            selection: crossSelection,
            event: { key: 'z' } as any,
        });
        expect(textResult.changed).toBe(false);

        // Backspace across files -> rejected
        const bsResult = handleBackspace({
            code: multibuffer,
            cursor: { row: 4, column: 3 },
            selection: crossSelection,
        });
        expect(bsResult.changed).toBe(false);

        // Enter across files -> rejected
        const enterResult = handleEnter({
            code: multibuffer,
            cursor: { row: 4, column: 3 },
            selection: crossSelection,
        });
        expect(enterResult.changed).toBe(false);

        // Tab across files -> rejected
        const tabResult = handleTab({
            code: multibuffer,
            cursor: { row: 4, column: 3 },
            selection: crossSelection,
        });
        expect(tabResult.changed).toBe(false);

        // UnTab across files -> rejected
        const unTabResult = handleUnTab({
            code: multibuffer,
            cursor: { row: 4, column: 3 },
            selection: crossSelection,
        });
        expect(unTabResult.changed).toBe(false);

        // Toggle comment across files -> rejected
        const commentResult = handleToggleComment({
            code: multibuffer,
            cursor: { row: 4, column: 3 },
            selection: crossSelection,
        });
        expect(commentResult.changed).toBe(false);

        // Duplicate across files -> rejected
        const dupResult = await handleDuplicate({
            code: multibuffer,
            cursor: { row: 4, column: 3 },
            selection: crossSelection,
        });
        expect(dupResult.changed).toBe(false);

        // Buffer contents should be completely intact
        expect(file1.getContent()).toBe('line1\nline2');
        
        expect(file2.getContent()).toBe('lineA\nlineB');
    });

    it('caches getFoldRanges results and invalidates properly on edits and file state changes', async () => {
        const jsCode1 = new Code('function foo() {\n  return 1;\n}', 'a.js', 'javascript');
        const jsCode2 = new Code('function bar() {\n  return 2;\n}', 'b.js', 'javascript');
        await jsCode1.init();
        await jsCode2.init();

        const multibuffer = new MultiBufferCode([
            { id: 'a.js', path: 'a.js', code: jsCode1, originalCode: new Code('', 'a.js', '') },
            { id: 'b.js', path: 'b.js', code: jsCode2, originalCode: new Code('', 'b.js', '') },
        ]);

        const ranges1 = multibuffer.getFoldRanges();
        expect(ranges1.length).toBeGreaterThan(0);

        // Same reference returned from cache
        const ranges2 = multibuffer.getFoldRanges();
        expect(ranges2).toBe(ranges1);

        // Edit inside buffer invalidates cache
        multibuffer.insertAt({ row: 1, column: 0 }, '// comment\n');
        const ranges3 = multibuffer.getFoldRanges();
        expect(ranges3).not.toBe(ranges1);

        // Collapsing file invalidates cache
        multibuffer.toggleMultibufferFileAtLine(0);
        const ranges4 = multibuffer.getFoldRanges();
        expect(ranges4).not.toBe(ranges3);
        // Only b.js ranges should remain
        expect(ranges4.length).toBeLessThan(ranges3.length);
    });
});

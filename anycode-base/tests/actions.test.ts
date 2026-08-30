import { describe, it, expect } from 'vitest';
import {
    Action,
    executeAction,
    handleTextInput,
    handleBackspace,
    handleEnter,
    handleTab,
    handleUnTab,
    handleSelectAll,
    handleDuplicate,
    handleToggleComment,
    handleUndo,
    handleRedo,
    moveArrowLeft,
    moveArrowRight,
    moveArrowUp,
    moveArrowDown,
    handleEsc,
    handlePasteText,
    smartPaste,
    isCrossFileSelection,
    type ActionContext,
} from '../src/actions';
import { Code, type Point } from '../src/code';
import { MultiBufferCode } from '../src/multibuffer';
import { Selection } from '../src/selection';

describe('Actions Test Suite', () => {
    describe('Text Input', () => {
        it('inserts character at cursor and advances column', () => {
            const code = new Code('hello world', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 5 },
                code,
                event: { key: ',' } as KeyboardEvent,
            };

            const result = handleTextInput(ctx);
            expect(result.changed).toBe(true);
            expect(code.getContent()).toBe('hello, world');
            expect(result.ctx.cursor).toEqual({ row: 0, column: 6 });
        });

        it('replaces active selection when typing', () => {
            const code = new Code('hello world', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 11 },
                code,
                selection: new Selection({ row: 0, column: 6 }, { row: 0, column: 11 }),
                event: { key: 'there' } as KeyboardEvent,
            };

            const result = handleTextInput(ctx);
            expect(result.changed).toBe(true);
            expect(code.getContent()).toBe('hello there');
            expect(result.ctx.cursor).toEqual({ row: 0, column: 11 });
            expect(result.ctx.selection).toBeUndefined();
        });

        it('does not insert text on non-editable line in MultiBuffer', () => {
            const currentCode = new Code('hello', 'test.ts', 'typescript');
            const mb = new MultiBufferCode([
                { id: 'test.ts', path: 'test.ts', code: currentCode, originalCode: currentCode },
            ]);
            // Row 0 in MultiBuffer is the header line
            const ctx: ActionContext = {
                cursor: { row: 0, column: 0 },
                code: mb,
                event: { key: 'a' } as KeyboardEvent,
            };

            const result = handleTextInput(ctx);
            expect(result.changed).toBe(false);
            expect(currentCode.getContent()).toBe('hello');
        });
    });

    describe('Backspace', () => {
        it('deletes character before cursor', () => {
            const code = new Code('hello', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 5 },
                code,
            };

            const result = handleBackspace(ctx);
            expect(result.changed).toBe(true);
            expect(code.getContent()).toBe('hell');
            expect(result.ctx.cursor).toEqual({ row: 0, column: 4 });
        });

        it('does nothing at (0, 0)', () => {
            const code = new Code('hello', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 0 },
                code,
            };

            const result = handleBackspace(ctx);
            expect(result.changed).toBe(false);
            expect(code.getContent()).toBe('hello');
        });

        it('merges current line with previous line when at column 0', () => {
            const code = new Code('first\nsecond', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 1, column: 0 },
                code,
            };

            const result = handleBackspace(ctx);
            expect(result.changed).toBe(true);
            expect(code.getContent()).toBe('firstsecond');
            expect(result.ctx.cursor).toEqual({ row: 0, column: 5 });
        });

        it('deletes selection when selection is active', () => {
            const code = new Code('hello world', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 11 },
                code,
                selection: new Selection({ row: 0, column: 5 }, { row: 0, column: 11 }),
            };

            const result = handleBackspace(ctx);
            expect(result.changed).toBe(true);
            expect(code.getContent()).toBe('hello');
            expect(result.ctx.cursor).toEqual({ row: 0, column: 5 });
            expect(result.ctx.selection).toBeUndefined();
        });

        it('deletes previous word with altKey', () => {
            const code = new Code('hello world', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 11 },
                code,
                event: { altKey: true } as KeyboardEvent,
            };

            const result = handleBackspace(ctx);
            expect(result.changed).toBe(true);
            expect(code.getContent()).toBe('hello ');
            expect(result.ctx.cursor).toEqual({ row: 0, column: 6 });
        });

        it('deletes to start of line with metaKey', () => {
            const code = new Code('const message = "hello";', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 15 },
                code,
                event: { metaKey: true } as KeyboardEvent,
            };

            const result = handleBackspace(ctx);
            expect(result.changed).toBe(true);
            expect(code.getContent()).toBe(' "hello";');
            expect(result.ctx.cursor).toEqual({ row: 0, column: 0 });
        });

        it('removes indentation step when cursor is at indentation boundary', () => {
            const code = new Code('    const x = 1;', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 4 },
                code,
            };

            const result = handleBackspace(ctx);
            expect(result.changed).toBe(true);
            expect(code.getContent()).toBe('const x = 1;');
            expect(result.ctx.cursor).toEqual({ row: 0, column: 0 });
        });
    });

    describe('Enter', () => {
        it('splits line and places cursor on new line', () => {
            const code = new Code('hello world', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 5 },
                code,
            };

            const result = handleEnter(ctx);
            expect(result.changed).toBe(true);
            expect(code.getContent()).toBe('hello\n world');
            expect(result.ctx.cursor).toEqual({ row: 1, column: 0 });
        });

        it('preserves indentation on new line (auto-indent)', () => {
            const code = new Code('  function test() {', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 19 },
                code,
            };

            const result = handleEnter(ctx);
            expect(result.changed).toBe(true);
            expect(code.getContent()).toBe('  function test() {\n  ');
            expect(result.ctx.cursor).toEqual({ row: 1, column: 2 });
        });

        it('inserts new line at end of line when metaKey is pressed', () => {
            const code = new Code('const x = 1;', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 5 },
                code,
                event: { metaKey: true } as KeyboardEvent,
            };

            const result = handleEnter(ctx);
            expect(result.changed).toBe(true);
            expect(code.getContent()).toBe('const x = 1;\n');
            expect(result.ctx.cursor).toEqual({ row: 1, column: 0 });
        });

        it('replaces selection with new line', () => {
            const code = new Code('line1 [REPLACE] line2', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 15 },
                code,
                selection: new Selection({ row: 0, column: 5 }, { row: 0, column: 16 }),
            };

            const result = handleEnter(ctx);
            expect(result.changed).toBe(true);
            expect(code.getContent()).toBe('line1\nline2');
            expect(result.ctx.cursor).toEqual({ row: 1, column: 0 });
            expect(result.ctx.selection).toBeUndefined();
        });
    });

    describe('Tab & UnTab', () => {
        it('inserts indentation at cursor without selection', () => {
            const code = new Code('const x = 1;', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 0 },
                code,
            };

            const result = handleTab(ctx);
            expect(result.changed).toBe(true);
            expect(code.getContent()).toBe('    const x = 1;');
            expect(result.ctx.cursor).toEqual({ row: 0, column: 4 });
        });

        it('indents multiple selected lines on Tab', () => {
            const code = new Code('line1\nline2\nline3', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 2, column: 5 },
                code,
                selection: new Selection({ row: 0, column: 0 }, { row: 2, column: 5 }),
            };

            const result = handleTab(ctx);
            expect(result.changed).toBe(true);
            expect(code.getContent()).toBe('    line1\n    line2\n    line3');
            expect(result.ctx.selection?.anchor).toEqual({ row: 0, column: 4 });
            expect(result.ctx.selection?.cursor).toEqual({ row: 2, column: 9 });
        });

        it('unindents single line on UnTab', () => {
            const code = new Code('    const x = 1;', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 6 },
                code,
            };

            const result = handleUnTab(ctx);
            expect(result.changed).toBe(true);
            expect(code.getContent()).toBe('const x = 1;');
            expect(result.ctx.cursor).toEqual({ row: 0, column: 2 });
        });

        it('unindents multiple selected lines on UnTab', () => {
            const code = new Code('    line1\n    line2\n    line3', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 2, column: 9 },
                code,
                selection: new Selection({ row: 0, column: 4 }, { row: 2, column: 9 }),
            };

            const result = handleUnTab(ctx);
            expect(result.changed).toBe(true);
            expect(code.getContent()).toBe('line1\nline2\nline3');
            expect(result.ctx.selection?.anchor).toEqual({ row: 0, column: 0 });
            expect(result.ctx.selection?.cursor).toEqual({ row: 2, column: 5 });
        });
    });

    describe('Select All', () => {
        it('selects entire code buffer', () => {
            const code = new Code('line 1\nline 2\nline 3', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 0 },
                code,
            };

            const result = handleSelectAll(ctx);
            expect(result.changed).toBe(false);
            expect(result.ctx.selection?.anchor).toEqual({ row: 0, column: 0 });
            expect(result.ctx.selection?.cursor).toEqual({ row: 2, column: 6 });
        });
    });

    describe('Duplicate', () => {
        it('duplicates current line downwards without selection', async () => {
            const code = new Code('const a = 1;\nconst b = 2;', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 6 },
                code,
            };

            const result = await handleDuplicate(ctx);
            expect(result.changed).toBe(true);
            expect(code.getContent()).toBe('const a = 1;\nconst a = 1;\nconst b = 2;');
            expect(result.ctx.cursor).toEqual({ row: 1, column: 6 });
        });

        it('duplicates selected text directly after selection', async () => {
            const code = new Code('hello world', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 5 },
                code,
                selection: new Selection({ row: 0, column: 0 }, { row: 0, column: 5 }),
            };

            const result = await handleDuplicate(ctx);
            expect(result.changed).toBe(true);
            expect(code.getContent()).toBe('hellohello world');
            expect(result.ctx.cursor).toEqual({ row: 0, column: 10 });
        });
    });

    describe('Toggle Comment', () => {
        it('comments an uncommented line in TypeScript', () => {
            const code = new Code('const x = 1;', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 0 },
                code,
            };

            const result = handleToggleComment(ctx);
            expect(result.changed).toBe(true);
            expect(code.getContent()).toBe('//const x = 1;');
            expect(result.ctx.cursor).toEqual({ row: 0, column: 2 });
        });

        it('uncomments an already commented line', () => {
            const code = new Code('//const x = 1;', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 2 },
                code,
            };

            const result = handleToggleComment(ctx);
            expect(result.changed).toBe(true);
            expect(code.getContent()).toBe('const x = 1;');
            expect(result.ctx.cursor).toEqual({ row: 0, column: 0 });
        });

        it('comments multiple selected lines', () => {
            const code = new Code('line1\nline2', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 1, column: 5 },
                code,
                selection: new Selection({ row: 0, column: 0 }, { row: 1, column: 5 }),
            };

            const result = handleToggleComment(ctx);
            expect(result.changed).toBe(true);
            expect(code.getContent()).toBe('//line1\n//line2');
            expect(result.ctx.selection?.anchor).toEqual({ row: 0, column: 2 });
            expect(result.ctx.selection?.cursor).toEqual({ row: 1, column: 7 });
        });

        it('toggles comments in Python with #', () => {
            const code = new Code('print("hello")', 'test.py', 'python');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 0 },
                code,
            };

            const result = handleToggleComment(ctx);
            expect(result.changed).toBe(true);
            expect(code.getContent()).toBe('#print("hello")');

            const uncommentResult = handleToggleComment(ctx);
            expect(uncommentResult.changed).toBe(true);
            expect(code.getContent()).toBe('print("hello")');
        });
    });

    describe('Undo & Redo with Cursor & Selection restoration', () => {
        it('restores cursor and selection on undo and redo', () => {
            const code = new Code('hello world', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 11 },
                code,
                selection: new Selection({ row: 0, column: 6 }, { row: 0, column: 11 }),
                event: { key: '!' } as KeyboardEvent,
            };

            handleTextInput(ctx);
            expect(code.getContent()).toBe('hello !');

            // Undo
            const undoResult = handleUndo(ctx);
            expect(undoResult.changed).toBe(true);
            expect(code.getContent()).toBe('hello world');
            expect(undoResult.ctx.selection?.anchor).toEqual({ row: 0, column: 6 });
            expect(undoResult.ctx.selection?.cursor).toEqual({ row: 0, column: 11 });

            // Redo
            const redoResult = handleRedo(ctx);
            expect(redoResult.changed).toBe(true);
            expect(code.getContent()).toBe('hello !');
            expect(redoResult.ctx.selection).toBeUndefined();
        });
    });

    describe('Navigation Arrows', () => {
        it('moves cursor left and right within line', () => {
            const code = new Code('hello', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 2 },
                code,
            };

            moveArrowLeft(ctx, false);
            expect(ctx.cursor).toEqual({ row: 0, column: 1 });

            moveArrowRight(ctx, false);
            expect(ctx.cursor).toEqual({ row: 0, column: 2 });
        });

        it('wraps left to previous line end at column 0', () => {
            const code = new Code('line1\nline2', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 1, column: 0 },
                code,
            };

            moveArrowLeft(ctx, false);
            expect(ctx.cursor).toEqual({ row: 0, column: 5 });
        });

        it('wraps right to next line start at line end', () => {
            const code = new Code('line1\nline2', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 5 },
                code,
            };

            moveArrowRight(ctx, false);
            expect(ctx.cursor).toEqual({ row: 1, column: 0 });
        });

        it('jumps by word with altKey', () => {
            const code = new Code('hello world foo', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 0 },
                code,
            };

            moveArrowRight(ctx, true);
            expect(ctx.cursor.column).toBe(5); // jumps to end of "hello"

            moveArrowRight(ctx, true);
            expect(ctx.cursor.column).toBe(11); // jumps to end of "world"

            moveArrowLeft(ctx, true);
            expect(ctx.cursor.column).toBe(6); // jumps to start of "world"
        });

        it('creates selection with shiftKey', () => {
            const code = new Code('hello', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 0 },
                code,
                event: { shiftKey: true } as KeyboardEvent,
            };

            moveArrowRight(ctx, false);
            expect(ctx.cursor).toEqual({ row: 0, column: 1 });
            expect(ctx.selection?.anchor).toEqual({ row: 0, column: 0 });
            expect(ctx.selection?.cursor).toEqual({ row: 0, column: 1 });
        });

        it('moves up and down clamping column to line lengths', () => {
            const code = new Code('short\nvery long line\nend', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 1, column: 10 },
                code,
            };

            moveArrowUp(ctx);
            expect(ctx.cursor).toEqual({ row: 0, column: 5 }); // clamped to 'short'.length

            moveArrowDown(ctx);
            expect(ctx.cursor).toEqual({ row: 1, column: 5 });

            ctx.cursor = { row: 1, column: 12 };
            moveArrowDown(ctx);
            expect(ctx.cursor).toEqual({ row: 2, column: 3 }); // clamped to 'end'.length
        });
    });

    describe('Escape', () => {
        it('clears active selection', () => {
            const code = new Code('hello', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 5 },
                code,
                selection: new Selection({ row: 0, column: 0 }, { row: 0, column: 5 }),
            };

            const result = handleEsc(ctx);
            expect(result.changed).toBe(true);
            expect(result.ctx.selection).toBeUndefined();
        });

        it('does nothing when there is no selection', () => {
            const code = new Code('hello', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 0 },
                code,
            };

            const result = handleEsc(ctx);
            expect(result.changed).toBe(false);
        });
    });

    describe('Smart Paste & handlePasteText', () => {
        it('pastes single line and adjusts cursor', () => {
            const code = new Code('hello world', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 5 },
                code,
            };

            const result = handlePasteText(ctx, ', beautiful');
            expect(result.changed).toBe(true);
            expect(code.getContent()).toBe('hello, beautiful world');
            expect(result.ctx.cursor).toEqual({ row: 0, column: 16 });
        });

        it('pastes multiline text adjusting indentation to target context', () => {
            const code = new Code('    function test() {\n        \n    }', 'test.ts', 'typescript');
            const cursor: Point = { row: 1, column: 8 };

            const rawText = 'const a = 1;\n    const b = 2;';
            const adjusted = smartPaste(code, cursor, rawText);

            expect(adjusted).toBe('const a = 1;\n        const b = 2;');
        });
    });

    describe('executeAction Dispatcher', () => {
        it('dispatches TEXT_INPUT', async () => {
            const code = new Code('abc', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 3 },
                code,
                event: { key: 'd' } as KeyboardEvent,
            };

            const res = await executeAction(Action.TEXT_INPUT, ctx);
            expect(res.changed).toBe(true);
            expect(code.getContent()).toBe('abcd');
        });

        it('dispatches ENTER', async () => {
            const code = new Code('abc', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 1 },
                code,
            };

            const res = await executeAction(Action.ENTER, ctx);
            expect(res.changed).toBe(true);
            expect(code.getContent()).toBe('a\nbc');
        });

        it('dispatches SELECT_ALL', async () => {
            const code = new Code('line1\nline2', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 0 },
                code,
            };

            const res = await executeAction(Action.SELECT_ALL, ctx);
            expect(res.ctx.selection).toBeDefined();
            expect(res.ctx.selection?.anchor).toEqual({ row: 0, column: 0 });
            expect(res.ctx.selection?.cursor).toEqual({ row: 1, column: 5 });
        });

        it('dispatches DUPLICATE', async () => {
            const code = new Code('hello', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 5 },
                code,
            };

            const res = await executeAction(Action.DUPLICATE, ctx);
            expect(res.changed).toBe(true);
            expect(code.getContent()).toBe('hello\nhello');
        });

        it('dispatches COMMENT', async () => {
            const code = new Code('let x = 1;', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 0 },
                code,
            };

            const res = await executeAction(Action.COMMENT, ctx);
            expect(res.changed).toBe(true);
            expect(code.getContent()).toBe('//let x = 1;');
        });

        it('dispatches TAB and UNTAB', async () => {
            const code = new Code('let x = 1;', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 0 },
                code,
            };

            const tabRes = await executeAction(Action.TAB, ctx);
            expect(tabRes.changed).toBe(true);
            expect(code.getContent()).toBe('    let x = 1;');

            const untabRes = await executeAction(Action.UNTAB, ctx);
            expect(untabRes.changed).toBe(true);
            expect(code.getContent()).toBe('let x = 1;');
        });
    });

    describe('MultiBuffer & Cross-file Selection Safety', () => {
        it('detects cross-file selection and prevents editing', async () => {
            const file1 = new Code('file 1 content', 'file1.ts', 'typescript');
            const file2 = new Code('file 2 content', 'file2.ts', 'typescript');
            const mb = new MultiBufferCode([
                { id: 'file1.ts', path: 'file1.ts', code: file1, originalCode: file1 },
                { id: 'file2.ts', path: 'file2.ts', code: file2, originalCode: file2 },
            ]);

            // Row 0: header file1.ts
            // Row 1: file 1 content
            // Row 2: header file2.ts
            // Row 3: file 2 content

            const crossCtx: ActionContext = {
                cursor: { row: 3, column: 5 },
                code: mb,
                selection: new Selection({ row: 1, column: 0 }, { row: 3, column: 5 }),
                event: { key: 'x' } as KeyboardEvent,
            };

            expect(isCrossFileSelection(crossCtx)).toBe(true);

            const textInputRes = handleTextInput(crossCtx);
            expect(textInputRes.changed).toBe(false);

            const backspaceRes = handleBackspace(crossCtx);
            expect(backspaceRes.changed).toBe(false);

            const tabRes = handleTab(crossCtx);
            expect(tabRes.changed).toBe(false);

            const commentRes = handleToggleComment(crossCtx);
            expect(commentRes.changed).toBe(false);

            const duplicateRes = await handleDuplicate(crossCtx);
            expect(duplicateRes.changed).toBe(false);
        });

        it('allows editing when selection is within the same file body in MultiBuffer', () => {
            const file1 = new Code('line 1\nline 2', 'file1.ts', 'typescript');
            const mb = new MultiBufferCode([
                { id: 'file1.ts', path: 'file1.ts', code: file1, originalCode: file1 },
            ]);

            // Row 0: header
            // Row 1: line 1
            // Row 2: line 2

            const sameFileCtx: ActionContext = {
                cursor: { row: 2, column: 6 },
                code: mb,
                selection: new Selection({ row: 1, column: 0 }, { row: 2, column: 6 }),
                event: { key: 'a' } as KeyboardEvent,
            };

            expect(isCrossFileSelection(sameFileCtx)).toBe(false);

            const res = handleTextInput(sameFileCtx);
            expect(res.changed).toBe(true);
            expect(file1.getContent()).toBe('a');
        });
    });

    describe('Edge Cases - Empty Buffers', () => {
        it('handles Backspace on an empty buffer gracefully', () => {
            const code = new Code('', 'test.ts', 'typescript');
            const ctx: ActionContext = { cursor: { row: 0, column: 0 }, code };
            const res = handleBackspace(ctx);
            expect(res.changed).toBe(false);
            expect(res.ctx.cursor).toEqual({ row: 0, column: 0 });
            expect(code.getContent()).toBe('');
        });

        it('handles Enter on an empty buffer', () => {
            const code = new Code('', 'test.ts', 'typescript');
            const ctx: ActionContext = { cursor: { row: 0, column: 0 }, code };
            const res = handleEnter(ctx);
            expect(res.changed).toBe(true);
            expect(code.getContent()).toBe('\n');
            expect(res.ctx.cursor).toEqual({ row: 1, column: 0 });
        });

        it('handles SelectAll on an empty buffer', () => {
            const code = new Code('', 'test.ts', 'typescript');
            const ctx: ActionContext = { cursor: { row: 0, column: 0 }, code };
            const res = handleSelectAll(ctx);
            expect(res.changed).toBe(false);
            expect(res.ctx.selection?.anchor).toEqual({ row: 0, column: 0 });
            expect(res.ctx.selection?.cursor).toEqual({ row: 0, column: 0 });
        });

        it('handles Arrow navigation on an empty buffer', () => {
            const code = new Code('', 'test.ts', 'typescript');
            const ctx: ActionContext = { cursor: { row: 0, column: 0 }, code };

            expect(moveArrowLeft(ctx, false).changed).toBe(false);
            expect(ctx.cursor).toEqual({ row: 0, column: 0 });

            expect(moveArrowRight(ctx, false).changed).toBe(false);
            expect(ctx.cursor).toEqual({ row: 0, column: 0 });

            expect(moveArrowUp(ctx).changed).toBe(false);
            expect(ctx.cursor).toEqual({ row: 0, column: 0 });

            expect(moveArrowDown(ctx).changed).toBe(false);
            expect(ctx.cursor).toEqual({ row: 0, column: 0 });
        });

        it('handles Duplicate on an empty buffer', async () => {
            const code = new Code('', 'test.ts', 'typescript');
            const ctx: ActionContext = { cursor: { row: 0, column: 0 }, code };
            const res = await handleDuplicate(ctx);
            expect(res.changed).toBe(true);
            expect(code.getContent()).toBe('\n');
            expect(res.ctx.cursor).toEqual({ row: 1, column: 0 });
        });
    });

    describe('Edge Cases - Inverted Selection (Anchor after Cursor)', () => {
        it('deletes inverted selection correctly with Backspace', () => {
            const code = new Code('0123456789', 'test.ts', 'typescript');
            // User dragged backwards from 8 to 3
            const ctx: ActionContext = {
                cursor: { row: 0, column: 3 },
                code,
                selection: new Selection({ row: 0, column: 8 }, { row: 0, column: 3 }),
            };

            const res = handleBackspace(ctx);
            expect(res.changed).toBe(true);
            expect(code.getContent()).toBe('01289');
            expect(res.ctx.cursor).toEqual({ row: 0, column: 3 });
            expect(res.ctx.selection).toBeUndefined();
        });

        it('replaces multiline inverted selection with text input', () => {
            const code = new Code('line 1\nline 2\nline 3', 'test.ts', 'typescript');
            // Selected backwards from line 2 to line 0
            const ctx: ActionContext = {
                cursor: { row: 0, column: 0 },
                code,
                selection: new Selection({ row: 2, column: 6 }, { row: 0, column: 0 }),
                event: { key: 'X' } as KeyboardEvent,
            };

            const res = handleTextInput(ctx);
            expect(res.changed).toBe(true);
            expect(code.getContent()).toBe('X');
            expect(res.ctx.cursor).toEqual({ row: 0, column: 1 });
            expect(res.ctx.selection).toBeUndefined();
        });

        it('handles Tab on inverted selection across lines', () => {
            const code = new Code('line 1\nline 2', 'test.ts', 'typescript');
            // Inverted selection
            const ctx: ActionContext = {
                cursor: { row: 0, column: 2 },
                code,
                selection: new Selection({ row: 1, column: 4 }, { row: 0, column: 2 }),
            };

            const res = handleTab(ctx);
            expect(res.changed).toBe(true);
            expect(code.getContent()).toBe('    line 1\n    line 2');
            expect(res.ctx.selection?.anchor).toEqual({ row: 1, column: 8 });
            expect(res.ctx.selection?.cursor).toEqual({ row: 0, column: 6 });
        });

        it('handles ToggleComment on inverted selection', () => {
            const code = new Code('line 1\nline 2', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 0 },
                code,
                selection: new Selection({ row: 1, column: 6 }, { row: 0, column: 0 }),
            };

            const res = handleToggleComment(ctx);
            expect(res.changed).toBe(true);
            expect(code.getContent()).toBe('//line 1\n//line 2');
            expect(res.ctx.selection?.anchor).toEqual({ row: 1, column: 8 });
            expect(res.ctx.selection?.cursor).toEqual({ row: 0, column: 2 });
        });
    });

    describe('Edge Cases - MultiBuffer Navigation across File Boundaries', () => {
        it('ArrowDown on last line of File 1 skips header of File 2 directly to File 2 body', () => {
            const file1 = new Code('file1 line', 'file1.ts', 'typescript');
            const file2 = new Code('file2 line', 'file2.ts', 'typescript');
            const mb = new MultiBufferCode([
                { id: 'file1.ts', path: 'file1.ts', code: file1, originalCode: file1 },
                { id: 'file2.ts', path: 'file2.ts', code: file2, originalCode: file2 },
            ]);

            // Row 0: Header 1
            // Row 1: file1 line
            // Row 2: Header 2
            // Row 3: file2 line

            const ctx: ActionContext = {
                cursor: { row: 1, column: 3 },
                code: mb,
            };

            moveArrowDown(ctx);
            // Must jump directly to row 3 (file 2 line), NOT row 2 (Header 2)
            expect(ctx.cursor).toEqual({ row: 3, column: 3 });
        });

        it('ArrowUp on first line of File 2 skips header of File 2 directly to File 1 body', () => {
            const file1 = new Code('file1 line', 'file1.ts', 'typescript');
            const file2 = new Code('file2 line', 'file2.ts', 'typescript');
            const mb = new MultiBufferCode([
                { id: 'file1.ts', path: 'file1.ts', code: file1, originalCode: file1 },
                { id: 'file2.ts', path: 'file2.ts', code: file2, originalCode: file2 },
            ]);

            const ctx: ActionContext = {
                cursor: { row: 3, column: 4 },
                code: mb,
            };

            moveArrowUp(ctx);
            // Must jump directly to row 1 (file 1 line), NOT row 2 (Header 2)
            expect(ctx.cursor).toEqual({ row: 1, column: 4 });
        });

        it('ArrowRight at end of File 1 wraps across header directly to start of File 2', () => {
            const file1 = new Code('f1', 'file1.ts', 'typescript');
            const file2 = new Code('f2', 'file2.ts', 'typescript');
            const mb = new MultiBufferCode([
                { id: 'file1.ts', path: 'file1.ts', code: file1, originalCode: file1 },
                { id: 'file2.ts', path: 'file2.ts', code: file2, originalCode: file2 },
            ]);

            const ctx: ActionContext = {
                cursor: { row: 1, column: 2 }, // end of 'f1'
                code: mb,
            };

            moveArrowRight(ctx, false);
            expect(ctx.cursor).toEqual({ row: 3, column: 0 });
        });

        it('ArrowLeft at start of File 2 wraps across header directly to end of File 1', () => {
            const file1 = new Code('f1', 'file1.ts', 'typescript');
            const file2 = new Code('f2', 'file2.ts', 'typescript');
            const mb = new MultiBufferCode([
                { id: 'file1.ts', path: 'file1.ts', code: file1, originalCode: file1 },
                { id: 'file2.ts', path: 'file2.ts', code: file2, originalCode: file2 },
            ]);

            const ctx: ActionContext = {
                cursor: { row: 3, column: 0 }, // start of 'f2'
                code: mb,
            };

            moveArrowLeft(ctx, false);
            expect(ctx.cursor).toEqual({ row: 1, column: 2 });
        });

        it('Backspace at (0, 0) of File 2 is blocked and does NOT merge across file boundary', () => {
            const file1 = new Code('f1', 'file1.ts', 'typescript');
            const file2 = new Code('f2', 'file2.ts', 'typescript');
            const mb = new MultiBufferCode([
                { id: 'file1.ts', path: 'file1.ts', code: file1, originalCode: file1 },
                { id: 'file2.ts', path: 'file2.ts', code: file2, originalCode: file2 },
            ]);

            const ctx: ActionContext = {
                cursor: { row: 3, column: 0 },
                code: mb,
            };

            const res = handleBackspace(ctx);
            expect(res.changed).toBe(false);
            expect(file1.getContent()).toBe('f1');
            expect(file2.getContent()).toBe('f2');
        });

        it('prevents all edits on readOnly entries in MultiBuffer', async () => {
            const file1 = new Code('const x = 1;', 'file1.ts', 'typescript');
            const mb = new MultiBufferCode([
                { id: 'file1.ts', path: 'file1.ts', readOnly: true, code: file1, originalCode: file1 },
            ]);

            const ctx: ActionContext = {
                cursor: { row: 1, column: 5 },
                code: mb,
                event: { key: '!' } as KeyboardEvent,
            };

            expect(handleTextInput(ctx).changed).toBe(false);
            expect(handleBackspace(ctx).changed).toBe(false);
            expect(handleEnter(ctx).changed).toBe(false);
            expect(handleTab(ctx).changed).toBe(false);
            expect((await handleDuplicate(ctx)).changed).toBe(false);
            expect(file1.getContent()).toBe('const x = 1;');
        });
    });

    describe('Edge Cases - Whitespace and Partial Indentation', () => {
        it('handleEnter inside existing indentation preserves subsequent indentation', () => {
            const code = new Code('        const x = 1;', 'test.ts', 'typescript'); // 8 spaces
            const ctx: ActionContext = {
                cursor: { row: 0, column: 4 }, // middle of indentation
                code,
            };

            const res = handleEnter(ctx);
            expect(res.changed).toBe(true);
            // Splitting at col 4 creates '    \n        const x = 1;'
            expect(code.getContent()).toBe('    \n        const x = 1;');
            expect(res.ctx.cursor).toEqual({ row: 1, column: 4 });
        });

        it('handles Tab and UnTab when selection includes empty lines', () => {
            const code = new Code('line 1\n\nline 3', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 2, column: 6 },
                code,
                selection: new Selection({ row: 0, column: 0 }, { row: 2, column: 6 }),
            };

            const tabRes = handleTab(ctx);
            expect(tabRes.changed).toBe(true);
            expect(code.getContent()).toBe('    line 1\n    \n    line 3');

            const untabRes = handleUnTab(tabRes.ctx);
            expect(untabRes.changed).toBe(true);
            expect(code.getContent()).toBe('line 1\n\nline 3');
        });
    });

    describe('Edge Cases - Unicode, Emojis and Graphemes', () => {
        it('navigates across surrogate pair emojis with ArrowLeft and ArrowRight without splitting them', () => {
            // '🚀' is 2 UTF-16 code units (surrogate pair)
            const code = new Code('A🚀B', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 0 },
                code,
            };

            // Move to 'A'
            moveArrowRight(ctx, false);
            expect(ctx.cursor.column).toBe(1);

            // Move over '🚀' (length 2 in JS string)
            moveArrowRight(ctx, false);
            expect(ctx.cursor.column).toBe(3); // Skipped both surrogate pair code units

            // Move over 'B'
            moveArrowRight(ctx, false);
            expect(ctx.cursor.column).toBe(4);

            // Move left over 'B'
            moveArrowLeft(ctx, false);
            expect(ctx.cursor.column).toBe(3);

            // Move left over '🚀'
            moveArrowLeft(ctx, false);
            expect(ctx.cursor.column).toBe(1); // Back before emoji
        });

        it('deletes entire multi-byte emoji in a single Backspace', () => {
            const code = new Code('test🚀', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 6 }, // After 'test' (4) + '🚀' (2) = 6
                code,
            };

            const res = handleBackspace(ctx);
            expect(res.changed).toBe(true);
            expect(code.getContent()).toBe('test');
            expect(res.ctx.cursor).toEqual({ row: 0, column: 4 });
        });
    });

    describe('Edge Cases - Multi-step Sequential Undo/Redo', () => {
        it('faithfully tracks and reverses a series of diverse edits', () => {
            const code = new Code('init', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 0, column: 4 },
                code,
            };

            // Step 1: Type '1'
            ctx.event = { key: '1' } as KeyboardEvent;
            handleTextInput(ctx);
            expect(code.getContent()).toBe('init1');

            // Step 2: Type '2'
            ctx.event = { key: '2' } as KeyboardEvent;
            handleTextInput(ctx);
            expect(code.getContent()).toBe('init12');

            // Step 3: Enter
            delete ctx.event;
            handleEnter(ctx);
            expect(code.getContent()).toBe('init12\n');

            // Step 4: Duplicate
            handleDuplicate(ctx);
            expect(code.getContent()).toBe('init12\n\n');

            // Undo Step 4
            expect(handleUndo(ctx).changed).toBe(true);
            expect(code.getContent()).toBe('init12\n');

            // Undo Step 3
            expect(handleUndo(ctx).changed).toBe(true);
            expect(code.getContent()).toBe('init12');

            // Undo Step 2
            expect(handleUndo(ctx).changed).toBe(true);
            expect(code.getContent()).toBe('init1');

            // Undo Step 1
            expect(handleUndo(ctx).changed).toBe(true);
            expect(code.getContent()).toBe('init');

            // Redo all
            expect(handleRedo(ctx).changed).toBe(true);
            expect(code.getContent()).toBe('init1');

            expect(handleRedo(ctx).changed).toBe(true);
            expect(code.getContent()).toBe('init12');

            expect(handleRedo(ctx).changed).toBe(true);
            expect(code.getContent()).toBe('init12\n');

            expect(handleRedo(ctx).changed).toBe(true);
            expect(code.getContent()).toBe('init12\n\n');
        });
    });

    describe('Multi-line Editing & Range Replacements', () => {
        it('replaces a 3-line selection with a single character', () => {
            const initial = 'line 1\nline 2\nline 3\nline 4\nline 5';
            const code = new Code(initial, 'test.ts', 'typescript');
            // Select from middle of line 1 to middle of line 3
            const ctx: ActionContext = {
                cursor: { row: 3, column: 4 },
                code,
                selection: new Selection({ row: 1, column: 2 }, { row: 3, column: 4 }),
                event: { key: 'Z' } as KeyboardEvent,
            };

            const res = handleTextInput(ctx);
            expect(res.changed).toBe(true);
            expect(code.getContent()).toBe('line 1\nliZ 4\nline 5');
            expect(res.ctx.cursor).toEqual({ row: 1, column: 3 });
        });

        it('replaces a selection extending to the very end of the file', () => {
            const initial = 'function test() {\n    return 42;\n}';
            const code = new Code(initial, 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 2, column: 1 },
                code,
                selection: new Selection({ row: 1, column: 4 }, { row: 2, column: 1 }),
                event: { key: '}' } as KeyboardEvent,
            };

            const res = handleTextInput(ctx);
            expect(res.changed).toBe(true);
            expect(code.getContent()).toBe('function test() {\n    }');
            expect(res.ctx.cursor).toEqual({ row: 1, column: 5 });
        });
    });

    describe('Multi-Language Commenting Behavior', () => {
        it('comments in Rust with //', () => {
            const code = new Code('fn main() {}', 'main.rs', 'rust');
            const ctx: ActionContext = { cursor: { row: 0, column: 0 }, code };
            handleToggleComment(ctx);
            expect(code.getContent()).toBe('//fn main() {}');
            handleToggleComment(ctx);
            expect(code.getContent()).toBe('fn main() {}');
        });

        it('comments in Bash with #', () => {
            const code = new Code('echo "hello"', 'script.sh', 'bash');
            const ctx: ActionContext = { cursor: { row: 0, column: 0 }, code };
            handleToggleComment(ctx);
            expect(code.getContent()).toBe('#echo "hello"');
            handleToggleComment(ctx);
            expect(code.getContent()).toBe('echo "hello"');
        });

        it('comments in Lua with --', () => {
            const code = new Code('local x = 10', 'main.lua', 'lua');
            const ctx: ActionContext = { cursor: { row: 0, column: 0 }, code };
            handleToggleComment(ctx);
            expect(code.getContent()).toBe('--local x = 10');
            handleToggleComment(ctx);
            expect(code.getContent()).toBe('local x = 10');
        });

        it('uncomments all lines when selection has mixed commented and uncommented lines', () => {
            const code = new Code('//line 1\nline 2', 'test.ts', 'typescript');
            const ctx: ActionContext = {
                cursor: { row: 1, column: 6 },
                code,
                selection: new Selection({ row: 0, column: 0 }, { row: 1, column: 6 }),
            };

            // Since at least one line has a comment, toggling should remove existing comments
            handleToggleComment(ctx);
            expect(code.getContent()).toBe('line 1\nline 2');
        });
    });

    describe('Continuous Multi-line Merges with Backspace', () => {
        it('collapses multiple lines into one by repeated Backspaces at column 0', () => {
            const code = new Code('a\nb\nc\nd', 'test.ts', 'typescript');
            const ctx: ActionContext = { cursor: { row: 3, column: 0 }, code };

            // Merge 'd' into 'c' -> 'a\nb\ncd'
            handleBackspace(ctx);
            expect(code.getContent()).toBe('a\nb\ncd');
            expect(ctx.cursor).toEqual({ row: 2, column: 1 });

            // Move to start of 'cd'
            ctx.cursor = { row: 2, column: 0 };
            // Merge 'cd' into 'b' -> 'a\nbcd'
            handleBackspace(ctx);
            expect(code.getContent()).toBe('a\nbcd');
            expect(ctx.cursor).toEqual({ row: 1, column: 1 });

            // Move to start of 'bcd'
            ctx.cursor = { row: 1, column: 0 };
            // Merge 'bcd' into 'a' -> 'abcd'
            handleBackspace(ctx);
            expect(code.getContent()).toBe('abcd');
            expect(ctx.cursor).toEqual({ row: 0, column: 1 });
        });
    });

    describe('Deeply-Nested Smart Paste & Whitespace Preservation', () => {
        it('adjusts base indentation for 8-space nested destination', () => {
            const code = new Code('class Foo {\n    bar() {\n        \n    }\n}', 'test.ts', 'typescript');
            const cursor: Point = { row: 2, column: 8 };

            const rawClipboard = 'const x = 1;\nif (x) {\n    doSomething();\n}';
            const pasted = smartPaste(code, cursor, rawClipboard);

            expect(pasted).toBe('const x = 1;\n        if (x) {\n            doSomething();\n        }');
        });

        it('preserves blank lines without adding trailing whitespace during smartPaste', () => {
            const code = new Code('function test() {\n    \n}', 'test.ts', 'typescript');
            const cursor: Point = { row: 1, column: 4 };

            const rawClipboard = 'step1();\n\nstep2();';
            const pasted = smartPaste(code, cursor, rawClipboard);

            expect(pasted).toBe('step1();\n\n    step2();');
        });
    });

    describe('MultiBuffer Transactional Batching & State Synchronization', () => {
        it('batches multiple edits in MultiBuffer and undoes all of them in a single step', () => {
            const file1 = new Code('first line', 'file1.ts', 'typescript');
            const mb = new MultiBufferCode([
                { id: 'file1.ts', path: 'file1.ts', code: file1, originalCode: file1 },
            ]);

            // Row 0: Header
            // Row 1: first line
            const ctx: ActionContext = {
                cursor: { row: 1, column: 10 },
                code: mb,
            };

            // Enter
            handleEnter(ctx);
            expect(file1.getContent()).toBe('first line\n');

            // Type 'second line'
            ctx.event = { key: 's' } as KeyboardEvent;
            handleTextInput(ctx);
            expect(file1.getContent()).toBe('first line\ns');

            // Undo typing 's'
            handleUndo(ctx);
            expect(file1.getContent()).toBe('first line\n');

            // Undo Enter
            handleUndo(ctx);
            expect(file1.getContent()).toBe('first line');
        });
    });
});

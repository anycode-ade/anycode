import { Operation, type Code, type Point } from "./code";
import { Selection } from "./selection";
import { getIndentation, getPrevGraphemeIndex, getNextGraphemeIndex, findPrevWord } from "./utils";

export enum Action {
    // Navigation
    ARROW_LEFT = 'ARROW_LEFT',
    ARROW_RIGHT = 'ARROW_RIGHT',
    ARROW_UP = 'ARROW_UP',
    ARROW_DOWN = 'ARROW_DOWN',
    ARROW_LEFT_ALT = 'ARROW_LEFT_ALT',
    ARROW_RIGHT_ALT = 'ARROW_RIGHT_ALT',
    ESC = 'ESC',

    // Editing
    BACKSPACE = 'BACKSPACE',
    DELETE = 'DELETE',
    ENTER = 'ENTER',
    TAB = 'TAB',
    UNTAB = 'UNTAB',
    TEXT_INPUT = 'TEXT_INPUT',

    // Shortcuts
    UNDO = 'UNDO',
    REDO = 'REDO',
    SELECT_ALL = 'SELECT_ALL',
    COPY = 'COPY',
    PASTE = 'PASTE',
    CUT = 'CUT',
    DUPLICATE = 'DUPLICATE',
    COMMENT = 'COMMENT',
    GO_TO_DEFINITION = 'GO_TO_DEFINITION',
    REFERENCES = 'OPEN_REFERENCES_PEEK',
    HOVER = 'HOVER',
}

export type ActionContext = {
    cursor: Point;
    code: Code;
    selection?: Selection;
    event?: KeyboardEvent;
};

export type ActionResult = {
    changed: boolean;
    ctx: ActionContext;
};

function syncCursor(ctx: ActionContext, row: number, column: number): void {
    ctx.cursor = { row, column };
}

export function isCrossFileSelection(ctx: ActionContext): boolean {
    if (!ctx.selection || ctx.selection.isEmpty()) return false;
    const [start, end] = ctx.selection.sorted();
    return !ctx.code.isSameFileBody(start.row, end.row);
}

export const executeAction = async (
    action: Action, ctx: ActionContext
): Promise<ActionResult> => {
    switch (action) {
        // Navigation
        case Action.ARROW_LEFT: return moveArrowLeft(ctx, false);
        case Action.ARROW_RIGHT: return moveArrowRight(ctx, false);
        case Action.ARROW_LEFT_ALT: return moveArrowLeft(ctx, true);
        case Action.ARROW_RIGHT_ALT: return moveArrowRight(ctx, true);
        case Action.ARROW_UP: return moveArrowUp(ctx);
        case Action.ARROW_DOWN:  return moveArrowDown(ctx);
        case Action.ESC:  return handleEsc(ctx);

        // Editing
        case Action.BACKSPACE: return handleBackspace(ctx);
        case Action.ENTER: return handleEnter(ctx);
        case Action.TAB: return handleTab(ctx);
        case Action.UNTAB: return handleUnTab(ctx);
        case Action.TEXT_INPUT: return handleTextInput(ctx);

        // Shortcuts
        case Action.UNDO: return handleUndo(ctx);
        case Action.REDO: return handleRedo(ctx);
        case Action.SELECT_ALL: return handleSelectAll(ctx);
        case Action.COPY: return await handleCopy(ctx);
        case Action.PASTE: return await handlePaste(ctx);
        case Action.CUT: return await handleCut(ctx);
        case Action.DUPLICATE: return await handleDuplicate(ctx);
        case Action.COMMENT: return handleToggleComment(ctx);
        default:
            return { ctx, changed: false };
    }
};

export const handleTextInput = (ctx: ActionContext): ActionResult => {
    if (!ctx.code.isLineEditable(ctx.cursor.row) || isCrossFileSelection(ctx)) {
        return { ctx, changed: false };
    }

    ctx.code.tx();
    ctx.code.setStateBefore(ctx.cursor, ctx.selection);

    let event: KeyboardEvent | undefined = ctx.event;

    if (ctx.selection?.nonEmpty()) {
        removeSelection(ctx);
    }

    if (event?.key) {
        ctx.code.insertAt(ctx.cursor, event.key);
        syncCursor(ctx, ctx.cursor.row, ctx.cursor.column + event.key.length);
    }

    ctx.selection = undefined;
    ctx.code.setStateAfter(ctx.cursor, ctx.selection);
    ctx.code.commit();

    return { ctx, changed: true };
};

export const removeSelection = (ctx: ActionContext) => {
    if (!ctx.selection) return;

    let [start, end] = ctx.selection.sorted();
    ctx.code.removeRange(start, end);

    ctx.cursor = { ...start };
    ctx.selection = undefined;
};

export const handleBackspace = (ctx: ActionContext): ActionResult => {
    if (!ctx.code.isLineEditable(ctx.cursor.row) || isCrossFileSelection(ctx)) {
        return { ctx, changed: false };
    }

    let event: KeyboardEvent | undefined = ctx.event;
    
    ctx.code.tx();
    ctx.code.setStateBefore(ctx.cursor, ctx.selection);

    if (ctx.selection?.nonEmpty()) {
        removeSelection(ctx);
        ctx.code.setStateAfter(ctx.cursor, ctx.selection);
        ctx.code.commit();
        return { ctx, changed: true };
    }

    const { row: line, column } = ctx.cursor;
    if (line === 0 && column === 0) {
        return { ctx, changed: false };
    }

    const lineText = ctx.code.line(line);
    let targetLine = line;
    let targetCol = column;
    let startPoint: Point;
    
    if (event?.metaKey) {
        if (column === 0 && line > 0) {
            const prevLine = ctx.code.getPrevLine(line);
            if (prevLine < 0 || !ctx.code.isLineEditable(prevLine) || !ctx.code.isSameFileBody(line, prevLine)) {
                return { ctx, changed: false };
            }
            targetLine = prevLine;
            targetCol = ctx.code.lineLength(targetLine);
            startPoint = { row: targetLine, column: targetCol };
        } else {
            targetCol = 0;
            startPoint = { row: line, column: 0 };
        }
    } else if (event?.altKey) {
        if (column === 0 && line > 0) {
            const prevLine = ctx.code.getPrevLine(line);
            if (prevLine < 0 || !ctx.code.isLineEditable(prevLine) || !ctx.code.isSameFileBody(line, prevLine)) {
                return { ctx, changed: false };
            }
            targetLine = prevLine;
            targetCol = ctx.code.lineLength(targetLine);
            startPoint = { row: targetLine, column: targetCol };
        } else {
            targetCol = findPrevWord(lineText, column);
            startPoint = { row: line, column: targetCol };
        }
    } else {
        if (column === 0 && line > 0) {
            const prevLine = ctx.code.getPrevLine(line);
            if (prevLine < 0 || !ctx.code.isLineEditable(prevLine) || !ctx.code.isSameFileBody(line, prevLine)) {
                return { ctx, changed: false };
            }
            targetLine = prevLine;
            targetCol = ctx.code.lineLength(targetLine);
            startPoint = { row: targetLine, column: targetCol };
        } else {
            const isRemoveIndent = column > 0 && ctx.code.getIndent(line) &&
                ctx.code.isOnlyIndentationBefore(line, column);
            
            if (isRemoveIndent) {
                targetCol = ctx.code.prevIndentation(line, column);
            } else {
                targetCol = getPrevGraphemeIndex(lineText, column);
            }
            startPoint = { row: line, column: targetCol };
        }
    }
    
    ctx.code.removeRange(startPoint, ctx.cursor);
    syncCursor(ctx, targetLine, targetCol);

    ctx.code.setStateAfter(ctx.cursor, ctx.selection);
    ctx.code.commit();

    return { ctx, changed: true };
};

export const handleEnter = (ctx: ActionContext): ActionResult => {
    if (!ctx.code.isLineEditable(ctx.cursor.row) || isCrossFileSelection(ctx)) {
        return { ctx, changed: false };
    }

    let event: KeyboardEvent | undefined = ctx.event;

    ctx.code.tx();
    ctx.code.setStateBefore(ctx.cursor, ctx.selection);

    if (ctx.selection?.nonEmpty()) {
        removeSelection(ctx);
    }

    if (event?.metaKey) {
        const lineLength = ctx.code.lineLength(ctx.cursor.row);
        syncCursor(ctx, ctx.cursor.row, lineLength);
    }

    const { row: line, column } = ctx.cursor;
    const currentLine = ctx.code.line(line);

    const indent = getIndentation(currentLine, column);
    const newlineWithIndent = '\n' + indent;

    ctx.code.insertAt(ctx.cursor, newlineWithIndent);
    syncCursor(ctx, line + 1, indent.length);
    
    ctx.selection = undefined;
    ctx.code.setStateAfter(ctx.cursor, ctx.selection);
    ctx.code.commit();

    return { ctx, changed: true };
};

export const handleUndo = (ctx: ActionContext): ActionResult => {
    const change = ctx.code.undo(ctx.cursor);

    if (change) {
        if (change.stateBefore) { 
            // use state before to restore cursor and selection
            if (change.stateBefore.cursor) {
                syncCursor(ctx, change.stateBefore.cursor.row, change.stateBefore.cursor.column);
            }
            ctx.selection = change.stateBefore.selection;
        } else {
            // calculate new cursor position
            for (const edit of change.edits) {
                if (edit.operation === Operation.Insert) {
                    ctx.cursor = ctx.code.getPoint(edit.start);
                } else if (edit.operation === Operation.Remove) {
                    ctx.cursor = ctx.code.getPoint(edit.start + edit.text.length);
                }
            }
            ctx.selection = undefined;
        }
        return { ctx, changed: true };
    }

    return { ctx, changed: false };
};

export const handleRedo = (ctx: ActionContext): ActionResult => {
    const change = ctx.code.redo(ctx.cursor);

    if (change) {
        if (change.stateAfter) { 
            // use state after to restore cursor and selection
            if (change.stateAfter.cursor) {
                syncCursor(ctx, change.stateAfter.cursor.row, change.stateAfter.cursor.column);
            }
            ctx.selection = change.stateAfter.selection;
        } else {
            // calculate new cursor position
            for (const edit of change.edits) {
                if (edit.operation === Operation.Insert) {
                    ctx.cursor = ctx.code.getPoint(edit.start + edit.text.length);
                } else if (edit.operation === Operation.Remove) {
                    ctx.cursor = ctx.code.getPoint(edit.start);
                }
            }
            ctx.selection = undefined;
        }
        return { ctx, changed: true };
    }

    return { ctx, changed: false };
};

export const handleSelectAll = (ctx: ActionContext): ActionResult => {
    const firstRow = ctx.code.findFirstEditableLine();
    const lastRow = Math.max(0, ctx.code.linesLength() - 1);
    const lastCol = ctx.code.lineLength(lastRow);
    ctx.selection = new Selection({ row: firstRow, column: 0 }, { row: lastRow, column: lastCol });
    return { ctx, changed: false };
};

export const handleCopy = async (ctx: ActionContext): Promise<ActionResult> => {
    if (!ctx.selection || ctx.selection.isEmpty()) {
        return { ctx, changed: false };
    }

    try {
        const [start, end] = ctx.selection.sorted();
        const content = ctx.code.getTextRange(start, end);
        await copyToClipboard(content);
    } catch (err) {
        console.error('Failed to copy:', err);
    }

    return { ctx, changed: true };
};

async function copyToClipboard(textToCopy: string) {
    // Navigator clipboard api needs a secure context (https)
    if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(textToCopy);
    } else {
        // Use the 'out of viewport hidden text area' trick
        const textArea = document.createElement("textarea");
        textArea.value = textToCopy;
            
        // Move textarea out of the viewport so it's not visible
        textArea.style.position = "absolute";
        textArea.style.left = "-999999px";
            
        document.body.prepend(textArea);
        textArea.select();

        try {
            document.execCommand('copy');
        } catch (error) {
            console.error(error);
        } finally {
            textArea.remove();
        }
    }
}

export const handlePaste = async (ctx: ActionContext): Promise<ActionResult> => {
    try {
        const text = await navigator.clipboard.readText();
        if (!text) return { ctx, changed: false };

        return handlePasteText(ctx, text);
    } catch (err) {
        console.error('Failed to paste:', err);
        return { ctx, changed: false };
    }
};

export const handlePasteText = (ctx: ActionContext, text: string): ActionResult => {
    if (!ctx.code.isLineEditable(ctx.cursor.row) || isCrossFileSelection(ctx)) {
        return { ctx, changed: false };
    }

    ctx.code.tx();
    ctx.code.setStateBefore(ctx.cursor, ctx.selection);

    if (ctx.selection?.nonEmpty()) {
        removeSelection(ctx);
    }

    const { row: line, column } = ctx.cursor;
    const toInsert = smartPaste(ctx.code, ctx.cursor, text);
    ctx.code.insertAt(ctx.cursor, toInsert);
    const pastedLines = toInsert.split('\n');
    const targetLine = line + pastedLines.length - 1;
    const targetCol = pastedLines.length === 1 ? column + toInsert.length : pastedLines[pastedLines.length - 1].length;
    syncCursor(ctx, targetLine, targetCol);
    ctx.code.setStateAfter(ctx.cursor, ctx.selection);
    ctx.code.commit();

    return { ctx, changed: true };
};

/**
 * Smart paste with indentation awareness.
 */
export function smartPaste(code: Code, cursor: Point, text: string): string {
    const { row: line, column } = cursor;
    const baseLevel = code.getIndentationLevel(line, column);
    const indent = code.getIndent(line);
    
    if (!indent) {
        return text;
    }

    const indentStep = indent.unit === ' ' ? ' '.repeat(indent.width) : '\t';
    
    const lines = text.split('\n');
    if (lines.length === 0) {
        return '';
    }
    
    // Compute indentation levels of all lines in the source block
    const lineLevels: number[] = [];
    for (const lineText of lines) {
        let level = 0;
        let rest = lineText;
        while (rest.startsWith(indentStep)) {
            level++;
            rest = rest.slice(indentStep.length);
        }
        lineLevels.push(level);
    }
    
    // Find minimum indentation among non-empty lines (excluding first line)
    let minLevel = Infinity;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim().length > 0) {
            minLevel = Math.min(minLevel, lineLevels[i]);
        }
    }
    if (minLevel === Infinity) {
        minLevel = 0;
    }
    
    // Re-indent lines: first line stays as-is, subsequent lines are adjusted relative to baseLevel
    const result: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        if (i === 0) {
            result.push(lines[0]);
        } else {
            const lineText = lines[i];
            if (lineText.trim().length === 0) {
                result.push('');
            } else {
                const relativeLevel = lineLevels[i] - minLevel;
                const newLevel = Math.max(0, baseLevel + relativeLevel);
                const trimmed = lineText.trimStart();
                result.push(indentStep.repeat(newLevel) + trimmed);
            }
        }
    }
    
    return result.join('\n');
}

export const handleDuplicate = async (ctx: ActionContext): Promise<ActionResult> => {
    if (!ctx.code.isLineEditable(ctx.cursor.row) || isCrossFileSelection(ctx)) {
        return { ctx, changed: false };
    }

    let textToDuplicate: string;
    let targetLine: number, targetCol: number;
    let insertPoint: Point;

    if (ctx.selection?.nonEmpty()) {
        const [start, end] = ctx.selection.sorted();
        textToDuplicate = ctx.code.getTextRange(start, end);
        insertPoint = end;
        const dupLines = textToDuplicate.split('\n');
        targetLine = end.row + dupLines.length - 1;
        targetCol = dupLines.length === 1 ? end.column + textToDuplicate.length : dupLines[dupLines.length - 1].length;
    } else {
        // Duplicate the whole line at the cursor
        const { row: line, column } = ctx.cursor;
        const lineContent = ctx.code.line(line);
        textToDuplicate = '\n' + lineContent;
        insertPoint = { row: line, column: lineContent.length };
        targetLine = line + 1;
        targetCol = column;
    }

    ctx.code.tx();
    ctx.code.setStateBefore(ctx.cursor, ctx.selection);

    ctx.code.insertAt(insertPoint, textToDuplicate);
    
    syncCursor(ctx, targetLine, targetCol);
    ctx.selection = undefined;

    ctx.code.setStateAfter(ctx.cursor, ctx.selection);
    ctx.code.commit();
    return { ctx, changed: true };
};

export const handleCut = async (ctx: ActionContext): Promise<ActionResult> => {
    if (!ctx.selection || ctx.selection.isEmpty() || isCrossFileSelection(ctx)) {
        return { ctx, changed: false };
    }

    const [start, end] = ctx.selection.sorted();
    if (!ctx.code.isLineEditable(start.row) || !ctx.code.isLineEditable(end.row)) {
        return { ctx, changed: false };
    }

    try {
        const content = ctx.code.getTextRange(start, end);
        await copyToClipboard(content);

        ctx.code.tx();
        ctx.code.setStateBefore(ctx.cursor, ctx.selection);

        ctx.code.removeRange(start, end);
        
        syncCursor(ctx, start.row, start.column);
        ctx.selection = undefined;
        ctx.code.setStateAfter(ctx.cursor, ctx.selection);
        ctx.code.commit();
        return { ctx, changed: true };
    } catch (err) {
        console.error('Failed to cut:', err);
        return { ctx, changed: false };
    }
};

export const handleTab = (ctx: ActionContext): ActionResult => {
    if (isCrossFileSelection(ctx)) {
        return { ctx, changed: false };
    }

    let linesToHandle: number[] = [];

    if (ctx.selection && !ctx.selection.isEmpty()) {
        const [start, end] = ctx.selection.sorted();
        for (let i = start.row; i <= end.row; i++) {
            linesToHandle.push(i);
        }
    } else {
        linesToHandle = [ctx.cursor.row];
    }

    if (linesToHandle.some((line) => !ctx.code.isLineEditable(line))) {
        return { ctx, changed: false };
    }

    const targetRow = linesToHandle[0] ?? ctx.cursor.row;
    const indent = ctx.code.getIndent(targetRow);
    const indentText = indent?.unit === ' ' 
        ? ' '.repeat(indent.width) 
        : '\t';

    ctx.code.tx();
    ctx.code.setStateBefore(ctx.cursor, ctx.selection);

    linesToHandle.reverse();

    let indents_added = 0;
    for (const line of linesToHandle) {
        const start = ctx.code.getOffset(line, 0);
        ctx.code.insert(indentText, start);
        indents_added += 1;
    }

    if (ctx.selection && !ctx.selection.isEmpty()) {
        const newAnchor: Point = {
            row: ctx.selection.anchor.row,
            column: ctx.selection.anchor.column + indentText.length,
        };
        const newCursor: Point = {
            row: ctx.cursor.row,
            column: ctx.cursor.column + indentText.length,
        };
        ctx.selection = new Selection(newAnchor, newCursor);
        syncCursor(ctx, newCursor.row, newCursor.column);
    } else {
        syncCursor(ctx, ctx.cursor.row, ctx.cursor.column + indentText.length);
    }

    ctx.code.setStateAfter(ctx.cursor, ctx.selection);
    ctx.code.commit();
    return { ctx, changed: true };
};

export const handleUnTab = (ctx: ActionContext): ActionResult => {
    if (isCrossFileSelection(ctx)) {
        return { ctx, changed: false };
    }

    let linesToHandle: number[] = [];

    if (ctx.selection && !ctx.selection.isEmpty()) {
        const [start, end] = ctx.selection.sorted();
        for (let i = start.row; i <= end.row; i++) {
            linesToHandle.push(i);
        }
    } else {
        linesToHandle = [ctx.cursor.row];
    }

    if (linesToHandle.some((line) => !ctx.code.isLineEditable(line))) {
        return { ctx, changed: false };
    }

    const targetRow = linesToHandle[0] ?? ctx.cursor.row;
    const indent = ctx.code.getIndent(targetRow);
    const indentText = indent?.unit === ' ' ? ' '.repeat(indent.width) : '\t';

    ctx.code.tx();
    ctx.code.setStateBefore(ctx.cursor, ctx.selection);

    linesToHandle.reverse();

    let lines_untabbed = 0;

    for (const line of linesToHandle) {
        const tabMatches = ctx.code.searchOnLine(line, indentText.length, indentText);
        if (tabMatches.length > 0) {
            const c = tabMatches[0];
            const start = ctx.code.getOffset(line, c);
            ctx.code.remove(start, indentText.length);
            lines_untabbed += 1;
        }
    }

    if (ctx.selection && !ctx.selection.isEmpty()) {
        const newAnchor: Point = {
            row: ctx.selection.anchor.row,
            column: Math.max(0, ctx.selection.anchor.column - indentText.length),
        };
        const newCursor: Point = {
            row: ctx.cursor.row,
            column: Math.max(0, ctx.cursor.column - indentText.length),
        };
        ctx.selection = new Selection(newAnchor, newCursor);
        syncCursor(ctx, newCursor.row, newCursor.column);
    } else {
        syncCursor(ctx, ctx.cursor.row, Math.max(0, ctx.cursor.column - (lines_untabbed > 0 ? indentText.length : 0)));
    }

    ctx.code.setStateAfter(ctx.cursor, ctx.selection);
    ctx.code.commit();

    return { ctx, changed: true };
};

export const handleToggleComment = (ctx: ActionContext): ActionResult => {
    if (isCrossFileSelection(ctx)) {
        return { ctx, changed: false };
    }

    let linesToHandle: number[] = [];

    if (ctx.selection && !ctx.selection.isEmpty()) {
        const [start, end] = ctx.selection.sorted();
        for (let i = start.row; i <= end.row; i++) {
            linesToHandle.push(i);
        }
    } else {
        linesToHandle = [ctx.cursor.row];
    }

    if (linesToHandle.some((line) => !ctx.code.isLineEditable(line))) {
        return { ctx, changed: false };
    }

    const targetRow = linesToHandle[0] ?? ctx.cursor.row;
    const comment = ctx.code.getComment(targetRow);
    if (!comment) return { ctx, changed: false };

    const commentFound = linesToHandle.some(line => {
        const lineText = ctx.code.line(line);
        const matches = ctx.code.searchOnLine(line, lineText.length, comment);
        return matches.length > 0;
    });

    ctx.code.tx();
    ctx.code.setStateBefore(ctx.cursor, ctx.selection);

    linesToHandle.reverse();

    let comments_added = 0;
    let comments_removed = 0;

    for (const line of linesToHandle) {
        const lineText = ctx.code.line(line);

        if (commentFound) {
            // remove comment
            const matches = ctx.code.searchOnLine(line, lineText.length, comment);
            if (matches.length > 0) {
                const c = matches[0];
                const start = ctx.code.getOffset(line, c);
                ctx.code.remove(start, comment.length);
                comments_removed += 1;
            }
        } else {
            // insert comment
            const start = ctx.code.getOffset(line, 0);
            ctx.code.insert(comment, start);
            comments_added += 1;
        }
    }

    if (ctx.selection && !ctx.selection.isEmpty()) {
        const delta = commentFound ? -comment.length : comment.length;
        const newAnchor: Point = {
            row: ctx.selection.anchor.row,
            column: Math.max(0, ctx.selection.anchor.column + delta),
        };
        const newCursor: Point = {
            row: ctx.cursor.row,
            column: Math.max(0, ctx.cursor.column + delta),
        };
        ctx.selection = new Selection(newAnchor, newCursor);
        syncCursor(ctx, newCursor.row, newCursor.column);
    } else {
        const delta = commentFound ? -(comments_removed > 0 ? comment.length : 0) : (comments_added > 0 ? comment.length : 0);
        syncCursor(ctx, ctx.cursor.row, Math.max(0, ctx.cursor.column + delta));
    }

    ctx.code.setStateAfter(ctx.cursor, ctx.selection);
    ctx.code.commit();

    return { ctx, changed: true };
};

export const moveArrowDown = (ctx: ActionContext): ActionResult => {
    const { row, column } = ctx.cursor;
    if (row >= ctx.code.linesLength() - 1) return { ctx, changed: false };

    const nextLine = ctx.code.getNextLine(row);
    if (nextLine >= ctx.code.linesLength() || !ctx.code.isLineEditable(nextLine)) return { ctx, changed: false };
    const nextCol = Math.min(column, ctx.code.lineLength(nextLine));
    const originalCursor = { ...ctx.cursor };
    syncCursor(ctx, nextLine, nextCol);
    
    if (ctx.event?.shiftKey) {
        if (!ctx.selection) {
            ctx.selection = new Selection(originalCursor, ctx.cursor);
        } else {
            ctx.selection = ctx.selection.fromCursor(ctx.cursor);
        }
    } else {
        if (ctx.selection) {
            ctx.selection.reset(ctx.cursor);
        }
    }

    return { ctx, changed: false };
};

export const moveArrowUp = (ctx: ActionContext): ActionResult => {
    const { row, column } = ctx.cursor;
    const firstEditable = ctx.code.findFirstEditableLine();
    if (row <= firstEditable) {
        syncCursor(ctx, firstEditable, 0);
        return { ctx, changed: false };
    }

    const prevLine = ctx.code.getPrevLine(row);
    if (prevLine < 0 || !ctx.code.isLineEditable(prevLine)) return { ctx, changed: false };

    const prevCol = Math.min(column, ctx.code.lineLength(prevLine));
    const originalCursor = { ...ctx.cursor };
    syncCursor(ctx, prevLine, prevCol);
    
    if (ctx.event?.shiftKey) {
        if (!ctx.selection) {
            ctx.selection = new Selection(originalCursor, ctx.cursor);
        } else {
            ctx.selection = ctx.selection.fromCursor(ctx.cursor);
        }
    } else {
        if (ctx.selection) {
            ctx.selection.reset(ctx.cursor);
        }
    }

    return { ctx, changed: false };
};

export const moveArrowRight = (ctx: ActionContext, alt: boolean): ActionResult => {
    const originalCursor = { ...ctx.cursor };
    const { row, column } = ctx.cursor;

    if (alt) {
        const lineTextAll = ctx.code.line(row);
        const s = lineTextAll.slice(column);
        const match = s.match(/^[ \t]*\w+/);
        const jump = match ? match[0].length : 1;
        const lineText = lineTextAll;
        let col = column;
        for (let i = 0; i < jump; i++) {
            const nextCol = getNextGraphemeIndex(lineText, col);
            if (nextCol === col) { col++; } else { col = nextCol; }
        }
        if (col >= lineText.length) {
            const nextLine = ctx.code.getNextLine(row);
            if (nextLine < ctx.code.linesLength() && ctx.code.isLineEditable(nextLine)) {
                syncCursor(ctx, nextLine, 0);
            } else {
                syncCursor(ctx, row, lineText.length);
            }
        } else {
            syncCursor(ctx, row, col);
        }
    } else {
        if (ctx.selection && !ctx.selection.isEmpty() && !ctx.event?.shiftKey) {
            syncCursor(ctx, ctx.selection.end.row, ctx.selection.end.column);
        } else {
            const lineText = ctx.code.line(row);
            if (column >= lineText.length) {
                const nextLine = ctx.code.getNextLine(row);
                if (nextLine < ctx.code.linesLength() && ctx.code.isLineEditable(nextLine)) {
                    syncCursor(ctx, nextLine, 0);
                } else {
                    return { ctx, changed: false };
                }
            } else {
                const nextCol = getNextGraphemeIndex(lineText, column);
                syncCursor(ctx, row, nextCol);
            }
        }
    }
    
    if (ctx.event?.shiftKey) {
        if (!ctx.selection) {
            ctx.selection = new Selection(originalCursor, ctx.cursor);
        } else {
            ctx.selection = ctx.selection.fromCursor(ctx.cursor);
        }
    } else {
        if (ctx.selection) {
            ctx.selection = undefined;
        }
    }

    return { ctx, changed: false };
};

export const moveArrowLeft = (ctx: ActionContext, alt: boolean): ActionResult => {
    const originalCursor = { ...ctx.cursor };
    const { row, column } = ctx.cursor;
    const firstEditable = ctx.code.findFirstEditableLine();

    if (row <= firstEditable && column === 0) return { ctx, changed: false };

    if (alt) {
        const s = ctx.code.line(row).slice(0, column);
        const match = s.match(/\w+[ \t]*$/);
        const jump = match ? match[0].length : 1;
        const lineText = ctx.code.line(row);
        let col = column;
        for (let i = 0; i < jump; i++) {
            const prevCol = getPrevGraphemeIndex(lineText, col);
            if (prevCol === col) { col--; } else { col = prevCol; }
            if (col <= 0) { col = 0; break; }
        }
        syncCursor(ctx, row, col);
    } else {
        if (ctx.selection && !ctx.selection.isEmpty() && !ctx.event?.shiftKey) {
            syncCursor(ctx, ctx.selection.start.row, ctx.selection.start.column);
        } else {
            if (column === 0 && row > firstEditable) {
                const prevLine = ctx.code.getPrevLine(row);
                if (prevLine >= 0 && ctx.code.isLineEditable(prevLine)) {
                    const prevLineLen = ctx.code.line(prevLine).length;
                    syncCursor(ctx, prevLine, prevLineLen);
                }
            } else {
                const lineText = ctx.code.line(row);
                const prevCol = getPrevGraphemeIndex(lineText, column);
                syncCursor(ctx, row, prevCol);
            }
        }
    }
    
    if (ctx.event?.shiftKey) {
        if (!ctx.selection) {
            ctx.selection = new Selection(originalCursor, ctx.cursor);
        } else {
            ctx.selection = ctx.selection.fromCursor(ctx.cursor);
        }
    } else {
        if (ctx.selection) {
            ctx.selection = undefined;
        }
    }

    return { ctx, changed: false };
};

export const handleEsc = (ctx: ActionContext): ActionResult => {
    if (ctx.selection && !ctx.selection.isEmpty()) {
        ctx.selection = undefined;
        return { ctx, changed: true };
    }

    return { ctx, changed: false };
};

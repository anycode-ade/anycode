import { Code, Edit, Operation } from './code';
import type { Point } from './types';

/**
 * Maps a buffer offset across one edit that has just been applied to the buffer.
 * Insert at or before the offset pushes it right; a removal entirely before it pulls it
 * left; an offset inside a removed range collapses to the start of that range.
 */
export function transformOffset(offset: number, edit: Edit): number {
    if (edit.operation === Operation.Insert) {
        return edit.start <= offset ? offset + edit.text.length : offset;
    }
    if (edit.operation === Operation.Remove) {
        const end = edit.start + edit.text.length;
        if (offset >= end) return offset - edit.text.length;
        if (offset > edit.start) return edit.start;
    }
    return offset;
}

/**
 * Applies remote edits in order and returns the given points moved so that each stays on
 * the same characters. Each edit's offset is relative to the buffer as it is at that step.
 */
export function applyEditsKeepingPoints(code: Code, edits: Edit[], points: Point[]): Point[] {
    let offsets = points.map((p) => code.getOffset(p.row, p.column));
    for (const edit of edits) {
        if (edit.operation === Operation.Insert) {
            code.insert(edit.text, edit.start);
        } else if (edit.operation === Operation.Remove) {
            code.remove(edit.start, edit.text.length);
        }
        offsets = offsets.map((offset) => transformOffset(offset, edit));
    }
    return offsets.map((offset) => code.getPoint(offset));
}

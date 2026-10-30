import type { TextRange } from "../wordDiff";

function appendSpan(parent: HTMLElement, text: string, className: string): void {
    const span = document.createElement('span');
    if (className) span.className = className;
    span.textContent = text;
    parent.appendChild(span);
}

/**
 * Appends one syntax token as spans, splitting it where word-diff ranges overlap it.
 *
 * Tokens must be appended in column order and `ranges` must be sorted and
 * non-overlapping. Pass the returned index to the next token so the line is
 * processed in O(tokens + ranges) without rescanning earlier ranges.
 */
export function appendTokenSpans(
    parent: HTMLElement,
    text: string,
    classString: string,
    offset: number,
    ranges: readonly TextRange[] | undefined,
    rangeIndex: number,
    highlightClass: string,
): number {
    if (text.length === 0) return rangeIndex;
    if (!ranges || rangeIndex >= ranges.length) {
        appendSpan(parent, text, classString);
        return rangeIndex;
    }

    const end = offset + text.length;
    let cursor = offset;
    while (rangeIndex < ranges.length) {
        const range = ranges[rangeIndex];
        if (range.start >= end) break;

        const start = range.start > cursor ? range.start : cursor;
        const stop = range.end < end ? range.end : end;
        if (stop > start) {
            if (start > cursor) {
                appendSpan(parent, text.substring(cursor - offset, start - offset), classString);
            }
            appendSpan(
                parent,
                text.substring(start - offset, stop - offset),
                classString ? `${classString} ${highlightClass}` : highlightClass,
            );
            cursor = stop;
        }

        // A range that extends past this token continues into the next one.
        if (range.end > end) break;
        rangeIndex++;
    }

    if (cursor < end) {
        appendSpan(parent, text.substring(cursor - offset), classString);
    }
    return rangeIndex;
}

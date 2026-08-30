import { AnycodeLine, Pos, Point } from "./types";
import { getLineTextLength, isDiagnosticElement, isInsideDiagnostic } from "./utils";

export function comparePoints(a: Point, b: Point): number {
    if (a.row !== b.row) return a.row - b.row;
    return a.column - b.column;
}

export function pointsEqual(a: Point | null | undefined, b: Point | null | undefined): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.row === b.row && a.column === b.column;
}

export class Selection {
    public anchor: Point;
    public cursor: Point;

    constructor(anchor: Point, cursor: Point) {
        this.anchor = { row: anchor.row, column: anchor.column };
        this.cursor = { row: cursor.row, column: cursor.column };
    }

    public reset(pos: Point) {
        this.anchor = { row: pos.row, column: pos.column };
        this.cursor = { row: pos.row, column: pos.column };
    }

    public updateCursor(pos: Point) {
        this.cursor = { row: pos.row, column: pos.column };
    }

    fromCursor(cursor: Point): Selection {
        return new Selection(this.anchor, cursor);
    }

    public isEmpty(): boolean {
        return this.anchor.row === this.cursor.row && this.anchor.column === this.cursor.column;
    }

    public nonEmpty(): boolean {
        return !this.isEmpty();
    }

    public sorted(): [Point, Point] {
        return this.isBackward()
            ? [{ ...this.cursor }, { ...this.anchor }]
            : [{ ...this.anchor }, { ...this.cursor }];
    }

    public isBackward(): boolean {
        return comparePoints(this.cursor, this.anchor) < 0;
    }

    public get start(): Point {
        return this.sorted()[0];
    }

    public get end(): Point {
        return this.sorted()[1];
    }

    public equals(other: Selection): boolean {
        const [startA, endA] = this.sorted();
        const [startB, endB] = other.sorted();
        return pointsEqual(startA, startB) && pointsEqual(endA, endB);
    }

    public clone(): Selection {
        return new Selection(this.anchor, this.cursor);
    }
}

export function getSelection(): { start: Pos, end: Pos } | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
        return null;
    }

    const range = sel.getRangeAt(0);
    if (range.collapsed) {
        return null;
    }

    const start = resolveAbsoluteOffset(range.startContainer, range.startOffset);
    const end = resolveAbsoluteOffset(range.endContainer, range.endOffset);

    if (start == null || end == null) {
        return null;
    }

    return { start, end };
}

export function hasDiagnosticSelection(): boolean {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return false;
    return isInsideDiagnostic(sel.anchorNode) || isInsideDiagnostic(sel.focusNode);
}

export function resolveAbsoluteOffset(node: Node, nodeOffset: number): Pos | null {
    if (isInsideDiagnostic(node)) {
        return null;
    }

    // corner case, whole row selected
    if (
        node instanceof HTMLElement &&
        node.classList.contains("line")
    ) {
        const lineDiv = node as AnycodeLine;
        return { row: lineDiv.lineNumber, col: 0 };
    }

    const lineDiv = (
        node instanceof HTMLElement
            ? node.closest(".line")
            : node.parentElement?.closest(".line")
    ) as AnycodeLine | null;

    if (!lineDiv || typeof lineDiv.lineNumber !== "number") return null;

    let offset = 0;
    let found = false;

    for (const child of lineDiv.childNodes) {
        if (found) break;
        if (isDiagnosticElement(child)) continue;

        if (child.contains(node)) {
            if (child === node) {
                offset += nodeOffset;
            } else {
                for (const sub of child.childNodes) {
                    if (sub === node) {
                        offset += nodeOffset;
                        found = true;
                        break;
                    } else {
                        offset += sub.textContent?.length ?? 0;
                    }
                }
            }
            found = true;
        } else {
            offset += child.textContent?.length ?? 0;
        }
    }

    return { row: lineDiv.lineNumber, col: offset };
}

interface DOMPosition {
    node: Node;
    offset: number;
}

function resolveDOMPosition(
    point: Point, lines: AnycodeLine[]
): DOMPosition | null {
    const line = lines.find((l) => l.lineNumber === point.row);
    if (!line) return null;

    const lineLength = getLineTextLength(line);
    const targetColumn = Math.max(0, Math.min(lineLength, point.column));

    if (lineLength === 0 || targetColumn === 0) {
        const firstChild = Array.from(line.childNodes).find(
            (child) => !isDiagnosticElement(child)
        );
        if (firstChild) {
            const textNode = firstChild.firstChild || firstChild;
            return { node: textNode, offset: 0 };
        }
    }

    let remaining = targetColumn;
    for (const span of line.childNodes) {
        if (isDiagnosticElement(span)) continue;
        const len = span.textContent?.length ?? 0;

        if (remaining <= len) {
            const textNode = span.firstChild || span;
            return { node: textNode, offset: remaining };
        }
        remaining -= len;
    }

    const lineChildren = Array.from(line.childNodes).filter(
        (child) => !isDiagnosticElement(child)
    );
    const lastSpan = lineChildren[lineChildren.length - 1];
    if (lastSpan) {
        const lastLen = lastSpan.textContent?.length ?? 0;
        const textNode = lastSpan.firstChild || lastSpan;
        return { node: textNode, offset: lastLen };
    }

    return null;
}

export function renderSelection(
    selection: Selection, lines: AnycodeLine[]
) {
    if (lines.length === 0) return;

    // Ensure all lines are connected to the DOM before proceeding
    for (const line of lines) {
        if (!line.isConnected) {
            return;
        }
    }

    const [selectionStart, selectionEnd] = selection.sorted();

    // Sort lines by line number
    const sortedLines = [...lines].sort((a, b) => a.lineNumber - b.lineNumber);
    const firstLine = sortedLines[0];
    const lastLine = sortedLines[sortedLines.length - 1];

    if (selectionEnd.row < firstLine.lineNumber || selectionStart.row > lastLine.lineNumber) {
        const sel = window.getSelection();
        if (sel) sel.removeAllRanges();
        return;
    }

    const effectiveStart: Point = selectionStart.row < firstLine.lineNumber
        ? { row: firstLine.lineNumber, column: 0 }
        : selectionStart;

    const effectiveEnd: Point = selectionEnd.row > lastLine.lineNumber
        ? { row: lastLine.lineNumber, column: getLineTextLength(lastLine) }
        : selectionEnd;

    // Check if the same selection is already active in the DOM
    const currentSelection = getSelection();
    if (currentSelection) {
        if (
            currentSelection.start.row === effectiveStart.row &&
            currentSelection.start.col === effectiveStart.column &&
            currentSelection.end.row === effectiveEnd.row &&
            currentSelection.end.col === effectiveEnd.column
        ) {
            return;
        }
    }

    const startPos = resolveDOMPosition(effectiveStart, sortedLines);
    const endPos = resolveDOMPosition(effectiveEnd, sortedLines);

    if (!startPos || !endPos) return;

    const doc = startPos.node.ownerDocument || document;
    const range = doc.createRange();
    const sel = window.getSelection();
    if (!sel) return;

    range.setStart(startPos.node, startPos.offset);
    range.setEnd(endPos.node, endPos.offset);

    try {
        sel.removeAllRanges();
        sel.addRange(range);
    } catch (error) {
        console.warn("Failed to add range to selection:", error);
    }
}

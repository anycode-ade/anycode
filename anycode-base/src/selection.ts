import { AnycodeLine, Pos, getLineTextLength, isDiagnosticElement, isInsideDiagnostic } from "./utils";
import { Code } from "./code";

export class Selection {
    public anchor: number | null;
    public cursor: number | null;

    constructor(anchor: number, cursor: number) {
        this.anchor = anchor;
        this.cursor = cursor;
    }

    public reset(pos: number) {
        this.anchor = pos;
        this.cursor = pos;
    }

    public updateCursor(pos: number) {
        this.cursor = pos;
    }

    fromCursor(cursor: number): Selection {
        return new Selection(this.anchor!, cursor);
    }

    public isEmpty(): boolean {
        return this.anchor === this.cursor;
    }

    public nonEmpty(): boolean {
        return !this.isEmpty();
    }

    public sorted(): [number, number] {
        return this.anchor! <= this.cursor!
            ? [this.anchor!, this.cursor!]
            : [this.cursor!, this.anchor!];
    }

    public isBackward(): boolean {
        return this.cursor! < this.anchor!;
    }

    public get start(): number {
        return Math.min(this.anchor!, this.cursor!);
    }

    public get end(): number {
        return Math.max(this.anchor!, this.cursor!);
    }

    public equals(other: Selection): boolean {
        const [startA, endA] = this.sorted();
        const [startB, endB] = other.sorted();
        return startA === startB && endA === endB;
    }

    public clone(): Selection {
        return new Selection(this.anchor!, this.cursor!);
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
    offset: number, lines: AnycodeLine[], code: Code,
): DOMPosition | null {

    const pos = code.getPosition(offset);
    const lineLength = code.line(pos.line).length;

    if (pos.column === 0 && lineLength === 0 && offset > 0) {
        offset = offset - 1;
    }

    for (const line of lines) {
        const lineOffset = code.getOffset(line.lineNumber, 0);
        const lineLength = getLineTextLength(line);

        if (offset >= lineOffset && offset <= lineOffset + lineLength) {
            let remaining = offset - lineOffset;

            if (lineLength === 0 && remaining === 0) {
                const firstChild = Array.from(line.childNodes)
                    .find(child => !isDiagnosticElement(child));
                if (firstChild) {
                    const textNode = firstChild.firstChild || firstChild;
                    return { node: textNode, offset: 0 };
                }
            }

            for (const span of line.childNodes) {
                if (isDiagnosticElement(span)) continue;
                const len = span.textContent?.length ?? 0;

                if (remaining <= len) {
                    const textNode = span.firstChild || span;
                    return { node: textNode, offset: remaining };
                }
                remaining -= len;
            }

            const lineChildren = Array.from(line.childNodes).filter(child => !isDiagnosticElement(child));
            const lastSpan = lineChildren[lineChildren.length - 1];
            if (lastSpan) {
                const lastLen = lastSpan.textContent?.length ?? 0;
                const textNode = lastSpan.firstChild || lastSpan;
                return { node: textNode, offset: lastLen };
            }
        }
    }
    return null;
}

export function renderSelection(
    selection: Selection, lines: AnycodeLine[], code: Code
) {
    // console.log("setSelectionFromOffsets ", selection);
    const [selectionStart, selectionEnd] = selection.sorted(); // DOM needs sorted

    if (lines.length === 0) return;

    // Check if the same selection is already active
    const currentSelection = getSelection();
    if (currentSelection) {
        const currentStartOffset = code.getOffset(currentSelection.start.row, currentSelection.start.col);
        const currentEndOffset = code.getOffset(currentSelection.end.row, currentSelection.end.col);
        const [newStart, newEnd] = selection.sorted();

        if (currentStartOffset === newStart && currentEndOffset === newEnd) {
            return;
        }
    }

    // Ensure all lines are connected to the DOM before proceeding
    for (const line of lines) {
        if (!line.isConnected) {
            console.warn('setSelectionFromOffsets: line is not connected to DOM');
            return;
        }
    }

    const firstLine = lines[0];
    const lastLine = lines[lines.length - 1];

    const visibleStart = code.getOffset(firstLine.lineNumber, 0);
    const visibleEnd =
        code.getOffset(lastLine.lineNumber, 0) +
        getLineTextLength(lastLine);

    const clampedStart = Math.max(selectionStart, visibleStart);
    const clampedEnd = Math.min(selectionEnd, visibleEnd);
    if (clampedStart > clampedEnd) return;

    let finalStart = clampedStart;
    let finalEnd = clampedEnd;

    // Adjust start offset if it falls within a fold gap
    let startAdjusted = false;
    for (const line of lines) {
        const lineOffset = code.getOffset(line.lineNumber, 0);
        const lineLength = getLineTextLength(line);
        const lineEnd = lineOffset + lineLength;

        if (finalStart >= lineOffset && finalStart <= lineEnd) {
            startAdjusted = true;
            break;
        }
        if (finalStart < lineOffset) {
            finalStart = lineOffset;
            startAdjusted = true;
            break;
        }
    }
    if (!startAdjusted) return;

    // Adjust end offset if it falls within a fold gap
    let endAdjusted = false;
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        const lineOffset = code.getOffset(line.lineNumber, 0);
        const lineLength = getLineTextLength(line);
        const lineEnd = lineOffset + lineLength;

        if (finalEnd >= lineOffset && finalEnd <= lineEnd) {
            endAdjusted = true;
            break;
        }
        if (finalEnd > lineEnd) {
            finalEnd = lineEnd;
            endAdjusted = true;
            break;
        }
    }
    if (!endAdjusted) return;

    if (finalStart > finalEnd) return;

    const clamped = new Selection(finalStart, finalEnd);

    const startPos = resolveDOMPosition(clamped.start, lines, code);
    const endPos = resolveDOMPosition(clamped.end, lines, code);

    if (!startPos || !endPos) return;

    // Ensure we're working with the correct document context
    const doc = startPos.node.ownerDocument || document;
    const range = doc.createRange();
    const sel = window.getSelection();
    if (!sel) return;

    range.setStart(startPos.node, startPos.offset);
    range.setEnd(endPos.node, endPos.offset);

    // Ensure the range is valid and in the same document as the selection
    try {
        sel.removeAllRanges();
        sel.addRange(range);
        // console.log("addRange", range);
    } catch (error) {
        console.warn('Failed to add range to selection:', error);
    }
}

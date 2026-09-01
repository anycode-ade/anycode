import { CSS_CLASS } from "../constants";
import { AnycodeLine, GhostElement, GutterElement } from "../types";
import { isGhostElement } from "../utils";
import { EditorSettings } from "../editor";
import { DiffInfo, ChangeType, DiffModel } from "../diff";
import { Code, HighlighedNode, WordHighlight } from "../code";
import type { GhostRow, SeparatorRow, VisualRow } from "./Renderer";

export type ExpandDirection = 'up' | 'down' | 'both' | 'all';

export interface GapElementData {
    hiddenStart: number;
    hiddenEnd: number;
    expandStep: number;
    expandDirection: ExpandDirection;
}

const gapElementDataMap = new WeakMap<HTMLElement, GapElementData>();

export const setGapElementData = (el: HTMLElement, data: GapElementData): void => {
    gapElementDataMap.set(el, data);
};

export const getGapElementData = (el: HTMLElement): GapElementData | undefined => {
    return gapElementDataMap.get(el);
};

export interface GhostLine {
    code: GhostElement;
    gutter: GhostElement;
    btn: GhostElement;
    fold: GhostElement;
}

/**
 * DiffRenderer handles diff visualization, ghost lines, and focused diff model.
 * Manages diff highlighting, ghost lines for deleted content, hunk synchronization,
 * and focused diff visibility/separator computation.
 */
export class DiffRenderer {
    private codeContent: HTMLDivElement;
    private gutter: HTMLDivElement;
    private buttonsColumn: HTMLDivElement;
    private foldsColumn: HTMLDivElement;

    // Focused diff model state
    private focusedDiffEnabled: boolean = false;
    private focusedDiffContextLines: number = 3;
    private focusedDiffExpandedRanges: Array<{ start: number; end: number }> = [];

    constructor(
        codeContent: HTMLDivElement,
        gutter: HTMLDivElement,
        buttonsColumn: HTMLDivElement,
        foldsColumn: HTMLDivElement
    ) {
        this.codeContent = codeContent;
        this.gutter = gutter;
        this.buttonsColumn = buttonsColumn;
        this.foldsColumn = foldsColumn;
    }

    /**
     * Get a line by its line number (internal helper)
     */
    private getLine(lineNumber: number): AnycodeLine | null {
        for (let i = 0; i < this.codeContent.children.length; i++) {
            const child = this.codeContent.children[i];
            if (child.classList.contains('spacer') || isGhostElement(child)) {
                continue;
            }
            const line = child as AnycodeLine;
            if (line.lineNumber === lineNumber) {
                return line;
            }
        }
        return null;
    }

    // ========== Ghost Lines ==========

    private createDeletedGhostLine(
        text: string,
        settings: EditorSettings,
        hunkId: number,
        nodes?: HighlighedNode[],
        wordHighlight?: WordHighlight | null
    ): HTMLDivElement & GhostElement {
        const ghostLine = document.createElement('div') as HTMLDivElement & GhostElement;
        ghostLine.className = `${CSS_CLASS.LINE} ${CSS_CLASS.LINE_DELETED_GHOST}`;
        ghostLine.isGhost = true;
        ghostLine.hunkId = hunkId;

        if (nodes && nodes.length > 0) {
            for (const { name, text: nodeText } of nodes) {
                const span = document.createElement('span');
                const classNameParts: string[] = [];
                if (name) {
                    // Keep class fallback behavior consistent with normal line rendering.
                    const parts = name.split('.').filter(Boolean);
                    classNameParts.push(...Array.from(new Set([name, ...parts])));
                }
                if (!name && nodeText === '\t') classNameParts.push('indent');

                if (
                    wordHighlight?.token &&
                    classNameParts.includes(wordHighlight.token) &&
                    nodeText === wordHighlight.text
                ) {
                    classNameParts.push('wh');
                }

                if (classNameParts.length > 0) {
                    span.className = classNameParts.join(' ');
                }
                span.textContent = nodeText;
                ghostLine.appendChild(span);
            }
        } else if (text === '') {
            ghostLine.textContent = '\u00A0'; // non-breaking space
        } else {
            ghostLine.textContent = text;
        }

        return ghostLine;
    }

    /**
     * Create DOM elements for a ghost row (from visual rows model)
     * Returns code, gutter, and button elements for the ghost line
     */
    public createGhostRowElements(
        ghostRow: GhostRow, 
        settings: EditorSettings,
        originalText: string,
        originalNodes?: HighlighedNode[],
        wordHighlight?: WordHighlight | null,
    ): GhostLine {
        const { hunkId } = ghostRow;
        
        const ghostLine = this.createDeletedGhostLine(
            originalText,
            settings,
            hunkId,
            originalNodes,
            wordHighlight
        ) as HTMLDivElement & GhostElement & { originalLineIndex: number };
        ghostLine.originalLineIndex = ghostRow.originalLineIndex;

        const emptyGutter = document.createElement('div') as HTMLDivElement & GhostElement;
        emptyGutter.className = `${CSS_CLASS.GUTTER} ${CSS_CLASS.LINE_DELETED_GHOST}`;
        emptyGutter.isGhost = true;
        emptyGutter.hunkId = hunkId;
        emptyGutter.textContent = '';

        const emptyButton = document.createElement('div') as HTMLDivElement & GhostElement;
        emptyButton.className = `${CSS_CLASS.BUTTONS} ${CSS_CLASS.LINE_DELETED_GHOST}`;
        emptyButton.isGhost = true;
        emptyButton.hunkId = hunkId;

        const emptyFold = document.createElement('div') as HTMLDivElement & GhostElement;
        emptyFold.className = `${CSS_CLASS.FOLDS} ${CSS_CLASS.LINE_DELETED_GHOST}`;
        emptyFold.isGhost = true;
        emptyFold.hunkId = hunkId;

        return { code: ghostLine, gutter: emptyGutter, btn: emptyButton, fold: emptyFold };
    }

    public clearAllGhostLines(): void {
        this.removeGhostChildren(this.codeContent);
        this.removeGhostChildren(this.gutter);
        this.removeGhostChildren(this.buttonsColumn);
        this.removeGhostChildren(this.foldsColumn);
    }

    private removeGhostChildren(container: HTMLElement): void {
        Array.from(container.children)
            .filter((child): child is GhostElement => isGhostElement(child))
            .forEach((child) => child.remove());
    }

    // ========== Focused Diff Model ==========

    public isFocusedDiffEnabled(): boolean {
        return this.focusedDiffEnabled;
    }

    public setFocusedDiffMode(enabled: boolean, contextLines: number = 3): void {
        this.focusedDiffEnabled = enabled;
        this.focusedDiffContextLines = Math.max(0, contextLines);
        if (!enabled) {
            this.focusedDiffExpandedRanges = [];
        }
    }

    public clearExpandedRanges(): void {
        this.focusedDiffExpandedRanges = [];
    }

    /**
     * Returns the list of non-overlapping [start, end] 0-indexed line ranges that should be visible,
     * or `undefined` when focused diff is disabled (meaning "show all lines").
     */
    public computeVisibleRanges(
        totalLines: number,
        diffs: DiffModel | Map<number, DiffInfo> | undefined,
        code?: Code,
    ): { start: number; end: number }[] | undefined {
        if (!this.focusedDiffEnabled) {
            return undefined;
        }

        const hasChanges = diffs instanceof DiffModel
            ? diffs.hasChanges()
            : Boolean(diffs && diffs.size > 0);

        if (!diffs || !hasChanges) {
            return totalLines > 0 ? [{ start: 0, end: totalLines - 1 }] : [];
        }

        const rawRanges: { start: number; end: number }[] = [];
        const clamp = (line: number) => Math.max(0, Math.min(totalLines - 1, line));

        if (diffs instanceof DiffModel) {
            for (const hunk of diffs.getHunks()) {
                const start = clamp(hunk.startLine - 1);
                const end = hunk.changeType === 'deleted'
                    ? start
                    : clamp(hunk.startLine + Math.max(1, hunk.lineCount) - 2);

                let rStart = start;
                for (let step = 1; step <= this.focusedDiffContextLines; step++) {
                    const candidate = start - step;
                    if (candidate < 0) break;
                    if (code && !code.isSameFileBody(start, candidate)) break;
                    rStart = candidate;
                }

                let rEnd = end;
                for (let step = 1; step <= this.focusedDiffContextLines; step++) {
                    const candidate = end + step;
                    if (candidate >= totalLines) break;
                    if (code && !code.isSameFileBody(end, candidate)) break;
                    rEnd = candidate;
                }

                rawRanges.push({ start: rStart, end: rEnd });
            }
        } else {
            for (const [lineNumber] of diffs) {
                const center = lineNumber - 1;
                let rStart = center;
                for (let step = 1; step <= this.focusedDiffContextLines; step++) {
                    const candidate = center - step;
                    if (candidate < 0) break;
                    if (code && !code.isSameFileBody(center, candidate)) break;
                    rStart = candidate;
                }
                let rEnd = center;
                for (let step = 1; step <= this.focusedDiffContextLines; step++) {
                    const candidate = center + step;
                    if (candidate >= totalLines) break;
                    if (code && !code.isSameFileBody(center, candidate)) break;
                    rEnd = candidate;
                }
                rawRanges.push({ start: rStart, end: rEnd });
            }
        }

        for (const range of this.focusedDiffExpandedRanges) {
            rawRanges.push({ start: clamp(range.start), end: clamp(range.end) });
        }

        if (rawRanges.length === 0) {
            return totalLines > 0 ? [{ start: 0, end: totalLines - 1 }] : [];
        }

        // Sort and merge overlapping or adjacent ranges in O(H log H)
        rawRanges.sort((a, b) => a.start - b.start);
        const merged: { start: number; end: number }[] = [rawRanges[0]];

        for (let i = 1; i < rawRanges.length; i++) {
            const current = rawRanges[i];
            const prev = merged[merged.length - 1];

            if (current.start <= prev.end + 1) {
                prev.end = Math.max(prev.end, current.end);
            } else {
                merged.push(current);
            }
        }

        return merged;
    }

    /**
     * Returns the set of 0-indexed real line indices that should be rendered,
     * or `undefined` when focused diff is disabled (meaning "show all lines").
     */
    public computeVisibleLines(
        totalLines: number,
        diffs: DiffModel | Map<number, DiffInfo> | undefined,
        code?: Code,
    ): Set<number> | undefined {
        const ranges = this.computeVisibleRanges(totalLines, diffs, code);
        if (!ranges) return undefined;
        const visible = new Set<number>();
        for (const r of ranges) {
            for (let i = r.start; i <= r.end; i++) {
                visible.add(i);
            }
        }
        return visible;
    }

    /**
     * Expand a hidden region so that more lines become visible on the next render.
     * Returns `true` if the model was mutated.
     */
    public expandRange(
        hiddenStart: number,
        hiddenEnd: number,
        amount: number = 5,
        side: ExpandDirection = 'both',
    ): boolean {
        if (!this.focusedDiffEnabled || hiddenStart > hiddenEnd) {
            return false;
        }

        if (side === 'all') {
            this.focusedDiffExpandedRanges.push({ start: hiddenStart, end: hiddenEnd });
            return true;
        }

        const step = Math.max(1, amount);

        if (side === 'down') {
            const nextEnd = Math.min(hiddenEnd, hiddenStart + step - 1);
            this.focusedDiffExpandedRanges.push({ start: hiddenStart, end: nextEnd });
            return true;
        }

        if (side === 'up') {
            const nextStart = Math.max(hiddenStart, hiddenEnd - step + 1);
            this.focusedDiffExpandedRanges.push({ start: nextStart, end: hiddenEnd });
            return true;
        }

        // 'both'
        const downEnd = Math.min(hiddenEnd, hiddenStart + step - 1);
        const upStart = Math.max(hiddenStart, hiddenEnd - step + 1);
        this.focusedDiffExpandedRanges.push({ start: hiddenStart, end: downEnd });
        this.focusedDiffExpandedRanges.push({ start: upStart, end: hiddenEnd });
        return true;
    }

    // ========== Diff Class Management ==========

    public getDiffClass(changeType: ChangeType): string {
        switch (changeType) {
            case 'modified':
                return CSS_CLASS.DIFF_CHANGED;
            case 'added':
                return CSS_CLASS.DIFF_ADDED;
            case 'deleted':
                return CSS_CLASS.DIFF_DELETED;
            default:
                return '';
        }
    }



    public clearAllDiffs(): void {
        const classes = [CSS_CLASS.DIFF_CHANGED, CSS_CLASS.DIFF_ADDED, CSS_CLASS.DIFF_DELETED];
        const selector = `.${CSS_CLASS.DIFF_CHANGED}, .${CSS_CLASS.DIFF_ADDED}, .${CSS_CLASS.DIFF_DELETED}`;

        for (const container of [this.gutter, this.codeContent, this.buttonsColumn, this.foldsColumn]) {
            container.querySelectorAll(selector).forEach((el) => el.classList.remove(...classes));
        }

        // Clear all ghost lines
        this.clearAllGhostLines();
    }

    private getGutterLine(lineNumber: number): GutterElement | null {
        for (const child of Array.from(this.gutter.children)) {
            if (!child.classList.contains('ln') || isGhostElement(child)) continue;
            const line = child as GutterElement;
            if (line.lineNumber === lineNumber) return line;
        }
        return null;
    }

    // ========== Gap Row (Separator) Rendering ==========

    public createGapRowElements(
        row: SeparatorRow,
        settings: EditorSettings
    ): { code: HTMLElement; gutter: HTMLElement; btn: HTMLElement; fold: HTMLElement } {
        const code = document.createElement('div');
        code.className = `${CSS_CLASS.LINE} ${CSS_CLASS.DIFF_GAP}`;
        code.title = `Click to expand ${row.hiddenCount} hidden ${row.hiddenCount === 1 ? 'line' : 'lines'}`;
        setGapElementData(code, {
            hiddenStart: row.hiddenStart,
            hiddenEnd: row.hiddenEnd,
            expandStep: 0,
            expandDirection: 'all',
        });

        const divider = document.createElement('div');
        divider.className = 'diff-gap-divider';
        setGapElementData(divider, {
            hiddenStart: row.hiddenStart,
            hiddenEnd: row.hiddenEnd,
            expandStep: 0,
            expandDirection: 'all',
        });
        code.appendChild(divider);

        const gutter = document.createElement('div');
        gutter.className = `${CSS_CLASS.GUTTER} ${CSS_CLASS.DIFF_GAP_GUTTER}`;

        const btn = document.createElement('div');
        btn.className = `${CSS_CLASS.BUTTONS} ${CSS_CLASS.DIFF_GAP_BTN}`;

        const fold = document.createElement('div');
        fold.className = `${CSS_CLASS.FOLDS} ${CSS_CLASS.FOLD_GAP_CELL}`;

        return { code, gutter, btn, fold };
    }
}

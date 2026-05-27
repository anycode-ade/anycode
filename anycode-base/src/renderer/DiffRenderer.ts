import { AnycodeLine } from "../utils";
import { EditorSettings } from "../editor";
import { DiffInfo, ChangeType } from "../diff";
import { HighlighedNode, WordHighlight } from "../code";
import type { GhostRow, SeparatorRow, VisualRow } from "./Renderer";

export type ExpandDirection = 'up' | 'down' | 'both' | 'all';

export interface GapElementData {
    hiddenStart: number;
    hiddenEnd: number;
    expandStep: number;
    expandDirection: ExpandDirection;
}

const gapElementDataMap = new WeakMap<HTMLElement, GapElementData>();

const setGapElementData = (el: HTMLElement, data: GapElementData): void => {
    gapElementDataMap.set(el, data);
};

export const getGapElementData = (el: HTMLElement): GapElementData | undefined => {
    return gapElementDataMap.get(el);
};

export interface GhostLine {
    code: HTMLElement;
    gutter: HTMLElement;
    btn: HTMLElement;
    fold: HTMLElement;
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
            if (child.classList.contains('spacer') || child.hasAttribute('data-ghost')) {
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
    ): HTMLDivElement {
        const ghostLine = document.createElement('div');
        ghostLine.className = "line line-deleted-ghost";
        ghostLine.style.lineHeight = `${settings.lineHeight}px`;
        ghostLine.setAttribute('data-ghost', 'true');
        ghostLine.setAttribute('data-hunk-id', hunkId.toString());

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
        wordHighlight?: WordHighlight | null
    ): GhostLine {
        const { hunkId } = ghostRow;
        
        const ghostLine = this.createDeletedGhostLine(
            originalText,
            settings,
            hunkId,
            originalNodes,
            wordHighlight
        );

        const emptyGutter = document.createElement('div');
        emptyGutter.className = 'ln';
        emptyGutter.style.height = `${settings.lineHeight}px`;
        emptyGutter.setAttribute('data-ghost', 'true');
        emptyGutter.setAttribute('data-hunk-id', hunkId.toString());

        const emptyButton = document.createElement('div');
        emptyButton.className = 'bt';
        emptyButton.style.height = `${settings.lineHeight}px`;
        emptyButton.setAttribute('data-ghost', 'true');
        emptyButton.setAttribute('data-hunk-id', hunkId.toString());

        const emptyFold = document.createElement('div');
        emptyFold.className = 'fd';
        emptyFold.style.height = `${settings.lineHeight}px`;
        emptyFold.setAttribute('data-ghost', 'true');
        emptyFold.setAttribute('data-hunk-id', hunkId.toString());

        return { code: ghostLine, gutter: emptyGutter, btn: emptyButton, fold: emptyFold };
    }

    public clearAllGhostLines(): void {
        const ghostLines = this.codeContent.querySelectorAll('[data-ghost="true"]');
        ghostLines.forEach((ghostLine) => {
            ghostLine.remove();
        });

        const gutterGhosts = this.gutter.querySelectorAll('[data-ghost="true"]');
        gutterGhosts.forEach((ghost) => {
            ghost.remove();
        });

        const btnGhosts = this.buttonsColumn.querySelectorAll('[data-ghost="true"]');
        btnGhosts.forEach((ghost) => {
            ghost.remove();
        });

        const foldGhosts = this.foldsColumn.querySelectorAll('[data-ghost="true"]');
        foldGhosts.forEach((ghost) => {
            ghost.remove();
        });
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

    /**
     * Returns the set of 0-indexed real line indices that should be rendered,
     * or `undefined` when focused diff is disabled (meaning "show all lines").
     */
    public computeVisibleLines(
        totalLines: number,
        diffs: Map<number, DiffInfo> | undefined,
    ): Set<number> | undefined {
        if (!this.focusedDiffEnabled) {
            return undefined;
        }

        const visible = new Set<number>();
        if (!diffs || diffs.size === 0) {
            for (let i = 0; i < totalLines; i++) visible.add(i);
            return visible;
        }

        const clamp = (line: number) => Math.max(0, Math.min(totalLines - 1, line));

        for (const [lineNumber] of diffs) {
            const center = lineNumber - 1;
            const start = clamp(center - this.focusedDiffContextLines);
            const end = clamp(center + this.focusedDiffContextLines);
            for (let i = start; i <= end; i++) {
                visible.add(i);
            }
        }

        for (const range of this.focusedDiffExpandedRanges) {
            const start = clamp(range.start);
            const end = clamp(range.end);
            for (let i = start; i <= end; i++) {
                visible.add(i);
            }
        }

        return visible;
    }

    /**
     * Walk through `rows` and insert `SeparatorRow`s wherever consecutive real
     * lines are non-contiguous (i.e. some lines were hidden).
     * No-op when focused diff is disabled.
     */
    public insertSeparators(
        rows: VisualRow[],
        totalLines: number,
        isHiddenByFold?: (lineIndex: number) => boolean
    ): VisualRow[] {
        if (!this.focusedDiffEnabled) {
            return rows;
        }

        const result: VisualRow[] = [];
        let prevRealLine: number | null = null;

        const addSeparatorsForRange = (start: number, end: number) => {
            let currentStart: number | null = null;
            for (let i = start; i <= end; i++) {
                const folded = isHiddenByFold ? isHiddenByFold(i) : false;
                if (!folded) {
                    if (currentStart === null) {
                        currentStart = i;
                    }
                } else {
                    if (currentStart !== null) {
                        result.push({
                            kind: 'separator',
                            hiddenStart: currentStart,
                            hiddenEnd: i - 1,
                            hiddenCount: i - currentStart,
                        });
                        currentStart = null;
                    }
                }
            }
            if (currentStart !== null) {
                result.push({
                    kind: 'separator',
                    hiddenStart: currentStart,
                    hiddenEnd: end,
                    hiddenCount: end - currentStart + 1,
                });
            }
        };

        for (const row of rows) {
            if (row.kind === 'real') {
                if (prevRealLine === null) {
                    if (row.lineIndex > 0) {
                        addSeparatorsForRange(0, row.lineIndex - 1);
                    }
                } else if (row.lineIndex - prevRealLine > 1) {
                    addSeparatorsForRange(prevRealLine + 1, row.lineIndex - 1);
                }
                prevRealLine = row.lineIndex;
            }
            result.push(row);
        }

        if (prevRealLine !== null) {
            if (prevRealLine < totalLines - 1) {
                addSeparatorsForRange(prevRealLine + 1, totalLines - 1);
            }
        } else if (totalLines > 0) {
            addSeparatorsForRange(0, totalLines - 1);
        }

        return result;
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

        if (side === 'up') {
            const nextEnd = Math.min(hiddenEnd, hiddenStart + step - 1);
            this.focusedDiffExpandedRanges.push({ start: hiddenStart, end: nextEnd });
            return true;
        }

        if (side === 'down') {
            const nextStart = Math.max(hiddenStart, hiddenEnd - step + 1);
            this.focusedDiffExpandedRanges.push({ start: nextStart, end: hiddenEnd });
            return true;
        }

        // 'both'
        const upEnd = Math.min(hiddenEnd, hiddenStart + step - 1);
        const downStart = Math.max(hiddenStart, hiddenEnd - step + 1);
        this.focusedDiffExpandedRanges.push({ start: hiddenStart, end: upEnd });
        this.focusedDiffExpandedRanges.push({ start: downStart, end: hiddenEnd });
        return true;
    }

    // ========== Diff Class Management ==========

    public getDiffClass(changeType: ChangeType): string {
        switch (changeType) {
            case 'modified':
                return 'diff-changed';
            case 'added':
                return 'diff-added';
            case 'deleted':
                return 'diff-deleted';
            default:
                return '';
        }
    }

    public verifyDiffs(diffResult: Map<number, DiffInfo>): void {
        const currentDiffLines = new Map<number, ChangeType>();

        const gutterLines = this.gutter.querySelectorAll('.ln');
        gutterLines.forEach((gutterLine) => {
            const lineIndex = parseInt(gutterLine.getAttribute('data-line') || '-1', 10);
            if (lineIndex < 0) return;

            const lineNumber = lineIndex + 1;

            if (gutterLine.classList.contains('diff-changed')) {
                currentDiffLines.set(lineNumber, 'modified');
            } else if (gutterLine.classList.contains('diff-added')) {
                currentDiffLines.set(lineNumber, 'added');
            } else if (gutterLine.classList.contains('diff-deleted')) {
                currentDiffLines.set(lineNumber, 'deleted');
            }
        });

        const linesToRemove: number[] = [];
        for (const [lineNumber] of currentDiffLines.entries()) {
            if (!diffResult.has(lineNumber)) {
                linesToRemove.push(lineNumber);
            }
        }

        for (const lineNumber of linesToRemove) {
            const lineIndex = lineNumber - 1;
            this.removeDiffGutter(lineIndex);
            this.removeDiffCodeLine(lineIndex);
        }

        for (const [lineNumber, diffInfo] of diffResult.entries()) {
            const lineIndex = lineNumber - 1;
            const changeType = diffInfo.changeType;

            const currentType = currentDiffLines.get(lineNumber);
            if (currentType !== changeType) {
                this.addDiffGutter(lineIndex, changeType);
            }

            if (changeType === 'added' || changeType === 'modified') {
                const codeLine = this.getLine(lineIndex);
                if (codeLine) {
                    const expectedCodeClass = changeType === 'modified' ? 'diff-changed' : 'diff-added';

                    // Check if already has the correct class
                    if (codeLine.classList.contains(expectedCodeClass)) {
                        continue;
                    }

                    // Update classes only if needed
                    codeLine.classList.remove('diff-changed', 'diff-added', 'diff-deleted');
                    codeLine.classList.add(expectedCodeClass);
                }
            } else if (changeType === 'deleted') {
                this.removeDiffCodeLine(lineIndex);
            }
        }
    }

    public addDiffGutter(lineIndex: number, changeType: ChangeType): void {
        const gutterLine = this.gutter.querySelector(`.ln[data-line="${lineIndex}"]`) as HTMLElement | null;
        if (!gutterLine) {
            return;
        }

        gutterLine.classList.remove('diff-changed', 'diff-added', 'diff-deleted');

        const diffClass = this.getDiffClass(changeType);
        if (diffClass) {
            gutterLine.classList.add(diffClass);
        }
    }

    private removeDiffGutter(lineIndex: number): void {
        const gutterLine = this.gutter.querySelector(`.ln[data-line="${lineIndex}"]`) as HTMLElement | null;
        if (!gutterLine) {
            return;
        }

        gutterLine.classList.remove('diff-changed', 'diff-added', 'diff-deleted');
    }

    private removeDiffCodeLine(lineIndex: number): void {
        const codeLine = this.getLine(lineIndex);
        if (codeLine) {
            codeLine.classList.remove('diff-changed', 'diff-added', 'diff-deleted');
        }
    }

    public clearAllDiffs(): void {
        const gutterLines = this.gutter.querySelectorAll('.ln.diff-changed, .ln.diff-added, .ln.diff-deleted');
        gutterLines.forEach((gutterLine) => {
            gutterLine.classList.remove('diff-changed', 'diff-added', 'diff-deleted');
        });

        const codeLines = this.codeContent.querySelectorAll('.line.diff-changed, .line.diff-added, .line.diff-deleted');
        codeLines.forEach((codeLine: Element) => {
            codeLine.classList.remove('diff-changed', 'diff-added', 'diff-deleted');
        });

        // Clear all ghost lines
        this.clearAllGhostLines();
    }

    // ========== Gap Row (Separator) Rendering ==========

    public createGapRowElements(
        row: SeparatorRow,
        settings: EditorSettings
    ): { code: HTMLElement; gutter: HTMLElement; btn: HTMLElement; fold: HTMLElement } {
        const code = document.createElement('div');
        code.className = 'line diff-gap';
        code.style.lineHeight = `${settings.lineHeight}px`;
        code.style.height = `${settings.lineHeight}px`;
        setGapElementData(code, {
            hiddenStart: row.hiddenStart,
            hiddenEnd: row.hiddenEnd,
            expandStep: 5,
            expandDirection: 'all',
        });

        const labelBtn = document.createElement('button');
        labelBtn.className = 'diff-gap-expand-btn diff-gap-expand-btn-label';
        labelBtn.type = 'button';
        labelBtn.textContent = `${row.hiddenCount} unmodified ${row.hiddenCount === 1 ? 'line' : 'lines'}`;
        setGapElementData(labelBtn, {
            hiddenStart: row.hiddenStart,
            hiddenEnd: row.hiddenEnd,
            expandStep: 0,
            expandDirection: 'all',
        });
        code.appendChild(labelBtn);

        const gutter = document.createElement('div');
        gutter.className = 'ln diff-gap-gutter';
        gutter.style.height = `${settings.lineHeight}px`;

        const upBtn = document.createElement('button');
        upBtn.className = 'diff-gap-expand-btn diff-gap-gutter-btn diff-gap-gutter-btn-up';
        upBtn.type = 'button';
        upBtn.setAttribute('aria-label', 'Expand hidden lines up');
        setGapElementData(upBtn, {
            hiddenStart: row.hiddenStart,
            hiddenEnd: row.hiddenEnd,
            expandStep: 5,
            expandDirection: 'up',
        });
        gutter.appendChild(upBtn);

        const downBtn = document.createElement('button');
        downBtn.className = 'diff-gap-expand-btn diff-gap-gutter-btn diff-gap-gutter-btn-down';
        downBtn.type = 'button';
        downBtn.setAttribute('aria-label', 'Expand hidden lines down');
        setGapElementData(downBtn, {
            hiddenStart: row.hiddenStart,
            hiddenEnd: row.hiddenEnd,
            expandStep: 5,
            expandDirection: 'down',
        });
        gutter.appendChild(downBtn);

        const btn = document.createElement('div');
        btn.className = 'bt diff-gap-btn';
        btn.style.height = `${settings.lineHeight}px`;

        const fold = document.createElement('div');
        fold.className = 'fd fold-gap-cell';
        fold.style.height = `${settings.lineHeight}px`;

        return { code, gutter, btn, fold };
    }
}

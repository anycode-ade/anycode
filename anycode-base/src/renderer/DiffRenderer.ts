import { AnycodeLine } from "../utils";
import { EditorSettings } from "../editor";
import { DiffInfo, ChangeType } from "../diff";
import { GhostRow } from "./Renderer";

export interface GhostLine {
    code: HTMLElement;
    gutter: HTMLElement;
    btn: HTMLElement;
}

/**
 * DiffRenderer handles diff visualization and ghost lines.
 * Manages diff highlighting, ghost lines for deleted content, and hunk synchronization.
 */
export class DiffRenderer {
    private codeContent: HTMLDivElement;
    private gutter: HTMLDivElement;
    private buttonsColumn: HTMLDivElement;

    constructor(
        codeContent: HTMLDivElement,
        gutter: HTMLDivElement,
        buttonsColumn: HTMLDivElement
    ) {
        this.codeContent = codeContent;
        this.gutter = gutter;
        this.buttonsColumn = buttonsColumn;
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

    // ========== Ghost Lines Rendering ==========

    private hasGhostContent(diffInfo: DiffInfo): boolean {
        return (
            (diffInfo.changeType === 'modified' || diffInfo.changeType === 'deleted') &&
            !!diffInfo.oldLines &&
            diffInfo.oldLines.length > 0
        );
    }

    private getGhostAnchorLine(lineNumber: number, diffInfo: DiffInfo): number {
        return diffInfo.ghostAnchorLine ?? lineNumber;
    }

    /**
     * @deprecated Use buildVisualRows + createGhostRowElements instead.
     * This method was used for dynamic ghost line insertion during render.
     */
    public renderGhostsForLine(
        lineIndex: number,
        diffResult: Map<number, DiffInfo>,
        renderedHunks: Set<number>,
        settings: EditorSettings
    ): GhostLine[] | null {
        const anchorLine = lineIndex + 1;
        const lines: GhostLine[] = [];

        for (const [lineNumber, diffInfo] of diffResult) {
            if (!this.hasGhostContent(diffInfo)) {
                continue;
            }
            if (this.getGhostAnchorLine(lineNumber, diffInfo) !== anchorLine) {
                continue;
            }

            const hunkId = diffInfo.hunkId;
            if (renderedHunks.has(hunkId)) {
                continue;
            }
            renderedHunks.add(hunkId);

            for (const oldLine of diffInfo.oldLines!) {
                const ghostLine = this.createDeletedGhostLine(oldLine, settings, hunkId);

                // Add empty gutter and button elements to keep alignment
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

                lines.push({ code: ghostLine, gutter: emptyGutter, btn: emptyButton });
            }
        }

        return lines.length > 0 ? lines : null;
    }

    /**
     * @deprecated No longer needed with visual rows model.
     * Ghost lines are now part of the unified visual rows and rendered with stable indices.
     */
    public syncVisibleGhosts(
        startLine: number,
        endLine: number,
        diffResult: Map<number, DiffInfo>,
        settings: EditorSettings,
        lines: AnycodeLine[],
        totalLines: number
    ): void {
        if (!diffResult || diffResult.size === 0) return;

        const visibleHunks = new Set<number>();
        const includeEofAnchor = endLine === totalLines;

        // Collect all hunks whose ghost anchor is visible.
        for (const [lineNumber, diffInfo] of diffResult) {
            if (!this.hasGhostContent(diffInfo)) {
                continue;
            }
            const anchorLine = this.getGhostAnchorLine(lineNumber, diffInfo);
            const inVisibleRange = anchorLine >= startLine + 1 && anchorLine <= endLine;
            const atVisibleEof = includeEofAnchor && anchorLine === totalLines + 1;

            if (inVisibleRange || atVisibleEof) {
                visibleHunks.add(diffInfo.hunkId);
            }
        }

        // Update ghost lines for each visible hunk
        for (const hunkId of visibleHunks) {
            let oldLinesForHunk: string[] | undefined;
            for (const [_, info] of diffResult) {
                if (info.hunkId === hunkId && info.oldLines && info.oldLines.length > 0) {
                    oldLinesForHunk = info.oldLines;
                    break;
                }
            }
            if (oldLinesForHunk) {
                this.updateGhostLinesForHunk(hunkId, oldLinesForHunk, settings, diffResult, lines);
            }
        }

        // Remove ghost lines for hunks that are no longer visible
        const allGhostLines = this.codeContent.querySelectorAll('[data-ghost="true"]');
        const ghostHunks = new Set<number>();
        allGhostLines.forEach((ghost) => {
            const hunkId = parseInt(ghost.getAttribute('data-hunk-id') || '-1', 10);
            if (hunkId >= 0) {
                ghostHunks.add(hunkId);
            }
        });

        for (const hunkId of ghostHunks) {
            if (!visibleHunks.has(hunkId)) {
                this.removeGhostLinesForHunk(hunkId);
            }
        }
    }

    private updateGhostLinesForHunk(
        hunkId: number, oldLines: string[],
        settings: EditorSettings,
        diffResult: Map<number, DiffInfo>,
        lines: AnycodeLine[]
    ): void {
        // Find existing ghost lines for this hunk
        const existingGhosts = this.findGhostLinesForHunk(hunkId);

        // If content matches, no update needed
        if (existingGhosts.length === oldLines.length) {
            let match = true;
            for (let i = 0; i < oldLines.length; i++) {
                const expectedText = oldLines[i] === '' ? '\u00A0' : oldLines[i];
                if (existingGhosts[i].textContent !== expectedText) {
                    match = false;
                    break;
                }
            }
            if (match) return; // No changes needed
        }

        // Remove old ghost lines and corresponding gutter/button elements
        this.removeGhostLinesForHunk(hunkId);

        // Find ghost anchor for this hunk.
        const anchorLineNum = this.getGhostAnchorLineInHunk(hunkId, diffResult);
        if (anchorLineNum === null) return;

        // Find anchor line from lines array (can be absent for EOF anchors).
        const anchorLine = lines.find(line => line.lineNumber === anchorLineNum - 1);

        // Insert new ghost lines before the first line
        const codeFrag = document.createDocumentFragment();
        const gutterFrag = document.createDocumentFragment();
        const btnFrag = document.createDocumentFragment();

        for (const oldLine of oldLines) {
            const ghostLine = this.createDeletedGhostLine(oldLine, settings, hunkId);
            codeFrag.appendChild(ghostLine);

            const emptyGutter = document.createElement('div');
            emptyGutter.className = 'ln';
            emptyGutter.style.height = `${settings.lineHeight}px`;
            emptyGutter.setAttribute('data-ghost', 'true');
            emptyGutter.setAttribute('data-hunk-id', hunkId.toString());
            gutterFrag.appendChild(emptyGutter);

            const emptyButton = document.createElement('div');
            emptyButton.className = 'bt';
            emptyButton.style.height = `${settings.lineHeight}px`;
            emptyButton.setAttribute('data-ghost', 'true');
            emptyButton.setAttribute('data-hunk-id', hunkId.toString());
            btnFrag.appendChild(emptyButton);
        }

        // Find corresponding gutter and button elements by data-line attribute.
        const anchorGutterEl = this.gutter.querySelector(`.ln[data-line="${anchorLineNum - 1}"]`);
        const anchorBtnEl = this.buttonsColumn.querySelector(`.bt[data-line="${anchorLineNum - 1}"]`);

        // Insert at the correct positions in all three containers.
        const codeInsertBefore = anchorLine ?? this.codeContent.lastElementChild;
        const gutterInsertBefore = anchorGutterEl ?? this.gutter.lastElementChild;
        const btnInsertBefore = anchorBtnEl ?? this.buttonsColumn.lastElementChild;

        this.codeContent.insertBefore(codeFrag, codeInsertBefore);
        this.gutter.insertBefore(gutterFrag, gutterInsertBefore);
        this.buttonsColumn.insertBefore(btnFrag, btnInsertBefore);
    }

    private createDeletedGhostLine(
        text: string, settings: EditorSettings, hunkId: number
    ): HTMLDivElement {
        const ghostLine = document.createElement('div');
        ghostLine.className = "line line-deleted-ghost";
        ghostLine.style.lineHeight = `${settings.lineHeight}px`;
        ghostLine.setAttribute('data-ghost', 'true');
        ghostLine.setAttribute('data-hunk-id', hunkId.toString());

        if (text === '') {
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
        settings: EditorSettings
    ): GhostLine {
        const { hunkId, text } = ghostRow;
        
        const ghostLine = this.createDeletedGhostLine(text, settings, hunkId);

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

        return { code: ghostLine, gutter: emptyGutter, btn: emptyButton };
    }

    private findGhostLinesForHunk(hunkId: number): HTMLElement[] {
        const ghostLines: HTMLElement[] = [];
        const allGhostLines = this.codeContent.querySelectorAll('[data-ghost="true"]');
        allGhostLines.forEach((ghost) => {
            if (ghost.getAttribute('data-hunk-id') === hunkId.toString()) {
                ghostLines.push(ghost as HTMLElement);
            }
        });
        return ghostLines;
    }

    private removeGhostLinesForHunk(hunkId: number): void {
        const ghostLines = this.findGhostLinesForHunk(hunkId);
        ghostLines.forEach(ghost => ghost.remove());

        const gutterGhosts = this.gutter.querySelectorAll(`[data-ghost="true"][data-hunk-id="${hunkId}"]`);
        gutterGhosts.forEach(ghost => ghost.remove());

        const btnGhosts = this.buttonsColumn.querySelectorAll(`[data-ghost="true"][data-hunk-id="${hunkId}"]`);
        btnGhosts.forEach(ghost => ghost.remove());
    }

    private getGhostAnchorLineInHunk(
        hunkId: number, diffResult: Map<number, DiffInfo>
    ): number | null {
        let minAnchorLine: number | null = null;
        for (const [lineNum, info] of diffResult) {
            if (info.hunkId === hunkId && this.hasGhostContent(info)) {
                const anchorLine = this.getGhostAnchorLine(lineNum, info);
                if (minAnchorLine === null || anchorLine < minAnchorLine) {
                    minAnchorLine = anchorLine;
                }
            }
        }
        return minAnchorLine;
    }

    public clearAllGhostLines(): void {
        // Remove all ghost lines from code
        const ghostLines = this.codeContent.querySelectorAll('[data-ghost="true"]');
        ghostLines.forEach((ghostLine) => {
            ghostLine.remove();
        });

        // Remove ghost elements from gutter
        const gutterGhosts = this.gutter.querySelectorAll('[data-ghost="true"]');
        gutterGhosts.forEach((ghost) => {
            ghost.remove();
        });

        // Remove ghost elements from buttons
        const btnGhosts = this.buttonsColumn.querySelectorAll('[data-ghost="true"]');
        btnGhosts.forEach((ghost) => {
            ghost.remove();
        });
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
}

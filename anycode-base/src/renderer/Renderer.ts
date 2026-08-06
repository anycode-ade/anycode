import { Code, HighlighedNode } from "../code";
import { AnycodeLine, RowElements } from "../types";
import { isGhostElement, objectHash, minimize } from "../utils";
import { moveCursor, removeCursor } from "../cursor";
import { EditorState, EditorSettings } from "../editor";
import { DiffInfo } from "../diff";
import { Selection, renderSelection } from "../selection";
import { Completion } from "../lsp";
import { Search } from "../search";
import { LineRenderer } from "./LineRenderer";
import { SearchRenderer } from "./SearchRenderer";
import { DiffRenderer } from "./DiffRenderer";
import { CompletionRenderer } from "./CompletionRenderer";
import { HoverRenderer } from "./HoverRenderer";
import { DiagnosticRenderer } from "./DiagnosticRenderer";
import { ScrollbarMarkersRenderer } from "./ScrollbarMarkersRenderer";
import { WordHighlightRenderer } from "./WordHighlightRenderer";
import { BracketMatchRenderer } from "./BracketMatchRenderer";

/**
 * A real line from the code
 */
export interface RealRow {
    kind: 'real';
    lineIndex: number;  // 0-indexed line in code
}

/**
 * A ghost line representing deleted content
 */
export interface GhostRow {
    kind: 'ghost';
    hunkId: number;
    anchorLine: number;  // 1-indexed, the line before which this ghost appears
    originalLineIndex: number; // 0-indexed line in original code
}

export interface SeparatorRow {
    kind: 'separator';
    hiddenStart: number; // inclusive, 0-indexed real line
    hiddenEnd: number;   // inclusive, 0-indexed real line
    hiddenCount: number;
}

export type VisualRow = RealRow | GhostRow | SeparatorRow;

export class Renderer {
    private container: HTMLDivElement;
    private buttonsColumn: HTMLDivElement;
    private gutter: HTMLDivElement;
    private foldsColumn: HTMLDivElement;
    private codeContent: HTMLDivElement;
    private diffEnabled: boolean = false;
    private lineRenderer: LineRenderer;
    private searchRenderer: SearchRenderer;
    private diffRenderer: DiffRenderer;
    private completionRenderer: CompletionRenderer;
    private hoverRenderer: HoverRenderer;
    private wordHighlightRenderer: WordHighlightRenderer;
    private bracketMatchRenderer: BracketMatchRenderer;
    private scrollbarMarkersRenderer: ScrollbarMarkersRenderer;
    private visualRows: VisualRow[] = [];
    private visualIndexByElement = new WeakMap<HTMLElement, number>();
    private lastCollapsedMap: Map<number, number> = new Map();
    private lastFoldableStarts: Map<number, number> = new Map();
    private lastHiddenLines: Set<number> = new Set();
    private codeFoldingEnabled: boolean = true;
    private charWidth = 0;
    private lastContentMinWidth = -1;

    constructor(
        container: HTMLDivElement,
        buttonsColumn: HTMLDivElement,
        gutter: HTMLDivElement,
        foldsColumn: HTMLDivElement,
        codeContent: HTMLDivElement,
        scrollbarMarkersEnabled: boolean = true
    ) {
        this.container = container;
        this.buttonsColumn = buttonsColumn;
        this.gutter = gutter;
        this.foldsColumn = foldsColumn;
        this.codeContent = codeContent;

        // Initialize renderers
        const diagnosticRenderer = new DiagnosticRenderer();
        this.lineRenderer = new LineRenderer(diagnosticRenderer);
        this.searchRenderer = new SearchRenderer(
            container,
            (lineNumber) => this.getLine(lineNumber),
            (state, focusLine) => this.revealCursor(state, focusLine)
        );
        this.diffRenderer = new DiffRenderer(
            codeContent,
            gutter,
            buttonsColumn,
            foldsColumn
        );
        this.completionRenderer = new CompletionRenderer(
            container,
            (lineNumber) => this.getLine(lineNumber)
        );
        this.hoverRenderer = new HoverRenderer(
            container,
            (lineNumber) => this.getLine(lineNumber)
        );
        this.wordHighlightRenderer = new WordHighlightRenderer(codeContent);
        this.bracketMatchRenderer = new BracketMatchRenderer(
            codeContent,
            (lineNumber) => this.getLine(lineNumber)
        );
        this.scrollbarMarkersRenderer = new ScrollbarMarkersRenderer(
            container,
            (state, line) => this.revealLineCenter(state, line),
            (state, index) => {
                this.searchRenderer.removeSelectedHighlight(state.search);
                state.search.setSelected(index);
                this.searchRenderer.updateSearchHighlights(state.search);
            },
            scrollbarMarkersEnabled
        );
    }

    public setDiffEnabled(enabled: boolean) {
        this.diffEnabled = enabled;
    }

    public getVisualRowCount(): number {
        return this.visualRows.length;
    }

    public setFocusedDiffMode(enabled: boolean, contextLines: number = 3) {
        this.diffRenderer.setFocusedDiffMode(enabled, contextLines);
    }

    public render(state: EditorState) {
        const { code, offset, selection, settings, diffs, readOnly, search } = state;
        this.codeFoldingEnabled = state.codeFoldingEnabled ?? true;
        this.updateFoldableStarts(state);
        this.updateCollapsedMap(state);

        // Build unified visual rows model (real lines + ghost lines)
        const totalRealLines = code.linesLength();
        this.visualRows = this.diffEnabled
            ? this.buildVisualRows(totalRealLines, diffs)
            : this.buildRealOnlyRows(totalRealLines);

        const totalVisualRows = this.visualRows.length;
        const { startIndex, endIndex } = this.getVisibleRange(totalVisualRows, settings);

        const itemHeight = settings.lineHeight;
        const paddingTop = startIndex * itemHeight;
        const paddingBottom = (totalVisualRows - endIndex) * itemHeight;

        // Build fragments for better performance
        const btnFrag = document.createDocumentFragment();
        const gutterFrag = document.createDocumentFragment();
        const foldsFrag = document.createDocumentFragment();
        const codeFrag = document.createDocumentFragment();

        // Top spacers
        btnFrag.appendChild(this.lineRenderer.createSpacer(paddingTop));
        gutterFrag.appendChild(this.lineRenderer.createSpacer(paddingTop));
        foldsFrag.appendChild(this.lineRenderer.createSpacer(paddingTop));
        codeFrag.appendChild(this.lineRenderer.createSpacer(paddingTop));

        // Render visible slice of visual rows
        for (let i = startIndex; i < endIndex; i++) {
            const row = this.visualRows[i];
            const elements = this.createRow(row, i, state);
            codeFrag.appendChild(elements.code);
            gutterFrag.appendChild(elements.gutter);
            btnFrag.appendChild(elements.btn);
            foldsFrag.appendChild(elements.fold);
        }

        // Bottom spacers
        btnFrag.appendChild(this.lineRenderer.createSpacer(paddingBottom));
        gutterFrag.appendChild(this.lineRenderer.createSpacer(paddingBottom));
        foldsFrag.appendChild(this.lineRenderer.createSpacer(paddingBottom));
        codeFrag.appendChild(this.lineRenderer.createSpacer(paddingBottom));

        // Replace old children atomically
        this.buttonsColumn.replaceChildren(btnFrag);
        this.gutter.replaceChildren(gutterFrag);
        this.foldsColumn.replaceChildren(foldsFrag);
        this.codeContent.replaceChildren(codeFrag);

        // Render cursor or selection
        if (!readOnly && (!search.isActive() || !search.isFocused())) {
            if (!selection || selection.isEmpty()) {
                const { line, column } = code.getPosition(offset);
                this.renderCursor(line, column, false);
            } else {
                this.renderSelection(code, selection!);
            }
        }

        // Render search highlights
        if (!readOnly && search.isActive()) {
            this.searchRenderer.updateSearchHighlights(search);
        }
        const wordLines = this.wordHighlightRenderer.render(state, state.scrollbarMarkersEnabled);
        this.renderScrollbarMarkers(state, true, wordLines);
        this.updateContentMinWidth(state);

    }

    private renderScrollbarMarkers(
        state: EditorState | null,
        includeSearch: boolean = true,
        wordLines?: number[]
    ) {
        const enabled = state?.scrollbarMarkersEnabled ?? false;
        this.scrollbarMarkersRenderer.setEnabled(enabled);
        if (!enabled) return;

        this.scrollbarMarkersRenderer.render(state, includeSearch, wordLines, this.visualRows);
    }

    /**
     * Build visual rows with only real lines (no ghost lines)
     */
    private buildRealOnlyRows(totalLines: number): VisualRow[] {
        const rows: VisualRow[] = [];
        for (let i = 0; i < totalLines; i++) {
            if (this.isHiddenByFold(i)) continue;
            rows.push({ kind: 'real', lineIndex: i });
        }
        return rows;
    }

    /**
     * Build a unified list of visual rows.
     * This provides a stable model for virtualized scrolling.
     */
    private buildVisualRows(
        totalLines: number,
        diffs: Map<number, DiffInfo> | undefined
    ): VisualRow[] {
        const rows: VisualRow[] = [];
        const processedHunks = new Set<number>();
        const visibleRealLines = this.diffRenderer.computeVisibleLines(totalLines, diffs);

        // Collect ghost info by anchor line for efficient lookup
        const ghostsByAnchor = new Map<number, { hunkId: number; oldLineNumbers: number[] }[]>();

        if (diffs) {
            for (const [lineNumber, diffInfo] of diffs) {
                if (!diffInfo.oldLineNumbers || diffInfo.oldLineNumbers.length === 0) continue;
                if (diffInfo.changeType !== 'modified' && diffInfo.changeType !== 'deleted') continue;

                const anchorLine = diffInfo.ghostAnchorLine ?? lineNumber;

                if (!ghostsByAnchor.has(anchorLine)) {
                    ghostsByAnchor.set(anchorLine, []);
                }
                ghostsByAnchor.get(anchorLine)!.push({
                    hunkId: diffInfo.hunkId,
                    oldLineNumbers: diffInfo.oldLineNumbers,
                });
            }
        }

        // Build visual rows: iterate through lines and insert ghosts before their anchors
        for (let i = 0; i < totalLines; i++) {
            const lineNumber = i + 1; // 1-indexed for diffs
            // Check for ghost lines anchored before this line
            const ghostsHere = ghostsByAnchor.get(lineNumber);
            if (ghostsHere && !this.isHiddenByFold(i)) {
                for (const ghostGroup of ghostsHere) {
                    if (processedHunks.has(ghostGroup.hunkId)) continue;
                    processedHunks.add(ghostGroup.hunkId);

                    for (let ghostIndex = 0; ghostIndex < ghostGroup.oldLineNumbers.length; ghostIndex++) {
                        const originalLineNumber = ghostGroup.oldLineNumbers[ghostIndex];
                        if (originalLineNumber < 1) continue;
                        rows.push({
                            kind: 'ghost',
                            hunkId: ghostGroup.hunkId,
                            anchorLine: lineNumber,
                            originalLineIndex: originalLineNumber - 1,
                        });
                    }
                }
            }

            // Add real lines based on focused mode visibility
            if (!visibleRealLines || visibleRealLines.has(i)) {
                if (this.isHiddenByFold(i)) continue;
                rows.push({ kind: 'real', lineIndex: i });
            }
        }

        // Handle EOF ghosts (deletions anchored after the last line)
        const eofAnchor = totalLines + 1;
        const eofGhosts = ghostsByAnchor.get(eofAnchor);
        const isLastLineFolded = totalLines > 0 && this.isHiddenByFold(totalLines - 1);
        if (eofGhosts && !isLastLineFolded) {
            for (const ghostGroup of eofGhosts) {
                if (processedHunks.has(ghostGroup.hunkId)) continue;
                processedHunks.add(ghostGroup.hunkId);

                for (let ghostIndex = 0; ghostIndex < ghostGroup.oldLineNumbers.length; ghostIndex++) {
                    const originalLineNumber = ghostGroup.oldLineNumbers[ghostIndex];
                    if (originalLineNumber < 1) continue;
                    rows.push({
                        kind: 'ghost',
                        hunkId: ghostGroup.hunkId,
                        anchorLine: eofAnchor,
                        originalLineIndex: originalLineNumber - 1,
                    });
                }
            }
        }

        return this.diffRenderer.insertSeparators(
            rows,
            totalLines,
            (lineIndex) => this.isHiddenByFold(lineIndex)
        );
    }

    public expandFocusedHiddenRange(
        hiddenStart: number,
        hiddenEnd: number,
        amount: number = 5,
        side: 'up' | 'down' | 'both' | 'all' = 'both'
    ): boolean {
        return this.diffRenderer.expandRange(hiddenStart, hiddenEnd, amount, side);
    }

    /**
     * Get visual index for a real line number.
     * This accounts for ghost lines above the target line.
     */
    private getVisualIndexForLine(lineIndex: number): number {
        for (let i = 0; i < this.visualRows.length; i++) {
            const row = this.visualRows[i];
            if (row.kind === 'real' && row.lineIndex === lineIndex) {
                return i;
            }
        }
        // In focused diff mode, cursor can temporarily point to a hidden line.
        // Snap to nearest rendered real row for scrolling purposes.
        let nearestIndex = -1;
        let nearestDistance = Number.POSITIVE_INFINITY;
        for (let i = 0; i < this.visualRows.length; i++) {
            const row = this.visualRows[i];
            if (row.kind !== 'real') continue;
            const distance = Math.abs(row.lineIndex - lineIndex);
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestIndex = i;
            }
        }
        return nearestIndex >= 0 ? nearestIndex : 0;
    }

    public getVisibleRealLineIndices(): Set<number> {
        const lines = new Set<number>();
        for (const row of this.visualRows) {
            if (row.kind === 'real') {
                lines.add(row.lineIndex);
            }
        }
        return lines;
    }

    /**
     * Get visible range based on visual row indices
     */
    private getVisibleRange(totalVisualRows: number, settings: EditorSettings) {
        const scrollTop = this.container.scrollTop;
        const viewHeight = this.container.clientHeight;

        const visibleBuffer = settings.buffer;
        const itemHeight = settings.lineHeight;

        let visibleCount: number;
        if (viewHeight > 0) {
            visibleCount = Math.ceil(viewHeight / itemHeight);
        } else {
            const parentHeight = this.container.parentElement?.clientHeight || 0;
            const fallbackHeight = parentHeight > 0 ? parentHeight : window.innerHeight;
            visibleCount = Math.min(Math.floor(fallbackHeight / itemHeight), totalVisualRows);
        }

        const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - visibleBuffer);
        const endIndex = Math.min(totalVisualRows, startIndex + visibleCount + visibleBuffer * 2);

        return { startIndex, endIndex };
    }

    public renderScroll(state: EditorState) {
        const { code, offset, selection, settings, diffs, readOnly, search } = state;
        this.updateFoldableStarts(state);
        this.updateCollapsedMap(state);
        const lineHeight = settings.lineHeight;
        const buffer = settings.buffer;

        // Rebuild visual rows if diffs changed (otherwise use cached)
        const totalRealLines = code.linesLength();
        this.visualRows = this.diffEnabled
            ? this.buildVisualRows(totalRealLines, diffs)
            : this.buildRealOnlyRows(totalRealLines);

        const totalVisualRows = this.visualRows.length;
        const { startIndex, endIndex } = this.getVisibleRange(totalVisualRows, settings);

        this.ensureSpacers(this.codeContent);
        this.ensureSpacers(this.gutter);
        this.ensureSpacers(this.buttonsColumn);
        this.ensureSpacers(this.foldsColumn);

        const topSpacer = this.codeContent.firstChild as HTMLElement;
        const bottomSpacer = this.codeContent.lastChild as HTMLElement;

        const gutterTopSpacer = this.gutter.firstChild as HTMLElement;
        const gutterBottomSpacer = this.gutter.lastChild as HTMLElement;

        const btnTopSpacer = this.buttonsColumn.firstChild as HTMLElement;
        const btnBottomSpacer = this.buttonsColumn.lastChild as HTMLElement;
        const foldsTopSpacer = this.foldsColumn.firstChild as HTMLElement;
        const foldsBottomSpacer = this.foldsColumn.lastChild as HTMLElement;

        const renderedRange = this.getRenderedRange();
        let currentStartIndex = renderedRange?.startIndex ?? -1;
        let currentEndIndex = renderedRange?.endIndex ?? -1;

        // Check if full re-render is needed
        const needFullRerender =
            currentStartIndex === -1 ||
            startIndex >= currentEndIndex ||
            endIndex <= currentStartIndex ||
            Math.abs(startIndex - currentStartIndex) > buffer * 2 ||
            Math.abs(endIndex - currentEndIndex) > buffer * 2;

        if (needFullRerender) {
            this.render(state);
            return;
        }

        let changed = false;

        // Remove rows from top
        while (currentStartIndex < startIndex && this.codeContent.children.length > 2) {
            this.codeContent.removeChild(this.codeContent.children[1]);
            if (this.gutter.children[1]) {
                this.gutter.removeChild(this.gutter.children[1]);
            }
            if (this.buttonsColumn.children[1]) {
                this.buttonsColumn.removeChild(this.buttonsColumn.children[1]);
            }
            if (this.foldsColumn.children[1]) {
                this.foldsColumn.removeChild(this.foldsColumn.children[1]);
            }
            currentStartIndex++;
            changed = true;
        }

        // Remove rows from bottom
        while (currentEndIndex > endIndex && this.codeContent.children.length > 2) {
            const index = this.codeContent.children.length - 2;
            this.codeContent.removeChild(this.codeContent.children[index]);
            if (this.gutter.children[index]) {
                this.gutter.removeChild(this.gutter.children[index]);
            }
            if (this.buttonsColumn.children[index]) {
                this.buttonsColumn.removeChild(this.buttonsColumn.children[index]);
            }
            if (this.foldsColumn.children[index]) {
                this.foldsColumn.removeChild(this.foldsColumn.children[index]);
            }
            currentEndIndex--;
            changed = true;
        }

        // Add rows above
        while (currentStartIndex > startIndex) {
            currentStartIndex--;
            const row = this.visualRows[currentStartIndex];
            const elements = this.createRow(row, currentStartIndex, state);

            this.codeContent.insertBefore(elements.code, this.codeContent.children[1]);
            this.gutter.insertBefore(elements.gutter, this.gutter.children[1]);
            this.buttonsColumn.insertBefore(elements.btn, this.buttonsColumn.children[1]);
            this.foldsColumn.insertBefore(elements.fold, this.foldsColumn.children[1]);

            changed = true;
        }

        // Add rows below
        while (currentEndIndex < endIndex) {
            const row = this.visualRows[currentEndIndex];
            const elements = this.createRow(row, currentEndIndex, state);

            this.codeContent.insertBefore(elements.code, bottomSpacer);
            this.gutter.insertBefore(elements.gutter, gutterBottomSpacer);
            this.buttonsColumn.insertBefore(elements.btn, btnBottomSpacer);
            this.foldsColumn.insertBefore(elements.fold, foldsBottomSpacer);

            currentEndIndex++;
            changed = true;
        }

        // Render cursor or selection
        if (!readOnly && (!search.isActive() || !search.isFocused())) {
            if (!selection || selection.isEmpty()) {
                const { line, column } = code.getPosition(offset);
                this.renderCursor(line, column, false);
            } else {
                this.renderSelection(code, selection!);
            }
        }

        // Render search highlights
        if (search.isActive()) {
            this.searchRenderer.updateSearchHighlights(search);
        }

        if (!changed) return;

        // Update spacers based on visual indices
        const topHeight = Math.round(startIndex * lineHeight);
        const bottomHeight = Math.round(Math.max(0, (totalVisualRows - endIndex) * lineHeight));

        topSpacer.style.height = `${topHeight}px`;
        bottomSpacer.style.height = `${bottomHeight}px`;

        gutterTopSpacer.style.height = `${topHeight}px`;
        gutterBottomSpacer.style.height = `${bottomHeight}px`;

        btnTopSpacer.style.height = `${topHeight}px`;
        btnBottomSpacer.style.height = `${bottomHeight}px`;
        foldsTopSpacer.style.height = `${topHeight}px`;
        foldsBottomSpacer.style.height = `${bottomHeight}px`;
    }

    /**
     * Create DOM elements for a visual row (real or ghost)
     */
    private createRow(
        row: VisualRow,
        visualIndex: number,
        state: EditorState,
        precomputedNodes?: HighlighedNode[]
    ): RowElements {
        const { code, settings, diffs, runLines, errorLines } = state;
        let elements: RowElements;

        if (row.kind === 'real') {
            const syntaxNodes = precomputedNodes || code.getLineNodes(row.lineIndex);
            elements = this.lineRenderer.createLineElements(
                row.lineIndex, syntaxNodes, errorLines, settings,
                diffs, runLines, this.getFoldIndicator(row.lineIndex), state.wordHighlight
            );
        } else if (row.kind === 'ghost') {
            const originalNodes = state.originalCode?.getLineNodes(row.originalLineIndex);
            const originalText = state.originalCode?.line(row.originalLineIndex) ?? '';
            elements = this.diffRenderer.createGhostRowElements(
                row, settings, originalText, originalNodes, state.wordHighlight
            );
        } else {
            elements = this.diffRenderer.createGapRowElements(row, settings);
        }

        return this.applyVisualIndex(elements, visualIndex);
    }

    private applyVisualIndex(elements: RowElements, visualIndex: number): RowElements {
        this.visualIndexByElement.set(elements.code, visualIndex);
        this.visualIndexByElement.set(elements.gutter, visualIndex);
        this.visualIndexByElement.set(elements.btn, visualIndex);
        this.visualIndexByElement.set(elements.fold, visualIndex);
        return elements;
    }

    private getRenderedRange(): { startIndex: number; endIndex: number } | null {
        const children = this.codeContent.children;
        const length = children.length;
        if (length <= 2) return null;

        const firstElement = children[1] as HTMLElement;
        const lastElement = children[length - 2] as HTMLElement;

        const startIndex = this.getVisualIndex(firstElement);
        const endIndex = this.getVisualIndex(lastElement);

        if (startIndex === -1 || endIndex === -1) return null;

        return {
            startIndex,
            endIndex: endIndex + 1,
        };
    }

    private getVisualIndex(element: HTMLElement): number {
        return this.visualIndexByElement.get(element) ?? -1;
    }

    public renderChanges(state: EditorState) {
        const { code, settings, diffs, search } = state;
        this.wordHighlightRenderer.invalidateMarkerLines();
        this.codeFoldingEnabled = state.codeFoldingEnabled ?? true;
        this.updateFoldableStarts(state);
        this.updateCollapsedMap(state);

        // Keep a reference to the old visual rows model to identify changes
        const oldVisualRows = this.visualRows;

        // Rebuild visual rows - structure may have changed
        const totalRealLines = code.linesLength();
        const newVisualRows = this.diffEnabled
            ? this.buildVisualRows(totalRealLines, diffs)
            : this.buildRealOnlyRows(totalRealLines);

        if (newVisualRows.length !== oldVisualRows.length) {
            // Fallback to full render
            this.render(state);
            return;
        }

        // Update visualRows
        this.visualRows = newVisualRows;

        const renderedRange = this.getRenderedRange();
        if (!renderedRange) {
            // Fallback to full render
            this.render(state);
            return;
        }

        const totalVisualRows = this.visualRows.length;
        const visible = this.getVisibleRange(totalVisualRows, settings);

        // If viewport changed, do full render
        if (renderedRange.startIndex !== visible.startIndex ||
            renderedRange.endIndex !== visible.endIndex) {
            this.render(state);
            return;
        }

        // Update changed rows in viewport
        for (let i = visible.startIndex; i < visible.endIndex; i++) {
            const oldRow = oldVisualRows[i];
            const newRow = this.visualRows[i];
            const childIndex = i - renderedRange.startIndex + 1;

            let needsUpdate = false;
            let precomputedNodes: HighlighedNode[] | undefined;

            if (!oldRow || oldRow.kind !== newRow.kind) {
                needsUpdate = true;
            } else if (newRow.kind === 'real') {
                const oldReal = oldRow as RealRow;
                if (oldReal.lineIndex !== newRow.lineIndex) {
                    needsUpdate = true;
                } else {
                    const nodes = code.getLineNodes(newRow.lineIndex);
                    const newHash = objectHash(nodes).toString();
                    const existingLine = this.codeContent.children[childIndex] as AnycodeLine | undefined;
                    
                    if (!existingLine || existingLine.hash !== newHash) {
                        needsUpdate = true;
                        precomputedNodes = nodes;
                    }
                }
            } else if (newRow.kind === 'ghost') {
                const oldGhost = oldRow as GhostRow;
                if (oldGhost.originalLineIndex !== newRow.originalLineIndex ||
                    oldGhost.hunkId !== newRow.hunkId ||
                    oldGhost.anchorLine !== newRow.anchorLine) {
                    needsUpdate = true;
                }
            } else if (newRow.kind === 'separator') {
                const oldSep = oldRow as SeparatorRow;
                if (oldSep.hiddenStart !== newRow.hiddenStart ||
                    oldSep.hiddenEnd !== newRow.hiddenEnd) {
                    needsUpdate = true;
                }
            }

            if (needsUpdate) {
                const row = this.createRow(newRow, i, state, precomputedNodes);

                const oldCode = this.codeContent.children[childIndex];
                if (oldCode) {
                    this.codeContent.replaceChild(row.code, oldCode);
                }

                const oldGutter = this.gutter.children[childIndex];
                if (oldGutter) {
                    this.gutter.replaceChild(row.gutter, oldGutter);
                }

                const oldBtn = this.buttonsColumn.children[childIndex];
                if (oldBtn) {
                    this.buttonsColumn.replaceChild(row.btn, oldBtn);
                }

                const oldFold = this.foldsColumn.children[childIndex];
                if (oldFold) {
                    this.foldsColumn.replaceChild(row.fold, oldFold);
                }
            }
        }

        // Render search highlights
        if (search.isActive()) {
            this.searchRenderer.updateSearchHighlights(search);
        }

        // Render cursor or selection
        this.renderCursorOrSelection(state, true);
        this.updateContentMinWidth(state);

    }

    private updateFoldableStarts(state: EditorState) {
        const map = new Map<number, number>();
        for (const range of state.foldRanges) {
            const prevEnd = map.get(range.startLine);
            if (prevEnd === undefined || range.endLine > prevEnd) {
                map.set(range.startLine, range.endLine);
            }
        }
        this.lastFoldableStarts = map;
    }

    private updateCollapsedMap(state: EditorState) {
        const map = new Map<number, number>();
        for (const start of state.collapsedFoldStarts) {
            const end = this.lastFoldableStarts.get(start);
            if (end !== undefined && end > start) {
                map.set(start, end);
            }
        }
        this.lastCollapsedMap = map;

        // Pre-build the set of all hidden line indices for O(1) lookups
        const hidden = new Set<number>();
        if (this.codeFoldingEnabled) {
            for (const [start, end] of map) {
                for (let i = start + 1; i <= end; i++) {
                    hidden.add(i);
                }
            }
        }
        this.lastHiddenLines = hidden;
    }

    private isHiddenByFold(lineIndex: number): boolean {
        return this.lastHiddenLines.has(lineIndex);
    }

    private getFoldIndicator(lineIndex: number): { canFold: boolean; collapsed: boolean } {
        if (!this.codeFoldingEnabled) {
            return { canFold: false, collapsed: false };
        }
        const end = this.lastFoldableStarts.get(lineIndex);
        if (end === undefined || end <= lineIndex) {
            return { canFold: false, collapsed: false };
        }

        return {
            canFold: true,
            collapsed: this.lastCollapsedMap.has(lineIndex),
        };
    }

    private ensureSpacers(container: HTMLElement) {
        const first = container.firstChild as HTMLElement | null;
        const last = container.lastChild as HTMLElement | null;

        if (!first || !first.classList?.contains('spacer')) {
            container.insertBefore(this.lineRenderer.createSpacer(0), container.firstChild);
        }

        if (!last || !last.classList?.contains('spacer')) {
            container.appendChild(this.lineRenderer.createSpacer(0));
        }
    }

    public renderCursorOrSelection(state: EditorState, focus: boolean = false) {
        if (state.readOnly) return;

        const { code, offset, selection } = state;
        if (!selection || selection.isEmpty()) {
            const { line, column } = code.getPosition(offset);
            this.renderCursor(line, column, focus);
        } else {
            this.renderSelection(code, selection!);
        }
        this.renderBracketMatch(state);
    }

    public renderCursor(line: number, column: number, focus: boolean = false) {
        this.codeContent.classList.remove('selecting');
        const lineDiv = this.getLine(line);
        if (lineDiv) {
            if (lineDiv.isConnected) {
                moveCursor(lineDiv, column, focus);
            } else {
                requestAnimationFrame(() => {
                    moveCursor(lineDiv, column, focus)
                });
            }
        } else {
            removeCursor();
        }
    }

    public renderSelection(code: Code, selection: Selection) {
        if (selection.isEmpty()) return;
        this.codeContent.classList.add('selecting');

        const lines = this.getLines();
        let attached = true;
        for (const l of lines) {
            if (!l.isConnected) { attached = false; break; }
        }
        if (attached) {
            renderSelection(selection, lines, code);
        } else {
            requestAnimationFrame(() => {
                renderSelection(selection, this.getLines(), code);
            });
        }
    }

    public getLines(): AnycodeLine[] {
        return Array.from(this.codeContent.children)
            .filter((child) =>
                !child.classList.contains('spacer')
                && !isGhostElement(child)
                && child.classList.contains('line')
                && typeof (child as AnycodeLine).lineNumber === 'number'
            ) as AnycodeLine[];
    }

    public getLine(lineNumber: number): AnycodeLine | null {
        // Iterate through children, skipping spacers and ghost lines
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

    public renderWordHighlight(state: EditorState) {
        const wordLines = this.wordHighlightRenderer.render(state, state.scrollbarMarkersEnabled);
        this.renderScrollbarMarkers(state, true, wordLines);
    }

    public renderBracketMatch(state: EditorState) {
        this.bracketMatchRenderer.render(state);
    }

    public revealCursor(state: EditorState, focusLine: number | null = null): boolean {
        const { code, offset, settings } = state;
        if (!code) return false;

        let { line } = code.getPosition(offset);
        if (focusLine !== null) line = focusLine;

        // Use visual index to account for ghost lines above cursor
        const visualIndex = this.getVisualIndexForLine(line);
        const cursorTop = visualIndex * settings.lineHeight;
        const cursorBottom = cursorTop + settings.lineHeight;

        const viewportTop = this.container.scrollTop;
        const viewportBottom = viewportTop + this.container.clientHeight;

        const bottomPaddingLines = 0;
        const padding = settings.lineHeight * bottomPaddingLines;
        let targetScrollTop = viewportTop;

        if (cursorTop < viewportTop) {
            targetScrollTop = cursorTop;
        } else if (cursorBottom > viewportBottom - padding) {
            targetScrollTop = cursorBottom - this.container.clientHeight + padding;
        }

        const tolerance = 2;
        if (Math.abs(targetScrollTop - viewportTop) > tolerance) {
            this.container.scrollTo({ top: targetScrollTop });
            return true;
        }

        return false;
    }

    public revealCursorCenter(state: EditorState): boolean {
        const { code, offset } = state;
        if (!code) return false;

        const { line } = code.getPosition(offset);
        return this.revealLineCenter(state, line);
    }

    private revealLineCenter(state: EditorState, line: number): boolean {
        const { code, settings } = state;
        if (!code) return false;

        // Use visual index to account for ghost lines above cursor
        const visualIndex = this.getVisualIndexForLine(line);
        const cursorTop = visualIndex * settings.lineHeight;
        const cursorCenter = cursorTop + settings.lineHeight / 2;

        const viewportHeight = this.container.clientHeight;
        const targetScrollTop = cursorCenter - viewportHeight / 2;

        const maxScroll = this.container.scrollHeight - viewportHeight;
        const clampedScrollTop = Math.max(0, Math.min(targetScrollTop, maxScroll));

        this.container.scrollTo({ top: clampedScrollTop });

        return true;
    }

    public renderErrors(state: EditorState) {
        const { errorLines } = state;
        const lines = this.getLines();
        if (lines.length) {
            for (let i = 0; i < lines.length; i++) {
                const lineDiv = lines[i];
                const lineNumber = lineDiv.lineNumber;

                const message = errorLines.get(lineNumber);
                this.lineRenderer.renderDiagnostics(lineDiv, message);
            }
        }
        this.renderScrollbarMarkers(state);
        this.updateContentMinWidth(state);
    }

    public renderCompletion(
        completions: Completion[],
        selectedIndex: number,
        code: Code,
        offset: number,
        onCompletionClick: (index: number) => void
    ) {
        this.completionRenderer.render(completions, selectedIndex, code, offset, onCompletionClick);
    }

    public moveCompletion(code: Code, offset: number) {
        this.completionRenderer.move(code, offset);
    }

    public closeCompletion() {
        this.completionRenderer.close();
    }

    public isCompletionOpen() {
        return this.completionRenderer.isOpen();
    }

    public highlightCompletion(index: number) {
        this.completionRenderer.highlight(index);
    }

    public renderHover(content: string, code: Code, offset: number) {
        this.hoverRenderer.render(content, code, offset);
    }

    public moveHover(code: Code, offset: number) {
        this.hoverRenderer.move(code, offset);
    }

    public closeHover() {
        this.hoverRenderer.close();
    }

    public isHoverOpen() {
        return this.hoverRenderer.isOpen();
    }

    public renderSearch(
        search: Search,
        state: EditorState,
        handlers?: {
            onKeyDown?: (event: KeyboardEvent, input: HTMLTextAreaElement) => void,
            onInputChange?: (value: string) => void,
        }
    ) {
        this.searchRenderer.renderSearch(search, state, handlers);
        this.renderScrollbarMarkers(state);
    }

    public removeSearch(state: EditorState) {
        this.searchRenderer.removeSearch();
        this.renderScrollbarMarkers(state, false);
    }

    public focusSearchInput() {
        this.searchRenderer.focusSearchInput();
    }

    public updateSearchHighlights(state: EditorState) {
        this.searchRenderer.updateSearchHighlights(state.search);
        this.renderScrollbarMarkers(state);
    }

    public removeAllHighlights(search: Search) {
        this.searchRenderer.removeAllHighlights(search);
    }

    public removeSelectedHighlight(search: Search) {
        this.searchRenderer.removeSelectedHighlight(search);
    }

    public updateSearchLabel(text: string) {
        this.searchRenderer.updateSearchLabel(text);
    }

    public clearAllDiffs(): void {
        this.diffRenderer.clearAllDiffs();
    }

    private getCharWidth(): number {
        if (this.charWidth > 0) return this.charWidth;

        const probe = document.createElement('span');
        probe.textContent = 'M';
        probe.style.position = 'absolute';
        probe.style.visibility = 'hidden';
        probe.style.pointerEvents = 'none';
        this.codeContent.appendChild(probe);

        const width = probe.getBoundingClientRect().width;
        probe.remove();
        this.charWidth = width > 0 ? width : 8;
        return this.charWidth;
    }

    private updateContentMinWidth(state: EditorState): void {
        const charWidth = this.getCharWidth();
        let maxWidth = 0;

        for (let line = 0; line < state.code.linesLength(); line++) {
            let width = state.code.lineLength(line) * charWidth;
            const diagnostic = state.errorLines.get(line);
            if (diagnostic) {
                const diagnosticText = minimize(diagnostic);
                width += diagnosticText.length * charWidth + charWidth * 3 + 8;
            }
            maxWidth = Math.max(maxWidth, width);
        }

        if (state.originalCode) {
            for (const row of this.visualRows) {
                if (row.kind !== 'ghost') continue;
                const width = state.originalCode.lineLength(row.originalLineIndex) * charWidth;
                maxWidth = Math.max(maxWidth, width);
            }
        }

        const nextMinWidth = Math.ceil(maxWidth + 100);
        if (nextMinWidth === this.lastContentMinWidth) return;

        this.lastContentMinWidth = nextMinWidth;
        this.codeContent.style.minWidth = `${nextMinWidth}px`;
    }

}

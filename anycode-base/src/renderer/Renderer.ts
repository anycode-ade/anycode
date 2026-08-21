import { Code, HighlighedNode } from "../code";
import { BinaryTokens } from "../tokens";
import { AnycodeLine, RowElements, SparseGhostGroup } from "../types";
import { isGhostElement, objectHash, minimize } from "../utils";
import { moveCursor, removeCursor } from "../cursor";
import { EditorState, EditorSettings } from "../editor";
import { DiffInfo } from "../diff";
import { Selection, renderSelection } from "../selection";
import { Completion } from "../lsp";
import { Search } from "../search";
import { LineRenderer } from "./LineRenderer";
import { SearchRenderer } from "./SearchRenderer";
import { DiffRenderer, getGapElementData } from "./DiffRenderer";
import { CSS_CLASS } from "../constants";
import { CompletionRenderer } from "./CompletionRenderer";
import { HoverRenderer } from "./HoverRenderer";
import { DiagnosticRenderer } from "./DiagnosticRenderer";
import { ScrollbarMarkersRenderer } from "./ScrollbarMarkersRenderer";
import { WordHighlightRenderer } from "./WordHighlightRenderer";
import { BracketMatchRenderer } from "./BracketMatchRenderer";

const MAX_SCROLLBAR_MARKER_LINES = 5000;

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
    private activeVisualRows: VisualRow[] | null = null;
    private lastTotalLines: number = 0;
    private visualIndexByElement = new WeakMap<HTMLElement, number>();
    private lastCollapsedMap: Map<number, number> = new Map();
    private lastFoldableStarts: Map<number, number> = new Map();
    private lastHiddenLines: Set<number> = new Set();
    private codeFoldingEnabled: boolean = true;
    private charWidth = 0;
    private lastContentMinWidth = -1;
    private maxTrackedWidth: number = 0;
    private lastGutterWidth: number = 48;
    private sparseGhostGroups: SparseGhostGroup[] = [];
    private totalGhostLines: number = 0;
    private expandBufferRafId: number | null = null;
    private isFastScroll: boolean = false;
    private cursorRafId: number | null = null;

    constructor(
        container: HTMLDivElement,
        buttonsColumn: HTMLDivElement,
        gutter: HTMLDivElement,
        foldsColumn: HTMLDivElement,
        codeContent: HTMLDivElement,
        scrollbarMarkersEnabled: boolean = true,
        onImmediateScroll?: () => void,
        wrapper?: HTMLDivElement
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
            onImmediateScroll,
            scrollbarMarkersEnabled,
            wrapper,
            (isDragging, state) => this.setFastScroll(isDragging, state)
        );
    }

    public setDiffEnabled(enabled: boolean) {
        this.diffEnabled = enabled;
    }

    public clean() {
        if (this.expandBufferRafId !== null) {
            cancelAnimationFrame(this.expandBufferRafId);
            this.expandBufferRafId = null;
        }
        this.scrollbarMarkersRenderer.clean();
    }

    private updateSparseGhostIndex(diffs: Map<number, DiffInfo> | undefined, totalLines: number): void {
        this.sparseGhostGroups = [];
        this.totalGhostLines = 0;
        if (!diffs || diffs.size === 0) return;

        const processedHunks = new Set<number>();
        const ghostsByAnchor = new Map<number, { hunkId: number; oldLineNumbers: number[] }[]>();

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

        const sortedAnchors = Array.from(ghostsByAnchor.keys()).sort((a, b) => a - b);
        let cumulativeGhosts = 0;

        for (const anchor of sortedAnchors) {
            const groups = ghostsByAnchor.get(anchor)!;
            for (const group of groups) {
                if (processedHunks.has(group.hunkId)) continue;
                processedHunks.add(group.hunkId);

                const validOldNumbers = group.oldLineNumbers.filter((n) => n >= 1);
                if (validOldNumbers.length === 0) continue;

                const startVisualIndex = Math.max(0, anchor - 1) + cumulativeGhosts;
                const ghostCount = validOldNumbers.length;

                this.sparseGhostGroups.push({
                    anchorLine: anchor,
                    hunkId: group.hunkId,
                    oldLineNumbers: validOldNumbers,
                    ghostCount,
                    startVisualIndex,
                });

                cumulativeGhosts += ghostCount;
            }
        }

        this.totalGhostLines = cumulativeGhosts;
    }

    public getVisualRowCount(): number {
        if (this.activeVisualRows) {
            return this.activeVisualRows.length;
        }
        return this.lastTotalLines + this.totalGhostLines;
    }

    public getVisualRow(visualIndex: number): VisualRow {
        if (this.activeVisualRows) {
            return this.activeVisualRows[visualIndex] ?? { kind: 'real', lineIndex: visualIndex };
        }

        if (this.sparseGhostGroups.length === 0) {
            return { kind: 'real', lineIndex: visualIndex };
        }

        let ghostsBefore = 0;
        for (let g = 0; g < this.sparseGhostGroups.length; g++) {
            const group = this.sparseGhostGroups[g];
            if (visualIndex < group.startVisualIndex) {
                return { kind: 'real', lineIndex: visualIndex - ghostsBefore };
            }
            if (visualIndex < group.startVisualIndex + group.ghostCount) {
                const ghostOffset = visualIndex - group.startVisualIndex;
                const originalLineNumber = group.oldLineNumbers[ghostOffset];
                return {
                    kind: 'ghost',
                    hunkId: group.hunkId,
                    anchorLine: group.anchorLine,
                    originalLineIndex: originalLineNumber - 1,
                };
            }
            ghostsBefore += group.ghostCount;
        }

        return { kind: 'real', lineIndex: visualIndex - ghostsBefore };
    }

    public getVisualRows(startIndex: number, endIndex: number): VisualRow[] {
        const count = Math.max(0, endIndex - startIndex);
        const rows: VisualRow[] = new Array(count);
        for (let i = 0; i < count; i++) {
            rows[i] = this.getVisualRow(startIndex + i);
        }
        return rows;
    }

    public setFocusedDiffMode(enabled: boolean, contextLines: number = 3) {
        this.diffRenderer.setFocusedDiffMode(enabled, contextLines);
    }

    public lastScrollTop: number = 0;
    public lastClientHeight: number = 600;

    public render(state: EditorState) {
        const { code, diffs } = state;
        if (this.container.isConnected) {
            this.lastScrollTop = this.container.scrollTop;
            if (this.container.clientHeight > 0) {
                this.lastClientHeight = this.container.clientHeight;
            }
        }
        this.updateGutterWidth(state);
        this.codeFoldingEnabled = state.codeFoldingEnabled ?? true;
        this.updateFoldableStarts(state);
        this.updateCollapsedMap(state);

        const totalRealLines = code.linesLength();
        this.lastTotalLines = totalRealLines;

        this.updateSparseGhostIndex(diffs, totalRealLines);

        if (this.diffRenderer.isFocusedDiffEnabled() && diffs && diffs.size > 0) {
            this.activeVisualRows = this.buildVisualRows(totalRealLines, diffs, code);
        } else if (this.lastHiddenLines.size > 0 && this.codeFoldingEnabled) {
            this.activeVisualRows = this.buildRealOnlyRows(totalRealLines);
        } else {
            this.activeVisualRows = null;
        }

        this.renderViewport(state);
        const wordLines = this.wordHighlightRenderer.render(state, state.scrollbarMarkersEnabled);
        this.renderScrollbarMarkers(state, true, wordLines);
    }

    private renderViewport(state: EditorState, bufferOverride?: number) {
        const { settings, readOnly, search } = state;

        const totalVisualRows = this.getVisualRowCount();
        const { startIndex, endIndex } = this.getVisibleRange(totalVisualRows, settings, bufferOverride);

        const itemHeight = settings.lineHeight;
        const paddingTop = Math.round(startIndex * itemHeight);
        const paddingBottom = Math.round(Math.max(0, (totalVisualRows - endIndex) * itemHeight));
        const topPx = `${paddingTop}px`;
        const bottomPx = `${paddingBottom}px`;

        // Build fragments for better performance
        const btnFrag = document.createDocumentFragment();
        const gutterFrag = document.createDocumentFragment();
        const foldsFrag = document.createDocumentFragment();
        const codeFrag = document.createDocumentFragment();

        // Top spacers
        btnFrag.appendChild(this.lineRenderer.createSpacer(topPx));
        gutterFrag.appendChild(this.lineRenderer.createSpacer(topPx));
        foldsFrag.appendChild(this.lineRenderer.createSpacer(topPx));
        codeFrag.appendChild(this.lineRenderer.createSpacer(topPx));

        // Render visible slice of visual rows directly on the fly (Zero Alloc)
        for (let visualIndex = startIndex; visualIndex < endIndex; visualIndex++) {
            const elements = this.renderRowAt(visualIndex, state);
            codeFrag.appendChild(elements.code);
            gutterFrag.appendChild(elements.gutter);
            btnFrag.appendChild(elements.btn);
            foldsFrag.appendChild(elements.fold);
        }

        // Bottom spacers
        btnFrag.appendChild(this.lineRenderer.createSpacer(bottomPx));
        gutterFrag.appendChild(this.lineRenderer.createSpacer(bottomPx));
        foldsFrag.appendChild(this.lineRenderer.createSpacer(bottomPx));
        codeFrag.appendChild(this.lineRenderer.createSpacer(bottomPx));

        // Replace old children atomically
        this.buttonsColumn.replaceChildren(btnFrag);
        this.gutter.replaceChildren(gutterFrag);
        this.foldsColumn.replaceChildren(foldsFrag);
        this.codeContent.replaceChildren(codeFrag);

        // Render cursor or selection
        if (!readOnly && (!search.isActive() || !search.isFocused())) {
            this.renderCursorOrSelection(state);
        }

        // Render search highlights
        if (!readOnly && search.isActive()) {
            this.searchRenderer.updateSearchHighlights(search);
        }

        // Update content min width based on rendered slice
        this.updateContentMinWidth(state, startIndex, endIndex, bufferOverride === undefined);
    }

    private renderScrollbarMarkers(
        state: EditorState | null,
        includeSearch: boolean = true,
        wordLines?: number[]
    ) {
        const enabled = (state?.scrollbarMarkersEnabled ?? true) && state !== null;
        this.scrollbarMarkersRenderer.setEnabled(enabled);
        if (!enabled || !state) return;

        const limitMarkers = state.code.linesLength() > MAX_SCROLLBAR_MARKER_LINES;
        const effectiveWordLines = limitMarkers ? [] : wordLines;
        const effectiveIncludeSearch = limitMarkers ? false : includeSearch;

        const totalVisualRows = this.getVisualRowCount();
        const clientHeight = this.container.clientHeight > 0 ? this.container.clientHeight : (this.lastClientHeight || 600);
        this.lastClientHeight = clientHeight;
        const scrollHeight = totalVisualRows * state.settings.lineHeight;
        this.scrollbarMarkersRenderer.updateGeometry(
            clientHeight,
            scrollHeight
        );
        this.scrollbarMarkersRenderer.render(state, effectiveIncludeSearch, effectiveWordLines, this.activeVisualRows || undefined);
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
        diffs: Map<number, DiffInfo> | undefined,
        code: Code,
    ): VisualRow[] {
        const rows: VisualRow[] = [];
        const processedHunks = new Set<number>();
        const visibleRealLines = this.diffRenderer.computeVisibleLines(totalLines, diffs, code);
        const alwaysVisibleLines = code.getAlwaysVisibleLines(totalLines);
        if (visibleRealLines && alwaysVisibleLines) {
            for (const line of alwaysVisibleLines) visibleRealLines.add(line);
        }

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

    public clearExpandedDiffRanges(): void {
        this.diffRenderer.clearExpandedRanges();
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
        if (this.activeVisualRows) {
            for (let i = 0; i < this.activeVisualRows.length; i++) {
                const row = this.activeVisualRows[i];
                if (row.kind === 'real' && row.lineIndex === lineIndex) {
                    return i;
                }
            }
            // In focused diff mode, cursor can temporarily point to a hidden line.
            // Snap to nearest rendered real row for scrolling purposes.
            let nearestIndex = -1;
            let nearestDistance = Number.POSITIVE_INFINITY;
            for (let i = 0; i < this.activeVisualRows.length; i++) {
                const row = this.activeVisualRows[i];
                if (row.kind !== 'real') continue;
                const distance = Math.abs(row.lineIndex - lineIndex);
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestIndex = i;
                }
            }
            return nearestIndex >= 0 ? nearestIndex : 0;
        }

        if (this.sparseGhostGroups.length === 0) {
            return lineIndex;
        }

        let visualIndex = lineIndex;
        for (let g = 0; g < this.sparseGhostGroups.length; g++) {
            const group = this.sparseGhostGroups[g];
            if (lineIndex >= group.anchorLine - 1) {
                visualIndex += group.ghostCount;
            } else {
                break;
            }
        }
        return visualIndex;
    }

    public getVisibleRealLineIndices(): Set<number> {
        const lines = new Set<number>();
        if (!this.activeVisualRows) {
            for (let i = 0; i < this.lastTotalLines; i++) {
                lines.add(i);
            }
            return lines;
        }
        for (const row of this.activeVisualRows) {
            if (row.kind === 'real') {
                lines.add(row.lineIndex);
            }
        }
        return lines;
    }

    public setFastScroll(enabled: boolean, state?: EditorState) {
        if (this.isFastScroll === enabled) return;
        this.isFastScroll = enabled;
        if (!enabled && state) {
            this.scheduleExpandBuffer(state);
        }
    }

    private getVisibleRange(totalVisualRows: number, settings: EditorSettings, bufferOverride?: number) {
        const scrollTop = this.container.scrollTop;
        const viewHeight = this.container.clientHeight;
        this.lastScrollTop = scrollTop;
        if (viewHeight > 0) this.lastClientHeight = viewHeight;

        let visibleBuffer = bufferOverride !== undefined ? bufferOverride : settings.buffer;
        if (this.isFastScroll && bufferOverride === undefined) {
            visibleBuffer = 2;
        }
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

    private scheduleExpandBuffer(state: EditorState) {
        if (this.expandBufferRafId !== null) {
            cancelAnimationFrame(this.expandBufferRafId);
        }
        this.expandBufferRafId = requestAnimationFrame(() => {
            this.expandBufferRafId = null;
            if (!this.container.isConnected) return;
            this.renderScroll(state);
        });
    }

    public renderScroll(state: EditorState) {
        const currentScrollTop = this.container.scrollTop;
        this.lastScrollTop = currentScrollTop;
        const viewHeight = this.container.clientHeight;
        if (viewHeight > 0) this.lastClientHeight = viewHeight;
        this.scrollbarMarkersRenderer.updateThumbPosition(currentScrollTop, true, viewHeight);
        const { settings, readOnly, search } = state;
        const lineHeight = settings.lineHeight;
        const buffer = settings.buffer;

        // Structural changes rebuild this model through render()/renderChanges().
        // Scrolling only consumes the visual rows on the fly.
        const totalVisualRows = this.getVisualRowCount();
        if (totalVisualRows === 0) {
            this.render(state);
            return;
        }

        const renderedRange = this.getRenderedRange();
        let currentStartIndex = renderedRange?.startIndex ?? -1;
        let currentEndIndex = renderedRange?.endIndex ?? -1;

        // Buffer thresholding: if viewport is still comfortably within rendered slice, skip DOM mutations
        if (currentStartIndex !== -1 && currentEndIndex !== -1 && viewHeight > 0) {
            const firstVisible = Math.floor(currentScrollTop / lineHeight);
            const visibleCount = Math.ceil(viewHeight / lineHeight);
            const lastVisible = firstVisible + visibleCount;
            const threshold = Math.max(3, Math.floor(buffer / 4));

            if (
                firstVisible >= currentStartIndex + threshold &&
                lastVisible <= currentEndIndex - threshold
            ) {
                // Viewport is completely covered by already rendered elements.
                if (!readOnly && (!search.isActive() || !search.isFocused())) {
                    this.renderCursorOrSelection(state);
                }
                if (search.isActive()) {
                    this.searchRenderer.updateSearchHighlights(search);
                }
                return;
            }
        }

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

        // Check if full re-render is needed
        const isFarJump =
            currentStartIndex !== -1 &&
            (startIndex >= currentEndIndex ||
                endIndex <= currentStartIndex ||
                Math.abs(startIndex - currentStartIndex) > buffer * 3);

        const needFullRerender =
            currentStartIndex === -1 ||
            startIndex >= currentEndIndex ||
            endIndex <= currentStartIndex ||
            Math.abs(startIndex - currentStartIndex) > buffer * 2 ||
            Math.abs(endIndex - currentEndIndex) > buffer * 2;

        if (needFullRerender) {
            if (isFarJump) {
                // Two-phase far-jump: render minimal visible window on frame 1 for instant sub-frame paint,
                // then expand to full buffer in subsequent RAF.
                this.renderViewport(state, 2);
                this.scheduleExpandBuffer(state);
            } else {
                // Rebuild only the viewport DOM; the structural row model stays cached.
                this.renderViewport(state);
            }
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

        // Add rows above directly (Zero Alloc)
        while (currentStartIndex > startIndex) {
            currentStartIndex--;
            const elements = this.renderRowAt(currentStartIndex, state);

            this.codeContent.insertBefore(elements.code, this.codeContent.children[1]);
            this.gutter.insertBefore(elements.gutter, this.gutter.children[1]);
            this.buttonsColumn.insertBefore(elements.btn, this.buttonsColumn.children[1]);
            this.foldsColumn.insertBefore(elements.fold, this.foldsColumn.children[1]);

            changed = true;
        }

        // Add rows below directly (Zero Alloc)
        while (currentEndIndex < endIndex) {
            const elements = this.renderRowAt(currentEndIndex, state);

            this.codeContent.insertBefore(elements.code, bottomSpacer);
            this.gutter.insertBefore(elements.gutter, gutterBottomSpacer);
            this.buttonsColumn.insertBefore(elements.btn, btnBottomSpacer);
            this.foldsColumn.insertBefore(elements.fold, foldsBottomSpacer);

            currentEndIndex++;
            changed = true;
        }

        // Render cursor or selection
        if (!readOnly && (!search.isActive() || !search.isFocused())) {
            this.renderCursorOrSelection(state);
        }

        // Render search highlights
        if (search.isActive()) {
            this.searchRenderer.updateSearchHighlights(search);
        }

        this.updateContentMinWidth(state, startIndex, endIndex);

        if (!changed) return;

        // Update spacers based on visual indices
        const topHeight = Math.round(startIndex * lineHeight);
        const bottomHeight = Math.round(Math.max(0, (totalVisualRows - endIndex) * lineHeight));

        const topPx = `${topHeight}px`;
        const bottomPx = `${bottomHeight}px`;

        topSpacer.style.height = topPx;
        gutterTopSpacer.style.height = topPx;
        btnTopSpacer.style.height = topPx;
        foldsTopSpacer.style.height = topPx;

        bottomSpacer.style.height = bottomPx;
        gutterBottomSpacer.style.height = bottomPx;
        btnBottomSpacer.style.height = bottomPx;
        foldsBottomSpacer.style.height = bottomPx;
    }

    public updateScrollbarThumb() {
        this.scrollbarMarkersRenderer.updateThumbPosition(this.lastScrollTop, true);
    }

    /**
     * Render a visual row directly without intermediate object allocations (Zero Alloc)
     */
    public renderRowAt(
        visualIndex: number,
        state: EditorState,
        precomputedNodes?: HighlighedNode[]
    ): RowElements {
        if (this.activeVisualRows) {
            const row = this.activeVisualRows[visualIndex];
            if (!row || row.kind === "real") {
                const lineIndex = row ? row.lineIndex : visualIndex;
                return this.createRealRow(lineIndex, visualIndex, state, precomputedNodes);
            }
            if (row.kind === "ghost") {
                return this.createGhostRow(row.hunkId, row.anchorLine, row.originalLineIndex, visualIndex, state);
            }
            return this.createSeparatorRow(row, visualIndex, state);
        }

        if (this.sparseGhostGroups.length === 0) {
            return this.createRealRow(visualIndex, visualIndex, state, precomputedNodes);
        }

        let ghostsBefore = 0;
        for (let g = 0; g < this.sparseGhostGroups.length; g++) {
            const group = this.sparseGhostGroups[g];
            if (visualIndex < group.startVisualIndex) {
                const lineIndex = visualIndex - ghostsBefore;
                return this.createRealRow(lineIndex, visualIndex, state, precomputedNodes);
            }
            if (visualIndex < group.startVisualIndex + group.ghostCount) {
                const ghostOffset = visualIndex - group.startVisualIndex;
                const originalLineNumber = group.oldLineNumbers[ghostOffset];
                return this.createGhostRow(
                    group.hunkId,
                    group.anchorLine,
                    originalLineNumber - 1,
                    visualIndex,
                    state
                );
            }
            ghostsBefore += group.ghostCount;
        }

        const lineIndex = visualIndex - ghostsBefore;
        return this.createRealRow(lineIndex, visualIndex, state, precomputedNodes);
    }

    private createRealRow(
        lineIndex: number,
        visualIndex: number,
        state: EditorState,
        precomputedNodes?: HighlighedNode[]
    ): RowElements {
        const { code, settings, diffs, runLines, errorLines } = state;
        const multibufferCode = code as Code & {
            getMultibufferHeader?: (line: number) => string | null;
            getMultibufferLineNumber?: (line: number) => number | null;
        };
        const lineText = code.line(lineIndex) || "\u200B";
        const binaryTokens = code.getLineBinaryTokens(lineIndex);
        const syntaxNodes = precomputedNodes || [];
        const displayLineNumber = multibufferCode.getMultibufferLineNumber?.(lineIndex) ?? undefined;
        const elements = this.lineRenderer.createLineElements(
            lineIndex, syntaxNodes, errorLines, settings,
            diffs, runLines, this.getFoldIndicator(lineIndex), state.wordHighlight,
            displayLineNumber, binaryTokens, lineText
        );
        const header = multibufferCode.getMultibufferHeader?.(lineIndex);
        if (header !== null && header !== undefined) {
            elements.code.classList.add("multibuffer-file-header-row");
            elements.code.contentEditable = "false";
            elements.gutter.classList.add("multibuffer-file-header-gutter");
            elements.gutter.textContent = "";
            elements.btn.classList.add("multibuffer-file-header-gutter");
            elements.fold.classList.add("multibuffer-file-header-gutter");
        }
        return this.applyVisualIndex(elements, visualIndex);
    }

    private createGhostRow(
        hunkId: number,
        anchorLine: number,
        originalLineIndex: number,
        visualIndex: number,
        state: EditorState
    ): RowElements {
        const { settings } = state;
        const originalNodes = state.originalCode?.getLineNodes(originalLineIndex);
        const originalText = state.originalCode?.line(originalLineIndex) ?? "";
        const ghostRow: GhostRow = {
            kind: "ghost",
            hunkId,
            anchorLine,
            originalLineIndex,
        };
        const elements = this.diffRenderer.createGhostRowElements(
            ghostRow, settings, originalText, originalNodes, state.wordHighlight
        );
        return this.applyVisualIndex(elements, visualIndex);
    }

    private createSeparatorRow(
        separator: SeparatorRow,
        visualIndex: number,
        state: EditorState
    ): RowElements {
        const elements = this.diffRenderer.createGapRowElements(separator, state.settings);
        return this.applyVisualIndex(elements, visualIndex);
    }

    private replaceRowAt(childIndex: number, row: RowElements): void {
        const oldCode = this.codeContent.children[childIndex];
        if (oldCode) this.codeContent.replaceChild(row.code, oldCode);

        const oldGutter = this.gutter.children[childIndex] as HTMLElement | undefined;
        if (oldGutter && (oldGutter.textContent !== row.gutter.textContent || oldGutter.className !== row.gutter.className)) {
            this.gutter.replaceChild(row.gutter, oldGutter);
        }

        const oldBtn = this.buttonsColumn.children[childIndex] as HTMLElement | undefined;
        if (oldBtn && (oldBtn.textContent !== row.btn.textContent || oldBtn.className !== row.btn.className)) {
            this.buttonsColumn.replaceChild(row.btn, oldBtn);
        }

        const oldFold = this.foldsColumn.children[childIndex] as HTMLElement | undefined;
        if (oldFold) {
            const oldToggle = oldFold.firstElementChild?.className;
            const newToggle = row.fold.firstElementChild?.className;
            if (oldFold.className !== row.fold.className || oldToggle !== newToggle) {
                this.foldsColumn.replaceChild(row.fold, oldFold);
            }
        }
    }

    private isRowChanged(
        existing: HTMLElement,
        row: VisualRow,
        code: Code,
        diffs?: Map<number, DiffInfo>
    ): boolean {
        if (row.kind === "real") {
            if (isGhostElement(existing)) return true;
            return this.isLineChanged(existing as AnycodeLine, row.lineIndex, code, diffs);
        }
        if (row.kind === "ghost") {
            if (!isGhostElement(existing)) return true;
            return existing.hunkId !== row.hunkId || existing.originalLineIndex !== row.originalLineIndex;
        }
        if (row.kind === "separator") {
            if (!existing.classList.contains(CSS_CLASS.DIFF_GAP)) return true;
            const data = getGapElementData(existing);
            return !data || data.hiddenStart !== row.hiddenStart || data.hiddenEnd !== row.hiddenEnd;
        }
        return true;
    }

    private isLineChanged(line: AnycodeLine, lineIndex: number, code: Code, diffs?: Map<number, DiffInfo>): boolean {
        if (line.lineNumber !== lineIndex) return true;

        const lineText = code.line(lineIndex) || "\u200B";
        const binaryTokens = code.getLineBinaryTokens(lineIndex);
        if (line.hash !== BinaryTokens.fastHash(binaryTokens, lineText)) return true;

        if (diffs) {
            const diff = diffs.get(lineIndex + 1);
            const expectedClass = diff?.changeType === "modified" ? CSS_CLASS.DIFF_CHANGED
                                : diff?.changeType === "added" ? CSS_CLASS.DIFF_ADDED : null;
            if (expectedClass ? !line.classList.contains(expectedClass)
                              : (line.classList.contains(CSS_CLASS.DIFF_CHANGED) || line.classList.contains(CSS_CLASS.DIFF_ADDED))) {
                return true;
            }
        }
        return false;
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

        const totalRealLines = code.linesLength();
        const oldTotalRows = this.getVisualRowCount();
        const oldActiveRows = this.activeVisualRows;

        this.updateSparseGhostIndex(diffs, totalRealLines);

        let newActiveRows: VisualRow[] | null = null;
        if (this.diffRenderer.isFocusedDiffEnabled() && diffs && diffs.size > 0) {
            newActiveRows = this.buildVisualRows(totalRealLines, diffs, code);
        } else if (this.lastHiddenLines.size > 0 && this.codeFoldingEnabled) {
            newActiveRows = this.buildRealOnlyRows(totalRealLines);
        }

        const newTotalRows = newActiveRows ? newActiveRows.length : (totalRealLines + this.totalGhostLines);
        if (newTotalRows !== oldTotalRows) {
            // Fallback to full render
            this.render(state);
            return;
        }

        this.lastTotalLines = totalRealLines;
        this.activeVisualRows = newActiveRows;

        const renderedRange = this.getRenderedRange();
        if (!renderedRange) {
            // Fallback to full render
            this.render(state);
            return;
        }

        const visible = this.getVisibleRange(newTotalRows, settings);

        // If viewport changed, do full render
        if (renderedRange.startIndex !== visible.startIndex ||
            renderedRange.endIndex !== visible.endIndex) {
            this.render(state);
            return;
        }

        // Update changed rows in viewport (Zero-Alloc)
        for (let i = visible.startIndex; i < visible.endIndex; i++) {
            const childIndex = i - renderedRange.startIndex + 1;
            const existing = this.codeContent.children[childIndex] as HTMLElement | undefined;
            const row = this.getVisualRow(i);

            if (!existing || this.isRowChanged(existing, row, code, diffs)) {
                this.replaceRowAt(childIndex, this.renderRowAt(i, state));
            }
        }

        // Render search highlights
        if (search.isActive()) {
            this.searchRenderer.updateSearchHighlights(search);
        }

        // Render cursor or selection
        this.renderCursorOrSelection(state, true);
        this.updateContentMinWidth(state, visible.startIndex, visible.endIndex);

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
        if (!state.cursorActive || state.readOnly) return;

        const { code, offset, selection } = state;
        if (!selection || selection.isEmpty()) {
            const { line, column } = code.getPosition(offset);
            this.renderCursor(line, column, focus, state);
        } else {
            this.renderSelection(code, selection!);
        }
        this.renderBracketMatch(state);
    }

    public renderCursor(line: number, column: number, focus: boolean = false, state?: EditorState) {
        this.codeContent.classList.remove('selecting');
        const lineDiv = this.getLine(line);
        if (lineDiv) {
            const visualIndex = this.getVisualIndexForLine(line);
            const lineHeight = state?.settings?.lineHeight || 20;
            const gutterWidth = this.lastGutterWidth || 48;
            const scrollTop = this.lastScrollTop;
            const clientHeight = this.lastClientHeight;

            if (typeof requestAnimationFrame !== 'undefined') {
                if (this.cursorRafId !== null) {
                    cancelAnimationFrame(this.cursorRafId);
                }
                this.cursorRafId = requestAnimationFrame(() => {
                    this.cursorRafId = null;
                    if (!lineDiv.isConnected) return;
                    moveCursor(lineDiv, column, focus, visualIndex, lineHeight, gutterWidth, scrollTop, clientHeight);
                });
            } else {
                moveCursor(lineDiv, column, focus, visualIndex, lineHeight, gutterWidth, scrollTop, clientHeight);
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

        // For plain files without folds or diffs, visual and source line
        // indices are identical. Avoid scanning all rendered rows.
        const visualIndex = !this.diffEnabled && state.foldRanges.length === 0
            ? line
            : this.getVisualIndexForLine(line);
        const cursorTop = visualIndex * settings.lineHeight;
        const cursorBottom = cursorTop + settings.lineHeight;

        const renderedRange = this.getRenderedRange();
        const isFarInsideRenderedRange = renderedRange !== null
            && visualIndex >= renderedRange.startIndex + settings.buffer
            && visualIndex < renderedRange.endIndex - settings.buffer;
        if (isFarInsideRenderedRange) {
            return false;
        }

        const viewportTop = this.container.scrollTop;
        const viewportBottom = viewportTop + this.container.clientHeight;

        const bottomPaddingLines = 0;
        const padding = settings.lineHeight * bottomPaddingLines;

        const isCursorVisible = cursorTop >= viewportTop
            && cursorBottom <= viewportBottom - padding;
        if (isCursorVisible) {
            return false;
        }

        let targetScrollTop = viewportTop;

        if (cursorTop < viewportTop) {
            targetScrollTop = cursorTop;
        } else if (cursorBottom > viewportBottom - padding) {
            targetScrollTop = cursorBottom - this.container.clientHeight + padding;
        }

        const tolerance = 2;
        if (Math.abs(targetScrollTop - viewportTop) > tolerance) {
            this.container.scrollTo({ top: targetScrollTop });
            this.renderScroll(state);
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
        this.renderScroll(state);

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

    private updateContentMinWidth(
        state: EditorState,
        startIndex: number = 0,
        endIndex?: number,
        reset: boolean = false
    ): void {
        // const charWidth = this.getCharWidth();
        // const totalLines = state.code.linesLength();

        // if (reset) {
        //     this.maxTrackedWidth = 0;
        // }

        // let start = 0;
        // let end = totalLines;

        // // For large files (> 5000 lines), scan visible viewport slice and error lines to keep render sub-millisecond
        // if (totalLines > 5000) {
        //     start = startIndex;
        //     end = endIndex !== undefined ? Math.min(totalLines, endIndex) : Math.min(totalLines, startIndex + 100);
        // }

        // let currentMaxWidth = this.maxTrackedWidth;

        // for (let line = start; line < end; line++) {
        //     let width = state.code.lineLength(line) * charWidth;
        //     currentMaxWidth = Math.max(currentMaxWidth, width);
        // }

        // for (const [line, diagnostic] of state.errorLines) {
        //     if (line >= 0 && line < totalLines) {
        //         const diagnosticText = minimize(diagnostic);
        //         const width = state.code.lineLength(line) * charWidth + diagnosticText.length * charWidth + charWidth * 3 + 8;
        //         currentMaxWidth = Math.max(currentMaxWidth, width);
        //     }
        // }

        // if (state.originalCode && this.activeVisualRows) {
        //     for (const row of this.activeVisualRows) {
        //         if (row.kind !== 'ghost') continue;
        //         const width = state.originalCode.lineLength(row.originalLineIndex) * charWidth;
        //         currentMaxWidth = Math.max(currentMaxWidth, width);
        //     }
        // }

        // this.maxTrackedWidth = currentMaxWidth;
        // const nextMinWidth = Math.ceil(currentMaxWidth + 100);
        // if (nextMinWidth === this.lastContentMinWidth) return;

        // this.lastContentMinWidth = nextMinWidth;
        // this.codeContent.style.minWidth = `${nextMinWidth}px`;
    }

    public updateGutterWidth(state: EditorState): void {
        const totalRealLines = state.code.linesLength();
        const digits = totalRealLines >= 100000 ? 6
                     : totalRealLines >= 10000  ? 5
                     : totalRealLines >= 1000   ? 4
                     : 3;

        const gutterWidth = Math.max(48, Math.ceil(digits * 8.5 + 18));
        if (gutterWidth === this.lastGutterWidth) return;

        this.lastGutterWidth = gutterWidth;
        const foldsLeft = 32 + gutterWidth;
        this.container.style.setProperty("--anycode-gutter-width", `${gutterWidth}px`);
        this.container.style.setProperty("--anycode-folds-left", `${foldsLeft}px`);
        (this.container as any)._stickyWidth = undefined;
    }

}

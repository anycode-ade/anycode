import { Code, HighlighedNode } from "../code";
import { BinaryTokens } from "../tokens";
import { AnycodeLine, Point, RowElements, SparseGhostGroup } from "../types";
import { isGhostElement, objectHash, minimize } from "../utils";
import { moveCursor, removeCursor } from "../cursor";
import { EditorState, EditorSettings } from "../editor";
import { DiffInfo, DiffModel } from "../diff";
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
import { StickyHeaderRenderer } from "./StickyHeaderRenderer";

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

export type VisualSegment =
    | { kind: 'real'; startLine: number; count: number; startVisualIndex: number }
    | { kind: 'ghost'; hunkId: number; anchorLine: number; oldLineNumbers: number[]; ghostCount: number; startVisualIndex: number }
    | { kind: 'separator'; hiddenStart: number; hiddenEnd: number; startVisualIndex: number };

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
    private stickyHeaderRenderer: StickyHeaderRenderer;
    private wrapper?: HTMLDivElement;
    private visualSegments: VisualSegment[] | null = null;
    private totalVisualRows: number = 0;
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
    private totalGhostLines: number = 0;
    private expandBufferRafId: number | null = null;
    private isFastScroll: boolean = false;
    private cursorRafId: number | null = null;
    private gapBeforeMap: Map<number, { hiddenStart: number; hiddenEnd: number }> = new Map();
    private gapAfterMap: Map<number, { hiddenStart: number; hiddenEnd: number }> = new Map();

    constructor(
        container: HTMLDivElement,
        buttonsColumn: HTMLDivElement,
        gutter: HTMLDivElement,
        foldsColumn: HTMLDivElement,
        codeContent: HTMLDivElement,
        scrollbarMarkersEnabled: boolean = true,
        onImmediateScroll?: () => void,
        wrapper?: HTMLDivElement,
        onToggleMultibufferHeader?: (line: number) => void,
        onJumpToMultibufferHeader?: (line: number) => void,
        stickyHeaderEnabled: boolean = true
    ) {
        this.container = container;
        this.buttonsColumn = buttonsColumn;
        this.gutter = gutter;
        this.foldsColumn = foldsColumn;
        this.codeContent = codeContent;
        this.wrapper = wrapper;

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
        this.stickyHeaderRenderer = new StickyHeaderRenderer(
            container,
            wrapper,
            {
                onToggleCollapse: onToggleMultibufferHeader,
                onJumpToFile: onJumpToMultibufferHeader,
                getVisualIndexForLine: (line: number) => this.getVisualIndexForLine(line),
            },
            stickyHeaderEnabled
        );
    }

    public setDiffEnabled(enabled: boolean) {
        this.diffEnabled = enabled;
    }

    public clean() {
        this.cancelCursorRaf();
        if (this.expandBufferRafId !== null) {
            cancelAnimationFrame(this.expandBufferRafId);
            this.expandBufferRafId = null;
        }
        this.scrollbarMarkersRenderer.clean();
        this.stickyHeaderRenderer.clean();
    }

    public cancelCursorRaf(): void {
        if (this.cursorRafId !== null) {
            cancelAnimationFrame(this.cursorRafId);
            this.cursorRafId = null;
        }
    }

    private updateVisualSegments(state: EditorState): void {
        const { code, diffs } = state;
        const totalRealLines = code.linesLength();
        this.lastTotalLines = totalRealLines;

        // 1. Ghost groups from diffs (only deleted / modified)
        const ghostGroups: SparseGhostGroup[] = [];
        let totalGhosts = 0;
        if (diffs && diffs.hasChanges()) {
            const processedHunks = new Set<number>();
            const ghostsByAnchor = new Map<number, { hunkId: number; oldLineNumbers: number[] }[]>();

            for (const hunk of diffs.getHunks()) {
                if (!hunk.oldLineNumbers || hunk.oldLineNumbers.length === 0) continue;
                if (hunk.changeType !== 'modified' && hunk.changeType !== 'deleted') continue;

                const anchorLine = hunk.ghostAnchorLine ?? hunk.startLine;
                if (!ghostsByAnchor.has(anchorLine)) {
                    ghostsByAnchor.set(anchorLine, []);
                }
                ghostsByAnchor.get(anchorLine)!.push({
                    hunkId: hunk.hunkId,
                    oldLineNumbers: hunk.oldLineNumbers,
                });
            }

            const sortedAnchors = Array.from(ghostsByAnchor.keys()).sort((a, b) => a - b);
            for (const anchor of sortedAnchors) {
                const groups = ghostsByAnchor.get(anchor)!;
                for (const group of groups) {
                    if (processedHunks.has(group.hunkId)) continue;
                    processedHunks.add(group.hunkId);
                    const validOldNumbers = group.oldLineNumbers.filter((n) => n >= 1);
                    if (validOldNumbers.length === 0) continue;
                    ghostGroups.push({
                        anchorLine: anchor,
                        hunkId: group.hunkId,
                        oldLineNumbers: validOldNumbers,
                        ghostCount: validOldNumbers.length,
                        startVisualIndex: 0,
                    });
                    totalGhosts += validOldNumbers.length;
                }
            }
        }
        this.totalGhostLines = totalGhosts;
        this.gapBeforeMap = new Map();
        this.gapAfterMap = new Map();

        // 2. Focused diff visible ranges
        const focusedRanges = this.diffRenderer.computeVisibleRanges(totalRealLines, diffs, code);
        const alwaysVisible = code.getAlwaysVisibleLines(totalRealLines);

        // 3. Fast Path: No focused diff gaps, no folds, no ghosts -> visualSegments = null!
        const hasFolds = this.lastHiddenLines.size > 0 && this.codeFoldingEnabled;
        const isFocusedDiffActive = focusedRanges !== undefined && !(focusedRanges.length === 1 && focusedRanges[0].start === 0 && focusedRanges[0].end === totalRealLines - 1);
        const hasGhosts = ghostGroups.length > 0;

        if (!hasFolds && !isFocusedDiffActive && !hasGhosts && !alwaysVisible) {
            this.visualSegments = null;
            this.totalVisualRows = totalRealLines;
            return;
        }

        // In the common diff-only case, there is no reason to inspect every
        // real line. Ghost anchors are already sorted, so the visual model
        // can be built in O(H), where H is the number of ghost groups.
        if (!hasFolds && !isFocusedDiffActive) {
            const result = this.buildSegmentsAroundGhosts(totalRealLines, ghostGroups);
            this.visualSegments = result.segments;
            this.totalVisualRows = result.totalRows;
            return;
        }

        // 4. Build sparse segments by interleaving real visible intervals, separators, and ghost groups
        let baseIntervals: { start: number; end: number }[] = focusedRanges ?? (totalRealLines > 0 ? [{ start: 0, end: totalRealLines - 1 }] : []);
        if (alwaysVisible && alwaysVisible.size > 0) {
            const raw = [...baseIntervals];
            for (const line of alwaysVisible) {
                if (line >= 0 && line < totalRealLines) raw.push({ start: line, end: line });
            }
            raw.sort((a, b) => a.start - b.start);
            if (raw.length > 0) {
                baseIntervals = [raw[0]];
                for (let i = 1; i < raw.length; i++) {
                    const prev = baseIntervals[baseIntervals.length - 1];
                    if (raw[i].start <= prev.end + 1) {
                        prev.end = Math.max(prev.end, raw[i].end);
                    } else {
                        baseIntervals.push(raw[i]);
                    }
                }
            }
        }

        const segments: VisualSegment[] = [];
        const gapBeforeMap = new Map<number, { hiddenStart: number; hiddenEnd: number }>();
        const gapAfterMap = new Map<number, { hiddenStart: number; hiddenEnd: number }>();
        let currentVisualIndex = 0;
        let ghostIdx = 0;
        let lastRealEnd = -1;

        for (let r = 0; r < baseIntervals.length; r++) {
            const range = baseIntervals[r];

            // Gap before this range?
            if (focusedRanges !== undefined && range.start > lastRealEnd + 1) {
                const hiddenStart = lastRealEnd + 1;
                const hiddenEnd = range.start - 1;
                segments.push({
                    kind: 'separator',
                    hiddenStart,
                    hiddenEnd,
                    startVisualIndex: currentVisualIndex,
                });
                currentVisualIndex += 1;

                if (lastRealEnd >= 0) {
                    gapAfterMap.set(lastRealEnd, { hiddenStart, hiddenEnd });
                }
                gapBeforeMap.set(range.start, { hiddenStart, hiddenEnd });
            }

            // Real lines within this range (handling folds and ghosts)
            let segStartLine: number | null = null;

            for (let line = range.start; line <= range.end; line++) {
                const lineNumber = line + 1; // 1-based for anchor

                // Insert ghosts anchored before this line
                while (ghostIdx < ghostGroups.length && ghostGroups[ghostIdx].anchorLine <= lineNumber) {
                    const ghost = ghostGroups[ghostIdx++];

                    // If the anchor itself is hidden by a collapsed fold, the
                    // ghost belongs to that hidden block and must not be
                    // moved to the next visible row.
                    if (this.isHiddenByFold(Math.max(0, ghost.anchorLine - 1))) {
                        continue;
                    }

                    // Flush active real segment first
                    if (segStartLine !== null) {
                        const count = line - segStartLine;
                        if (count > 0) {
                            segments.push({
                                kind: 'real',
                                startLine: segStartLine,
                                count,
                                startVisualIndex: currentVisualIndex,
                            });
                            currentVisualIndex += count;
                        }
                        segStartLine = null;
                    }

                    segments.push({
                        kind: 'ghost',
                        hunkId: ghost.hunkId,
                        anchorLine: ghost.anchorLine,
                        oldLineNumbers: ghost.oldLineNumbers,
                        ghostCount: ghost.ghostCount,
                        startVisualIndex: currentVisualIndex,
                    });
                    currentVisualIndex += ghost.ghostCount;
                }

                // Check fold
                if (this.isHiddenByFold(line)) {
                    if (segStartLine !== null) {
                        const count = line - segStartLine;
                        if (count > 0) {
                            segments.push({
                                kind: 'real',
                                startLine: segStartLine,
                                count,
                                startVisualIndex: currentVisualIndex,
                            });
                            currentVisualIndex += count;
                        }
                        segStartLine = null;
                    }
                } else {
                    if (segStartLine === null) {
                        segStartLine = line;
                    }
                }
            }

            // Flush remaining real lines in range
            if (segStartLine !== null) {
                const count = range.end - segStartLine + 1;
                if (count > 0) {
                    segments.push({
                        kind: 'real',
                        startLine: segStartLine,
                        count,
                        startVisualIndex: currentVisualIndex,
                    });
                    currentVisualIndex += count;
                }
            }

            lastRealEnd = range.end;
        }

        // Trailing gap for focused diff?
        if (focusedRanges !== undefined && lastRealEnd < totalRealLines - 1) {
            const hiddenStart = lastRealEnd + 1;
            const hiddenEnd = totalRealLines - 1;
            segments.push({
                kind: 'separator',
                hiddenStart,
                hiddenEnd,
                startVisualIndex: currentVisualIndex,
            });
            currentVisualIndex += 1;

            if (lastRealEnd >= 0) {
                gapAfterMap.set(lastRealEnd, { hiddenStart, hiddenEnd });
            }
        }

        // EOF ghosts (anchored after last line)
        while (ghostIdx < ghostGroups.length) {
            const g = ghostGroups[ghostIdx++];
            segments.push({
                kind: 'ghost',
                hunkId: g.hunkId,
                anchorLine: g.anchorLine,
                oldLineNumbers: g.oldLineNumbers,
                ghostCount: g.ghostCount,
                startVisualIndex: currentVisualIndex,
            });
            currentVisualIndex += g.ghostCount;
        }

        this.gapBeforeMap = gapBeforeMap;
        this.gapAfterMap = gapAfterMap;
        this.visualSegments = segments;
        this.totalVisualRows = currentVisualIndex;
    }

    private buildSegmentsAroundGhosts(
        totalRealLines: number,
        ghostGroups: SparseGhostGroup[],
    ): { segments: VisualSegment[]; totalRows: number } {
        const segments: VisualSegment[] = [];
        let realCursor = 0;
        let visualCursor = 0;

        for (const ghost of ghostGroups) {
            // A ghost is rendered immediately before its 1-based anchor.
            // Clamping also handles deletions at/after EOF.
            const anchor = Math.max(0, Math.min(totalRealLines, ghost.anchorLine - 1));

            if (anchor > realCursor) {
                const count = anchor - realCursor;
                segments.push({
                    kind: 'real',
                    startLine: realCursor,
                    count,
                    startVisualIndex: visualCursor,
                });
                visualCursor += count;
            }

            segments.push({
                kind: 'ghost',
                hunkId: ghost.hunkId,
                anchorLine: ghost.anchorLine,
                oldLineNumbers: ghost.oldLineNumbers,
                ghostCount: ghost.ghostCount,
                startVisualIndex: visualCursor,
            });
            visualCursor += ghost.ghostCount;
            realCursor = Math.max(realCursor, anchor);
        }

        if (realCursor < totalRealLines) {
            const count = totalRealLines - realCursor;
            segments.push({
                kind: 'real',
                startLine: realCursor,
                count,
                startVisualIndex: visualCursor,
            });
            visualCursor += count;
        }

        return { segments, totalRows: visualCursor };
    }

    public getVisualRowCount(): number {
        return this.totalVisualRows || this.lastTotalLines;
    }

    public getVisualRow(visualIndex: number): VisualRow {
        if (!this.visualSegments || this.visualSegments.length === 0) {
            return { kind: 'real', lineIndex: visualIndex };
        }

        let low = 0;
        let high = this.visualSegments.length - 1;

        while (low <= high) {
            const mid = (low + high) >> 1;
            const seg = this.visualSegments[mid];
            const segCount = seg.kind === 'real' ? seg.count : seg.kind === 'ghost' ? seg.ghostCount : 1;

            if (visualIndex < seg.startVisualIndex) {
                high = mid - 1;
            } else if (visualIndex >= seg.startVisualIndex + segCount) {
                low = mid + 1;
            } else {
                if (seg.kind === 'real') {
                    return { kind: 'real', lineIndex: seg.startLine + (visualIndex - seg.startVisualIndex) };
                }
                if (seg.kind === 'ghost') {
                    const offset = visualIndex - seg.startVisualIndex;
                    return {
                        kind: 'ghost',
                        hunkId: seg.hunkId,
                        anchorLine: seg.anchorLine,
                        originalLineIndex: seg.oldLineNumbers[offset] - 1,
                    };
                }
                if (seg.kind === 'separator') {
                    return {
                        kind: 'separator',
                        hiddenStart: seg.hiddenStart,
                        hiddenEnd: seg.hiddenEnd,
                        hiddenCount: seg.hiddenEnd - seg.hiddenStart + 1,
                    };
                }
            }
        }

        return { kind: 'real', lineIndex: visualIndex };
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

        this.updateVisualSegments(state);

        this.renderViewport(state);
        const wordLines = this.wordHighlightRenderer.render(state, state.scrollbarMarkersEnabled);
        this.renderScrollbarMarkers(state, true, wordLines);
        this.stickyHeaderRenderer.render(state, this.lastScrollTop);
    }

    private renderViewport(
        state: EditorState,
        bufferOverride?: number,
        scrollTopOverride?: number,
        viewHeightOverride?: number
    ) {
        const { settings, readOnly, search } = state;

        const totalVisualRows = this.getVisualRowCount();
        const { startIndex, endIndex } = this.getVisibleRange(
            totalVisualRows,
            settings,
            bufferOverride,
            scrollTopOverride,
            viewHeightOverride
        );

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
        this.scrollbarMarkersRenderer.render(
            state,
            effectiveIncludeSearch,
            effectiveWordLines,
            (line: number) => this.getVisualIndexForLine(line),
            (visualIndex: number) => this.getLineForVisualRow(visualIndex),
            totalVisualRows
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
     * This accounts for ghost lines and hidden lines.
     */
    public getVisualIndexForLine(lineIndex: number): number {
        if (!this.visualSegments || this.visualSegments.length === 0) {
            return lineIndex;
        }

        for (const seg of this.visualSegments) {
            if (seg.kind === 'real') {
                if (lineIndex >= seg.startLine && lineIndex < seg.startLine + seg.count) {
                    return seg.startVisualIndex + (lineIndex - seg.startLine);
                }
            }
        }

        // Fallback for hidden lines (e.g. cursor in folded or focused diff gap): find nearest real segment
        let closestVisual = 0;
        let minDistance = Infinity;
        for (const seg of this.visualSegments) {
            if (seg.kind === 'real') {
                const dist = lineIndex < seg.startLine
                    ? seg.startLine - lineIndex
                    : lineIndex - (seg.startLine + seg.count - 1);
                if (dist < minDistance) {
                    minDistance = dist;
                    closestVisual = lineIndex < seg.startLine
                        ? seg.startVisualIndex
                        : seg.startVisualIndex + seg.count - 1;
                }
            }
        }
        return closestVisual;
    }

    public getLineForVisualRow(visualIndex: number): number {
        const row = this.getVisualRow(visualIndex);
        if (row.kind === 'real') return row.lineIndex;
        if (row.kind === 'ghost') return Math.max(0, row.anchorLine - 1);
        return Math.max(0, Math.round((row.hiddenStart + row.hiddenEnd) / 2));
    }

    public getVisibleRealLineIndices(): Set<number> {
        const lines = new Set<number>();
        if (!this.visualSegments || this.visualSegments.length === 0) {
            for (let i = 0; i < this.lastTotalLines; i++) {
                lines.add(i);
            }
            return lines;
        }
        for (const seg of this.visualSegments) {
            if (seg.kind === 'real') {
                for (let i = 0; i < seg.count; i++) {
                    lines.add(seg.startLine + i);
                }
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

    private getVisibleRange(
        totalVisualRows: number,
        settings: EditorSettings,
        bufferOverride?: number,
        scrollTopOverride?: number,
        viewHeightOverride?: number
    ) {
        const scrollTop = scrollTopOverride !== undefined ? scrollTopOverride : this.container.scrollTop;
        const viewHeight = viewHeightOverride !== undefined ? viewHeightOverride : this.container.clientHeight;
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
            const fallbackHeight = parentHeight > 0 ? parentHeight : (typeof window !== 'undefined' ? window.innerHeight : 600);
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
        this.stickyHeaderRenderer.render(state, currentScrollTop);
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

        const { startIndex, endIndex } = this.getVisibleRange(totalVisualRows, settings, undefined, currentScrollTop, viewHeight);

        this.ensureSpacers(this.codeContent);
        this.gutter.firstChild || this.ensureSpacers(this.gutter);
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
                this.renderViewport(state, 2, currentScrollTop, viewHeight);
                this.scheduleExpandBuffer(state);
            } else {
                // Rebuild only the viewport DOM; the structural row model stays cached.
                this.renderViewport(state, undefined, currentScrollTop, viewHeight);
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

    /**
     * Render a visual row directly without intermediate object allocations (Zero Alloc)
     */
    public renderRowAt(
        visualIndex: number,
        state: EditorState,
        precomputedNodes?: HighlighedNode[]
    ): RowElements {
        const row = this.getVisualRow(visualIndex);
        if (row.kind === 'real') {
            return this.createRealRow(row.lineIndex, visualIndex, state, precomputedNodes);
        }
        if (row.kind === 'ghost') {
            return this.createGhostRow(row.hunkId, row.anchorLine, row.originalLineIndex, visualIndex, state);
        }
        return this.createSeparatorRow(row, visualIndex, state);
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
        const gapBefore = this.gapBeforeMap.get(lineIndex);
        const gapAfter = this.gapAfterMap.get(lineIndex);
        const header = multibufferCode.getMultibufferHeader?.(lineIndex);
        const isHeader = header !== null && header !== undefined;
        const rowErrorLines = isHeader ? new Map<number, string>() : errorLines;
        const elements = this.lineRenderer.createLineElements(
            lineIndex, syntaxNodes, rowErrorLines, settings,
            diffs, runLines, this.getFoldIndicator(lineIndex), state.wordHighlight,
            displayLineNumber, binaryTokens, lineText,
            gapBefore, gapAfter
        );
        if (isHeader) {
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
        diffs?: DiffModel
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

    private isLineChanged(line: AnycodeLine, lineIndex: number, code: Code, diffs?: DiffModel): boolean {
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

        const oldTotalRows = this.getVisualRowCount();
        this.updateVisualSegments(state);
        const newTotalRows = this.getVisualRowCount();

        if (newTotalRows !== oldTotalRows) {
            // Fallback to full render
            this.render(state);
            return;
        }

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
        this.renderCursorOrSelection(state);
        this.updateContentMinWidth(state, visible.startIndex, visible.endIndex);
        this.stickyHeaderRenderer.render(state, this.lastScrollTop);
    }

    private updateFoldableStarts(state: EditorState) {
        const map = new Map<number, number>();
        if (state.foldRanges) {
            for (const range of state.foldRanges) {
                const prevEnd = map.get(range.startLine);
                if (prevEnd === undefined || range.endLine > prevEnd) {
                    map.set(range.startLine, range.endLine);
                }
            }
        }
        this.lastFoldableStarts = map;
    }

    private updateCollapsedMap(state: EditorState) {
        const map = new Map<number, number>();
        if (state.collapsedFoldStarts) {
            for (const start of state.collapsedFoldStarts) {
                const end = this.lastFoldableStarts.get(start);
                if (end !== undefined && end > start) {
                    map.set(start, end);
                }
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

        const { code, cursor, selection } = state;
        if (!selection || selection.isEmpty()) {
            this.renderCursor(cursor.row, cursor.column, focus, state);
        } else {
            this.renderSelection(code, selection!);
        }
        this.renderBracketMatch(state);
    }

    public renderCursor(line: number, column: number, focus: boolean = false, state?: EditorState) {
        this.codeContent.classList.remove('selecting');
        if (state?.code && !state.code.isLineEditable(line)) {
            removeCursor();
            return;
        }
        const lineDiv = this.getLine(line);
        if (lineDiv) {
            const visualIndex = this.getVisualIndexForLine(line);
            const lineHeight = state?.settings?.lineHeight || 20;
            const gutterWidth = this.lastGutterWidth || 48;
            const scrollTop = this.lastScrollTop;
            const clientHeight = this.lastClientHeight;

            if (lineDiv.isConnected) {
                if (this.cursorRafId !== null) {
                    cancelAnimationFrame(this.cursorRafId);
                    this.cursorRafId = null;
                }
                moveCursor(lineDiv, column, focus, visualIndex, lineHeight, gutterWidth, scrollTop, clientHeight);
            } else if (typeof requestAnimationFrame !== 'undefined') {
                if (this.cursorRafId !== null) {
                    cancelAnimationFrame(this.cursorRafId);
                }
                this.cursorRafId = requestAnimationFrame(() => {
                    this.cursorRafId = null;
                    if (!lineDiv.isConnected) return;
                    if (state && !state.cursorActive) return;
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
            renderSelection(selection, lines);
        } else {
            requestAnimationFrame(() => {
                renderSelection(selection, this.getLines());
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
        const { code, cursor, settings } = state;
        if (!code) return false;

        let line = focusLine !== null
            ? focusLine
            : cursor.row;

        // For plain files without folds or diffs, visual and source line
        // indices are identical. Avoid scanning all rendered rows.
        const visualIndex = !this.diffEnabled && state.foldRanges.length === 0
            ? line
            : this.getVisualIndexForLine(line);
        const cursorTop = visualIndex * settings.lineHeight;
        const cursorBottom = cursorTop + settings.lineHeight;

        const topPadding = (state.stickyHeaderEnabled && typeof (state.code as any)?.getFileHeaders === 'function')
            ? settings.lineHeight
            : 0;
        const topPaddingLines = topPadding > 0 ? 1 : 0;

        const renderedRange = this.getRenderedRange();
        const isFarInsideRenderedRange = renderedRange !== null
            && visualIndex >= renderedRange.startIndex + settings.buffer + topPaddingLines
            && visualIndex < renderedRange.endIndex - settings.buffer;
        if (isFarInsideRenderedRange) {
            return false;
        }

        const viewportTop = this.container.scrollTop;
        const viewportBottom = viewportTop + this.container.clientHeight;

        const bottomPaddingLines = 0;
        const bottomPadding = settings.lineHeight * bottomPaddingLines;

        const isCursorVisible = cursorTop >= viewportTop + topPadding
            && cursorBottom <= viewportBottom - bottomPadding;
        if (isCursorVisible) {
            return false;
        }

        let targetScrollTop = viewportTop;

        if (cursorTop < viewportTop + topPadding) {
            targetScrollTop = Math.max(0, cursorTop - topPadding);
        } else if (cursorBottom > viewportBottom - bottomPadding) {
            targetScrollTop = cursorBottom - this.container.clientHeight + bottomPadding;
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
        const { code, cursor } = state;
        if (!code) return false;

        return this.revealLineCenter(state, cursor.row);
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
                if (lineDiv.classList.contains("multibuffer-file-header-row")) {
                    this.lineRenderer.renderDiagnostics(lineDiv, null);
                    continue;
                }
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
        point: Point,
        onCompletionClick: (index: number) => void
    ) {
        this.completionRenderer.render(completions, selectedIndex, code, point, onCompletionClick);
    }

    public moveCompletion(code: Code, point: Point) {
        this.completionRenderer.move(code, point);
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

    public renderHover(content: string, code: Code, point: Point) {
        this.hoverRenderer.render(content, code, point);
    }

    public moveHover(code: Code, point: Point) {
        this.hoverRenderer.move(code, point);
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
        if (this.wrapper && this.wrapper !== this.container) {
            this.wrapper.style.setProperty("--anycode-gutter-width", `${gutterWidth}px`);
            this.wrapper.style.setProperty("--anycode-folds-left", `${foldsLeft}px`);
        }
        (this.container as any)._stickyWidth = undefined;
    }

    public setStickyHeaderEnabled(enabled: boolean, state?: EditorState): void {
        this.stickyHeaderRenderer.setEnabled(enabled, state, this.lastScrollTop);
    }

    public getStickyHeaderActiveLine(): number | null {
        return this.stickyHeaderRenderer.getActiveLine();
    }
}

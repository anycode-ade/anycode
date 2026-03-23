import { Code } from "../code";
import { AnycodeLine, objectHash } from "../utils";
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
import { DiagnosticRenderer } from "./DiagnosticRenderer";

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
    text: string;
}

export type VisualRow = RealRow | GhostRow;

export class Renderer {
    private container: HTMLDivElement;
    private buttonsColumn: HTMLDivElement;
    private gutter: HTMLDivElement;
    private codeContent: HTMLDivElement;
    private diffEnabled: boolean = false;
    private lineRenderer: LineRenderer;
    private searchRenderer: SearchRenderer;
    private diffRenderer: DiffRenderer;
    private completionRenderer: CompletionRenderer;
    
    private visualRows: VisualRow[] = [];
    
    private maxWidth: number = 0;
    private charWidth: number = 0;

    constructor(
        container: HTMLDivElement,
        buttonsColumn: HTMLDivElement,
        gutter: HTMLDivElement,
        codeContent: HTMLDivElement
    ) {
        this.container = container;
        this.buttonsColumn = buttonsColumn;
        this.gutter = gutter;
        this.codeContent = codeContent;

        // Initialize renderers
        const diagnosticRenderer = new DiagnosticRenderer();
        this.lineRenderer = new LineRenderer(diagnosticRenderer);
        this.searchRenderer = new SearchRenderer(
            container,
            (lineNumber) => this.getLine(lineNumber),
            (state, focusLine) => this.focus(state, focusLine)
        );
        this.diffRenderer = new DiffRenderer(
            codeContent,
            gutter,
            buttonsColumn
        );
        this.completionRenderer = new CompletionRenderer(
            container,
            (lineNumber) => this.getLine(lineNumber)
        );
    }

    public setDiffEnabled(enabled: boolean) {
        this.diffEnabled = enabled;
    }

    public render(state: EditorState, search?: Search) {
        const { code, offset, selection, runLines, errorLines, settings, diffs, readOnly } = state;

        // Build unified visual rows model (real lines + ghost lines)
        const totalRealLines = code.linesLength();
        this.visualRows = this.diffEnabled 
            ? this.buildVisualRows(totalRealLines, diffs)
            : this.buildRealOnlyRows(totalRealLines);

        const totalVisualRows = this.visualRows.length;
        const { startIndex, endIndex } = this.getVisibleRangeByVisualIndex(totalVisualRows, settings);
        
        const itemHeight = settings.lineHeight;
        const paddingTop = startIndex * itemHeight;
        const paddingBottom = (totalVisualRows - endIndex) * itemHeight;

        // Build fragments for better performance
        const btnFrag = document.createDocumentFragment();
        const gutterFrag = document.createDocumentFragment();
        const codeFrag = document.createDocumentFragment();

        // Top spacers
        btnFrag.appendChild(this.lineRenderer.createSpacer(paddingTop));
        gutterFrag.appendChild(this.lineRenderer.createSpacer(paddingTop));
        codeFrag.appendChild(this.lineRenderer.createSpacer(paddingTop));

        // Render visible slice of visual rows
        for (let i = startIndex; i < endIndex; i++) {
            const row = this.visualRows[i];
            
            if (row.kind === 'real') {
                const lineIndex = row.lineIndex;
                const syntaxNodes = code.getLineNodes(lineIndex);
                
                const lineWrapper = this.lineRenderer.createLineWrapper(lineIndex, syntaxNodes, errorLines, settings, diffs);
                lineWrapper.setAttribute('data-visual-index', i.toString());
                
                const lineNumberEl = this.lineRenderer.createLineNumber(lineIndex, settings, diffs);
                lineNumberEl.setAttribute('data-visual-index', i.toString());
                
                const lineButtonEl = this.lineRenderer.createLineButtons(lineIndex, runLines, errorLines, settings);
                lineButtonEl.setAttribute('data-visual-index', i.toString());

                codeFrag.appendChild(lineWrapper);
                gutterFrag.appendChild(lineNumberEl);
                btnFrag.appendChild(lineButtonEl);
            } else {
                // Ghost row
                const ghostElements = this.diffRenderer.createGhostRowElements(row, settings);
                ghostElements.code.setAttribute('data-visual-index', i.toString());
                ghostElements.gutter.setAttribute('data-visual-index', i.toString());
                ghostElements.btn.setAttribute('data-visual-index', i.toString());
                
                codeFrag.appendChild(ghostElements.code);
                gutterFrag.appendChild(ghostElements.gutter);
                btnFrag.appendChild(ghostElements.btn);
            }
        }

        // Bottom spacers
        btnFrag.appendChild(this.lineRenderer.createSpacer(paddingBottom));
        gutterFrag.appendChild(this.lineRenderer.createSpacer(paddingBottom));
        codeFrag.appendChild(this.lineRenderer.createSpacer(paddingBottom));

        // Replace old children atomically
        this.buttonsColumn.replaceChildren(btnFrag);
        this.gutter.replaceChildren(gutterFrag);
        this.codeContent.replaceChildren(codeFrag);

        // Render cursor or selection
        if (!readOnly && (!search || !search.isActive() || !search.isFocused())) {
            if (!selection || selection.isEmpty()) {
                const { line, column } = code.getPosition(offset);
                this.renderCursor(line, column, false);
            } else {
                this.renderSelection(code, selection!);
            }
        }

        // Render search highlights
        if (!readOnly && search && search.isActive()) {
            this.searchRenderer.updateSearchHighlights(search);
        }
        
        this.updateMaxWidth(code);
    }

    /**
     * Build visual rows with only real lines (no ghost lines)
     */
    private buildRealOnlyRows(totalLines: number): VisualRow[] {
        const rows: VisualRow[] = [];
        for (let i = 0; i < totalLines; i++) {
            rows.push({ kind: 'real', lineIndex: i });
        }
        return rows;
    }

    /**
     * Build a unified list of visual rows (real + ghost lines).
     * Ghost lines are inserted before their anchor line.
     * This provides a stable model for virtualized scrolling.
     */
    private buildVisualRows(
        totalLines: number,
        diffs: Map<number, DiffInfo> | undefined
    ): VisualRow[] {
        const rows: VisualRow[] = [];
        const processedHunks = new Set<number>();

        // Collect ghost info by anchor line for efficient lookup
        const ghostsByAnchor = new Map<number, { hunkId: number; texts: string[] }[]>();
        
        if (diffs) {
            for (const [lineNumber, diffInfo] of diffs) {
                if (!diffInfo.oldLines || diffInfo.oldLines.length === 0) continue;
                if (diffInfo.changeType !== 'modified' && diffInfo.changeType !== 'deleted') continue;
                
                const anchorLine = diffInfo.ghostAnchorLine ?? lineNumber;
                
                if (!ghostsByAnchor.has(anchorLine)) {
                    ghostsByAnchor.set(anchorLine, []);
                }
                ghostsByAnchor.get(anchorLine)!.push({
                    hunkId: diffInfo.hunkId,
                    texts: diffInfo.oldLines
                });
            }
        }

        // Build visual rows: iterate through lines and insert ghosts before their anchors
        for (let i = 0; i < totalLines; i++) {
            const lineNumber = i + 1; // 1-indexed for diffs
            
            // Check for ghost lines anchored before this line
            const ghostsHere = ghostsByAnchor.get(lineNumber);
            if (ghostsHere) {
                for (const ghostGroup of ghostsHere) {
                    if (processedHunks.has(ghostGroup.hunkId)) continue;
                    processedHunks.add(ghostGroup.hunkId);
                    
                    for (const text of ghostGroup.texts) {
                        rows.push({
                            kind: 'ghost',
                            hunkId: ghostGroup.hunkId,
                            anchorLine: lineNumber,
                            text
                        });
                    }
                }
            }
            
            // Add the real line
            rows.push({ kind: 'real', lineIndex: i });
        }

        // Handle EOF ghosts (deletions anchored after the last line)
        const eofAnchor = totalLines + 1;
        const eofGhosts = ghostsByAnchor.get(eofAnchor);
        if (eofGhosts) {
            for (const ghostGroup of eofGhosts) {
                if (processedHunks.has(ghostGroup.hunkId)) continue;
                processedHunks.add(ghostGroup.hunkId);
                
                for (const text of ghostGroup.texts) {
                    rows.push({
                        kind: 'ghost',
                        hunkId: ghostGroup.hunkId,
                        anchorLine: eofAnchor,
                        text
                    });
                }
            }
        }

        return rows;
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
        // Fallback: if line not found, estimate based on lineIndex
        // This shouldn't happen in normal operation
        return lineIndex;
    }
    
    /**
     * Get visible range based on visual row indices
     */
    private getVisibleRangeByVisualIndex(totalVisualRows: number, settings: EditorSettings) {
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

    public renderScroll(state: EditorState, search?: Search) {
        // console.log("renderScroll");

        const { code, offset, selection, settings, diffs, runLines, errorLines } = state;
        const lineHeight = settings.lineHeight;
        const buffer = settings.buffer;
        
        // Rebuild visual rows if diffs changed (otherwise use cached)
        const totalRealLines = code.linesLength();
        this.visualRows = this.diffEnabled 
            ? this.buildVisualRows(totalRealLines, diffs)
            : this.buildRealOnlyRows(totalRealLines);

        const totalVisualRows = this.visualRows.length;
        const { startIndex, endIndex } = this.getVisibleRangeByVisualIndex(totalVisualRows, settings);

        this.ensureSpacers(this.codeContent);
        this.ensureSpacers(this.gutter);
        this.ensureSpacers(this.buttonsColumn);

        const topSpacer = this.codeContent.firstChild as HTMLElement;
        const bottomSpacer = this.codeContent.lastChild as HTMLElement;

        const gutterTopSpacer = this.gutter.firstChild as HTMLElement;
        const gutterBottomSpacer = this.gutter.lastChild as HTMLElement;

        const btnTopSpacer = this.buttonsColumn.firstChild as HTMLElement;
        const btnBottomSpacer = this.buttonsColumn.lastChild as HTMLElement;

        // Get current rendered range by checking first/last visual index attributes
        const renderedElements = this.getRenderedElements();
        let currentStartIndex = renderedElements.length > 0 
            ? parseInt(renderedElements[0].getAttribute('data-visual-index') || '-1', 10) 
            : -1;
        let currentEndIndex = renderedElements.length > 0 
            ? parseInt(renderedElements[renderedElements.length - 1].getAttribute('data-visual-index') || '-1', 10) + 1 
            : -1;

        // Check if full re-render is needed
        const needFullRerender =
            currentStartIndex === -1 ||
            startIndex >= currentEndIndex ||
            endIndex <= currentStartIndex ||
            Math.abs(startIndex - currentStartIndex) > buffer * 2 ||
            Math.abs(endIndex - currentEndIndex) > buffer * 2;

        if (needFullRerender) {
            this.render(state, search);
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
            currentEndIndex--;
            changed = true;
        }

        // Add rows above
        while (currentStartIndex > startIndex) {
            currentStartIndex--;
            const row = this.visualRows[currentStartIndex];
            const elements = this.createRowElements(row, currentStartIndex, state);

            this.codeContent.insertBefore(elements.code, this.codeContent.children[1]);
            this.gutter.insertBefore(elements.gutter, this.gutter.children[1]);
            this.buttonsColumn.insertBefore(elements.btn, this.buttonsColumn.children[1]);

            changed = true;
        }

        // Add rows below
        while (currentEndIndex < endIndex) {
            const row = this.visualRows[currentEndIndex];
            const elements = this.createRowElements(row, currentEndIndex, state);

            this.codeContent.insertBefore(elements.code, bottomSpacer);
            this.gutter.insertBefore(elements.gutter, gutterBottomSpacer);
            this.buttonsColumn.insertBefore(elements.btn, btnBottomSpacer);

            currentEndIndex++;
            changed = true;
        }

        // Render cursor or selection
        if (!search || !search.isActive() || !search.isFocused()) {
            if (!selection || selection.isEmpty()) {
                const { line, column } = code.getPosition(offset);
                this.renderCursor(line, column, false);
            } else {
                this.renderSelection(code, selection!);
            }
        }

        // Render search highlights
        if (search && search.isActive()) {
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
    }

    /**
     * Create DOM elements for a visual row (real or ghost)
     */
    private createRowElements(
        row: VisualRow, 
        visualIndex: number, 
        state: EditorState
    ): { code: HTMLElement; gutter: HTMLElement; btn: HTMLElement } {
        const { code, settings, diffs, runLines, errorLines } = state;
        
        if (row.kind === 'real') {
            const lineIndex = row.lineIndex;
            const syntaxNodes = code.getLineNodes(lineIndex);
            
            const lineWrapper = this.lineRenderer.createLineWrapper(lineIndex, syntaxNodes, errorLines, settings, diffs);
            lineWrapper.setAttribute('data-visual-index', visualIndex.toString());
            
            const lineNumberEl = this.lineRenderer.createLineNumber(lineIndex, settings, diffs);
            lineNumberEl.setAttribute('data-visual-index', visualIndex.toString());
            
            const lineButtonEl = this.lineRenderer.createLineButtons(lineIndex, runLines, errorLines, settings);
            lineButtonEl.setAttribute('data-visual-index', visualIndex.toString());
            
            return { code: lineWrapper, gutter: lineNumberEl, btn: lineButtonEl };
        } else {
            const ghostElements = this.diffRenderer.createGhostRowElements(row, settings);
            ghostElements.code.setAttribute('data-visual-index', visualIndex.toString());
            ghostElements.gutter.setAttribute('data-visual-index', visualIndex.toString());
            ghostElements.btn.setAttribute('data-visual-index', visualIndex.toString());
            
            return ghostElements;
        }
    }

    /**
     * Get all rendered elements (excluding spacers)
     */
    private getRenderedElements(): HTMLElement[] {
        return Array.from(this.codeContent.children)
            .filter((child) => !child.classList.contains('spacer')) as HTMLElement[];
    }

    public renderChanges(state: EditorState, search?: Search) {
        console.log("renderChanges");

        const { code, offset, selection, errorLines, settings, diffs } = state;

        // Rebuild visual rows - structure may have changed
        const totalRealLines = code.linesLength();
        const newVisualRows = this.diffEnabled 
            ? this.buildVisualRows(totalRealLines, diffs)
            : this.buildRealOnlyRows(totalRealLines);

        // If visual rows structure changed (different length or diff structure changed), do full render
        if (newVisualRows.length !== this.visualRows.length) {
            this.render(state, search);
            return;
        }

        // Update visualRows
        this.visualRows = newVisualRows;

        const totalVisualRows = this.visualRows.length;
        const { startIndex, endIndex } = this.getVisibleRangeByVisualIndex(totalVisualRows, settings);

        const lines = this.getLines();

        if (lines.length === 0) {
            this.render(state, search);
            return;
        }

        // Get current rendered range
        const renderedElements = this.getRenderedElements();
        if (renderedElements.length === 0) {
            this.render(state, search);
            return;
        }

        const currentStartIndex = parseInt(renderedElements[0].getAttribute('data-visual-index') || '-1', 10);
        const currentEndIndex = parseInt(renderedElements[renderedElements.length - 1].getAttribute('data-visual-index') || '-1', 10) + 1;

        // If viewport changed, do full render
        if (currentStartIndex !== startIndex || currentEndIndex !== endIndex) {
            this.render(state, search);
            return;
        }

        // Update only changed real lines
        for (let i = startIndex; i < endIndex; i++) {
            const row = this.visualRows[i];
            if (row.kind !== 'real') continue;

            const lineIndex = row.lineIndex;
            const nodes = code.getLineNodes(lineIndex);
            const newHash = objectHash(nodes).toString();

            const existingLine = lines.find(line => line.lineNumber === lineIndex);

            if (existingLine) {
                const existingHash = existingLine.hash;
                if (existingHash !== newHash) {
                    const newLineEl = this.lineRenderer.createLineWrapper(lineIndex, nodes, errorLines, settings, diffs);
                    newLineEl.setAttribute('data-visual-index', i.toString());
                    existingLine.replaceWith(newLineEl);

                    // Replace the line number (gutter) to reflect changes
                    const oldGutterLine = this.gutter.querySelector(`.ln[data-line="${lineIndex}"]`) as HTMLElement;
                    if (oldGutterLine) {
                        const newGutterLine = this.lineRenderer.createLineNumber(lineIndex, settings, diffs);
                        newGutterLine.setAttribute('data-visual-index', i.toString());
                        this.gutter.replaceChild(newGutterLine, oldGutterLine);
                    }
                }
            } else {
                // Fallback to full render if line is missing
                this.render(state, search);
                return;
            }
        }

        // Update gutter for all visible lines to ensure diff classes are correct
        if (diffs) {
            for (let i = startIndex; i < endIndex; i++) {
                const row = this.visualRows[i];
                if (row.kind !== 'real') continue;

                const lineIndex = row.lineIndex;
                const oldGutterLine = this.gutter.querySelector(`.ln[data-line="${lineIndex}"]`) as HTMLElement;
                if (oldGutterLine) {
                    const hasDiffClass = oldGutterLine.classList.contains('diff-changed') ||
                        oldGutterLine.classList.contains('diff-added') ||
                        oldGutterLine.classList.contains('diff-deleted');
                    const diffInfo = diffs.get(lineIndex + 1);

                    if (hasDiffClass || diffInfo) {
                        const expectedClass = diffInfo ? this.diffRenderer.getDiffClass(diffInfo.changeType) : '';
                        const hasCorrectClass = expectedClass ? oldGutterLine.classList.contains(expectedClass) : !hasDiffClass;

                        if (!hasCorrectClass) {
                            const newGutterLine = this.lineRenderer.createLineNumber(lineIndex, settings, diffs);
                            newGutterLine.setAttribute('data-visual-index', i.toString());
                            this.gutter.replaceChild(newGutterLine, oldGutterLine);
                        }
                    }
                }
            }
        }

        // Render search highlights
        if (search && search.isActive()) {
            this.searchRenderer.updateSearchHighlights(search);
        }

        // Render cursor or selection
        if (!search || !search.isActive() || !search.isFocused()) {
            if (!selection || selection.isEmpty()) {
                const { line, column } = code.getPosition(offset);
                this.renderCursor(line, column, true);
            } else {
                this.renderSelection(code, selection!);
            }
        }
        
        this.updateMaxWidth(code);
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
        const { code, offset, selection } = state;
        if (!selection || selection.isEmpty()) {
            const { line, column } = code.getPosition(offset);
            this.renderCursor(line, column, focus);
        } else {
            this.renderSelection(code, selection!);
        }
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
            .filter((child) => !child.classList.contains('spacer') && !child.hasAttribute('data-ghost')) as AnycodeLine[];
    }

    public getLine(lineNumber: number): AnycodeLine | null {
        // Iterate through children, skipping spacers and ghost lines
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

    public getStartLine(): AnycodeLine | null {
        const lines = this.getLines();
        return lines.length > 0 ? lines[0] : null;
    }

    public getEndLine(): AnycodeLine | null {
        const lines = this.getLines();
        return lines.length > 0 ? lines[lines.length - 1] : null;
    }

    public focus(state: EditorState, focusLine: number | null = null): boolean {
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

        const bottomPaddingLines = 3;
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

    public focusCenter(state: EditorState): boolean {
        const { code, offset, settings } = state;
        if (!code) return false;

        const { line } = code.getPosition(offset);

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

    public renderErrors(errorLines: Map<number, string>) {
        const lines = this.getLines();
        if (!lines.length) return;

        for (let i = 0; i < lines.length; i++) {
            const lineDiv = lines[i];
            const lineNumber = lineDiv.lineNumber;

            const message = errorLines.get(lineNumber);
            this.lineRenderer.renderDiagnostics(lineDiv, message);
        }
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

    public renderSearch(
        search: Search,
        state: EditorState,
        handlers?: {
            onKeyDown?: (event: KeyboardEvent, input: HTMLTextAreaElement) => void,
            onInputChange?: (value: string) => void,
        }
    ) {
        this.searchRenderer.renderSearch(search, state, handlers);
    }

    public removeSearch() {
        this.searchRenderer.removeSearch();
    }

    public focusSearchInput() {
        this.searchRenderer.focusSearchInput();
    }

    public updateSearchHighlights(search: Search) {
        this.searchRenderer.updateSearchHighlights(search);
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

    public verifyDiffs(diffs: Map<number, DiffInfo>): void {
        this.diffRenderer.verifyDiffs(diffs);
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
        probe.style.whiteSpace = 'pre';
        probe.style.pointerEvents = 'none';

        const computed = window.getComputedStyle(this.codeContent);
        probe.style.fontFamily = computed.fontFamily;
        probe.style.fontSize = computed.fontSize;
        probe.style.fontWeight = computed.fontWeight;
        probe.style.letterSpacing = computed.letterSpacing;

        this.codeContent.appendChild(probe);
        const measured = probe.getBoundingClientRect().width;
        probe.remove();

        this.charWidth = measured > 0 ? measured : 8;
        return this.charWidth;
    }

    private updateMaxWidth(code: Code): void {
        const charW = this.getCharWidth();
        const totalLines = code.linesLength();
        let maxW = 0;

        for (let i = 0; i < totalLines; i++) {
            const width = code.lineLength(i) * charW;
            if (width > maxW) {
                maxW = width;
            }
        }

        this.maxWidth = maxW;
        if (this.maxWidth > 0) {
            this.codeContent.style.minWidth = `${this.maxWidth + 100}px`;
        }
    }
}

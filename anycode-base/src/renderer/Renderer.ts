import { Code, HighlighedNode } from "../code";
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
        this.lineRenderer = new LineRenderer();
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
        console.log("render");

        const { code, offset, selection, runLines, errorLines, settings, diffs } = state;

        const totalLines = code.linesLength();
        const { startLine, endLine } = this.getVisibleRange(totalLines, settings);
        let itemHeight = settings.lineHeight;
        const paddingTop = startLine * itemHeight;
        const paddingBottom = (totalLines - endLine) * itemHeight;

        // build fragments for better performance
        const btnFrag = document.createDocumentFragment();
        const gutterFrag = document.createDocumentFragment();
        const codeFrag = document.createDocumentFragment();

        // top spacers
        btnFrag.appendChild(this.lineRenderer.createSpacer(paddingTop));
        gutterFrag.appendChild(this.lineRenderer.createSpacer(paddingTop));
        codeFrag.appendChild(this.lineRenderer.createSpacer(paddingTop));

        // Track which hunks we've already rendered ghost lines for
        const renderedHunks = new Set<number>();

        for (let i = startLine; i < endLine; i++) {
            // get syntax highlight nodes (cache supported)
            const syntaxNodes: HighlighedNode[] = code.getLineNodes(i);

            // Delegate ghost line rendering to DiffRenderer
            if (diffs && this.diffEnabled) {
                const ghosts = this.diffRenderer.renderGhostsForLine(
                    i, diffs, renderedHunks, settings
                );
                if (ghosts) {
                    for (const ghost of ghosts) {
                        codeFrag.appendChild(ghost.code);
                        gutterFrag.appendChild(ghost.gutter);
                        btnFrag.appendChild(ghost.btn);
                    }
                }
            }

            const lineWrapper = this.lineRenderer.createLineWrapper(i, syntaxNodes, errorLines, settings, diffs);
            const lineNumberEl = this.lineRenderer.createLineNumber(i, settings, diffs);
            const lineButtonEl = this.lineRenderer.createLineButtons(i, runLines, errorLines, settings);

            codeFrag.appendChild(lineWrapper);
            gutterFrag.appendChild(lineNumberEl);
            btnFrag.appendChild(lineButtonEl);
        }

        // bottom spacers
        btnFrag.appendChild(this.lineRenderer.createSpacer(paddingBottom));
        gutterFrag.appendChild(this.lineRenderer.createSpacer(paddingBottom));
        codeFrag.appendChild(this.lineRenderer.createSpacer(paddingBottom));

        // replace old children atomically
        this.buttonsColumn.replaceChildren(btnFrag);
        this.gutter.replaceChildren(gutterFrag);
        this.codeContent.replaceChildren(codeFrag);

        // render cursor or selection
        if (!search || !search.isActive() || !search.isFocused()) {
            if (!selection || selection.isEmpty()) {
                const { line, column } = code.getPosition(offset);
                this.renderCursor(line, column, false);
            } else {
                this.renderSelection(code, selection!);
            }
        }

        // render search highlights
        if (search && search.isActive()) {
            this.searchRenderer.updateSearchHighlights(search);
        }
    }

    public renderScroll(state: EditorState, search?: Search) {
        // console.log("renderScroll");

        const { code, offset, selection, settings, diffs } = state;
        const totalLines = code.linesLength();
        const lineHeight = settings.lineHeight;
        const buffer = settings.buffer;
        const { startLine, endLine } = this.getVisibleRange(totalLines, settings);

        this.ensureSpacers(this.codeContent);
        this.ensureSpacers(this.gutter);
        this.ensureSpacers(this.buttonsColumn);

        const topSpacer = this.codeContent.firstChild as HTMLElement;
        const bottomSpacer = this.codeContent.lastChild as HTMLElement;

        const gutterTopSpacer = this.gutter.firstChild as HTMLElement;
        const gutterBottomSpacer = this.gutter.lastChild as HTMLElement;

        const btnTopSpacer = this.buttonsColumn.firstChild as HTMLElement;
        const btnBottomSpacer = this.buttonsColumn.lastChild as HTMLElement;

        // Find first and last real lines (skip spacers and ghost lines)
        const realLines = this.getLines();
        let currentStartLine = realLines.length > 0 ? realLines[0].lineNumber : -1;
        let currentEndLine = realLines.length > 0 ? realLines[realLines.length - 1].lineNumber + 1 : -1; // exclusive

        let changed = false;

        const needFullRerender =
            currentStartLine === -1 ||
            startLine >= currentEndLine ||
            endLine <= currentStartLine ||
            Math.abs(startLine - currentStartLine) > buffer * 2 ||
            Math.abs(endLine - currentEndLine) > buffer * 2;

        if (needFullRerender) {
            this.render(state, search);
            return;
        }

        // delete rows above - remove elements until we reach the target line
        while (currentStartLine < startLine && this.codeContent.children.length > 2) {
            const child = this.codeContent.children[1];

            // Always remove matching elements from all three columns
            this.codeContent.removeChild(child);
            if (this.gutter.children[1]) {
                this.gutter.removeChild(this.gutter.children[1]);
            }
            if (this.buttonsColumn.children[1]) {
                this.buttonsColumn.removeChild(this.buttonsColumn.children[1]);
            }

            // Only increment currentStartLine if we removed a real line (not ghost)
            if (!child.hasAttribute('data-ghost')) {
                currentStartLine++;
            }
            changed = true;
        }

        // delete rows below - similar logic
        while (currentEndLine > endLine && this.codeContent.children.length > 2) {
            const index = this.codeContent.children.length - 2;
            const child = this.codeContent.children[index];

            this.codeContent.removeChild(child);
            if (this.gutter.children[index]) {
                this.gutter.removeChild(this.gutter.children[index]);
            }
            if (this.buttonsColumn.children[index]) {
                this.buttonsColumn.removeChild(this.buttonsColumn.children[index]);
            }

            // Only decrement currentEndLine if we removed a real line (not ghost)
            if (!child.hasAttribute('data-ghost')) {
                currentEndLine--;
            }
            changed = true;
        }


        // add roes above 
        while (currentStartLine > startLine) {
            currentStartLine--;
            const nodes = code.getLineNodes(currentStartLine);
            const lineEl = this.lineRenderer.createLineWrapper(currentStartLine, nodes, state.errorLines, settings, diffs);

            this.container.appendChild(lineEl);
            this.container.removeChild(lineEl);

            this.codeContent.insertBefore(lineEl, this.codeContent.children[1]);
            this.gutter.insertBefore(this.lineRenderer.createLineNumber(currentStartLine, settings, diffs), this.gutter.children[1]);
            this.buttonsColumn.insertBefore(
                this.lineRenderer.createLineButtons(currentStartLine, state.runLines, state.errorLines, settings),
                this.buttonsColumn.children[1]
            );

            changed = true;
        }

        // add rows below
        while (currentEndLine < endLine) {
            const nodes = code.getLineNodes(currentEndLine);
            const lineEl = this.lineRenderer.createLineWrapper(currentEndLine, nodes, state.errorLines, settings, diffs);

            this.container.appendChild(lineEl);
            this.container.removeChild(lineEl);

            this.codeContent.insertBefore(lineEl, bottomSpacer);
            this.gutter.insertBefore(this.lineRenderer.createLineNumber(currentEndLine, settings, diffs), gutterBottomSpacer);
            this.buttonsColumn.insertBefore(
                this.lineRenderer.createLineButtons(currentEndLine, state.runLines, state.errorLines, settings),
                btnBottomSpacer
            );

            currentEndLine++;
            changed = true;
        }

        // render cursor or selection
        if (!search || !search.isActive() || !search.isFocused()) {
            if (!selection || selection.isEmpty()) {
                const { line, column } = code.getPosition(offset);
                this.renderCursor(line, column, false);
            } else {
                this.renderSelection(code, selection!);
            }
        }

        // render search highlights
        if (search && search.isActive()) {
            this.searchRenderer.updateSearchHighlights(search);
        }

        if (!changed) return;

        // update spacers
        const topHeight = Math.round(startLine * lineHeight);
        const bottomHeight = Math.round(Math.max(0, (totalLines - endLine) * lineHeight));

        topSpacer.style.height = `${topHeight}px`;
        bottomSpacer.style.height = `${bottomHeight}px`;

        gutterTopSpacer.style.height = `${topHeight}px`;
        gutterBottomSpacer.style.height = `${bottomHeight}px`;

        btnTopSpacer.style.height = `${topHeight}px`;
        btnBottomSpacer.style.height = `${bottomHeight}px`;

        // Update ghost lines after scroll if diff mode is enabled
        if (this.diffEnabled && diffs && diffs.size > 0) {
            const lines = this.getLines();
            this.diffRenderer.syncVisibleGhosts(startLine, endLine, diffs, settings, lines);
        }
    }

    public renderChanges(state: EditorState, search?: Search) {
        console.log("renderChanges");
        // console.time('updateChanges');

        const { code, offset, selection, errorLines, settings, diffs } = state;

        const totalLines = code.linesLength();
        const { startLine, endLine } = this.getVisibleRange(totalLines, settings);

        const lines = this.getLines();

        if (lines.length === 0) {
            this.render(state, search);
            // console.timeEnd('updateChanges');
            return;
        }

        const oldStartLine = lines[0].lineNumber;
        const oldEndLine = lines[lines.length - 1].lineNumber + 1;

        if (oldStartLine !== startLine || oldEndLine !== endLine) {
            // Full render if viewport changed
            this.render(state, search);
            // console.timeEnd('updateChanges');
            return;
        }

        // Update only changed lines
        for (let i = startLine; i < endLine; i++) {
            const nodes = code.getLineNodes(i);
            const newHash = objectHash(nodes).toString();

            const existingLine = lines.find(line => line.lineNumber === i);

            if (existingLine) {
                const existingHash = existingLine.hash;
                if (existingHash !== newHash) {
                    const newLineEl = this.lineRenderer.createLineWrapper(i, nodes, errorLines, settings, diffs);
                    existingLine.replaceWith(newLineEl);

                    // Replace the line number (gutter) to reflect changes
                    // Find the gutter element by data-line attribute (not by index, due to ghost lines)
                    const oldGutterLine = this.gutter.querySelector(`.ln[data-line="${i}"]`) as HTMLElement;
                    if (oldGutterLine) {
                        const newGutterLine = this.lineRenderer.createLineNumber(i, settings, diffs);
                        this.gutter.replaceChild(newGutterLine, oldGutterLine);
                    }
                }
            } else {
                // Fallback to full render if line is missing
                this.render(state, search);
                console.timeEnd('updateChanges');
                return;
            }
        }

        // Update gutter for all visible lines to ensure diff classes are correct
        // (even if line content hash didn't change, diffInfo might have changed)
        if (diffs) {
            for (let i = startLine; i < endLine; i++) {
                const oldGutterLine = this.gutter.querySelector(`.ln[data-line="${i}"]`) as HTMLElement;
                if (oldGutterLine) {
                    const hasDiffClass = oldGutterLine.classList.contains('diff-changed') ||
                        oldGutterLine.classList.contains('diff-added') ||
                        oldGutterLine.classList.contains('diff-deleted');
                    const diffInfo = diffs.get(i + 1);

                    // Only update if the diff state changed
                    if (hasDiffClass || diffInfo) {
                        const expectedClass = diffInfo ? this.diffRenderer.getDiffClass(diffInfo.changeType) : '';
                        const hasCorrectClass = expectedClass ? oldGutterLine.classList.contains(expectedClass) : !hasDiffClass;

                        if (!hasCorrectClass) {
                            const newGutterLine = this.lineRenderer.createLineNumber(i, settings, diffs);
                            this.gutter.replaceChild(newGutterLine, oldGutterLine);
                        }
                    }
                }
            }
        }

        // Update ghost lines if diff mode is enabled
        if (this.diffEnabled && diffs && diffs.size > 0) {
            const lines = this.getLines();
            this.diffRenderer.syncVisibleGhosts(startLine, endLine, diffs, settings, lines);
        }

        // render search highlights
        if (search && search.isActive()) {
            this.searchRenderer.updateSearchHighlights(search);
        }

        // render cursor or selection
        if (!search || !search.isActive() || !search.isFocused()) {
            if (!selection || selection.isEmpty()) {
                const { line, column } = code.getPosition(offset);
                this.renderCursor(line, column, true);
            } else {
                this.renderSelection(code, selection!);
            }
        }

        // console.timeEnd('updateChanges');
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

    private getVisibleRange(totalLines: number, settings: EditorSettings) {
        const scrollTop = this.container.scrollTop;
        const viewHeight = this.container.clientHeight;

        let visibleBuffer = settings.buffer;
        let itemHeight = settings.lineHeight;

        // Fallback for cases when container doesn't have sizes (first render)
        let visibleCount: number;
        if (viewHeight > 0) {
            visibleCount = Math.ceil(viewHeight / itemHeight);
        } else {
            const parentHeight = this.container.parentElement?.clientHeight || 0;
            const fallbackHeight = parentHeight > 0 ? parentHeight : window.innerHeight;
            visibleCount = Math.min(Math.floor(fallbackHeight / itemHeight), totalLines);
        }

        const startLine = Math.max(0, Math.floor(scrollTop / itemHeight) - visibleBuffer);
        const endLine = Math.min(totalLines, startLine + visibleCount + visibleBuffer * 2);

        return { startLine, endLine };
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

        const cursorTop = line * settings.lineHeight;
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

        const cursorTop = line * settings.lineHeight;
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

            if (errorLines.has(lineNumber)) {
                const dm = errorLines.get(lineNumber)!;
                // Only update attribute if value is different or missing
                if (lineDiv.getAttribute('data-error') !== dm) {
                    lineDiv.setAttribute('data-error', dm);
                    lineDiv.classList.add('has-error');
                }
            } else {
                // Only remove attribute if it exists
                if (lineDiv.hasAttribute('data-error')) {
                    lineDiv.removeAttribute('data-error');
                    lineDiv.classList.remove('has-error');
                }
            }
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
}

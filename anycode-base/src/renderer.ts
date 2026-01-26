import { Code, HighlighedNode } from "./code";
import { AnycodeLine, objectHash, minimize, findNodeAndOffset, findPrevWord } from "./utils";
import { moveCursor, removeCursor } from "./cursor";
import { EditorState, EditorSettings } from "./editor";
import { ChangeType, DiffInfo } from "./diff";
import {
    Selection, getSelection,
    setSelectionFromOffsets as renderSelection,
} from "./selection";
import { Completion, completionKindMap } from "./lsp";

import { Search, SearchMatch } from "./search";

export class Renderer {
    private container: HTMLDivElement;
    private buttonsColumn: HTMLDivElement;
    private gutter: HTMLDivElement;
    private codeContent: HTMLDivElement;
    private maxLineWidth = 0;
    private completionContainer: HTMLDivElement | null = null;
    private searchContainer: HTMLDivElement | null = null;
    private searchMatchLabel: HTMLDivElement | null = null;

    private diffEnabled: boolean = false;

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
    }

    public setDiffEnabled(enabled: boolean) {
        this.diffEnabled = enabled;
    }

    public render(state: EditorState, search?: Search) {
        console.log("render");

        const { code, offset, selection, runLines, errorLines, settings, diffResult } = state;

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
        btnFrag.appendChild(this.createSpacer(paddingTop));
        gutterFrag.appendChild(this.createSpacer(paddingTop));
        codeFrag.appendChild(this.createSpacer(paddingTop));

        // Track which hunks we've already rendered ghost lines for
        const renderedHunks = new Set<number>();

        for (let i = startLine; i < endLine; i++) {
            // get syntax highlight nodes (cache supported)
            const syntaxNodes: HighlighedNode[] = code.getLineNodes(i);

            // Delegate ghost line rendering to DiffRenderer
            if (diffResult && this.diffEnabled) {
                const ghosts = this.renderGhostsForLine(
                    i, diffResult, renderedHunks, settings
                );
                if (ghosts) {
                    for (const ghost of ghosts) {
                        codeFrag.appendChild(ghost.code);
                        gutterFrag.appendChild(ghost.gutter);
                        btnFrag.appendChild(ghost.btn);
                    }
                }
            }

            const lineWrapper = this.createLineWrapper(i, syntaxNodes, errorLines, settings, diffResult);
            const lineNumberEl = this.createLineNumber(i, settings, diffResult);
            const lineButtonEl = this.createLineButtons(i, runLines, errorLines, settings);

            codeFrag.appendChild(lineWrapper);
            gutterFrag.appendChild(lineNumberEl);
            btnFrag.appendChild(lineButtonEl);
        }

        // bottom spacers
        btnFrag.appendChild(this.createSpacer(paddingBottom));
        gutterFrag.appendChild(this.createSpacer(paddingBottom));
        codeFrag.appendChild(this.createSpacer(paddingBottom));

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
            this.updateSearchHighlights(search);
        }
    }

    public renderScroll(state: EditorState, search?: Search) {
        // console.log("renderScroll");

        const { code, offset, selection, settings, diffResult } = state;
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
            const lineEl = this.createLineWrapper(currentStartLine, nodes, state.errorLines, settings, diffResult);

            this.container.appendChild(lineEl);
            this.container.removeChild(lineEl);

            this.codeContent.insertBefore(lineEl, this.codeContent.children[1]);
            this.gutter.insertBefore(this.createLineNumber(currentStartLine, settings, diffResult), this.gutter.children[1]);
            this.buttonsColumn.insertBefore(
                this.createLineButtons(currentStartLine, state.runLines, state.errorLines, settings),
                this.buttonsColumn.children[1]
            );

            changed = true;
        }

        // add rows below
        while (currentEndLine < endLine) {
            const nodes = code.getLineNodes(currentEndLine);
            const lineEl = this.createLineWrapper(currentEndLine, nodes, state.errorLines, settings, diffResult);

            this.container.appendChild(lineEl);
            this.container.removeChild(lineEl);

            this.codeContent.insertBefore(lineEl, bottomSpacer);
            this.gutter.insertBefore(this.createLineNumber(currentEndLine, settings, diffResult), gutterBottomSpacer);
            this.buttonsColumn.insertBefore(
                this.createLineButtons(currentEndLine, state.runLines, state.errorLines, settings),
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
            this.updateSearchHighlights(search);
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
        if (this.diffEnabled && diffResult && diffResult.size > 0) {
            const lines = this.getLines();
            this.syncVisibleGhosts(startLine, endLine, diffResult, settings, lines);
        }
    }

    public renderChanges(state: EditorState, search?: Search) {
        console.log("renderChanges");
        // console.time('updateChanges');

        const { code, offset, selection, errorLines, settings, diffResult } = state;

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
                    const newLineEl = this.createLineWrapper(i, nodes, errorLines, settings, diffResult);
                    existingLine.replaceWith(newLineEl);

                    // Replace the line number (gutter) to reflect changes
                    // Find the gutter element by data-line attribute (not by index, due to ghost lines)
                    const oldGutterLine = this.gutter.querySelector(`.ln[data-line="${i}"]`) as HTMLElement;
                    if (oldGutterLine) {
                        const newGutterLine = this.createLineNumber(i, settings, diffResult);
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
        if (diffResult) {
            for (let i = startLine; i < endLine; i++) {
                const oldGutterLine = this.gutter.querySelector(`.ln[data-line="${i}"]`) as HTMLElement;
                if (oldGutterLine) {
                    const hasDiffClass = oldGutterLine.classList.contains('diff-changed') ||
                        oldGutterLine.classList.contains('diff-added') ||
                        oldGutterLine.classList.contains('diff-deleted');
                    const diffInfo = diffResult.get(i + 1);

                    // Only update if the diff state changed
                    if (hasDiffClass || diffInfo) {
                        const expectedClass = diffInfo ? this.getDiffClass(diffInfo.changeType) : '';
                        const hasCorrectClass = expectedClass ? oldGutterLine.classList.contains(expectedClass) : !hasDiffClass;

                        if (!hasCorrectClass) {
                            const newGutterLine = this.createLineNumber(i, settings, diffResult);
                            this.gutter.replaceChild(newGutterLine, oldGutterLine);
                        }
                    }
                }
            }
        }

        // Update ghost lines if diff mode is enabled
        if (this.diffEnabled && diffResult && diffResult.size > 0) {
            const lines = this.getLines();
            this.syncVisibleGhosts(startLine, endLine, diffResult, settings, lines);
        }

        // render search highlights
        if (search && search.isActive()) {
            this.updateSearchHighlights(search);
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
            container.insertBefore(this.createSpacer(0), container.firstChild);
        }

        if (!last || !last.classList?.contains('spacer')) {
            container.appendChild(this.createSpacer(0));
        }
    }

    private createSpacer(height: number): HTMLDivElement {
        const spacer = document.createElement('div');
        spacer.className = "spacer";
        spacer.style.height = `${height}px`;
        return spacer;
    }

    private createLineNumber(lineNumber: number, settings: EditorSettings, diffResult?: Map<number, DiffInfo>): HTMLDivElement {
        const div = document.createElement('div');
        div.className = "ln";
        div.textContent = (lineNumber + 1).toString();
        div.style.height = `${settings.lineHeight}px`;
        div.setAttribute('data-line', lineNumber.toString());

        if (diffResult) {
            const diffInfo = diffResult.get(lineNumber + 1);
            if (diffInfo?.changeType === 'modified') {
                div.classList.add('diff-changed');
            } else if (diffInfo?.changeType === 'added') {
                div.classList.add('diff-added');
            } else if (diffInfo?.changeType === 'deleted') {
                div.classList.add('diff-deleted');
            }
        }

        return div;
    }


    private createLineButtons(
        lineNumber: number,
        runLines: number[],
        errorLines: Map<number, string>,
        settings: EditorSettings
    ): HTMLDivElement {
        const div = document.createElement('div');
        div.className = "bt";
        div.style.height = `${settings.lineHeight}px`;
        div.setAttribute('data-line', lineNumber.toString());

        const isRun = runLines.includes(lineNumber);
        // const hasError = errorLines.has(lineNumber);

        if (isRun) {
            div.textContent = '▶';
            div.title = `Run line ${lineNumber + 1}`;
            div.style.color = '#888';
            div.style.fontSize = '20px';
            div.style.cursor = 'pointer';
            div.onclick = () => {
                console.log(`Run line ${lineNumber + 1}`);
            };
        }

        return div;
    }



    private createLineWrapper(
        lineNumber: number,
        nodes: HighlighedNode[],
        errorLines: Map<number, string>,
        settings: EditorSettings,
        diffResult?: Map<number, DiffInfo>
    ): AnycodeLine {
        const wrapper = document.createElement('div') as AnycodeLine;

        wrapper.lineNumber = lineNumber;
        wrapper.className = "line";
        wrapper.style.lineHeight = `${settings.lineHeight}px`;

        // Add hash for change tracking
        const hash = objectHash(nodes).toString();
        wrapper.hash = hash;

        // Check if this line was changed in diff mode
        if (diffResult) {
            const diffInfo = diffResult.get(lineNumber + 1);
            if (diffInfo?.changeType === 'modified') {
                wrapper.classList.add('diff-changed');
            } else if (diffInfo?.changeType === 'added') {
                wrapper.classList.add('diff-added');
            }
        }

        if (nodes.length === 0 || (nodes.length === 1 && nodes[0].text === "\u200B")) {
            wrapper.appendChild(document.createElement('br'));
        } else {
            for (const { name, text } of nodes) {
                const span = document.createElement('span');
                if (name) span.className = name;
                if (!name && text === '\t') span.className = 'indent';
                span.textContent = text;
                wrapper.appendChild(span);
            }
        }

        const errorMessage = errorLines.get(lineNumber);
        if (errorMessage) {
            let smallError = minimize(errorMessage);
            wrapper.classList.add('has-error');
            wrapper.setAttribute('data-error', smallError);
        }



        return wrapper;
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

    public focusSearchInput() {
        if (this.searchContainer) {
            const inputField = this.searchContainer.querySelector('.search-input') as HTMLTextAreaElement;
            if (inputField) {
                inputField.focus();
            }
        }
    }

    public renderCompletion(
        completions: Completion[], selectedIndex: number, code: Code, offset: number,
        onCompletionClick: (index: number) => void
    ) {
        if (!this.completionContainer) {
            this.completionContainer = document.createElement('div');
            this.completionContainer.className = 'completion-box glass';
            this.container!.appendChild(this.completionContainer);
            this.moveCompletion(code, offset);
        }

        const fragment = document.createDocumentFragment();

        completions.forEach((completion, i) => {
            const completionDiv = document.createElement('div');
            completionDiv.className = 'completion-item';
            completionDiv.textContent = completion.label;

            if (completion.kind) {
                const kindText = document.createElement('span');
                kindText.className = 'completion-kind';
                kindText.textContent = completionKindMap[completion.kind] || 'Unknown';
                completionDiv.appendChild(kindText);
            }

            completionDiv.addEventListener('click', e => {
                e.preventDefault();
                onCompletionClick(i);
            });

            if (i === selectedIndex) completionDiv.classList.add('completion-active');
            fragment.appendChild(completionDiv);
        });

        this.completionContainer.replaceChildren(fragment);
        this.moveCompletion(code, offset);
    }

    public moveCompletion(code: Code, offset: number) {
        let { line, column } = code.getPosition(offset);

        let lineStr = code.line(line);
        let prev = findPrevWord(lineStr, column)

        var completion = this.completionContainer;

        const startLineDiv = this.getLine(line);
        const startPos = findNodeAndOffset(startLineDiv!, prev + 1);

        if (startPos) {
            // move completion to previous word position around cursor
            const { node, offset } = startPos;

            const calculateBoundingRect = (textNode: any) => {
                const range = document.createRange();
                range.selectNode(textNode);
                return range.getBoundingClientRect();
            };

            const startRect = calculateBoundingRect(node);
            const paddingLeft = parseInt(getComputedStyle(completion!).paddingLeft || "10");
            const containerRect = this.container.getBoundingClientRect();
            const left = startRect.left - containerRect.left + this.container.scrollLeft - paddingLeft * 2;
            const top = startRect.bottom - containerRect.top + this.container.scrollTop + 1;

            if (completion && completion.style) {
                completion.style.left = left + "px";
                completion.style.top = top + "px";
            }
        } else {
            // move completion under cursor position
            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) return;
            const range = sel.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            const containerRect = this.container.getBoundingClientRect();
            const top = rect.bottom - containerRect.top + this.container.scrollTop;
            const left = rect.left - containerRect.left + this.container.scrollLeft;
            this.completionContainer!.style.position = 'absolute';
            this.completionContainer!.style.top = `${top}px`;
            this.completionContainer!.style.left = `${left}px`;
        }
    }

    public closeCompletion() {
        this.completionContainer?.remove();
        this.completionContainer = null;
    }

    public isCompletionOpen() {
        return this.completionContainer !== null;
    }

    public highlightCompletion(index: number) {
        if (!this.completionContainer) return;
        const children = this.completionContainer.children;
        for (let i = 0; i < children.length; i++) {
            const el = children[i] as HTMLElement;
            el.classList.toggle('completion-active', i === index);
            if (i === index) el.scrollIntoView({ block: 'nearest' });
        }
    }

    renderHighlights(
        lineDiv: AnycodeLine,
        startColumn: number,
        endColumn: number,
        selected: boolean
    ) {
        const spans = Array.from(lineDiv.querySelectorAll('span'));
        let charCount = 0;

        for (let span of spans) {
            if (!span.textContent) continue;

            const textLength = span.textContent.length;

            // Check if the current span is fully within the range
            if (charCount + textLength <= startColumn || charCount >= endColumn) {
                charCount += textLength; // Skip spans outside the range
                continue;
            }

            if (charCount >= startColumn && charCount + textLength <= endColumn) {
                // Fully matched span
                if (!span.classList.contains('highlight'))
                    span.classList.add('highlight');
                if (selected && !span.classList.contains('selected'))
                    span.classList.add('selected');
            } else {
                // Partially matched span
                const startOffset = Math.max(0, startColumn - charCount);
                const endOffset = Math.min(textLength, endColumn - charCount);

                const beforeText = span.textContent.slice(0, startOffset);
                const highlightedText = span.textContent.slice(startOffset, endOffset);
                const afterText = span.textContent.slice(endOffset);

                const fragment = document.createDocumentFragment();

                if (beforeText) {
                    const beforeSpan = span.cloneNode(false);
                    beforeSpan.textContent = beforeText;
                    fragment.appendChild(beforeSpan);
                }

                if (highlightedText) {
                    const highlightSpan = span.cloneNode(false) as HTMLElement;
                    if (!highlightSpan.classList.contains('highlight'))
                        highlightSpan.classList.add('highlight');
                    if (selected && !highlightSpan.classList.contains('selected'))
                        highlightSpan.classList.add('selected');
                    highlightSpan.textContent = highlightedText;
                    fragment.appendChild(highlightSpan);
                }

                if (afterText) {
                    const afterSpan = span.cloneNode(false);
                    afterSpan.textContent = afterText;
                    fragment.appendChild(afterSpan);
                }

                span.replaceWith(fragment);
            }

            charCount += textLength;
        }
    }

    public removeAllHighlights(search: Search) {
        const pattern = search.getPattern();
        const patternLines = pattern.split(/\r?\n/);
        const isMultiline = patternLines.length > 1;
        const matches = search.getMatches();

        for (let index = 0; index < matches.length; index++) {
            const m = matches[index];

            if (!isMultiline) {
                // Single-line: remove highlight from first line only
                let line = this.getLine(m.line);
                if (line) {
                    this.removeHighlights(line);
                }
            } else {
                // Multiline: remove highlights from all lines of the pattern
                const firstLine = this.getLine(m.line);
                if (firstLine) {
                    this.removeHighlights(firstLine);
                }

                // Remove highlights from intermediate and last lines
                for (let j = 1; j < patternLines.length; j++) {
                    const lineIndex = m.line + j;
                    const line = this.getLine(lineIndex);
                    if (line) {
                        this.removeHighlights(line);
                    }
                }
            }
        }
    }

    public removeSelectedHighlight(search: Search) {
        const pattern = search.getPattern();
        const patternLines = pattern.split(/\r?\n/);
        const isMultiline = patternLines.length > 1;
        const matches = search.getMatches();
        const selectedIndex = search.getSelected();

        // Only remove the highlight from the currently selected match
        if (selectedIndex >= 0 && selectedIndex < matches.length) {
            const match = matches[selectedIndex];

            if (!isMultiline) {
                // Single-line: remove .selected class from first line only
                let line = this.getLine(match.line);
                if (line) {
                    // Only remove the .selected class, leave .highlight in place
                    this.removeHighlights(line, true);
                }
            } else {
                // Multiline: remove .selected class from all lines of the pattern
                const firstLine = this.getLine(match.line);
                if (firstLine) {
                    this.removeHighlights(firstLine, true);
                }

                // Remove .selected class from intermediate and last lines
                for (let j = 1; j < patternLines.length; j++) {
                    const lineIndex = match.line + j;
                    const line = this.getLine(lineIndex);
                    if (line) {
                        this.removeHighlights(line, true);
                    }
                }
            }
        }
    }

    private removeHighlights(lineDiv: AnycodeLine, selectedOnly: boolean = false) {
        const highlightedSpans = Array.from(lineDiv.querySelectorAll('span.highlight, span.selected'));

        for (const span of highlightedSpans) {
            span.classList.remove('highlight');
            if (selectedOnly) span.classList.remove('selected');
            else span.classList.remove('highlight', 'selected');
        }

        // After removing highlight classes, merge adjacent spans with the same class list
        let i = 0;
        while (i < lineDiv.childNodes.length - 1) {
            const current = lineDiv.childNodes[i] as ChildNode;
            const next = lineDiv.childNodes[i + 1] as ChildNode;

            if (
                current.nodeType === Node.ELEMENT_NODE &&
                next.nodeType === Node.ELEMENT_NODE
            ) {
                const currentEl = current as HTMLElement;
                const nextEl = next as HTMLElement;
                if (
                    currentEl.tagName === 'SPAN' &&
                    nextEl.tagName === 'SPAN' &&
                    currentEl.className === nextEl.className
                ) {
                    // Concatenate text and remove the next span
                    currentEl.textContent = (currentEl.textContent || '') + (nextEl.textContent || '');
                    lineDiv.removeChild(nextEl);
                    continue;
                }
            }
            i++;
        }
    }

    public removeSearch() {
        let searchContainer = document.querySelector('.search');
        if (searchContainer) searchContainer.remove();
        this.searchMatchLabel = null;
    }

    public updateSearchHighlights(search: Search) {
        const pattern = search.getPattern();
        const matches = search.getMatches();
        const selected = search.getSelected();
        const patternLines = pattern.split(/\r?\n/);
        const isMultiline = patternLines.length > 1;

        if (!pattern) {
            this.updateSearchLabel('');
        } else if (matches.length === 0) {
            this.updateSearchLabel('No matches');
        } else {
            this.updateSearchLabel(`Match ${selected + 1} of ${matches.length}`);
        }

        for (let i = 0; i < matches.length; i++) {
            const match = matches[i];
            const isSelected = i === selected;

            if (!isMultiline) {
                // Single-line search
                let line = this.getLine(match.line);
                if (!line) continue;

                this.renderHighlights(line, match.column, match.column + pattern.length, isSelected);
            } else {
                // Multiline search
                const firstLinePattern = patternLines[0];
                const remainingLines = patternLines.slice(1);

                // Highlight first line (from match.column to end of first pattern line)
                let firstLineDiv = this.getLine(match.line);
                if (firstLineDiv) {
                    const firstLineEnd = match.column + firstLinePattern.length;
                    this.renderHighlights(firstLineDiv, match.column, firstLineEnd, isSelected);
                }

                // Highlight intermediate lines (full line match)
                for (let j = 0; j < remainingLines.length - 1; j++) {
                    const lineIndex = match.line + j + 1;
                    let lineDiv = this.getLine(lineIndex);
                    if (!lineDiv) continue;

                    // Use pattern line length since matches correspond to text
                    const lineLength = patternLines[j + 1].length;
                    this.renderHighlights(lineDiv, 0, lineLength, isSelected);
                }

                // Highlight last line (from start to end of last pattern line)
                if (remainingLines.length > 0) {
                    const lastLineIndex = match.line + remainingLines.length;
                    let lastLineDiv = this.getLine(lastLineIndex);
                    if (lastLineDiv) {
                        const lastLinePattern = remainingLines[remainingLines.length - 1];
                        const lastLineEnd = lastLinePattern.length;
                        this.renderHighlights(lastLineDiv, 0, lastLineEnd, isSelected);
                    }
                }
            }
        }
    }

    public renderSearch(
        search: Search,
        state: EditorState,
        handlers?: {
            onKeyDown?: (event: KeyboardEvent, input: HTMLTextAreaElement) => void,
            onInputChange?: (value: string) => void,
        }
    ) {
        if (this.searchContainer) {
            this.removeAllHighlights(search);
            this.searchContainer.remove();
            this.searchMatchLabel = null;
            // return;
        }

        // Create a container for the search UI
        this.searchContainer = document.createElement('div');
        this.searchContainer.className = 'search';
        this.searchContainer.style.display = 'flex';
        this.searchContainer.style.flexDirection = 'column';
        this.searchContainer.style.position = 'fixed';

        // Create a search textarea field for multiline search (full width)
        const inputField = document.createElement('textarea');
        inputField.className = 'search-input';
        inputField.placeholder = 'Search';
        inputField.value = search.getPattern();
        inputField.rows = 1;

        inputField.addEventListener('focus', () => {
            console.log('[Search] input field focused');
            search.setFocused(true);
        });

        inputField.addEventListener('blur', () => {
            console.log('[Search] input field blurred');
            search.setFocused(false);
        });

        // Create close button
        const closeButton = document.createElement('button');
        closeButton.className = 'search-close-button';
        closeButton.innerHTML = '&times;'; // × symbol
        closeButton.title = 'Close search';

        // Add click handler for close button
        closeButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (handlers && handlers.onKeyDown) {
                let esc = { key: 'Escape', bubbles: true, cancelable: true };
                handlers.onKeyDown(new KeyboardEvent('keydown', esc), inputField as HTMLTextAreaElement);
            } else {
                this.removeAllHighlights(search);
                this.removeSearch();
                search.clear();
            }
        });

        // Create a label to display match information
        const matchLabel = document.createElement('div');
        matchLabel.className = 'search-label';
        matchLabel.textContent = '';
        matchLabel.style.userSelect = 'none';
        matchLabel.style.pointerEvents = 'none';

        // Create previous button
        const prevButton = document.createElement('button');
        prevButton.className = 'search-button';
        prevButton.innerHTML = '&#8593;'; // Up arrow
        prevButton.title = 'Previous match';

        // Create next button
        const nextButton = document.createElement('button');
        nextButton.className = 'search-button';
        nextButton.innerHTML = '&#8595;'; // Down arrow
        nextButton.title = 'Next match';

        // Add click handlers for buttons
        prevButton.addEventListener('click', () => {
            let matches = search.getMatches();
            if (matches.length === 0) return;
            this.removeSelectedHighlight(search);
            search.selectPrev();
            this.focus(state, search.getSelectedMatch()?.line);
            this.updateSearchHighlights(search);
            search.setNeedsFocus(true);
            this.focusSearchInput();
        });

        nextButton.addEventListener('click', () => {
            let matches = search.getMatches();
            if (matches.length === 0) return;
            this.removeSelectedHighlight(search);
            search.selectNext();
            this.focus(state, search.getSelectedMatch()?.line);
            this.updateSearchHighlights(search);
            search.setNeedsFocus(true);
            this.focusSearchInput();
        });

        // Create controls row
        const controlsRow = document.createElement('div');
        controlsRow.style.display = 'flex';
        controlsRow.style.alignItems = 'center';
        controlsRow.style.justifyContent = 'space-between';

        // Left side: close button and up and down buttons
        const leftControls = document.createElement('div');
        leftControls.style.display = 'flex';
        leftControls.style.alignItems = 'center';
        leftControls.appendChild(prevButton);
        leftControls.appendChild(nextButton);
        leftControls.appendChild(closeButton);

        controlsRow.appendChild(matchLabel);
        controlsRow.appendChild(leftControls);

        this.searchMatchLabel = matchLabel;

        // Wire input and keyboard handlers
        if (handlers && handlers.onKeyDown) {
            inputField.addEventListener('keydown', (e) =>
                handlers!.onKeyDown!(e, inputField as HTMLTextAreaElement));
        }

        if (handlers && handlers.onInputChange) {
            inputField.addEventListener('input', (e) => {
                inputField.style.height = 'auto';
                const newHeight = Math.min(inputField.scrollHeight, 200);
                inputField.style.height = `${newHeight}px`;
                handlers!.onInputChange!(inputField.value);
            });
            inputField.addEventListener('beforeinput', (e) => e.stopPropagation());
        }

        // Initial height adjustment
        // inputField.style.height = 'auto';
        // const initialHeight = Math.min(inputField.scrollHeight, 200);
        // inputField.style.height = `${initialHeight}px`;

        // Add textarea and controls row to container
        this.searchContainer.appendChild(inputField);
        this.searchContainer.appendChild(controlsRow);
        this.container!.appendChild(this.searchContainer);

        inputField.focus();

        this.updateSearchHighlights(search);
    }

    public updateSearchLabel(text: string) {
        if (!this.searchMatchLabel) return;
        if (this.searchMatchLabel.textContent !== text) {
            this.searchMatchLabel.textContent = text;
        }
    }

    public verifyDiffRendering(diffResult: Map<number, DiffInfo>): void {
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

    // ========== Diff / Ghost Lines Methods ==========

    private renderGhostsForLine(
        lineIndex: number,
        diffResult: Map<number, DiffInfo>,
        renderedHunks: Set<number>,
        settings: EditorSettings
    ): GhostLine[] | null {
        const diffInfo = diffResult.get(lineIndex + 1);
        if (diffInfo?.changeType === 'modified' && diffInfo.oldLines && diffInfo.oldLines.length > 0) {
            const hunkId = diffInfo.hunkId;

            // Check if this is the first line in the hunk within the visible range
            // And we haven't rendered this hunk yet
            if (!renderedHunks.has(hunkId)) {
                renderedHunks.add(hunkId);

                const lines: GhostLine[] = [];

                // Add ghost lines for deleted content
                for (const oldLine of diffInfo.oldLines) {
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
                return lines;
            }
        }
        return null;
    }

    private syncVisibleGhosts(
        startLine: number,
        endLine: number,
        diffResult: Map<number, DiffInfo>,
        settings: EditorSettings,
        lines: AnycodeLine[]
    ): void {
        if (!diffResult || diffResult.size === 0) return;

        const visibleHunks = new Set<number>();

        // Collect all hunks in visible range
        for (let i = startLine; i < endLine; i++) {
            const diffInfo = diffResult.get(i + 1);
            if (diffInfo?.changeType === 'modified' && diffInfo.oldLines && diffInfo.oldLines.length > 0) {
                visibleHunks.add(diffInfo.hunkId);
            }
        }

        // Update ghost lines for each visible hunk
        for (const hunkId of visibleHunks) {
            let oldLines: string[] | undefined;
            for (const [_, info] of diffResult) {
                if (info.hunkId === hunkId && info.oldLines) {
                    oldLines = info.oldLines;
                    break;
                }
            }
            if (oldLines) {
                this.updateGhostLinesForHunk(hunkId, oldLines, settings, diffResult, lines);
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

        // Find the first line in this hunk
        const firstLineNum = this.getFirstLineInHunk(hunkId, diffResult);
        if (firstLineNum === null) return;

        // Find firstLine from lines array instead of DOM query
        const firstLine = lines.find(line => line.lineNumber === firstLineNum - 1);
        if (!firstLine) return;

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

        // Find corresponding gutter and button elements by data-line attribute
        const firstGutterEl = this.gutter.querySelector(`.ln[data-line="${firstLineNum - 1}"]`);
        const firstBtnEl = this.buttonsColumn.querySelector(`.bt[data-line="${firstLineNum - 1}"]`);

        // Insert at the correct positions in all three containers
        this.codeContent.insertBefore(codeFrag, firstLine);

        if (firstGutterEl) {
            this.gutter.insertBefore(gutterFrag, firstGutterEl);
        }
        if (firstBtnEl) {
            this.buttonsColumn.insertBefore(btnFrag, firstBtnEl);
        }
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

    private getFirstLineInHunk(
        hunkId: number, diffResult: Map<number, DiffInfo>
    ): number | null {
        let minLine: number | null = null;
        for (const [lineNum, info] of diffResult) {
            if (info.hunkId === hunkId && info.changeType === 'modified') {
                if (minLine === null || lineNum < minLine) {
                    minLine = lineNum;
                }
            }
        }
        return minLine;
    }

    private getDiffClass(changeType: ChangeType): string {
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

    private clearAllGhostLines(): void {
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
}



interface GhostLine {
    code: HTMLElement;
    gutter: HTMLElement;
    btn: HTMLElement;
}

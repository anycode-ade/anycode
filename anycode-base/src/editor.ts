import { CSS_CLASS } from "./constants";
import { Code, Change, Position, Operation, type FoldRange, WordHighlight, areWordHighlightsEqual } from "./code";
import { Renderer } from './renderer/Renderer';
import { getPosFromMouse } from './mouse';
import { Selection, hasDiagnosticSelection } from "./selection";
import {
    Completion,
    CompletionRequest,
    DefinitionRequest,
    DefinitionResponse,
    HoverRequest,
    ReferencesRequest,
} from "./lsp";
import {
    Action, ActionContext, ActionResult,
    executeAction, handlePasteText,
} from './actions';
import {
    generateCssClasses, addCssToDocument,
    findPrevWord, findNextWord,
    getCompletionRange, scoreMatches,
    isFoldElement, isInsideDiagnostic
} from './utils';

import './styles.css';
import { Search } from "./search";
import { computeGitChanges, computeGitChangesFromSource, DiffInfo, DiffModel } from "./diff";
import { getGapElementData } from "./renderer/DiffRenderer";

export type ScrollbarStyle = 'rounded' | 'flat';

export interface ScrollbarSettings {
    style?: ScrollbarStyle;
    minSize?: number;
    width?: number;
}

export interface EditorSettings {
    lineHeight: number;
    buffer: number;
    scrollbar?: ScrollbarSettings;
}

export interface EditorOptions {
    line?: number;
    column?: number;
    theme?: any;
    readOnly?: boolean;
    ignoreEdits?: boolean;
    focusedDiffEnabled?: boolean;
    focusedDiffContextLines?: number;
    codeFoldingEnabled?: boolean;
    wordHighlightEnabled?: boolean;
    scrollbarMarkersEnabled?: boolean;
    scrollbarStyle?: ScrollbarStyle;
    scrollbarMinSize?: number;
    scrollbarWidth?: number;
    code?: Code;
    originalCode?: Code;
}

export interface EditorState {
    code: Code;
    originalCode?: Code;
    offset: number;
    selection: Selection | null;
    cursorActive: boolean;
    runLines: number[];
    errorLines: Map<number, string>;
    settings: EditorSettings;
    diffs?: DiffModel;
    readOnly?: boolean;
    foldRanges: FoldRange[];
    collapsedFoldStarts: Set<number>;
    codeFoldingEnabled: boolean;
    wordHighlightEnabled: boolean;
    scrollbarMarkersEnabled: boolean;
    wordHighlight: WordHighlight | null;
    search: Search;
}

export class AnycodeEditor {
    private code: Code;
    private offset: number;
    private settings: EditorSettings;
    private editorFontSettingsHandler: ((event: Event) => void) | null = null;
    private renderer!: Renderer;
    private wrapper!: HTMLDivElement;
    private container!: HTMLDivElement;
    private buttonsColumn!: HTMLDivElement;
    private gutter!: HTMLDivElement;
    private foldsColumn!: HTMLDivElement;
    private codeContent!: HTMLDivElement;

    private isMouseSelecting: boolean = false;
    private selection: Selection | null = null;
    private autoScrollTimer: number | null = null;
    private isWordSelection: boolean = false;
    private wordSelectionAnchor: number = 0;
    private isLineSelection: boolean = false;
    private lineSelectionAnchor: number = 0;

    private lastScrollTop = 0;
    private scrollAnimationFrameId: number | null = null;
    private listenersAttached: boolean = false;
    private readOnlyListenersAttached: boolean = false;

    private runLines: number[] = [];
    private errorLines: Map<number, string> = new Map();
    private errorListeners: Set<() => void> = new Set();

    private pendingOriginalContent: string | null = null;
    private isCompletionOpen = false;
    private selectedCompletionIndex = 0;
    private completions: Completion[] = [];
    private completionProvider: ((request: CompletionRequest) => Promise<Completion[]>) | null = null;
    private hoverProvider: ((request: HoverRequest) => Promise<string | null>) | null = null;
    private goToDefinitionProvider: ((request: DefinitionRequest) => Promise<DefinitionResponse>) | null = null;
    private referencesPeekProvider: ((request: ReferencesRequest) => Promise<void>) | null = null;
    private onCursorChangeCallback: ((newCursor: Position, oldCursor: Position) => void) | null = null;
    private hoverDebounceTimer: number | null = null;
    private hoverRequestToken = 0;
    private hoverOffset: number | null = null;

    private needFocus = false;
    private cursorActive = true;

    private search: Search = new Search();

    private diffEnabled: boolean = false;
    private focusedDiffEnabled: boolean;
    private focusedDiffContextLines: number;
    private originalCode?: Code;
    private diffs?: DiffModel;
    private readonly readOnly: boolean;
    private readonly ignoreEdits: boolean;
    private collapsedFoldStarts: Set<number> = new Set();
    private codeFoldingEnabled: boolean;
    
    private wordHighlightEnabled: boolean;
    private scrollbarMarkersEnabled: boolean;
    private wordHighlight: WordHighlight | null = null;

    constructor(
        initialText = '',
        filename: string = 'test.txt',
        language: string = '',
        options: EditorOptions = {}
    ) {
        this.code = options.code ?? new Code(initialText, filename, language);
        this.readOnly = options.readOnly ?? false;
        this.ignoreEdits = options.ignoreEdits ?? false;
        this.focusedDiffEnabled = options.focusedDiffEnabled ?? false;
        this.focusedDiffContextLines = Math.max(0, options.focusedDiffContextLines ?? 3);
        this.codeFoldingEnabled = options.codeFoldingEnabled ?? true;
        this.wordHighlightEnabled = options.wordHighlightEnabled ?? true;
        this.scrollbarMarkersEnabled = options.scrollbarMarkersEnabled ?? true;
        this.originalCode = options.originalCode;
        // Set initial cursor position
        if (options.line !== undefined && options.column !== undefined) {
            this.offset = this.code.getOffset(options.line, options.column);
            this.needFocus = true;
        } else {
            this.offset = 0;
        }

        this.settings = {
            lineHeight: 20,
            buffer: 25,
            scrollbar: {
                style: options.scrollbarStyle,
                minSize: options.scrollbarMinSize,
                width: options.scrollbarWidth,
            },
        };
        if (typeof window !== 'undefined') {
            const rootStyles = window.getComputedStyle(document.documentElement);
            const fontSize = Number.parseFloat(rootStyles.getPropertyValue('--editor-font-size'));
            const lineHeight = Number.parseFloat(rootStyles.getPropertyValue('--editor-line-height'));
            if (Number.isFinite(fontSize) && Number.isFinite(lineHeight)) {
                this.settings.lineHeight = Math.max(12, Math.round(fontSize * lineHeight));
            }
        }
        if (typeof window !== 'undefined') {
            this.editorFontSettingsHandler = (event: Event) => {
                const detail = (event as CustomEvent<{ size?: number; lineHeight?: number }>).detail;
                if (!detail) return;
                const fontSize = Number(detail.size);
                const lineHeight = Number(detail.lineHeight);
                if (Number.isFinite(fontSize) && Number.isFinite(lineHeight)) {
                    this.setLineHeight(fontSize * lineHeight);
                }
            };
            window.addEventListener('anycode:editor-font-settings', this.editorFontSettingsHandler);

        }

        if (options.theme) {
            const css = generateCssClasses(options.theme);
            addCssToDocument(css, 'anyeditor-theme');
        }
        this.createDomElements();
        this.renderer = new Renderer(
            this.container,
            this.buttonsColumn,
            this.gutter,
            this.foldsColumn,
            this.codeContent,
            this.scrollbarMarkersEnabled,
            () => this.renderScrollImmediate(),
            this.wrapper
        );
        this.renderer.setFocusedDiffMode(this.focusedDiffEnabled, this.focusedDiffContextLines);
    }

    private createDomElements() {
        this.wrapper = document.createElement('div');
        this.wrapper.className = 'anyeditor-wrapper';

        this.container = document.createElement('div');
        this.container.className = 'anyeditor';
        this.container.style.setProperty('--anycode-line-height', `${this.settings.lineHeight}px`);

        this.buttonsColumn = document.createElement('div');
        this.buttonsColumn.className = 'buttons';

        this.gutter = document.createElement('div');
        this.gutter.className = 'gutter';

        this.foldsColumn = document.createElement('div');
        this.foldsColumn.className = 'folds';

        this.codeContent = document.createElement('div');
        this.codeContent.className = 'code';
        this.codeContent.tabIndex = 0;
        this.codeContent.contentEditable = this.readOnly ? "false" : "true";
        this.codeContent.spellcheck = false;
        (this.codeContent as any).autocorrect = "off";
        this.codeContent.autocapitalize = "off";
        if (this.readOnly) {
            this.container.classList.add('readonly');
        }
        if (!this.codeFoldingEnabled) {
            this.container.classList.add('no-folding');
        }

        this.container.appendChild(this.buttonsColumn);
        this.container.appendChild(this.gutter);
        this.container.appendChild(this.foldsColumn);
        this.container.appendChild(this.codeContent);
        this.wrapper.appendChild(this.container);
    }

    public clean() {
        this.removeEventListeners();
        this.renderer?.clean();
        if (this.editorFontSettingsHandler && typeof window !== 'undefined') {
            window.removeEventListener('anycode:editor-font-settings', this.editorFontSettingsHandler);
            this.editorFontSettingsHandler = null;
        }
        this.clearPendingHover();
        this.closeHover();
        if (this.scrollAnimationFrameId !== null) {
            cancelAnimationFrame(this.scrollAnimationFrameId);
            this.scrollAnimationFrameId = null;
        }
        this.offset = 0;
        this.selection = null;

        if (this.wrapper && this.wrapper.parentElement) {
            this.wrapper.parentElement.removeChild(this.wrapper);
        } else if (this.container && this.container.parentElement) {
            this.container.parentElement.removeChild(this.container);
        }
    }

    public setScrollbarSettings(settings: ScrollbarSettings) {
        this.settings.scrollbar = {
            ...this.settings.scrollbar,
            ...settings,
        };
        this.render();
    }

    public setFastScroll(enabled: boolean) {
        this.renderer?.setFastScroll(enabled, this.getEditorState());
    }

    public setOnChange(func: (t: Change) => void) {
        if (this.readOnly) return;
        this.code.setOnChange(func);
    }

    public getCodeModel(): Code {
        return this.code;
    }

    public addOnChangeListener(listener: (change: Change) => void): () => void {
        return this.code.addChangeListener(listener);
    }

    public notifyExternalChange(change: Change): void {
        if (this.readOnly) return;
        this.code.notifyChange(change);
        this.refreshAfterExternalChange();
    }

    public setHistory(changes: Change[], index: number) {
        if (this.readOnly) return;
        this.code.setHistory(changes, index);
    }

    public setText(newText: string) {
        this.code.setContent(newText);
        this.recomputeDiffs();
    }

    public updateTextIncremental(newText: string) {
        const currentText = this.code.getContent();
        if (currentText === newText) return;

        const maxPrefix = Math.min(currentText.length, newText.length);
        let prefixLength = 0;
        while (
            prefixLength < maxPrefix
            && currentText.charCodeAt(prefixLength) === newText.charCodeAt(prefixLength)
        ) {
            prefixLength += 1;
        }

        let currentSuffixStart = currentText.length;
        let nextSuffixStart = newText.length;
        while (
            currentSuffixStart > prefixLength
            && nextSuffixStart > prefixLength
            && currentText.charCodeAt(currentSuffixStart - 1) === newText.charCodeAt(nextSuffixStart - 1)
        ) {
            currentSuffixStart -= 1;
            nextSuffixStart -= 1;
        }

        const removedLength = currentSuffixStart - prefixLength;
        const insertedText = newText.slice(prefixLength, nextSuffixStart);

        if (removedLength === 0 && insertedText.length === 0) return;

        if (removedLength > 0) {
            this.code.remove(prefixLength, removedLength);
        }

        if (insertedText.length > 0) {
            this.code.insert(insertedText, prefixLength);
        }

        this.selection = null;
        this.offset = Math.min(this.offset, this.code.getContentLength());

        this.recomputeDiffs();

        if (this.search.isActive()) {
            const matches = this.code.search(this.search.getPattern());
            this.search.setMatches(matches);
        }

        this.renderer.renderChanges(this.getEditorState());
    }

    public getText(): string {
        return this.code.getContent();
    }

    public refreshAfterExternalChange(): void {
        this.recomputeDiffs();

        if (this.search.isActive()) {
            this.search.setMatches(this.code.search(this.search.getPattern()));
        }

        this.renderer.renderChanges(this.getEditorState());
    }

    public getOriginalText(): string | null {
        return this.originalCode?.getContent() ?? this.pendingOriginalContent;
    }

    public getOriginalCodeModel(): Code | undefined {
        return this.originalCode;
    }

    public setOriginalCodeModel(code: Code): void {
        this.originalCode = code;
        if (this.diffEnabled) {
            this.recomputeDiffs();
            this.renderer.render(this.getEditorState());
        }
    }

    public getSelectedText(): string {
        if (!this.selection || this.selection.isEmpty()) {
            return '';
        }

        const [start, end] = this.selection.sorted();
        return this.code.getIntervalContent2(start, end);
    }

    public getTextLength(): number {
        return this.code.getContentLength();
    }

    public getFoldRanges(): FoldRange[] {
        if (!this.codeFoldingEnabled) {
            return [];
        }
        return this.code.getFoldRanges();
    }

    public async init() {
        await this.code.init();
        if (this.readOnly) {
            this.setupReadOnlyEventListeners();
            return;
        }
        this.setupEventListeners();
    }

    private originalContentString: string | null = null;

    private async initOriginalCode(content: string): Promise<boolean> {
        if (this.originalContentString === content && this.originalCode) {
            return false;
        }
        this.originalContentString = content;
        const originalCode = new Code(
            content,
            this.code.filename,
            this.code.language ?? 'text',
        );
        this.originalCode = originalCode;

        try {
            await originalCode.init();
            // Ignore stale async completion if a newer baseline replaced this instance.
            if (this.originalCode !== originalCode) return false;
            this.originalCode = originalCode;
            return true;
        } catch (error) {
            // Don't wipe newer baseline on stale failure.
            if (this.originalCode === originalCode) {
                this.originalCode = undefined;
                this.originalContentString = null;
            }
            console.warn('Failed to initialize original code for diff rendering', error);
            return false;
        }
    }

    private setupReadOnlyEventListeners() {
        if (this.readOnlyListenersAttached) return;
        this.readOnlyListenersAttached = true;
        this.handleScroll = this.handleScroll.bind(this);
        this.container.addEventListener("scroll", this.handleScroll);
    }

    public getContainer(): HTMLDivElement {
        return this.wrapper || this.container;
    }

    public getContentHeight(): number {
        return this.renderer.getVisualRowCount() * this.settings.lineHeight;
    }

    public getCursor(): { line: number, column: number } {
        return this.code.getPosition(this.offset);
    }

    public setCursor(line: number, column: number): void {
        const offset = this.code.getOffset(line, column);
        this.offset = offset;
        this.updateWordHighlight();
        this.renderCursorOrSelection();
    }

    private updateWordHighlight() {
        if (!this.code) return;

        if (!this.wordHighlightEnabled) {
            if (this.wordHighlight !== null) {
                this.wordHighlight = null;
                if (this.renderer) {
                    this.renderer.renderWordHighlight(this.getEditorState());
                }
            }
            return;
        }
        const highlight = this.code.getWordAtOffset(this.offset);
        const hasChanged = !areWordHighlightsEqual(highlight, this.wordHighlight);
        
        if (hasChanged) {
            this.wordHighlight = highlight;
            if (this.renderer) {
                this.renderer.renderWordHighlight(this.getEditorState());
            }
        }
    }

    public setWordHighlightEnabled(enabled: boolean) {
        if (this.wordHighlightEnabled !== enabled) {
            this.wordHighlightEnabled = enabled;
            this.updateWordHighlight();
        }
    }

    public setSelectionRange(
        startLine: number,
        startColumn: number,
        endLine: number,
        endColumn: number,
        center: boolean = false,
    ): void {
        const startOffset = this.code.getOffset(startLine, startColumn);
        const endOffset = this.code.getOffset(endLine, endColumn);
        this.selection = new Selection(startOffset, endOffset);
        this.offset = endOffset;
        this.updateWordHighlight();

        if (center) {
            this.renderer.revealCursorCenter(this.getEditorState());
        } else {
            this.renderer.revealCursor(this.getEditorState());
        }

        const applySelection = () => {
            if (!this.selection || this.selection.isEmpty()) return;
            this.renderer.renderSelection(this.code, this.selection);
        };

        // First pass immediately, then reinforce after possible virtualized re-render.
        applySelection();
        requestAnimationFrame(() => {
            applySelection();
            requestAnimationFrame(() => {
                applySelection();
            });
        });
    }

    public requestFocus(line: number, column: number, center: boolean = false): void {
        this.needFocus = true;
        const offset = this.code.getOffset(line, column);
        this.offset = offset;
        if (!this.readOnly) {
            this.codeContent.focus();
        }

        if (center) this.renderer.revealCursorCenter(this.getEditorState());
        else this.renderer.revealCursor(this.getEditorState());

        this.renderer.renderCursorOrSelection(this.getEditorState());
    }

    public requestedFocus(): boolean {
        return this.needFocus;
    }

    public setRunButtonLines(lines: number[]) {
        this.runLines = lines;
    }

    public getErrorLines(): Map<number, string> {
        return this.errorLines;
    }

    public addOnErrorListener(listener: () => void): () => void {
        this.errorListeners.add(listener);
        return () => {
            this.errorListeners.delete(listener);
        };
    }

    public setErrors(errors: { line: number, message: string }[]) {
        this.errorLines.clear();
        for (const { line, message } of errors) {
            this.errorLines.set(line, message);
        }
        this.renderer.renderErrors(this.getEditorState());
        for (const listener of this.errorListeners) {
            listener();
        }
    }

    public setCompletions(completions: Completion[]) {
        this.completions = completions;
    }

    public setCompletionProvider(
        completionProvider: (request: CompletionRequest) => Promise<Completion[]>
    ) {
        this.completionProvider = completionProvider;
    }

    public setHoverProvider(
        hoverProvider: (request: HoverRequest) => Promise<string | null>
    ) {
        this.hoverProvider = hoverProvider;
    }

    public setGoToDefinitionProvider(
        goToDefinitionProvider: (request: DefinitionRequest) => Promise<DefinitionResponse>
    ) {
        this.goToDefinitionProvider = goToDefinitionProvider;
    }

    public setReferencesPeekProvider(
        referencesPeekProvider: (request: ReferencesRequest) => Promise<void>
    ) {
        this.referencesPeekProvider = referencesPeekProvider;
    }

    public setOnCursorChange(callback: (newState: Position, oldState: Position) => void) {
        this.onCursorChangeCallback = callback;
    }

    private clearPendingHover() {
        if (this.hoverDebounceTimer) {
            window.clearTimeout(this.hoverDebounceTimer);
            this.hoverDebounceTimer = null;
        }
        this.hoverRequestToken += 1;
    }

    private closeHover() {
        this.renderer.closeHover();
        this.hoverOffset = null;
    }

    private setupEventListeners() {
        if (this.listenersAttached) return;
        this.listenersAttached = true;

        this.handleScroll = this.handleScroll.bind(this);
        this.container.addEventListener("scroll", this.handleScroll);

        this.handleClick = this.handleClick.bind(this);
        this.codeContent.addEventListener('click', this.handleClick);
        this.gutter.addEventListener('click', this.handleClick);
        this.foldsColumn.addEventListener('click', this.handleClick);

        this.handleKeydown = this.handleKeydown.bind(this);
        this.codeContent.addEventListener('keydown', this.handleKeydown);

        this.handlePasteEvent = this.handlePasteEvent.bind(this);
        this.codeContent.addEventListener('paste', this.handlePasteEvent);

        this.handleBeforeInput = this.handleBeforeInput.bind(this);
        this.container.addEventListener('beforeinput', this.handleBeforeInput);

        this.handleMouseDown = this.handleMouseDown.bind(this);
        this.codeContent.addEventListener('mousedown', this.handleMouseDown);

        this.handleMouseUp = this.handleMouseUp.bind(this);
        this.container.addEventListener('mouseup', this.handleMouseUp);

        this.handleMouseMove = this.handleMouseMove.bind(this);
        this.container.addEventListener('mousemove', this.handleMouseMove);

        this.handleMouseLeave = this.handleMouseLeave.bind(this);
        this.container.addEventListener('mouseleave', this.handleMouseLeave);

        this.handleBlur = this.handleBlur.bind(this);
        this.codeContent.addEventListener('blur', this.handleBlur);

        this.handleFocus = this.handleFocus.bind(this);
        this.codeContent.addEventListener('focus', this.handleFocus);
    }

    private removeEventListeners() {
        if (this.readOnlyListenersAttached) {
            this.container.removeEventListener("scroll", this.handleScroll);
            this.readOnlyListenersAttached = false;
        }
        if (!this.listenersAttached) return;
        this.listenersAttached = false;

        this.container.removeEventListener("scroll", this.handleScroll);
        this.codeContent.removeEventListener('click', this.handleClick);
        this.gutter.removeEventListener('click', this.handleClick);
        this.foldsColumn.removeEventListener('click', this.handleClick);
        this.codeContent.removeEventListener('keydown', this.handleKeydown);
        this.codeContent.removeEventListener('paste', this.handlePasteEvent);
        this.container.removeEventListener('beforeinput', this.handleBeforeInput);
        this.codeContent.removeEventListener('mousedown', this.handleMouseDown);
        this.container.removeEventListener('mouseup', this.handleMouseUp);
        this.container.removeEventListener('mousemove', this.handleMouseMove);
        this.container.removeEventListener('mouseleave', this.handleMouseLeave);
        this.codeContent.removeEventListener('blur', this.handleBlur);
        this.codeContent.removeEventListener('focus', this.handleFocus);
    }

    public renderScrollImmediate() {
        if (!this.container || !this.container.isConnected) return;
        if (this.scrollAnimationFrameId !== null) {
            cancelAnimationFrame(this.scrollAnimationFrameId);
            this.scrollAnimationFrameId = null;
        }
        const state = this.getEditorState();
        this.renderer.renderScroll(state);
        this.lastScrollTop = this.container.scrollTop;
    }

    private handleScroll(e: Event) {
        if (!this.container.isConnected) return;
        if (this.container.clientHeight === 0 && this.container.clientWidth === 0) return;

        this.clearPendingHover();
        this.closeHover();

        this.renderer.updateScrollbarThumb();

        if (this.scrollAnimationFrameId !== null) return;

        this.scrollAnimationFrameId = requestAnimationFrame(() => {
            this.scrollAnimationFrameId = null;
            if (!this.container.isConnected) return;
            if (this.container.clientHeight === 0 && this.container.clientWidth === 0) return;
            const scrollTop = this.container.scrollTop;
            if (scrollTop !== this.lastScrollTop) {
                let state = this.getEditorState();
                this.renderer.renderScroll(state);
                this.lastScrollTop = scrollTop;
            }
            this.needFocus = false;
        });
    }

    public hasScroll() {
        return this.lastScrollTop !== 0;
    }

    public restoreScroll() {
        this.container.scrollTop = this.lastScrollTop;
    }

    public onAttach() {
        this.restoreScroll();
        const state = this.getEditorState();
        this.renderer.renderScroll(state);
        this.renderer.renderCursorOrSelection(state);
    }

    public activateCursor(): void {
        if (this.cursorActive) return;
        this.cursorActive = true;
        if (this.container.isConnected) {
            this.renderer.renderCursorOrSelection(this.getEditorState());
        }
    }

    public deactivateCursor(): void {
        this.cursorActive = false;
        this.renderer.cancelCursorRaf();
    }

    private getEditorState(): EditorState {
        return {
            code: this.code,
            originalCode: this.originalCode,
            offset: this.offset,
            selection: this.selection,
            cursorActive: this.cursorActive,
            runLines: this.runLines,
            errorLines: this.errorLines,
            settings: {
                lineHeight: this.settings.lineHeight,
                buffer: this.settings.buffer,
            },
            diffs: this.diffs,
            readOnly: this.readOnly,
            foldRanges: this.code.getFoldRanges(),
            collapsedFoldStarts: this.collapsedFoldStarts,
            codeFoldingEnabled: this.codeFoldingEnabled,
            wordHighlightEnabled: this.wordHighlightEnabled,
            scrollbarMarkersEnabled: this.scrollbarMarkersEnabled,
            wordHighlight: this.wordHighlight,
            search: this.search,
        };
    }

    private toggleFoldAtLine(line: number) {
        if (this.collapsedFoldStarts.has(line)) {
            this.collapsedFoldStarts.delete(line);
        } else {
            this.collapsedFoldStarts.add(line);
        }
    }

    public render() {
        this.renderer.render(this.getEditorState());
    }

    public renderCursorOrSelection() {
        if (this.readOnly) return;
        this.renderer.renderCursorOrSelection(this.getEditorState());
    }

    public setLineHeight(lineHeight: number): void {
        const nextLineHeight = Math.max(12, Math.round(lineHeight));
        if (this.settings.lineHeight === nextLineHeight) return;
        this.settings.lineHeight = nextLineHeight;
        this.container.style.setProperty('--anycode-line-height', `${nextLineHeight}px`);
        this.render();
    }

    private getDiffGapTarget(target: EventTarget | null): HTMLElement | null {
        if (!(target instanceof Element)) {
            return null;
        }
        const match = target.closest(`.${CSS_CLASS.DIFF_GAP}, .${CSS_CLASS.DIFF_GAP_EXPAND_BTN}`);
        return match instanceof HTMLElement ? match : null;
    }

    private handleDiffGapExpandClick(e: MouseEvent): boolean {
        const gapTarget = this.getDiffGapTarget(e.target);
        if (!gapTarget) return false;

        e.preventDefault();
        e.stopPropagation();

        const gapData = getGapElementData(gapTarget);
        if (!gapData || gapData.hiddenStart < 0 || gapData.hiddenEnd < gapData.hiddenStart) {
            return true;
        }

        const prevScrollTop = this.container.scrollTop;
        const expanded = this.renderer.expandFocusedHiddenRange(
            gapData.hiddenStart,
            gapData.hiddenEnd,
            gapData.expandStep,
            gapData.expandDirection,
        );
        if (expanded) {
            this.renderer.render(this.getEditorState());
            this.container.scrollTop = prevScrollTop;
            if (!this.readOnly) {
                this.codeContent.focus({ preventScroll: true });
                this.renderer.renderCursorOrSelection(this.getEditorState(), false);
            }
        }

        return true;
    }

    private handleClick(e: MouseEvent): void {
        this.clearPendingHover();
        this.closeHover();

        if (this.handleDiffGapExpandClick(e)) {
            return;
        }

        if (this.handleFoldToggleClick(e)) {
            return;
        }

        const oldCursor = this.code.getPosition(this.offset);

        if (this.selection && this.selection.nonEmpty()) { return; }
        if (isInsideDiagnostic(e.target as Node)) { return; }

        e.preventDefault();

        const pos = getPosFromMouse(e);
        if (!pos) { return; }

        const multibufferCode = this.code as Code & {
            getMultibufferHeader?: (line: number) => string | null;
            toggleMultibufferFileAtLine?: (line: number) => boolean;
        };
        if (
            multibufferCode.getMultibufferHeader?.(pos.row) !== null
            && multibufferCode.getMultibufferHeader !== undefined
            && multibufferCode.toggleMultibufferFileAtLine?.(pos.row)
        ) {
            this.renderer.clearExpandedDiffRanges();
            this.offset = Math.min(this.code.getOffset(pos.row, 0), this.code.getContentLength());
            this.selection = null;
            this.recomputeDiffs();
            this.renderer.render(this.getEditorState());
            if (this.onCursorChangeCallback) {
                this.onCursorChangeCallback(this.code.getPosition(this.offset), oldCursor);
            }
            return;
        }


        const o = this.code.getOffset(pos.row, pos.col);
        //if (o == this.offset) { return; }

        this.offset = o;
        this.updateWordHighlight();

        this.activateCursor();
        if (!this.readOnly && document.activeElement !== this.codeContent) {
            this.codeContent.focus({ preventScroll: true });
        }
        this.renderCursorOrSelection();

        if (this.onCursorChangeCallback) {
            this.onCursorChangeCallback(
                this.code.getPosition(this.offset), oldCursor
            );
        }

        if (this.isCompletionOpen) {
            this.renderer.closeCompletion();
            this.isCompletionOpen = false;
        }

        if (e.altKey) {
            if (!this.ignoreEdits) {
                this.openReferencesPeek(pos.row, pos.col).catch(console.error);
            }
            return;
        }

        if (e.metaKey || e.ctrlKey) {
            this.goToDefinition(pos.row, pos.col).catch(console.error);
        }
    }

    private handleFoldToggleClick(e: MouseEvent): boolean {
        if (!this.codeFoldingEnabled || !(e.target instanceof HTMLElement)) {
            return false;
        }

        const foldToggle = e.target.closest('.fold-toggle');
        if (!isFoldElement(foldToggle)) {
            return false;
        }

        e.preventDefault();
        e.stopPropagation();
        this.toggleFoldAtLine(foldToggle.lineNumber);
        this.renderer.render(this.getEditorState());

        if (!this.readOnly) {
            this.codeContent.focus({ preventScroll: true });
            this.renderer.renderCursorOrSelection(this.getEditorState(), false);
        }

        return true;
    }

    private async goToDefinition(row: number, col: number): Promise<void> {
        if (!this.goToDefinitionProvider) {
            console.warn('Go to definition provider not set');
            return;
        }

        try {
            const { file, line, column } = this.code.resolvePosition(row, col);
            const definitionRequest: DefinitionRequest = {
                file,
                row: line,
                column,
            };

            await this.goToDefinitionProvider(definitionRequest);
        } catch (error) {
            console.error('Failed to get definition:', error);
        }
    }

    private async openReferencesPeek(row: number, col: number): Promise<void> {
        if (this.ignoreEdits) return;
        if (!this.referencesPeekProvider) {
            console.warn('References peek provider not set');
            return;
        }

        try {
            const referencesRequest: ReferencesRequest = {
                file: this.code.filename,
                row: row,
                column: col
            };

            await this.referencesPeekProvider(referencesRequest);
        } catch (error) {
            console.error('Failed to get references:', error);
        }
    }

    private handleMouseUp(e: MouseEvent) {
        // console.log('handleMouseUp ', this.selection);
        this.isMouseSelecting = false;
        this.isWordSelection = false;
        this.isLineSelection = false;

        if (this.autoScrollTimer) {
            cancelAnimationFrame(this.autoScrollTimer);
            this.autoScrollTimer = null;
        }
    }

    private handleBlur(e: FocusEvent) {
        // console.log('Editor lost focus');
        this.isMouseSelecting = false;
        this.isWordSelection = false;
        this.isLineSelection = false;
        this.clearPendingHover();
        this.closeHover();

        if (this.autoScrollTimer) {
            cancelAnimationFrame(this.autoScrollTimer);
            this.autoScrollTimer = null;
        }
    }

    private handleFocus(e: FocusEvent) {
        // console.log('Editor focus');
        this.activateCursor();
        this.search.setNeedsFocus(false);
    }

    private handleMouseLeave(e: MouseEvent) {
        this.clearPendingHover();
        this.closeHover();
    }

    private handleMouseDown(e: MouseEvent) {
        if (e.button !== 0) return;
        if (this.getDiffGapTarget(e.target)) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        if (isInsideDiagnostic(e.target as Node)) return;
        this.activateCursor();
        if (!this.readOnly && document.activeElement !== this.codeContent) {
            this.codeContent.focus({ preventScroll: true });
        }
        e.preventDefault();
        this.clearPendingHover();
        this.closeHover();

        this.isMouseSelecting = true;

        const pos = getPosFromMouse(e);
        if (!pos) return;

        if (e.detail === 2) { // double click
            this.selectWord(pos.row, pos.col);
            this.isWordSelection = true;
            this.wordSelectionAnchor = this.code.getOffset(pos.row, pos.col);
            return;
        }

        if (e.detail === 3) { // triple click
            this.selectLine(pos.row);
            this.isLineSelection = true;
            this.lineSelectionAnchor = pos.row;
            return;
        }

        this.isWordSelection = false;
        this.isLineSelection = false;
        const o = this.code.getOffset(pos.row, pos.col);

        if (e.shiftKey && this.selection) {
            this.selection.updateCursor(o);
            this.renderer.renderSelection(this.code, this.selection);
        } else {
            if (this.selection) {
                this.selection.reset(o);
            } else {
                this.selection = new Selection(o, o);
            }
        }
    }

    private handleMouseMove(e: MouseEvent) {
        e.preventDefault();
        const target = e.target as HTMLElement | null;
        if (target?.closest('.hover-box')) {
            return;
        }

        if (!this.isMouseSelecting) {
            if (!this.hoverProvider || this.isCompletionOpen || this.search.isActive()) {
                this.clearPendingHover();
                this.closeHover();
                return;
            }

            const pos = getPosFromMouse(e);
            if (!pos) {
                this.clearPendingHover();
                this.closeHover();
                return;
            }

            const hoverOffset = this.code.getOffset(pos.row, pos.col);
            if (this.renderer.isHoverOpen() && this.hoverOffset === hoverOffset) {
                this.renderer.moveHover(this.code, hoverOffset);
                return;
            }

            this.clearPendingHover();
            this.hoverDebounceTimer = window.setTimeout(() => {
                this.requestHover(pos.row, pos.col, hoverOffset).catch(() => {
                    this.closeHover();
                });
            }, 1000);
            return;
        }

        this.autoScroll(e);

        let pos = getPosFromMouse(e);

        let oldSelection = this.selection?.clone();

        if (pos && this.selection) {
            const { row, col } = pos;
            const currentOffset = this.code.getOffset(row, col);

            if (this.isWordSelection) {
                const line = this.code.line(row);
                const currentPos = this.code.getPosition(currentOffset);

                const anchor = this.wordSelectionAnchor;
                const anchorPos = this.code.getPosition(anchor);
                const anchorLine = this.code.line(anchorPos.line);

                const direction = currentOffset < anchor ? 'backward' : 'forward';

                if (direction === 'backward') {
                    // Selection is moving left (backward) — find start of current word
                    const wordStartCol = findPrevWord(line, currentPos.column);
                    const newCursor = this.code.getOffset(row, wordStartCol);

                    // Extend selection to the end of the anchor word
                    const anchorEndCol = findNextWord(anchorLine, anchorPos.column);
                    const anchorEnd = this.code.getOffset(anchorPos.line, anchorEndCol);

                    // Update selection from new word start to anchor word end
                    this.selection = new Selection(newCursor, anchorEnd);
                    this.offset = newCursor;
                } else if (direction === 'forward') {
                    // Selection is moving right (forward) — find end of current word
                    const wordEndCol = findNextWord(line, currentPos.column);
                    const newCursor = this.code.getOffset(row, wordEndCol);

                    // Extend selection from the start of the anchor word
                    const anchorStartCol = findPrevWord(anchorLine, anchorPos.column);
                    const anchorStart = this.code.getOffset(anchorPos.line, anchorStartCol);

                    // Update selection from anchor word start to new word end
                    this.selection = new Selection(anchorStart, newCursor);
                    this.offset = newCursor;
                } else {
                    // Cursor hasn't moved — select the current word under cursor
                    const startCol = findPrevWord(line, currentPos.column);
                    const endCol = findNextWord(line, currentPos.column);
                    const start = this.code.getOffset(row, startCol);
                    const end = this.code.getOffset(row, endCol);

                    this.selection = new Selection(start, end);
                    this.offset = end;
                }
            } else if (this.isLineSelection) {
                const anchorRow = this.lineSelectionAnchor;

                if (row < anchorRow) {
                    // Selection moving up
                    const start = this.code.getOffset(row, 0);
                    const end = this.code.getOffset(anchorRow, this.code.lineLength(anchorRow));
                    this.selection = new Selection(start, end);
                    this.offset = start;
                } else {
                    // Selection moving down or same line
                    const start = this.code.getOffset(anchorRow, 0);
                    const end = this.code.getOffset(row, this.code.lineLength(row));
                    this.selection = new Selection(start, end);
                    this.offset = end;
                }
            } else {
                // Standard selection mode — update the cursor directly
                this.selection.updateCursor(currentOffset);
            }

            if (oldSelection && !oldSelection.equals(this.selection)) {
                // console.log('selection changed');
                this.renderer.renderSelection(this.code, this.selection);
            }
        }
    }

    private async requestHover(row: number, col: number, hoverOffset: number): Promise<void> {
        if (!this.hoverProvider) return;

        const requestToken = ++this.hoverRequestToken;

        const { file, line, column } = this.code.resolvePosition(row, col);

        const hoverText = await this.hoverProvider({
            file,
            row: line,
            column,
        });

        if (requestToken !== this.hoverRequestToken) return;
        if (!hoverText || !hoverText.trim()) {
            this.closeHover();
            return;
        }

        this.hoverOffset = hoverOffset;
        this.renderer.renderHover(hoverText, this.code, hoverOffset);
    }

    private autoScroll(e: MouseEvent) {
        const containerRect = this.container.getBoundingClientRect();
        const mouseY = e.clientY;
        const scrollThreshold = 20; // pixels from edge to trigger scroll
        const scrollSpeed = 5; // pixels to scroll per frame

        // Clear existing timer
        if (this.autoScrollTimer) {
            cancelAnimationFrame(this.autoScrollTimer);
            this.autoScrollTimer = null;
        }

        let shouldScroll = false;
        let scrollDirection = 0;

        // Check if mouse is near the top or bottom edge
        if (mouseY < containerRect.top + scrollThreshold) {
            shouldScroll = true;
            scrollDirection = -1; // scroll up
        } else if (mouseY > containerRect.bottom - scrollThreshold) {
            shouldScroll = true;
            scrollDirection = 1; // scroll down
        }

        if (shouldScroll) {
            const autoScroll = () => {
                if (!this.isMouseSelecting) return;

                const currentScroll = this.container.scrollTop;
                const maxScroll = this.container.scrollHeight - this.container.clientHeight;

                if (scrollDirection === -1) {  // Scroll up
                    this.container.scrollTop = Math.max(0, currentScroll - scrollSpeed);
                } else {  // Scroll down
                    this.container.scrollTop = Math.min(maxScroll, currentScroll + scrollSpeed);
                }
                // Continue scrolling if still selecting
                if (this.isMouseSelecting) {
                    this.autoScrollTimer = requestAnimationFrame(autoScroll);
                }
            };
            this.autoScrollTimer = requestAnimationFrame(autoScroll);
        }
    }

    private selectWord(row: number, col: number) {
        const line = this.code.line(row);

        const startCol = findPrevWord(line, col);
        const endCol = findNextWord(line, col);

        const start = this.code.getOffset(row, startCol);
        const end = this.code.getOffset(row, endCol);

        this.selection = new Selection(start, end);

        this.offset = end;
        this.renderer.renderSelection(this.code, this.selection);
    }

    private selectLine(row: number) {
        const lineLen = this.code.lineLength(row);
        const start = this.code.getOffset(row, 0);
        const end = this.code.getOffset(row, lineLen);

        this.selection = new Selection(start, end);

        this.offset = end;
        this.renderer.renderSelection(this.code, this.selection);
    }

    private async handleKeydown(event: KeyboardEvent) {
        this.clearPendingHover();
        this.closeHover();

        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
            if (hasDiagnosticSelection()) {
                console.log('hasDiagnosticSelection');
                return;
            }
        }

        if (event.metaKey && event.key === " ") {
            event.preventDefault();
            this.toggleCompletion();
            return;
        }

        if ((event.metaKey && !event.shiftKey && event.key.toLowerCase() === "f") || this.search.isFocused()) {
            event.preventDefault();
            this.handleSearchKey(event);
            return;
        }

        if (this.handleCompletionKey(event)) {
            event.preventDefault();
            return;
        }

        const action = this.getActionFromKey(event);
        if (!action) return;

        if (this.ignoreEdits && this.isEditingAction(action)) {
            event.preventDefault();
            return;
        }

        // Special-case paste in non-secure context: let native paste flow,
        // which will be handled by the 'beforeinput' listener.
        if (action === Action.PASTE && !(navigator.clipboard && window.isSecureContext)) {
            return;
        }

        // Special-case go to definition: handle directly
        if (action === Action.GO_TO_DEFINITION) {
            event.preventDefault();
            const { line, column } = this.code.getPosition(this.offset);
            this.goToDefinition(line, column).catch(console.error);
            return;
        }

        if (action === Action.REFERENCES) {
            event.preventDefault();
            if (this.ignoreEdits) return;
            const { line, column } = this.code.getPosition(this.offset);
            this.openReferencesPeek(line, column).catch(console.error);
            return;
        }

        if (action === Action.HOVER) {
            event.preventDefault();
            if (!this.hoverProvider) return;
            const { line, column } = this.code.getPosition(this.offset);
            this.requestHover(line, column, this.offset).catch(() => {
                this.closeHover();
            });
            return;
        }

        event.preventDefault();

        const ctx: ActionContext = {
            offset: this.offset,
            code: this.code,
            selection: this.selection || undefined,
            event: event
        };

        const result = await executeAction(action, ctx);
        this.adjustFocusedDiffNavigationOffset(result, action);
        this.applyEditResult(result);

        if (this.isCompletionOpen) {
            await this.showCompletion();
        }

        if (this.search.isActive() && action === Action.ESC) {
            this.renderer.removeAllHighlights(this.search);
            this.renderer.removeSearch(this.getEditorState());
            this.search.clear();
        }
    }

    private adjustFocusedDiffNavigationOffset(result: ActionResult, action: Action): void {
        if (!this.focusedDiffEnabled && this.collapsedFoldStarts.size === 0) return;
        if (
            action !== Action.ARROW_LEFT
            && action !== Action.ARROW_RIGHT
            && action !== Action.ARROW_LEFT_ALT
            && action !== Action.ARROW_RIGHT_ALT
            && action !== Action.ARROW_UP
            && action !== Action.ARROW_DOWN
        ) {
            return;
        }

        const pos = result.ctx.code.getPosition(result.ctx.offset);
        if (this.renderer.isRealLineVisible(pos.line)) return;

        const preferNext =
            action === Action.ARROW_RIGHT
            || action === Action.ARROW_RIGHT_ALT
            || action === Action.ARROW_DOWN;

        const targetLine = this.renderer.findNearestVisibleRealLine(pos.line, preferNext);
        if (targetLine === pos.line) return;

        const targetColumn = Math.min(pos.column, result.ctx.code.lineLength(targetLine));
        const targetOffset = result.ctx.code.getOffset(targetLine, targetColumn);
        result.ctx.offset = targetOffset;

        if (result.ctx.selection && result.ctx.event?.shiftKey) {
            result.ctx.selection = result.ctx.selection.fromCursor(targetOffset);
        }
    }

    private getActionFromKey(event: KeyboardEvent): Action | null {
        const { key, altKey, ctrlKey, metaKey, shiftKey } = event;

        // Shortcuts
        if (metaKey) {
            if (shiftKey && key.toLowerCase() === 'z')
                return Action.REDO;
            if (key.toLowerCase() === '/')
                return Action.COMMENT;

            switch (key.toLowerCase()) {
                case 'z': return Action.UNDO;
                case 'a': return Action.SELECT_ALL;
                case 'c': return Action.COPY;
                case 'v': return Action.PASTE;
                case 'x': return Action.CUT;
                case 'd': return Action.DUPLICATE;
                case "backspace": return Action.BACKSPACE;
                case "enter": return Action.ENTER;
                default: return null;
            }
        }

        // Navigation
        if (altKey) {
            switch (key) {
                case "ArrowLeft": return Action.ARROW_LEFT_ALT;
                case "ArrowRight": return Action.ARROW_RIGHT_ALT;
            }
        } else {
            switch (key) {
                case "ArrowLeft": return Action.ARROW_LEFT;
                case "ArrowRight": return Action.ARROW_RIGHT;
                case "ArrowUp": return Action.ARROW_UP;
                case "ArrowDown": return Action.ARROW_DOWN;
            }
        }

        // Editing
        if (shiftKey && key === 'Tab') {
            return Action.UNTAB;
        }

        switch (key) {
            case "Backspace": return Action.BACKSPACE;
            case "Delete": return Action.DELETE;
            case "Enter": return Action.ENTER;
            case "Tab": return Action.TAB;
            case "Escape": return Action.ESC;
            case "F10": return Action.HOVER;
            case "F11": return Action.REFERENCES;
            case "F12": return Action.GO_TO_DEFINITION;
        }

        // Text input
        if (key.length === 1 && !ctrlKey) {
            return Action.TEXT_INPUT;
        }

        return null;
    }

    private isEditingAction(action: Action): boolean {
        return action === Action.BACKSPACE
            || action === Action.DELETE
            || action === Action.ENTER
            || action === Action.TAB
            || action === Action.UNTAB
            || action === Action.TEXT_INPUT
            || action === Action.UNDO
            || action === Action.REDO
            || action === Action.PASTE
            || action === Action.CUT
            || action === Action.DUPLICATE
            || action === Action.COMMENT;
    }

    private applyEditResult(result: ActionResult) {
        const textChanged = result.changed;
        const offsetChanged = result.ctx.offset !== this.offset;
        const selectionChanged = this.selection !== result.ctx.selection;

        if (!textChanged && !offsetChanged && !selectionChanged) return;

        if (textChanged) {
            this.code = result.ctx.code;
            this.recomputeDiffs();
        }
        if (offsetChanged) {
            this.offset = result.ctx.offset;
        }
        if (selectionChanged) this.selection = result.ctx.selection || null;

        if (textChanged) {
            this.wordHighlight = null;
        } else if (offsetChanged) {
            this.updateWordHighlight();
        }

        const state = this.getEditorState();

        if (textChanged) {
            if (this.search.isActive()) {
                let matches = this.code.search(this.search.getPattern());
                this.search.setMatches(matches);
            }
            this.renderer.renderChanges(state);
            this.renderer.renderWordHighlight(state);
            this.renderer.revealCursor(state);
        } else if (offsetChanged || selectionChanged) {
            const didScrollToCursor = this.renderer.revealCursor(state);
            if (didScrollToCursor) {
                // Scroll event will render the cursor, avoid double render
            } else {
                // Render cursor immediately if no scroll occurred
                this.renderer.renderCursorOrSelection(state, true);
            }
        }
    }

    private async handleBeforeInput(e: InputEvent) {
        // this one is for mobile devices, support input and deletion
        this.clearPendingHover();
        this.closeHover();
        e.preventDefault();
        e.stopPropagation();
        if (this.ignoreEdits) return;

        if (e.inputType === 'deleteContentBackward') {
            const ctx: ActionContext = {
                offset: this.offset,
                code: this.code,
                selection: this.selection || undefined,
            };
            const result = await executeAction(Action.BACKSPACE, ctx);
            this.applyEditResult(result);
            return;
        } else if (e.inputType === 'deleteContentForward') {
        } else if (e.inputType.startsWith('delete')) {
        } else {
            // Default case for insertion or other input events
            let key = e.data ?? '';
            if (key === '') return;

            const ctx: ActionContext = {
                offset: this.offset,
                code: this.code,
                selection: this.selection || undefined,
                event: { key } as KeyboardEvent
            };

            const result = await executeAction(Action.TEXT_INPUT, ctx);
            this.applyEditResult(result);
        }
    }

    private handlePasteEvent(e: ClipboardEvent) {
        this.clearPendingHover();
        this.closeHover();
        if (this.ignoreEdits) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        // In secure contexts, paste is handled via Action.PASTE using navigator.clipboard
        if (navigator.clipboard && window.isSecureContext) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        const pastedText = e.clipboardData?.getData('text/plain') ?? '';
        if (!pastedText) return;

        const ctx: ActionContext = {
            offset: this.offset,
            code: this.code,
            selection: this.selection || undefined,
        };

        let result = handlePasteText(ctx, pastedText);
        this.applyEditResult(result);
    }

    public async toggleCompletion() {
        console.log('anycode: toggle completion');
        this.clearPendingHover();
        this.closeHover();

        if (this.isCompletionOpen) {
            this.renderer.closeCompletion();
            this.isCompletionOpen = false;
            return;
        }

        await this.showCompletion();
    }

    public async showCompletion() {
        if (this.ignoreEdits) return;
        if (!this.completionProvider) return;
        this.clearPendingHover();
        this.closeHover();

        let { line, column } = this.code.getPosition(this.offset);

        let newCompletions = await this.completionProvider({
            file: this.code.filename, row: line, column: column
        });

        if (!Array.isArray(newCompletions) || newCompletions.length === 0) {
            this.completions = [];
            this.renderer.closeCompletion();
            this.isCompletionOpen = false;
            return;
        }

        let lineStr = this.code.line(line);
        let prev = findPrevWord(lineStr, column)
        let prevWord = lineStr.substring(prev, column)

        newCompletions.sort((a, b) => {
            let sa = scoreMatches(a.label, prevWord);
            let sb = scoreMatches(b.label, prevWord);
            if (sa === sb) return a.label.length - b.label.length;
            else return sb - sa;
        });

        this.completions = newCompletions;
        this.selectedCompletionIndex = 0;

        this.renderer.renderCompletion(
            this.completions, this.selectedCompletionIndex,
            this.code, this.offset,
            this.applyCompletion.bind(this)
        );
        this.isCompletionOpen = true;
    }

    public applyCompletion(index: number) {
        if (this.ignoreEdits) return;
        if (index < 0 || index >= this.completions.length) return;
        if (!this.isCompletionOpen) return;

        let { line, column } = this.code.getPosition(this.offset);
        let completionItem = this.completions[index];
        let text = completionItem.insertText !== undefined ? completionItem.insertText : completionItem.label;

        let lineStr = this.code.line(line);

        let { start: replaceStart, end: replaceEnd } = getCompletionRange(lineStr, column);

        this.code.tx();
        this.code.setStateBefore(this.offset, this.selection || undefined);
        let startOffset = this.code.getOffset(line, replaceStart);
        let endOffset = this.code.getOffset(line, replaceEnd);
        this.code.remove(startOffset, endOffset - startOffset);
        this.code.insert(text, startOffset);
        this.offset = startOffset + text.length;
        this.code.setStateAfter(this.offset, this.selection || undefined);
        this.code.commit();

        this.renderer.closeCompletion();
        this.isCompletionOpen = false;
        this.renderer.renderChanges(this.getEditorState());
    }

    private handleCompletionKey(event: KeyboardEvent): boolean {
        if (!this.isCompletionOpen) return false;

        let completionsCount = this.completions.length;

        if (event.key === "ArrowDown") {
            const next = (this.selectedCompletionIndex + 1) % completionsCount;
            this.selectedCompletionIndex = next;
            this.renderer.highlightCompletion(next);
            return true;
        }

        if (event.key === "ArrowUp") {
            const prev = (this.selectedCompletionIndex - 1 + completionsCount) % completionsCount;
            this.selectedCompletionIndex = prev;
            this.renderer.highlightCompletion(prev);
            return true;
        }

        if (event.key === "Enter") {
            this.applyCompletion(this.selectedCompletionIndex);
            return true;
        }

        if (event.key === "Escape") {
            this.renderer.closeCompletion();
            this.isCompletionOpen = false;
            return true;
        }

        return false;
    }

    private handleSearchKey(event: KeyboardEvent): boolean {
        const { key, altKey, ctrlKey, metaKey, shiftKey } = event;
        let isSearch = false;

        if (metaKey && !shiftKey && key.toLowerCase() == 'f') {
            this.renderer.removeAllHighlights(this.search);

            this.search.setActive(true);
            this.search.setNeedsFocus(true);
            let pattern = this.search.getPattern();

            if (this.selection && !this.selection.isEmpty()) {
                let [start, end] = this.selection!.sorted();
                let content = this.code.getIntervalContent2(start, end);
                pattern = content;
            }

            let matches = this.code.search(pattern);
            this.search.setPattern(pattern);
            this.search.setMatches(matches);

            // Find the first match
            let { line, column } = this.code.getPosition(this.offset);
            let foundIndex = matches.findIndex((match) => match.line > line ||
                (match.line === line && match.column + pattern.length >= column)
            );
            if (foundIndex === -1 && matches.length > 0) { foundIndex = 0; }
            this.search.setSelected(foundIndex);

            this.renderer.renderSearch(this.search, this.getEditorState(), {
                onKeyDown: this.onSearchKeyDown.bind(this),
                onInputChange: this.onSearchInputChange.bind(this)
            });
            isSearch = true;
        }


        if (event.key === "Escape" && this.search.isActive()) {
            this.renderer.removeAllHighlights(this.search);
            this.renderer.removeSearch(this.getEditorState());
            this.search.clear();
            isSearch = false;
        }

        return isSearch;
    }

    private onSearchKeyDown(event: KeyboardEvent, input: HTMLTextAreaElement) {
        const pattern = this.search.getPattern();
        const patternLines = pattern.split(/\r?\n/);
        const isMultiline = patternLines.length > 1;

        if (event.metaKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
            event.preventDefault();
            event.stopPropagation();
            // ignore search  
            return
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.renderer.removeAllHighlights(this.search);
            this.renderer.removeSearch(this.getEditorState());
            this.search.clear();
            this.renderer.renderCursorOrSelection(this.getEditorState());
            return;
        }

        if ((event.altKey || !isMultiline) && event.key === 'ArrowUp') {
            event.preventDefault();
            event.stopPropagation();
            const currentMatches = this.search.getMatches();
            if (currentMatches.length === 0) return;
            this.renderer.removeSelectedHighlight(this.search);
            this.search.selectPrev();
            this.search.setFocused(true);
            this.search.setNeedsFocus(true);
            this.renderer.revealCursor(this.getEditorState(), this.search.getSelectedMatch()?.line);
            this.renderer.updateSearchHighlights(this.getEditorState());
            this.renderer.focusSearchInput();
            return;
        }

        if ((event.altKey || !isMultiline) && event.key === 'ArrowDown') {
            event.preventDefault();
            event.stopPropagation();
            const currentMatches = this.search.getMatches();
            if (currentMatches.length === 0) return;
            this.renderer.removeSelectedHighlight(this.search);
            this.search.selectNext();
            this.search.setFocused(true);
            this.search.setNeedsFocus(true);
            this.renderer.revealCursor(this.getEditorState(), this.search.getSelectedMatch()?.line);
            this.renderer.updateSearchHighlights(this.getEditorState());
            this.renderer.focusSearchInput();
            return;
        }

        if (!event.shiftKey && event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            const selectedMatch = this.search.getSelectedMatch();
            if (selectedMatch) {
                this.renderer.removeAllHighlights(this.search);
                this.renderer.removeSearch(this.getEditorState());
                let start = this.code.getOffset(selectedMatch.line, selectedMatch.column);
                let end = start + this.search.getPattern().length;
                this.offset = end;
                this.selection = new Selection(start, end);
                this.search.clear();
                this.container.focus();
                let focused = this.renderer.revealCursor(this.getEditorState(), selectedMatch.line);
                if (!focused) this.renderer.renderCursorOrSelection(this.getEditorState());
            }
            return;
        }
    }

    private onSearchInputChange(pattern: string) {
        // Clear everything
        this.renderer.removeAllHighlights(this.search);

        if (!pattern) {
            this.renderer.updateSearchLabel('');
            this.search.clear();
            this.search.setActive(true);
            this.search.setFocused(true);
            this.search.setNeedsFocus(true);
            this.renderer.updateSearchHighlights(this.getEditorState());
            return;
        }

        // Perform search
        const matches = this.getEditorState().code.search(pattern);
        this.search.clear();
        this.search.setActive(true);
        this.search.setFocused(true);
        this.search.setMatches(matches);
        this.search.setPattern(pattern);

        // Find first match after cursor
        const { line, column } = this.code.getPosition(this.offset);
        let foundIndex = matches.findIndex((match) =>
            match.line > line ||
            (match.line === line && match.column >= column)
        );
        if (foundIndex === -1 && matches.length > 0) {
            foundIndex = 0;
        }

        this.search.setSelected(foundIndex);
        this.renderer.updateSearchHighlights(this.getEditorState());
        this.search.setNeedsFocus(true);
    }

    public applyChange(change: Change) {
        if (change.edits.length === 0) return;

        this.code.tx();
        this.code.setStateBefore(this.offset, this.selection || undefined);
        for (const edit of change.edits) {
            if (edit.operation === Operation.Insert) {
                this.code.insert(edit.text, edit.start);
            } else if (edit.operation === Operation.Remove) {
                this.code.remove(edit.start, edit.text.length);
            }
        }
        this.code.setStateAfter(this.offset, this.selection || undefined);
        this.code.commit();

        this.recomputeDiffs();

        this.renderer.renderChanges(this.getEditorState());
    }

    public setDiffEnabled(enabled: boolean): void {
        this.setDiffMode(enabled ? (this.focusedDiffEnabled ? 'diff' : 'combine') : 'plain');
    }

    public setFocusedDiffMode(enabled: boolean, contextLines: number = 3): void {
        this.setDiffMode(enabled ? 'diff' : (this.diffEnabled ? 'combine' : 'plain'), contextLines);
    }

    private isOriginalCodeInitializing = false;

    public setDiffMode(mode: 'plain' | 'diff' | 'combine', contextLines: number = 3): void {
        const diffEnabled = mode !== 'plain';
        const focusedDiffEnabled = mode === 'diff';

        if (
            this.diffEnabled === diffEnabled &&
            this.focusedDiffEnabled === focusedDiffEnabled &&
            this.focusedDiffContextLines === contextLines
        ) {
            return;
        }

        const wasDiffEnabled = this.diffEnabled;

        this.diffEnabled = diffEnabled;
        this.renderer.setDiffEnabled(diffEnabled);

        this.focusedDiffEnabled = focusedDiffEnabled;
        this.focusedDiffContextLines = Math.max(0, contextLines);
        this.renderer.setFocusedDiffMode(focusedDiffEnabled, this.focusedDiffContextLines);

        if (diffEnabled && !wasDiffEnabled && !this.originalCode && !this.isOriginalCodeInitializing) {
            const baseline = this.pendingOriginalContent ?? this.originalContentString ?? this.code.getContent();
            this.isOriginalCodeInitializing = true;
            void this.initOriginalCode(baseline).then(() => {
                this.isOriginalCodeInitializing = false;
                if (!this.diffEnabled) return;
                this.recomputeDiffs();
                this.renderer.render(this.getEditorState());
            });
        }

        if (!this.isOriginalCodeInitializing) {
            this.recomputeDiffs();
        }

        if (!diffEnabled) {
            this.renderer.clearAllDiffs();
        }
        this.renderer.render(this.getEditorState());
    }

    public setOriginalCode(content: string): void {
        this.pendingOriginalContent = content;
        this.isOriginalCodeInitializing = true;
        void this.initOriginalCode(content).then((updated) => {
            this.pendingOriginalContent = null;
            this.isOriginalCodeInitializing = false;
            if (!this.diffEnabled || !updated) return;
            this.recomputeDiffs();
            this.renderer.render(this.getEditorState());
        });
    }

    public setOriginalText(content: string): void {
        this.pendingOriginalContent = content;
    }

    private lastDiffOriginalCode: Code | null = null;
    private lastDiffCurrentCode: Code | null = null;
    private lastDiffOriginalVersion: number = -1;
    private lastDiffCurrentVersion: number = -1;

    public recomputeDiffs(): void {
        if (!this.diffEnabled || !this.originalCode) {
            this.diffs = undefined;
            return;
        }

        const multibufferCode = this.code as Code & {
            computeGitChanges?: () => DiffModel;
            getMultibufferDiffs?: () => DiffModel;
        };
        if (multibufferCode.computeGitChanges) {
            this.diffs = multibufferCode.computeGitChanges();
            return;
        }
        if (multibufferCode.getMultibufferDiffs) {
            this.diffs = multibufferCode.getMultibufferDiffs();
            return;
        }

        if (this.originalCode === this.code) {
            this.diffs = DiffModel.empty();
            return;
        }

        // Reuse memoized diffs if code versions haven't changed
        if (
            this.diffs !== undefined &&
            this.lastDiffOriginalCode === this.originalCode &&
            this.lastDiffCurrentCode === this.code &&
            this.lastDiffOriginalVersion === this.originalCode.getVersionId() &&
            this.lastDiffCurrentVersion === this.code.getVersionId()
        ) {
            return;
        }

        this.lastDiffOriginalCode = this.originalCode;
        this.lastDiffCurrentCode = this.code;
        this.lastDiffOriginalVersion = this.originalCode.getVersionId();
        this.lastDiffCurrentVersion = this.code.getVersionId();

        this.diffs = computeGitChangesFromSource(this.originalCode, this.code, this.code.getDirtyRange()).diffs;
    }

}

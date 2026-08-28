import { CSS_CLASS } from "../constants";
import { HighlighedNode, WordHighlight } from "../code";
import { TokenDictionary, BinaryTokens } from "../tokens";
import {
    AnycodeLine,
    ButtonColumnElement,
    FoldColumnElement,
    FoldElement,
    GutterElement,
    RealRowElements,
} from "../types";
import { objectHash } from "../utils";
import { EditorSettings } from "../editor";
import { DiffInfo, DiffModel } from "../diff";
import { DiagnosticRenderer } from "./DiagnosticRenderer";

/**
 * LineRenderer is responsible for creating line elements.
 * It doesn't manage DOM or query lines - just creates elements.
 */
export class LineRenderer {
    private diagnosticRenderer: DiagnosticRenderer;

    constructor(diagnosticRenderer: DiagnosticRenderer = new DiagnosticRenderer()) {
        this.diagnosticRenderer = diagnosticRenderer;
    }

    /**
     * Creates a line wrapper element with syntax highlighting and diff/error classes
     */
    public createLineWrapper(
        lineNumber: number,
        nodes: HighlighedNode[],
        errorLines: Map<number, string>,
        settings: EditorSettings,
        diffs?: DiffModel,
        wordHighlight?: WordHighlight | null,
        binaryTokens?: Uint32Array,
        lineText?: string
    ): AnycodeLine {
        const wrapper = document.createElement('div') as AnycodeLine;

        wrapper.lineNumber = lineNumber;
        wrapper.className = CSS_CLASS.LINE;

        // Add 32-bit numeric hash for fast zero-alloc change tracking
        const hash = binaryTokens && lineText !== undefined
            ? BinaryTokens.fastHash(binaryTokens, lineText)
            : objectHash(nodes);
        wrapper.hash = hash;

        // Check if this line was changed in diff mode
        if (diffs) {
            const diffInfo = diffs.get(lineNumber + 1);
            if (diffInfo?.changeType === 'modified') {
                wrapper.classList.add(CSS_CLASS.DIFF_CHANGED);
            } else if (diffInfo?.changeType === 'added') {
                wrapper.classList.add(CSS_CLASS.DIFF_ADDED);
            }
        }

        if (binaryTokens && lineText !== undefined) {
            const tokenCount = (binaryTokens.length / 2) | 0;
            if (tokenCount === 0 || (tokenCount === 1 && lineText === "\u200B")) {
                wrapper.appendChild(document.createElement('br'));
            } else {
                const whToken = wordHighlight?.token;
                const whText = wordHighlight?.text;

                for (let i = 0; i < tokenCount; i++) {
                    const word0 = binaryTokens[i * 2];
                    const word1 = binaryTokens[i * 2 + 1];

                    const tokenId = (word0 >>> 16) & 0xffff;
                    const startColumn = (word1 >>> 16) & 0xffff;
                    const textLen = word1 & 0xffff;

                    const text = lineText.substring(startColumn, startColumn + textLen);
                    const span = document.createElement('span');

                    let classString = TokenDictionary.getClassString(tokenId);
                    if (tokenId === 0 && text === '\t') {
                        classString = classString ? `${classString} indent` : 'indent';
                    }

                    if (whToken && whText && text === whText && classString.includes(whToken)) {
                        classString = classString ? `${classString} wh` : 'wh';
                    }

                    if (classString) {
                        span.className = classString;
                    }
                    span.textContent = text;
                    wrapper.appendChild(span);
                }
            }
        } else if (nodes.length === 0 || (nodes.length === 1 && nodes[0].text === "\u200B")) {
            wrapper.appendChild(document.createElement('br'));
        } else {
            for (const { name, text } of nodes) {
                const span = document.createElement('span');
                const tokenId = TokenDictionary.getId(name);
                let classString = TokenDictionary.getClassString(tokenId);

                if (!name && text === '\t') {
                    classString = classString ? `${classString} indent` : 'indent';
                }

                if (
                  wordHighlight?.token &&
                  wordHighlight?.text &&
                  text === wordHighlight.text &&
                  classString.includes(wordHighlight.token)
                ) {
                  classString = classString ? `${classString} wh` : 'wh';
                }

                if (classString) {
                    span.className = classString;
                }
                span.textContent = text;
                wrapper.appendChild(span);
            }
        }

        const errorMessage = errorLines.get(lineNumber);
        if (errorMessage) {
            this.diagnosticRenderer.render(wrapper, errorMessage);
        }

        return wrapper;
    }

    public renderDiagnostics(line: AnycodeLine, message?: string | null) {
        this.diagnosticRenderer.render(line, message);
    }

    /**
     * Creates a line number element for the gutter
     */
    public createLineNumber(
        lineNumber: number,
        settings: EditorSettings,
        diffs?: DiffModel,
        displayLineNumber: number = lineNumber,
    ): GutterElement {
        const div = document.createElement('div') as GutterElement;
        div.className = CSS_CLASS.GUTTER;
        div.lineNumber = lineNumber;
        div.textContent = (displayLineNumber + 1).toString();

        if (diffs) {
            const diffInfo = diffs.get(lineNumber + 1);
            if (diffInfo?.changeType === 'modified') {
                div.classList.add(CSS_CLASS.DIFF_CHANGED);
            } else if (diffInfo?.changeType === 'added') {
                div.classList.add(CSS_CLASS.DIFF_ADDED);
            } else if (diffInfo?.changeType === 'deleted') {
                div.classList.add(CSS_CLASS.DIFF_DELETED);
            }
        }

        return div;
    }

    /**
     * Creates a button element for the buttons column
     */
    public createLineButtons(
        lineNumber: number,
        runLines: number[],
        errorLines: Map<number, string>,
        settings: EditorSettings
    ): ButtonColumnElement {
        const div = document.createElement('div') as ButtonColumnElement;
        div.className = CSS_CLASS.BUTTONS;
        div.lineNumber = lineNumber;

        const isRun = runLines.includes(lineNumber);

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

    public createLineElements(
        lineNumber: number,
        nodes: HighlighedNode[],
        errorLines: Map<number, string>,
        settings: EditorSettings,
        diffs: DiffModel | undefined,
        runLines: number[],
        foldIndicator: { canFold: boolean; collapsed: boolean },
        wordHighlight?: WordHighlight | null,
        displayLineNumber?: number,
        binaryTokens?: Uint32Array,
        lineText?: string,
    ): RealRowElements {
        const code = this.createLineWrapper(lineNumber, nodes, errorLines, settings, diffs, wordHighlight, binaryTokens, lineText);
        const gutter = this.createLineNumber(lineNumber, settings, diffs, displayLineNumber);
        const btn = this.createLineButtons(lineNumber, runLines, errorLines, settings);
        const fold = document.createElement('div') as FoldColumnElement;
        fold.className = CSS_CLASS.FOLDS;
        fold.lineNumber = lineNumber;

        if (foldIndicator.canFold) {
            const toggle = document.createElement('button') as FoldElement;
            toggle.className = `${CSS_CLASS.FOLD_TOGGLE} ${foldIndicator.collapsed ? CSS_CLASS.COLLAPSED : CSS_CLASS.EXPANDED}`;
            toggle.lineNumber = lineNumber;
            toggle.type = 'button';
            toggle.ariaLabel = foldIndicator.collapsed ? 'Expand folded block' : 'Collapse block';
            fold.appendChild(toggle);
        }

        return { code, gutter, btn, fold };
    }

    /**
     * Creates a spacer element for virtual scrolling
     */
    public createSpacer(height: number | string): HTMLDivElement {
        const spacer = document.createElement('div');
        spacer.className = CSS_CLASS.SPACER;
        spacer.style.height = typeof height === "number" ? `${height}px` : height;
        return spacer;
    }
}

import { HighlighedNode, WordHighlight } from "../code";
import { AnycodeLine, objectHash } from "../utils";
import { EditorSettings } from "../editor";
import { DiffInfo } from "../diff";
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
        diffs?: Map<number, DiffInfo>,
        wordHighlight?: WordHighlight | null
    ): AnycodeLine {
        const wrapper = document.createElement('div') as AnycodeLine;

        wrapper.lineNumber = lineNumber;
        wrapper.className = "line";
        wrapper.style.lineHeight = `${settings.lineHeight}px`;

        // Add hash for change tracking
        const hash = objectHash(nodes).toString();
        wrapper.hash = hash;

        // Check if this line was changed in diff mode
        if (diffs) {
            const diffInfo = diffs.get(lineNumber + 1);
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
                const classNameParts: string[] = [];
                if (name) {
                    // Add both full token class (e.g. "function.method") and path segments
                    // ("function", "method") so styles can gracefully fall back from specific
                    // to general when a theme misses a deep token color.
                    // Deduplicate classes to avoid repeating when category name has no dots.
                    const parts = name.split('.').filter(Boolean);
                    classNameParts.push(...Array.from(new Set([name, ...parts])));
                }
                if (!name && text === '\t') classNameParts.push('indent');
                
                // Add highlight class if it matches the wordHighlight text and is highlightable
                if (
                  wordHighlight?.token &&
                  classNameParts.includes(wordHighlight.token) &&
                  text === wordHighlight.text
                ) {
                  classNameParts.push('wh');
                }

                if (classNameParts.length > 0) {
                    span.className = classNameParts.join(' ');
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
        diffs?: Map<number, DiffInfo>
    ): HTMLDivElement {
        const div = document.createElement('div');
        div.className = "ln";
        div.textContent = (lineNumber + 1).toString();
        div.style.height = `${settings.lineHeight}px`;
        div.setAttribute('data-line', lineNumber.toString());

        if (diffs) {
            const diffInfo = diffs.get(lineNumber + 1);
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

    /**
     * Creates a button element for the buttons column
     */
    public createLineButtons(
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
        diffs: Map<number, DiffInfo> | undefined,
        runLines: number[],
        foldIndicator: { canFold: boolean; collapsed: boolean },
        wordHighlight?: WordHighlight | null,
    ): { code: AnycodeLine; gutter: HTMLDivElement; btn: HTMLDivElement; fold: HTMLDivElement } {
        const code = this.createLineWrapper(lineNumber, nodes, errorLines, settings, diffs, wordHighlight);
        const gutter = this.createLineNumber(lineNumber, settings, diffs);
        const btn = this.createLineButtons(lineNumber, runLines, errorLines, settings);
        const fold = document.createElement('div');
        fold.className = 'fd';
        fold.style.height = `${settings.lineHeight}px`;
        fold.setAttribute('data-line', lineNumber.toString());

        if (foldIndicator.canFold) {
            const toggle = document.createElement('button');
            toggle.className = `fold-toggle ${foldIndicator.collapsed ? 'collapsed' : 'expanded'}`;
            toggle.setAttribute('data-line', lineNumber.toString());
            toggle.setAttribute('type', 'button');
            toggle.setAttribute('aria-label', foldIndicator.collapsed ? 'Expand folded block' : 'Collapse block');
            fold.appendChild(toggle);
        }

        return { code, gutter, btn, fold };
    }

    /**
     * Creates a spacer element for virtual scrolling
     */
    public createSpacer(height: number): HTMLDivElement {
        const spacer = document.createElement('div');
        spacer.className = "spacer";
        spacer.style.height = `${height}px`;
        return spacer;
    }
}

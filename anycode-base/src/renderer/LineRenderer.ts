import { HighlighedNode } from "../code";
import { AnycodeLine, objectHash, minimize } from "../utils";
import { EditorSettings } from "../editor";
import { DiffInfo } from "../diff";

/**
 * LineRenderer is responsible for creating line elements.
 * It doesn't manage DOM or query lines - just creates elements.
 */
export class LineRenderer {
    /**
     * Creates a line wrapper element with syntax highlighting and diff/error classes
     */
    public createLineWrapper(
        lineNumber: number,
        nodes: HighlighedNode[],
        errorLines: Map<number, string>,
        settings: EditorSettings,
        diffs?: Map<number, DiffInfo>
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

import { Code } from "../code";
import { AnycodeLine, findNodeAndOffset, findPrevWord } from "../utils";
import { Completion, completionKindMap } from "../lsp";

/**
 * CompletionRenderer is responsible for autocomplete UI.
 * Manages completion box rendering, positioning, and selection.
 */
export class CompletionRenderer {
    private container: HTMLDivElement;
    private completionContainer: HTMLDivElement | null = null;

    // Dependencies
    private getLineFn: (lineNumber: number) => AnycodeLine | null;

    constructor(
        container: HTMLDivElement,
        getLine: (lineNumber: number) => AnycodeLine | null
    ) {
        this.container = container;
        this.getLineFn = getLine;
    }

    // ========== Completion UI ==========

    public render(
        completions: Completion[],
        selectedIndex: number,
        code: Code,
        offset: number,
        onCompletionClick: (index: number) => void
    ) {
        if (!this.completionContainer) {
            this.completionContainer = document.createElement('div');
            this.completionContainer.className = 'completion-box glass';
            this.container.appendChild(this.completionContainer);
            this.move(code, offset);
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
        this.move(code, offset);
    }

    public move(code: Code, offset: number) {
        let { line, column } = code.getPosition(offset);
        let lineStr = code.line(line);
        let prev = findPrevWord(lineStr, column);

        const completion = this.completionContainer;

        const startLineDiv = this.getLineFn(line);
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

    public close() {
        this.completionContainer?.remove();
        this.completionContainer = null;
    }

    public isOpen() {
        return this.completionContainer !== null;
    }

    public highlight(index: number) {
        if (!this.completionContainer) return;
        const children = this.completionContainer.children;
        for (let i = 0; i < children.length; i++) {
            const el = children[i] as HTMLElement;
            el.classList.toggle('completion-active', i === index);
            if (i === index) el.scrollIntoView({ block: 'nearest' });
        }
    }
}

import { Code } from "../code";
import { AnycodeLine, Point } from "../types";
import { findNodeAndOffset } from "../utils";

/**
 * HoverRenderer is responsible for hover tooltip UI.
 * It renders plain text and keeps the popup near the hovered position.
 */
export class HoverRenderer {
    private container: HTMLDivElement;
    private hoverContainer: HTMLDivElement | null = null;

    // Dependencies
    private getLineFn: (lineNumber: number) => AnycodeLine | null;

    constructor(
        container: HTMLDivElement,
        getLine: (lineNumber: number) => AnycodeLine | null
    ) {
        this.container = container;
        this.getLineFn = getLine;
    }

    public render(content: string, code: Code, point: Point) {
        const text = content.trim();
        if (!text) {
            this.close();
            return;
        }

        if (!this.hoverContainer) {
            this.hoverContainer = document.createElement('div');
            this.hoverContainer.className = 'hover-box glass';
            this.container.appendChild(this.hoverContainer);
        }

        this.hoverContainer.textContent = text;
        this.move(code, point);
    }

    public move(_code: Code, point: Point) {
        if (!this.hoverContainer) return;

        const line = point.row;
        const column = point.column;
        const lineDiv = this.getLineFn(line);
        const pos = lineDiv ? findNodeAndOffset(lineDiv, Math.max(column, 0) + 1) : null;

        if (pos) {
            const { node } = pos;
            if (!node) return;
            const range = document.createRange();
            range.selectNode(node);
            const rect = range.getBoundingClientRect();
            const containerRect = this.container.getBoundingClientRect();
            const left = rect.left - containerRect.left + this.container.scrollLeft;
            const top = rect.bottom - containerRect.top + this.container.scrollTop + 2;

            this.hoverContainer.style.position = 'absolute';
            this.hoverContainer.style.left = `${left}px`;
            this.hoverContainer.style.top = `${top}px`;
            return;
        }

        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const containerRect = this.container.getBoundingClientRect();
        const top = rect.bottom - containerRect.top + this.container.scrollTop + 2;
        const left = rect.left - containerRect.left + this.container.scrollLeft;
        this.hoverContainer.style.position = 'absolute';
        this.hoverContainer.style.top = `${top}px`;
        this.hoverContainer.style.left = `${left}px`;
    }

    public close() {
        this.hoverContainer?.remove();
        this.hoverContainer = null;
    }

    public isOpen() {
        return this.hoverContainer !== null;
    }
}

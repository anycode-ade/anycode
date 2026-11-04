import { AnycodeLine } from "../types";

export interface InlineDecoration {
    type?: 'after' | 'before';
    contentText?: string;
    color?: string;
    backgroundColor?: string;
    fontStyle?: string;
    margin?: string;
}

export class DecorationRenderer {
    private getDecorationSpan(line: AnycodeLine): HTMLSpanElement | null {
        return line.querySelector('span.inline-decoration');
    }

    public render(line: AnycodeLine, decorations?: InlineDecoration[] | null) {
        const existing = this.getDecorationSpan(line);
        if (!decorations || decorations.length === 0) {
            if (existing) existing.remove();
            return;
        }

        const dec = decorations[0];
        if (!dec.contentText) {
            if (existing) existing.remove();
            return;
        }

        let span = existing;
        if (!span) {
            span = document.createElement('span');
            span.className = dec.type === 'before' ? 'inline-decoration inline-decoration-before' : 'inline-decoration';
            span.contentEditable = 'false';

            const br = line.querySelector('br');
            if (br) {
                line.insertBefore(span, br);
            } else {
                line.appendChild(span);
            }
        }

        span.textContent = "\u200B" + dec.contentText;
        if (dec.color) span.style.color = dec.color;
        if (dec.backgroundColor) span.style.backgroundColor = dec.backgroundColor;
        if (dec.fontStyle) span.style.fontStyle = dec.fontStyle;
        if (dec.margin) span.style.margin = dec.margin;
    }
}

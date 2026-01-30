import { AnycodeLine, minimize } from "../utils";

export class DiagnosticRenderer {
    private getDiagnosticSpan(line: AnycodeLine): HTMLSpanElement | null {
        return line.querySelector('span.diagnostic');
    }

    private isEmptyLine(line: AnycodeLine): boolean {
        for (const child of line.children) {
            if (child.tagName === 'BR') continue;
            if (child.classList.contains('diagnostic')) continue;
            return false;
        }
        return true;
    }

    private getInsertAnchor(line: AnycodeLine): ChildNode | null {
        const last = line.lastChild;
        if (last && last.nodeType === Node.ELEMENT_NODE) {
            const el = last as HTMLElement;
            if (el.tagName === 'BR') return last;
        }
        return null;
    }

    public render(line: AnycodeLine, diagnosticMessage?: string | null) {
        line.classList.remove('has-error');
        line.removeAttribute('data-error');

        const text = diagnosticMessage ? minimize(diagnosticMessage) : '';
        const existing = this.getDiagnosticSpan(line);

        // Don't show diagnostics on empty lines
        if (!text || this.isEmptyLine(line)) {
            if (existing) existing.remove();
            return;
        }

        if (existing) {
            if (existing.textContent !== text) {
                existing.textContent = text;
            }
            return;
        }

        const span = document.createElement('span');
        span.className = 'diagnostic';
        span.textContent = "\u200B" + text;
        span.setAttribute('data-diagnostic', 'true');
        span.setAttribute('contentEditable', 'false');

        const anchor = this.getInsertAnchor(line);
        if (anchor) {
            line.insertBefore(span, anchor);
        } else {
            line.appendChild(span);
        }
    }
}

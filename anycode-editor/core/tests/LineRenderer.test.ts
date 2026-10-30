import { afterEach, describe, expect, it } from 'vitest';
import { computeGitChanges } from '../src/diff';
import { LineRenderer } from '../src/renderer/LineRenderer';
import { BinaryTokens } from '../src/tokens';

function createFakeElement() {
    const classes = new Set<string>();
    return {
        className: '',
        textContent: '',
        children: [] as any[],
        classList: {
            add(...names: string[]) {
                names.forEach((name) => classes.add(name));
            },
            contains(name: string) {
                return classes.has(name);
            },
        },
        appendChild(child: any) {
            this.children.push(child);
        },
    };
}

describe('LineRenderer word diff highlighting', () => {
    const originalDocument = (globalThis as any).document;

    afterEach(() => {
        (globalThis as any).document = originalDocument;
    });

    it('splits syntax-token spans at changed word ranges', () => {
        (globalThis as any).document = { createElement: () => createFakeElement() };
        const currentText = 'const newName = 1;';
        const diff = computeGitChanges('const oldName = 1;', currentText);
        const line = new LineRenderer().createLineWrapper(
            0,
            [],
            new Map(),
            {} as any,
            diff,
            undefined,
            BinaryTokens.encode([{ name: null, text: currentText }]),
            currentText,
        );

        const spans = Array.from(line.children);
        expect(spans.map((span: any) => span.textContent).join('')).toBe(currentText);
        const changedSpans = spans.filter((span: any) => span.className.includes('diff-word-added'));
        expect(changedSpans.map((span: any) => span.textContent)).toEqual(['newName']);
    });

    it('keeps one pass over ranges when ranges span and skip syntax tokens', () => {
        (globalThis as any).document = { createElement: () => createFakeElement() };
        const currentText = 'let total = calculateTotal(a, b, c)';
        const diff = computeGitChanges('let total = calculateSum(a, b)', currentText);
        const line = new LineRenderer().createLineWrapper(
            0,
            [],
            new Map(),
            {} as any,
            diff,
            undefined,
            BinaryTokens.encode([
                { name: null, text: 'let total = calc' },
                { name: null, text: 'ulateTotal(a, b' },
                { name: null, text: ', ' },
                { name: null, text: 'c)' },
            ]),
            currentText,
        );

        const spans = Array.from(line.children);
        expect(spans.map((span: any) => span.textContent).join('')).toBe(currentText);
        const changedSpans = spans.filter((span: any) => span.className.includes('diff-word-added'));
        expect(changedSpans.map((span: any) => span.textContent)).toEqual(['calc', 'ulateTotal', ', ', 'c']);
    });
});

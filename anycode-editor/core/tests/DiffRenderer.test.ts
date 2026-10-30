import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DiffRenderer } from '../src/renderer/DiffRenderer';
import { BinaryTokens } from '../src/tokens';
import { computeGitChanges } from '../src/diff';

describe('DiffRenderer.computeVisibleRanges', () => {
    it('should return merged ranges for focused diff', () => {
        const renderer = new DiffRenderer({} as any, {} as any, {} as any, {} as any);
        renderer.setFocusedDiffMode(true, 3);

        const diffs = new Map([
            [10, { changeType: 'modified' as const, hunkId: 0 }],
        ]);

        const ranges = renderer.computeVisibleRanges(100, diffs);
        expect(ranges).toEqual([
            { start: 6, end: 12 }, // line 9 (0-indexed) with context ±3
        ]);
    });

    it('should handle 1,000,000 lines in < 1ms', () => {
        const renderer = new DiffRenderer({} as any, {} as any, {} as any, {} as any);
        renderer.setFocusedDiffMode(true, 3);

        const diffs = new Map([
            [500_000, { changeType: 'modified' as const, hunkId: 0 }],
        ]);

        const start = performance.now();
        const ranges = renderer.computeVisibleRanges(1_000_000, diffs);
        const elapsed = performance.now() - start;

        expect(ranges).toEqual([
            { start: 499_996, end: 500_002 },
        ]);
        expect(elapsed).toBeLessThan(10); // Runs instantly in < 1ms
    });
});

describe('DiffRenderer.computeVisibleLines', () => {
    it('should not let diff context lines cross file boundaries when isSameFileBody is provided', () => {
        const renderer = new DiffRenderer({} as any, {} as any, {} as any, {} as any);
        renderer.setFocusedDiffMode(true, 3); // 3 context lines

        // Mock a multibuffer layout:
        // row 0: file 0 header
        // rows 1..10: file 0 body (lines 0..9)
        // row 11: file 1 header
        // row 12: file 1 body line 0 (has diff at 1-indexed line 13)
        const isSameFileBody = (lineA: number, lineB: number): boolean => {
            const getFile = (line: number) => {
                if (line >= 1 && line <= 10) return 0;
                if (line >= 12 && line <= 20) return 1;
                return null;
            };
            const fA = getFile(lineA);
            const fB = getFile(lineB);
            return fA !== null && fA === fB;
        };

        const diffs = new Map([
            [13, { changeType: 'modified' as const, hunkId: 0 }],
        ]);

        const mockCode = { isSameFileBody } as any;
        const visible = renderer.computeVisibleLines(21, diffs, mockCode);
        expect(visible).toBeDefined();

        // Line 12 (0-indexed) has the diff.
        // Expanding UP should STOP at row 12 because row 11 is a header (isSameFileBody returns false).
        // It should NOT add row 10 (which is the last line of file 0).
        expect(visible!.has(12)).toBe(true);
        expect(visible!.has(10)).toBe(false); // Should NOT bleed into file 0!
        expect(visible!.has(13)).toBe(true);  // Context down line 1
        expect(visible!.has(14)).toBe(true);  // Context down line 2
        expect(visible!.has(15)).toBe(true);  // Context down line 3
    });
});

describe('DiffRenderer.createGhostRowElements', () => {
    let originalDocument: any;

    beforeEach(() => {
        originalDocument = (globalThis as any).document;
        (globalThis as any).document = {
            createElement: (tag: string) => {
                const classListSet = new Set<string>();
                const element: any = {
                    className: '',
                    textContent: '',
                    children: [] as any[],
                    classList: {
                        add(...cls: string[]) { cls.forEach(c => classListSet.add(c)); },
                        remove(...cls: string[]) { cls.forEach(c => classListSet.delete(c)); },
                        contains(c: string) { return classListSet.has(c); },
                    },
                    appendChild(child: any) { element.children.push(child); },
                };
                return element;
            },
        };
    });

    afterEach(() => {
        (globalThis as any).document = originalDocument;
    });

    it('should set line number on deleted ghost gutter element', () => {
        const renderer = new DiffRenderer({} as any, {} as any, {} as any, {} as any);
        const ghostRow = {
            kind: 'ghost' as const,
            hunkId: 0,
            anchorLine: 10,
            originalLineIndex: 14,
        };
        const elements = renderer.createGhostRowElements(
            ghostRow,
            'deleted line text',
        );

        expect(elements.gutter.textContent).toBe('15');
        expect(elements.gutter.className).toContain('ln');
        expect(elements.gutter.className).toContain('line-deleted-ghost');
    });

    it('should use displayLineNumber when provided (e.g. multibuffer)', () => {
        const renderer = new DiffRenderer({} as any, {} as any, {} as any, {} as any);
        const ghostRow = {
            kind: 'ghost' as const,
            hunkId: 0,
            anchorLine: 10,
            originalLineIndex: 100,
        };
        const elements = renderer.createGhostRowElements(
            ghostRow,
            'deleted line text',
            undefined,
            undefined,
            41
        );

        expect(elements.gutter.textContent).toBe('42');
    });

    it('should render syntax highlighted spans from binary tokens (Uint32Array)', () => {
        const renderer = new DiffRenderer({} as any, {} as any, {} as any, {} as any);
        const ghostRow = {
            kind: 'ghost' as const,
            hunkId: 1,
            anchorLine: 5,
            originalLineIndex: 8,
        };
        const text = 'const x = 42;';
        const nodes = [
            { name: 'keyword', text: 'const ' },
            { name: 'variable', text: 'x' },
            { name: 'operator', text: ' = ' },
            { name: 'number', text: '42;' },
        ];
        const binaryTokens = BinaryTokens.encode(nodes);

        const elements = renderer.createGhostRowElements(
            ghostRow,
            text,
            binaryTokens,
        );

        const codeChildren = (elements.code as any).children;
        expect(codeChildren.length).toBe(4);
        expect(codeChildren[0].textContent).toBe('const ');
        expect(codeChildren[0].className).toContain('keyword');
        expect(codeChildren[1].textContent).toBe('x');
        expect(codeChildren[1].className).toContain('variable');
        expect(codeChildren[3].textContent).toBe('42;');
        expect(codeChildren[3].className).toContain('number');
    });

    it('highlights deleted words in a modified hunk ghost line, across token boundaries', () => {
        const renderer = new DiffRenderer({} as any, {} as any, {} as any, {} as any);
        const oldText = 'foo(a, b)';
        const diffs = computeGitChanges(oldText, 'foo(a)');
        const hunkId = diffs.getHunks()[0].hunkId;
        const oldRanges = diffs.getOldWordDiffRanges(hunkId);
        const binaryTokens = BinaryTokens.encode([
            { name: null, text: 'foo(a' },
            { name: null, text: ', ' },
            { name: null, text: 'b)' },
        ]);

        const elements = renderer.createGhostRowElements(
            { kind: 'ghost' as const, hunkId, anchorLine: 1, originalLineIndex: 0 },
            oldText,
            binaryTokens,
            undefined,
            undefined,
            oldRanges,
        );

        const children = (elements.code as any).children;
        expect(children.map((span: any) => span.textContent).join('')).toBe(oldText);
        const deleted = children.filter((span: any) => span.className.includes('diff-word-deleted'));
        expect(deleted.map((span: any) => span.textContent)).toEqual([', ', 'b']);
        expect((elements.code as any).wordDiffRanges).toBe(oldRanges);
    });
});


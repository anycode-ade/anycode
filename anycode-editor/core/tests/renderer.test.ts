import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Renderer } from '../src/renderer/Renderer';
import { EditorState } from '../src/editor';
import { Code } from '../src/code';
import { MultiBufferCode } from '../src/multibuffer';
import { Search } from '../src/search';
import { DiffModel, DiffHunk, computeGitChanges } from '../src/diff';
import { BinaryTokens } from '../src/tokens';

function createMockElement(tag: string = 'div'): any {
    const classListSet = new Set<string>();
    const styleObj: Record<string, string> = {};
    const children: any[] = [];
    const listeners: Record<string, Function[]> = {};

    return {
        tagName: tag.toUpperCase(),
        className: '',
        style: {
            display: '',
            height: '',
            transform: '',
            top: '',
            right: '',
            setProperty(prop: string, val: string) { styleObj[prop] = val; },
            removeProperty(prop: string) { delete styleObj[prop]; },
            get transform() { return styleObj.transform || ''; },
            set transform(val: string) { styleObj.transform = val; },
            get height() { return styleObj.height || ''; },
            set height(val: string) { styleObj.height = val; },
            get display() { return styleObj.display || ''; },
            set display(val: string) { styleObj.display = val; },
        },
        dataset: {},
        classList: {
            add(...cls: string[]) { cls.forEach(c => classListSet.add(c)); },
            remove(...cls: string[]) { cls.forEach(c => classListSet.delete(c)); },
            contains(c: string) { return classListSet.has(c); },
        },
        setAttribute(name: string, val: string) {},
        addEventListener(event: string, fn: Function) {
            if (!listeners[event]) listeners[event] = [];
            listeners[event].push(fn);
        },
        removeEventListener(event: string, fn: Function) {
            if (listeners[event]) listeners[event] = listeners[event].filter(f => f !== fn);
        },
        appendChild(child: any) {
            children.push(child);
            child.parentElement = this;
            return child;
        },
        append(...items: any[]) {
            items.forEach(i => this.appendChild(i));
        },
        replaceChildren(...items: any[]) {
            children.length = 0;
            items.forEach(i => this.appendChild(i));
        },
        querySelectorAll: () => [],
        querySelector: () => null,
        get children() { return children; },
        get firstChild() { return children[0] || null; },
        get lastChild() { return children[children.length - 1] || null; },
        isConnected: true,
        clientHeight: 600,
        scrollHeight: 5000,
        scrollTop: 0,
    };
}

describe('Renderer Sparse Visual Model', () => {
    let originalDocument: any;

    beforeEach(() => {
        originalDocument = (globalThis as any).document;
        (globalThis as any).document = {
            createElement: (tag: string) => createMockElement(tag),
            createDocumentFragment: () => createMockElement('fragment'),
        };
    });

    afterEach(() => {
        (globalThis as any).document = originalDocument;
    });

    it('handles 1,000,000 lines plain text in O(1)', () => {
        const renderer = new Renderer(
            createMockElement('div'),
            createMockElement('div'),
            createMockElement('div'),
            createMockElement('div'),
            createMockElement('div'),
            false
        );

        const code = new Code('line\n'.repeat(999_999) + 'line');
        const state: EditorState = {
            code,
            settings: { lineHeight: 20, fontSize: 14, buffer: 5 } as any,
            errorLines: new Map(),
            runLines: [],
            search: new Search(),
            diffs: new DiffModel([]),
            foldRanges: [],
            collapsedFoldStarts: new Set(),
            scrollbarMarkersEnabled: true,
        } as any;

        const start = performance.now();
        renderer.render(state);
        const elapsed = performance.now() - start;

        expect(renderer.getVisualRowCount()).toBe(1_000_000);
        expect(renderer.getVisualRow(0)).toEqual({ kind: 'real', lineIndex: 0 });
        expect(renderer.getVisualRow(500_000)).toEqual({ kind: 'real', lineIndex: 500_000 });
        expect(renderer.getVisualRow(999_999)).toEqual({ kind: 'real', lineIndex: 999_999 });
        expect(elapsed).toBeLessThan(100);
    });

    it('rerenders a line when its word-diff ranges are cleared', () => {
        const renderer = new Renderer(
            createMockElement('div'),
            createMockElement('div'),
            createMockElement('div'),
            createMockElement('div'),
            createMockElement('div'),
            false
        );
        const code = new Code('const newName = 1;');
        const lineText = code.line(0);
        const binaryTokens = code.getLineBinaryTokens(0);
        const line = createMockElement('div');
        line.lineNumber = 0;
        line.hash = BinaryTokens.fastHash(binaryTokens, lineText);
        line.wordDiffRanges = [{ start: 6, end: 13 }];

        expect((renderer as any).isLineChanged(line, 0, code, undefined)).toBe(true);
    });

    it('rerenders a ghost row when its deleted-word ranges change', () => {
        const renderer = new Renderer(
            createMockElement('div'),
            createMockElement('div'),
            createMockElement('div'),
            createMockElement('div'),
            createMockElement('div'),
            false
        );
        const diffs = computeGitChanges('foo(a, b)', 'foo(a)');
        const hunkId = diffs.getHunks()[0].hunkId;
        const originalHTMLElement = (globalThis as any).HTMLElement;
        class FakeHTMLElement {}
        (globalThis as any).HTMLElement = FakeHTMLElement;
        const ghost = Object.setPrototypeOf(createMockElement('div'), FakeHTMLElement.prototype);
        ghost.isGhost = true;
        ghost.hunkId = hunkId;
        ghost.originalLineIndex = 0;
        const row = { kind: 'ghost', hunkId, anchorLine: 1, originalLineIndex: 0 };
        const code = new Code('foo(a)');

        try {
            ghost.wordDiffRanges = diffs.getOldWordDiffRanges(hunkId);
            expect((renderer as any).isRowChanged(ghost, row, code, diffs)).toBe(false);

            ghost.wordDiffRanges = [{ start: 0, end: 3 }];
            expect((renderer as any).isRowChanged(ghost, row, code, diffs)).toBe(true);
        } finally {
            (globalThis as any).HTMLElement = originalHTMLElement;
        }
    });

    it('does not scan every line for a normal diff with one ghost hunk', () => {
        const renderer = new Renderer(
            createMockElement('div'),
            createMockElement('div'),
            createMockElement('div'),
            createMockElement('div'),
            createMockElement('div'),
            false
        );

        let foldChecks = 0;
        (renderer as any).isHiddenByFold = () => {
            foldChecks++;
            return false;
        };

        const code = new Code('line\n'.repeat(999_999) + 'line');
        const state: EditorState = {
            code,
            settings: { lineHeight: 20, fontSize: 14, buffer: 5 } as any,
            errorLines: new Map(),
            runLines: [],
            search: new Search(),
            diffs: new DiffModel([{
                hunkId: 1,
                startLine: 500_000,
                lineCount: 1,
                changeType: 'modified',
                oldLineNumbers: [500_000],
            }]),
            foldRanges: [],
            collapsedFoldStarts: new Set(),
            scrollbarMarkersEnabled: true,
        } as any;

        renderer.render(state);

        expect(foldChecks).toBe(0);
        expect(renderer.getVisualRowCount()).toBe(1_000_001);
        expect(renderer.getVisualRow(499_999)).toMatchObject({
            kind: 'ghost',
            originalLineIndex: 499_999,
        });
        expect(renderer.getVisualRow(500_000)).toEqual({
            kind: 'real',
            lineIndex: 499_999,
        });
    });

    it('hides ghosts whose anchor is inside a collapsed fold', () => {
        const renderer = new Renderer(
            createMockElement('div'),
            createMockElement('div'),
            createMockElement('div'),
            createMockElement('div'),
            createMockElement('div'),
            false
        );

        const code = new Code('function foo() {\n    return 1;\n}');
        const state: EditorState = {
            code,
            settings: { lineHeight: 20, fontSize: 14, buffer: 5 } as any,
            errorLines: new Map(),
            runLines: [],
            search: new Search(),
            diffs: new DiffModel([{
                hunkId: 1,
                startLine: 2,
                lineCount: 0,
                changeType: 'deleted',
                oldLineNumbers: [2],
                ghostAnchorLine: 2,
            }]),
            foldRanges: [{ startLine: 0, endLine: 2, kind: 'block' }],
            collapsedFoldStarts: new Set([0]),
            scrollbarMarkersEnabled: true,
        } as any;

        renderer.render(state);

        expect(renderer.getVisualRows(0, renderer.getVisualRowCount()).some((row) => row.kind === 'ghost')).toBe(false);

        state.collapsedFoldStarts = new Set();
        renderer.render(state);

        expect(renderer.getVisualRows(0, renderer.getVisualRowCount()).some((row) => row.kind === 'ghost')).toBe(true);
    });

    it('handles 1,000,000 lines in Focused Diff with 1 change in < 1ms', () => {
        const renderer = new Renderer(
            createMockElement('div'),
            createMockElement('div'),
            createMockElement('div'),
            createMockElement('div'),
            createMockElement('div'),
            false
        );
        renderer.setFocusedDiffMode(true, 3);

        const hunks: DiffHunk[] = [
            {
                hunkId: 1,
                startLine: 500_000,
                lineCount: 5,
                changeType: 'modified',
                oldLineNumbers: [500_000, 500_001, 500_002],
            },
        ];
        const diffs = new DiffModel(hunks);
        const code = new Code('line\n'.repeat(999_999) + 'line');
        const state: EditorState = {
            code,
            settings: { lineHeight: 20, fontSize: 14, buffer: 5 } as any,
            errorLines: new Map(),
            runLines: [],
            search: new Search(),
            diffs,
            foldRanges: [],
            collapsedFoldStarts: new Set(),
            scrollbarMarkersEnabled: true,
        } as any;

        const start = performance.now();
        renderer.render(state);
        const elapsed = performance.now() - start;

        const totalVisual = renderer.getVisualRowCount();
        expect(totalVisual).toBeLessThan(30); // ~17 visual rows total!
        expect(elapsed).toBeLessThan(100); // < 1ms!

        const firstRow = renderer.getVisualRow(0);
        expect(firstRow.kind).toBe('separator');

        const lastRow = renderer.getVisualRow(totalVisual - 1);
        expect(lastRow.kind).toBe('separator');
    });

    it('handles 1,000,000 lines added file (origin == "") in Focused Diff without creating million rows', () => {
        const renderer = new Renderer(
            createMockElement('div'),
            createMockElement('div'),
            createMockElement('div'),
            createMockElement('div'),
            createMockElement('div'),
            false
        );
        renderer.setFocusedDiffMode(true, 3);

        const hunks: DiffHunk[] = [
            {
                hunkId: 1,
                startLine: 1,
                lineCount: 1_000_000,
                changeType: 'added',
            },
        ];
        const diffs = new DiffModel(hunks);
        const code = new Code('line\n'.repeat(999_999) + 'line');
        const state: EditorState = {
            code,
            settings: { lineHeight: 20, fontSize: 14, buffer: 5 } as any,
            errorLines: new Map(),
            runLines: [],
            search: new Search(),
            diffs,
            foldRanges: [],
            collapsedFoldStarts: new Set(),
            scrollbarMarkersEnabled: true,
        } as any;

        const start = performance.now();
        renderer.render(state);
        const elapsed = performance.now() - start;

        expect(renderer.getVisualRowCount()).toBe(1_000_000);
        expect(renderer.getVisualRow(0)).toEqual({ kind: 'real', lineIndex: 0 });
        expect(renderer.getVisualRow(999_999)).toEqual({ kind: 'real', lineIndex: 999_999 });
        expect(elapsed).toBeLessThan(100);
    });
});

describe('Renderer multi-row file headers', () => {
    let originalDocument: any;

    beforeEach(() => {
        originalDocument = (globalThis as any).document;
        (globalThis as any).document = {
            createElement: (tag: string) => createMockElement(tag),
            createDocumentFragment: () => createMockElement('fragment'),
        };
    });

    afterEach(() => {
        (globalThis as any).document = originalDocument;
    });

    const settings = { lineHeight: 20, fontSize: 14, buffer: 5 } as any;

    function setup(headerRows: number) {
        const bodyA = Array.from({ length: 100 }, (_, i) => `a${i}`).join('\n');
        const bodyB = Array.from({ length: 100 }, (_, i) => `b${i}`).join('\n');
        const multibuffer = new MultiBufferCode([
            { id: 'a.ts', path: 'a.ts', code: new Code(bodyA, 'a.ts', ''), originalCode: new Code(bodyA, 'a.ts', '') },
            { id: 'b.ts', path: 'b.ts', code: new Code(bodyB, 'b.ts', ''), originalCode: new Code(bodyB, 'b.ts', '') },
        ], { headerRows });
        const renderer = new Renderer(
            createMockElement('div'),
            createMockElement('div'),
            createMockElement('div'),
            createMockElement('div'),
            createMockElement('div'),
            false
        );
        renderer.render({
            code: multibuffer,
            settings,
            errorLines: new Map(),
            runLines: [],
            search: new Search(),
            diffs: new DiffModel([]),
            foldRanges: [],
            collapsedFoldStarts: new Set(),
            scrollbarMarkersEnabled: true,
        } as any);
        return { multibuffer, renderer };
    }

    // The mock DOM keeps a replaced fragment as one child, where a real DOM splices its rows in.
    // The fragment holds a spacer first and last, so the rows are the slice between them.
    function renderedRows(renderer: Renderer): any[] {
        const [fragment] = renderer['codeContent'].children;
        return fragment.children.slice(1, -1);
    }

    it('gives each header rows-1 pad rows after its own row', () => {
        const { multibuffer, renderer } = setup(2);
        const { lines } = multibuffer.getHeaderLayout()!;
        expect(renderer.getVisualRowCount()).toBe(multibuffer.linesLength() + lines.length);

        lines.forEach((headerLine, i) => {
            // Each earlier header adds one pad row above this one.
            const header = headerLine + i;
            expect(renderer.getVisualRow(header)).toEqual({ kind: 'real', lineIndex: headerLine });
            expect(renderer.getVisualRow(header + 1)).toEqual({ kind: 'headerPad', headerLine, offset: 1 });
            expect(renderer.getLineForVisualRow(header + 1)).toBe(headerLine);
            expect(renderer.getVisualRow(header + 2)).toEqual({ kind: 'real', lineIndex: headerLine + 1 });
        });
    });

    it('renders DOM rows for real rows only', () => {
        const { renderer } = setup(2);
        const rendered = renderedRows(renderer);
        const indices: number[] = rendered.map((el: HTMLElement) => renderer['getVisualIndex'](el));
        const first = indices[0];
        const last = indices[indices.length - 1];
        const expected: number[] = [];
        for (let v = first; v <= last; v++) {
            if (renderer.getVisualRow(v).kind !== 'headerPad') expected.push(v);
        }

        expect(first).toBe(0);
        expect(indices).toEqual(expected);
    });

    it('sizes a header element to cover its pad rows', () => {
        const { renderer } = setup(2);
        const rendered = renderedRows(renderer);
        const header = rendered.find((el: HTMLElement) => renderer['getVisualIndex'](el) === 0);

        expect(header.style.height).toBe('40px');
    });

    it('keeps single-row headers when headerRows is 1', () => {
        const { multibuffer, renderer } = setup(1);
        const firstRow = renderedRows(renderer)[0];

        expect(renderer.getVisualRowCount()).toBe(multibuffer.linesLength());
        expect(firstRow.style.height).toBe('');
    });

    it('keeps a header with its pad rows when the viewport starts on a pad row', () => {
        const { multibuffer, renderer } = setup(2);
        const secondHeaderVisual = multibuffer.getHeaderLayout()!.lines[1] + 1;
        // rawStart = floor(scrollTop / lineHeight) - buffer lands on the pad row below that header.
        const scrollTop = (secondHeaderVisual + 1 + settings.buffer) * settings.lineHeight;

        const range = renderer['getVisibleRange'](renderer.getVisualRowCount(), settings, undefined, scrollTop, 200);

        expect(range.startIndex).toBe(secondHeaderVisual);
    });
});

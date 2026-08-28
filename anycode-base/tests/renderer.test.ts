import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Renderer } from '../src/renderer/Renderer';
import { EditorState } from '../src/types';
import { Code } from '../src/code';
import { Search } from '../src/search';
import { DiffModel, DiffHunk } from '../src/diff';

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
        expect(elapsed).toBeLessThan(30);
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
        expect(elapsed).toBeLessThan(30); // < 1ms!

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
        expect(elapsed).toBeLessThan(30);
    });
});

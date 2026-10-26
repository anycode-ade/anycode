import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StickyHeaderRenderer } from '../src/renderer/StickyHeaderRenderer';
import { Renderer } from '../src/renderer/Renderer';
import { MultiBufferCode } from '../src/multibuffer';
import { Code } from '../src/code';
import { EditorState } from '../src/editor';
import { Search } from '../src/search';

// Lightweight mock DOM environment for StickyHeaderRenderer unit tests
function createMockElement(tagName: string = 'div'): any {
    const children: any[] = [];
    const listeners: Record<string, Function[]> = {};
    const styleObj: Record<string, string> = {};

    const classListSet = new Set<string>();
    const el = {
        tagName: tagName.toUpperCase(),
        className: '',
        textContent: '',
        title: '',
        dataset: {} as Record<string, string>,
        parentElement: null as any,
        setAttribute(name: string, val: string) {},
        getAttribute(name: string) { return null; },
        classList: {
            add(...cls: string[]) { cls.forEach(c => classListSet.add(c)); },
            remove(...cls: string[]) { cls.forEach(c => classListSet.delete(c)); },
            contains(c: string) { return classListSet.has(c); },
        },
        style: new Proxy(styleObj, {
            get(target, prop: string) {
                if (prop === 'setProperty') {
                    return (k: string, v: string) => { target[k] = v; };
                }
                if (prop === 'removeProperty') {
                    return (k: string) => { delete target[k]; };
                }
                return target[prop] || '';
            },
            set(target, prop: string, value: string) {
                target[prop] = value;
                return true;
            }
        }),
        _listeners: listeners,
        addEventListener(event: string, fn: Function) {
            if (!listeners[event]) listeners[event] = [];
            listeners[event].push(fn);
        },
        removeEventListener(event: string, fn: Function) {
            if (listeners[event]) {
                listeners[event] = listeners[event].filter(f => f !== fn);
            }
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
        get children() {
            return children;
        },
        querySelectorAll(selector: string): any[] {
            return [];
        },
        querySelector(selector: string): any {
            const cleanSelector = selector.replace(/^\./, '');
            function search(nodes: any[]): any {
                for (const child of nodes) {
                    if (child.className && child.className.split(' ').includes(cleanSelector)) {
                        return child;
                    }
                    const found = search(child.children || []);
                    if (found) return found;
                }
                return null;
            }
            return search(children);
        },
        contains(node: any) {
            return node === this || children.includes(node);
        },
        click() {
            let current: any = this;
            let stop = false;
            const event = {
                target: this,
                preventDefault: () => {},
                stopPropagation: () => { stop = true; },
            };
            while (current && !stop) {
                const fns = current._listeners?.['click'] || [];
                fns.forEach((fn: any) => fn(event));
                current = current.parentElement;
            }
        },
        remove() {
            if (this.parentElement) {
                const idx = this.parentElement.children.indexOf(this);
                if (idx !== -1) this.parentElement.children.splice(idx, 1);
            }
        },
        isConnected: true,
    };

    return el;
}

describe('StickyHeaderRenderer & MultiBufferCode headers', () => {
    let originalDocument: any;
    let originalHTMLElement: any;

    beforeEach(() => {
        originalDocument = (globalThis as any).document;
        originalHTMLElement = (globalThis as any).HTMLElement;
        (globalThis as any).HTMLElement = class {};
        (globalThis as any).document = {
            createElement: (tag: string) => createMockElement(tag),
            createDocumentFragment: () => createMockElement('fragment'),
        };
    });

    afterEach(() => {
        (globalThis as any).document = originalDocument;
        (globalThis as any).HTMLElement = originalHTMLElement;
    });

    it('returns file headers with correct metadata from MultiBufferCode', () => {
        const file1 = new Code('line 1\nline 2\nline 3', 'src/file1.ts', '');
        const file2 = new Code('console.log("hello");\n', 'src/utils/file2.ts', '');
        const multibuffer = new MultiBufferCode([
            { id: 'src/file1.ts', path: 'src/file1.ts', code: file1, originalCode: new Code('', 'src/file1.ts', '') },
            { id: 'src/utils/file2.ts', path: 'src/utils/file2.ts', code: file2, originalCode: new Code('', 'src/utils/file2.ts', '') },
        ]);

        const headers = multibuffer.getFileHeaders();
        expect(headers.length).toBe(2);
        expect(headers[0].fileName).toBe('file1.ts');
        expect(headers[0].path).toBe('src/file1.ts');
        expect(headers[0].line).toBe(0);
        expect(headers[0].collapsed).toBe(false);

        // Header 2 is after header 1 (line 0) + 3 lines of file1 = line 4
        expect(headers[1].fileName).toBe('file2.ts');
        expect(headers[1].path).toBe('src/utils/file2.ts');
        expect(headers[1].line).toBe(4);
        expect(headers[1].collapsed).toBe(false);
    });

    it('correctly tracks active sticky header and push-up offset on scroll', () => {
        const container = createMockElement('div');
        const wrapper = createMockElement('div');
        const onToggleCollapse = vi.fn();
        const onJumpToFile = vi.fn();

        const renderer = new StickyHeaderRenderer(
            container,
            wrapper,
            {
                onToggleCollapse,
                onJumpToFile,
                getVisualIndexForLine: (line: number) => line,
            },
            true
        );

        const file1 = new Code('line 1\nline 2\nline 3', 'src/file1.ts', '');
        const file2 = new Code('line A\nline B', 'src/file2.ts', '');
        const multibuffer = new MultiBufferCode([
            { id: 'src/file1.ts', path: 'src/file1.ts', code: file1, originalCode: new Code('', 'src/file1.ts', '') },
            { id: 'src/file2.ts', path: 'src/file2.ts', code: file2, originalCode: new Code('', 'src/file2.ts', '') },
        ]);

        const mockState: EditorState = {
            code: multibuffer,
            cursor: { row: 0, column: 0 },
            selection: null,
            cursorActive: true,
            runLines: [],
            errorLines: new Map(),
            settings: { lineHeight: 20, buffer: 25 },
            foldRanges: [],
            collapsedFoldStarts: new Set(),
            codeFoldingEnabled: true,
            wordHighlightEnabled: true,
            scrollbarMarkersEnabled: true,
            stickyHeaderEnabled: true,
            wordHighlight: null,
            search: {} as any,
        };

        const el = renderer.getElement();

        const content = el.querySelector('.sticky-header-content');

        // 1. When at scroll 0 (or negative overscroll), header 0 is in natural position, so sticky overlay is hidden
        renderer.render(mockState, 0);
        expect(el.style.display).toBe('none');

        // 2. When scrolled into File 1 (e.g. scrollTop = 30px)
        // File 1 header is at y = 0, File 2 header is at line 4 (y = 80px)
        renderer.render(mockState, 30);
        expect(el.style.display).toBe('flex');
        expect(renderer.getActiveLine()).toBe(0);
        expect(el.querySelector('.sticky-header-path')?.textContent).toBe('file1.ts');
        expect(el.style.transform).toBe('');
        expect(content?.style.opacity).toBe('');
        expect(el.style.opacity).toBe('');

        // 3. When approaching File 2 header (e.g. scrollTop = 70px)
        // Next header is at y = 80px. distanceToNext = 80 - 70 = 10px (< lineHeight 20px).
        // translateY = 10 - 20 = -10px, progress = 0.5, opacity = 0.5^2.5 ≈ 0.177 on text content only
        renderer.render(mockState, 70);
        expect(el.style.display).toBe('flex');
        expect(renderer.getActiveLine()).toBe(0);
        expect(el.style.transform).toBe('translateY(-10px)');
        expect(content?.style.opacity).toBe('0.177');
        expect(el.style.opacity).toBe('');

        // 4. When scrolled past File 2 header (e.g. scrollTop = 85px)
        renderer.render(mockState, 85);
        expect(el.style.display).toBe('flex');
        expect(renderer.getActiveLine()).toBe(4);
        expect(el.querySelector('.sticky-header-path')?.textContent).toBe('file2.ts');
        expect(el.style.transform).toBe('');
        expect(content?.style.opacity).toBe('');
        expect(el.style.opacity).toBe('');

        // 5. Test click interactions
        const chevron = el.querySelector('.sticky-header-chevron');
        const path = el.querySelector('.sticky-header-path');

        chevron.click();
        expect(onToggleCollapse).toHaveBeenCalledWith(4);

        path.click();
        expect(onJumpToFile).toHaveBeenCalledWith(4);
    });

    it('hides sticky header when disabled or for non-multibuffer code', () => {
        const container = createMockElement('div');
        const wrapper = createMockElement('div');
        const renderer = new StickyHeaderRenderer(container, wrapper, {}, false);

        const file1 = new Code('line 1', 'file1.ts', '');
        const mockState: EditorState = {
            code: file1,
            cursor: { row: 0, column: 0 },
            selection: null,
            cursorActive: true,
            runLines: [],
            errorLines: new Map(),
            settings: { lineHeight: 20, buffer: 25 },
            foldRanges: [],
            collapsedFoldStarts: new Set(),
            codeFoldingEnabled: true,
            wordHighlightEnabled: true,
            scrollbarMarkersEnabled: true,
            stickyHeaderEnabled: false,
            wordHighlight: null,
            search: {} as any,
        };

        renderer.render(mockState, 50);
        expect(renderer.getElement().style.display).toBe('none');
    });

    it('revealCursor accounts for sticky header top padding in multibuffer', () => {
        const container = createMockElement('div');
        const buttons = createMockElement('div');
        const gutter = createMockElement('div');
        const folds = createMockElement('div');
        const codeContent = createMockElement('div');
        const wrapper = createMockElement('div');

        container.clientHeight = 200;
        container.scrollTop = 100;
        let lastScrollTo: any = null;
        container.scrollTo = (opts: any) => {
            lastScrollTo = opts;
            container.scrollTop = opts.top;
        };

        const renderer = new Renderer(
            container,
            buttons,
            gutter,
            folds,
            codeContent,
            true,
            undefined,
            wrapper,
            undefined,
            undefined,
            true
        );

        const file1 = new Code('line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\nline 10', 'src/file1.ts', '');
        const multibuffer = new MultiBufferCode([
            { id: 'src/file1.ts', path: 'src/file1.ts', code: file1, originalCode: new Code('', 'src/file1.ts', '') },
        ]);

        // In multibuffer: line 0 = header, line 1..10 = code lines
        // If container.scrollTop = 100 (which corresponds to line 5 at y=100),
        // and cursor moves to line 5 (y=100), without topPadding it would be directly under sticky header [100, 120].
        // With topPadding = 20, targetScrollTop must be max(0, 100 - 20) = 80!
        const state: EditorState = {
            code: multibuffer,
            cursor: { row: 5, column: 0 },
            selection: null,
            cursorActive: true,
            runLines: [],
            errorLines: new Map(),
            settings: { lineHeight: 20, buffer: 25 },
            foldRanges: [],
            collapsedFoldStarts: new Set(),
            codeFoldingEnabled: true,
            wordHighlightEnabled: true,
            scrollbarMarkersEnabled: true,
            stickyHeaderEnabled: true,
            wordHighlight: null,
            search: new Search(),
        };

        const didScroll = renderer.revealCursor(state);
        expect(didScroll).toBe(true);
        expect(lastScrollTo.top).toBe(80);
    });

    it('setEnabled(true, state, scrollTop) immediately renders sticky header without waiting for scroll', () => {
        const container = createMockElement('div');
        const wrapper = createMockElement('div');
        const renderer = new StickyHeaderRenderer(container, wrapper, {}, false);

        const file1 = new Code('line 1\nline 2\nline 3', 'src/file1.ts', '');
        const multibuffer = new MultiBufferCode([
            { id: 'src/file1.ts', path: 'src/file1.ts', code: file1, originalCode: new Code('', 'src/file1.ts', '') },
        ]);

        const mockState: EditorState = {
            code: multibuffer,
            cursor: { row: 0, column: 0 },
            selection: null,
            cursorActive: true,
            runLines: [],
            errorLines: new Map(),
            settings: { lineHeight: 20, buffer: 25 },
            foldRanges: [],
            collapsedFoldStarts: new Set(),
            codeFoldingEnabled: true,
            wordHighlightEnabled: true,
            scrollbarMarkersEnabled: true,
            stickyHeaderEnabled: true,
            wordHighlight: null,
            search: new Search(),
        };

        expect(renderer.getElement().style.display).toBe('none');

        renderer.setEnabled(true, mockState, 40);

        expect(renderer.getElement().style.display).toBe('flex');
        expect(renderer.getActiveLine()).toBe(0);
        expect(renderer.getElement().querySelector('.sticky-header-path')?.textContent).toBe('file1.ts');
    });

    it('renderChanges updates sticky header content and diff badges', () => {
        const container = createMockElement('div');
        const buttons = createMockElement('div');
        const gutter = createMockElement('div');
        const folds = createMockElement('div');
        const codeContent = createMockElement('div');
        const wrapper = createMockElement('div');

        const renderer = new Renderer(
            container,
            buttons,
            gutter,
            folds,
            codeContent,
            true,
            undefined,
            wrapper,
            undefined,
            undefined,
            true
        );

        const file1 = new Code('line 1\nline 2', 'src/file1.ts', '');
        const multibuffer = new MultiBufferCode([
            { id: 'src/file1.ts', path: 'src/file1.ts', code: file1, originalCode: new Code('line 1\nline 2', 'src/file1.ts', '') },
        ]);

        const state: EditorState = {
            code: multibuffer,
            cursor: { row: 1, column: 0 },
            selection: null,
            cursorActive: true,
            runLines: [],
            errorLines: new Map(),
            settings: { lineHeight: 20, buffer: 25 },
            foldRanges: [],
            collapsedFoldStarts: new Set(),
            codeFoldingEnabled: true,
            wordHighlightEnabled: true,
            scrollbarMarkersEnabled: true,
            stickyHeaderEnabled: true,
            wordHighlight: null,
            search: new Search(),
        };

        // Initial full render
        container.scrollTop = 40;
        renderer.renderScroll(state);
        expect(wrapper.querySelector('.sticky-header-path')?.textContent).toBe('file1.ts');
        expect(wrapper.querySelector('.multibuffer-header-added')?.textContent).toBe('');

        // Simulate multibuffer file stats change / header update
        const spyGetHeaders = vi.spyOn(multibuffer, 'getFileHeaders').mockReturnValue([
            {
                id: 'src/file1.ts',
                fileName: 'renamed.ts',
                path: 'src/renamed.ts',
                line: 0,
                collapsed: false,
                added: 5,
                removed: 2,
            }
        ]);

        // Call renderChanges
        renderer.renderChanges(state);

        expect(wrapper.querySelector('.sticky-header-path')?.textContent).toBe('renamed.ts');
        expect(wrapper.querySelector('.multibuffer-header-added')?.textContent).toBe('  +5');
        expect(wrapper.querySelector('.multibuffer-header-removed')?.textContent).toBe(' −2');

        spyGetHeaders.mockRestore();
    });
});


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
    const attributes: Record<string, string> = {};

    const classListSet = new Set<string>();
    const el = {
        tagName: tagName.toUpperCase(),
        get className() {
            return Array.from(classListSet).join(' ');
        },
        set className(val: string) {
            classListSet.clear();
            for (const c of val.split(/\s+/)) {
                if (c) classListSet.add(c);
            }
        },
        textContent: '',
        title: '',
        dataset: {} as Record<string, string>,
        parentElement: null as any,
        setAttribute(name: string, val: string) {
            attributes[name] = val;
        },
        getAttribute(name: string) {
            return attributes[name] ?? null;
        },
        classList: {
            add(...cls: string[]) { cls.forEach(c => { if (c) classListSet.add(c); }); },
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
            const cleanSelector = selector.replace(/^\./, '');
            const matches: any[] = [];
            function collect(nodes: any[]) {
                for (const child of nodes) {
                    if (child.className && child.className.split(' ').includes(cleanSelector)) {
                        matches.push(child);
                    }
                    collect(child.children || []);
                }
            }
            collect(children);
            return matches;
        },
        querySelector(selector: string): any {
            return this.querySelectorAll(selector)[0] ?? null;
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
                this.parentElement = null;
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

    it('mounts pre-warmed composited sticky slots with push fade and zero in-place span mutations', () => {
        const container = createMockElement('div');
        const contentContainer = createMockElement('div');
        const wrapper = createMockElement('div');
        container.appendChild(contentContainer);
        wrapper.appendChild(container);
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
            true,
            contentContainer
        );

        const file1 = new Code('line 1\nline 2\nline 3', 'src/file1.ts', '');
        const file2 = new Code('line A\nline B', 'src/file2.ts', '');
        const multibuffer = new MultiBufferCode([
            { id: 'src/file1.ts', path: 'src/file1.ts', code: file1, originalCode: new Code('', 'src/file1.ts', '') },
            { id: 'src/file2.ts', path: 'src/file2.ts', code: file2, originalCode: new Code('', 'src/file2.ts', '') },
        ], { headerRows: 1 });

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

        // 1. At scrollTop = 0, header 0 is in natural position: standby slots are pre-warmed with full content
        //    on the compositor while no .anyeditor-sticky-header is active in DOM.
        renderer.render(mockState, 0);
        const placeholderEl = renderer.getElement();
        expect(placeholderEl.style.display).toBe('none');
        expect(renderer.getActiveLine()).toBeNull();
        expect(wrapper.querySelectorAll('.anyeditor-sticky-header').length).toBe(0);
        const prewarmedSlots = contentContainer.querySelectorAll('.anyeditor-sticky-slot');
        const prewarmedBanners = contentContainer.querySelectorAll('.anyeditor-sticky-banner');
        expect(prewarmedSlots.length).toBe(2);
        expect(prewarmedBanners.length).toBe(2);
        expect(prewarmedBanners[0].querySelector('.sticky-header-path')?.textContent).toBe('file1.ts');
        expect(prewarmedBanners[1].querySelector('.sticky-header-path')?.textContent).toBe('file2.ts');

        // 2. Scrolled into File 1 (scrollTop = 30px): File 1 slot spans [0, 80) and its banner is active.
        renderer.render(mockState, 30);
        const file1El = renderer.getElement();
        const file1Slot = prewarmedSlots[0];
        const file1Content = file1El.querySelector('.sticky-header-content');
        expect(file1El).toBe(prewarmedBanners[0]);
        expect(file1El).not.toBe(placeholderEl);
        expect(placeholderEl.parentElement).toBeNull();
        expect(file1El.classList.contains('anyeditor-sticky-header')).toBe(true);
        expect(file1El.style.display).toBe('');
        expect(file1El.style.transform).toBe('');
        expect(file1El.style.height).toBe('20px');
        expect(file1Slot.style.top).toBe('0px');
        expect(file1Slot.style.height).toBe('80px');
        expect(renderer.getActiveLine()).toBe(0);
        expect(file1El.querySelector('.sticky-header-path')?.textContent).toBe('file1.ts');
        expect(file1Content?.style.opacity).toBe('');
        expect(file1El.style.opacity).toBe('');
        expect(wrapper.querySelectorAll('.anyeditor-sticky-header').length).toBe(1);

        // 3. Approaching File 2 header (y = 80, headerHeight = 20):
        // Mid-fade at distanceToNext = 15px (progress = 0.75 -> (0.2/0.45)^2 ≈ 0.198),
        // then completely faded out at distanceToNext = 10px (progress = 0.5 <= 0.55) before glyphs clip.
        renderer.render(mockState, 65);
        expect(renderer.getElement()).toBe(file1El);
        expect(file1Content?.style.opacity).toBe('0.198');

        renderer.render(mockState, 70);
        expect(renderer.getElement()).toBe(file1El);
        expect(file1El.classList.contains('anyeditor-sticky-header')).toBe(true);
        expect(file1El.style.transform).toBe('');
        expect(renderer.getActiveLine()).toBe(0);
        expect(file1Content?.style.opacity).toBe('0');
        expect(file1El.style.opacity).toBe('');

        // 4. Exactly at File 2 header boundary (scrollTop = 80px):
        // Active class moves off File 1, File 1's faded opacity is reset,
        // and both slots stay mounted on compositor with full content for instant scroll up/down.
        renderer.render(mockState, 80);
        expect(renderer.getElement()).toBe(placeholderEl);
        expect(renderer.getElement().style.display).toBe('none');
        expect(renderer.getActiveLine()).toBeNull();
        expect(file1El.classList.contains('anyeditor-sticky-header')).toBe(false);
        expect(file1Content?.style.opacity).toBe('');
        expect(contentContainer.querySelectorAll('.anyeditor-sticky-slot').length).toBe(2);
        expect(wrapper.querySelectorAll('.anyeditor-sticky-header').length).toBe(0);

        // 5. Scrolled past File 2 header (scrollTop = 85px):
        // Activates File 2's own banner (never mutates file1El spans in place) and keeps strictly one .anyeditor-sticky-header.
        renderer.render(mockState, 85);
        const file2El = renderer.getElement();
        const slotsAfter = contentContainer.querySelectorAll('.anyeditor-sticky-slot');
        const file2Slot = slotsAfter[1];
        const file2Content = file2El.querySelector('.sticky-header-content');
        expect(file2El).toBe(prewarmedBanners[1]);
        expect(file2El).not.toBe(file1El);
        expect(file1El.classList.contains('anyeditor-sticky-header')).toBe(false);
        expect(file2El.classList.contains('anyeditor-sticky-header')).toBe(true);
        expect(file2El.style.transform).toBe('');
        expect(renderer.getActiveLine()).toBe(4);
        expect(file2El.querySelector('.sticky-header-path')?.textContent).toBe('file2.ts');
        expect(slotsAfter[0].style.top).toBe('0px');
        expect(slotsAfter[0].style.height).toBe('80px');
        expect(file2Slot.style.top).toBe('80px');
        expect(file2Slot.style.bottom).toBe('0px');
        expect(file2Slot.style.height).toBe('');
        expect(file2Content?.style.opacity).toBe('');
        expect(wrapper.querySelectorAll('.anyeditor-sticky-header').length).toBe(1);

        // 6. Test click interactions on active banner and ignore clicks on standby banner
        file1El.querySelector('.sticky-header-path').click();
        expect(onJumpToFile).not.toHaveBeenCalled();

        const chevron = file2El.querySelector('.sticky-header-chevron');
        const path = file2El.querySelector('.sticky-header-path');

        chevron.click();
        expect(onToggleCollapse).toHaveBeenCalledWith(4);

        path.click();
        expect(onJumpToFile).toHaveBeenCalledWith(4);
    });

    it('sizes the sticky header and slot by the multi-row header height', () => {
        const container = createMockElement('div');
        const contentContainer = createMockElement('div');
        const wrapper = createMockElement('div');
        container.appendChild(contentContainer);
        wrapper.appendChild(container);

        const file1 = new Code('line 1\nline 2\nline 3', 'src/file1.ts', '');
        const file2 = new Code('line A\nline B', 'src/file2.ts', '');
        const multibuffer = new MultiBufferCode([
            { id: 'src/file1.ts', path: 'src/file1.ts', code: file1, originalCode: new Code('', 'src/file1.ts', '') },
            { id: 'src/file2.ts', path: 'src/file2.ts', code: file2, originalCode: new Code('', 'src/file2.ts', '') },
        ], { headerRows: 2 });

        // Header lines 0 and 4 each take one pad row: line 0 -> row 0, lines 1-3 -> rows 2-4, line 4 -> row 5.
        const renderer = new StickyHeaderRenderer(
            container,
            wrapper,
            { getVisualIndexForLine: (line: number) => (line === 0 ? 0 : line + 1) },
            true,
            contentContainer
        );

        const state = {
            code: multibuffer,
            settings: { lineHeight: 20, buffer: 25 },
        } as unknown as EditorState;

        renderer.render(state, 30);
        const el = renderer.getElement();
        const slots = contentContainer.querySelectorAll('.anyeditor-sticky-slot');
        const content = el.querySelector('.sticky-header-content') as HTMLElement;
        expect(el.classList.contains('anyeditor-sticky-header')).toBe(true);
        expect(el.style.height).toBe('40px');
        expect(el.style.transform).toBe('');
        expect(slots[0].style.top).toBe('0px');
        expect(slots[0].style.height).toBe('100px');

        // Next header at y = 100; distance 30 (progress = 0.75) -> ((0.75-0.55)/0.45)^2 ≈ 0.198,
        // and by distance 22 (progress = 0.55) text has faded completely to '0'.
        renderer.render(state, 70);
        expect(renderer.getElement()).toBe(el);
        expect(el.style.transform).toBe('');
        expect(content.style.opacity).toBe('0.198');

        renderer.render(state, 78);
        expect(content.style.opacity).toBe('0');

        renderer.render(state, 105);
        expect(renderer.getActiveLine()).toBe(4);
        const file2El = renderer.getElement();
        expect(file2El).not.toBe(el);
        expect(file2El.style.height).toBe('40px');
        expect(content.style.opacity).toBe('');
        expect(slots[1].style.top).toBe('100px');
        expect(slots[1].style.bottom).toBe('0px');
        expect(slots[0].style.top).toBe('0px');
        expect(slots[0].style.height).toBe('100px');
        expect(el.style.height).toBe('40px');
    });

    it('hides sticky header and removes slots when disabled or for non-multibuffer code', () => {
        const container = createMockElement('div');
        const contentContainer = createMockElement('div');
        const wrapper = createMockElement('div');
        container.appendChild(contentContainer);
        wrapper.appendChild(container);
        const renderer = new StickyHeaderRenderer(container, wrapper, {}, false, contentContainer);

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
        expect(contentContainer.querySelectorAll('.anyeditor-sticky-slot').length).toBe(0);
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
        ], { headerRows: 1 });

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
        const contentContainer = createMockElement('div');
        const wrapper = createMockElement('div');
        container.appendChild(contentContainer);
        wrapper.appendChild(container);
        const renderer = new StickyHeaderRenderer(container, wrapper, {}, false, contentContainer);

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

        expect(renderer.getElement().classList.contains('anyeditor-sticky-header')).toBe(true);
        expect(renderer.getElement().style.display).not.toBe('none');
        expect(renderer.getActiveLine()).toBe(0);
        expect(renderer.getElement().querySelector('.sticky-header-path')?.textContent).toBe('file1.ts');
    });

    it('renderChanges replaces sticky header slot cleanly on diff stats or metadata update', () => {
        const container = createMockElement('div');
        const contentContainer = createMockElement('div');
        const buttons = createMockElement('div');
        const gutter = createMockElement('div');
        const folds = createMockElement('div');
        const codeContent = createMockElement('div');
        const wrapper = createMockElement('div');
        contentContainer.appendChild(buttons);
        contentContainer.appendChild(gutter);
        contentContainer.appendChild(folds);
        contentContainer.appendChild(codeContent);
        container.appendChild(contentContainer);
        wrapper.appendChild(container);

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
            true,
            contentContainer
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

        // Initial scroll render
        container.scrollTop = 40;
        renderer.renderScroll(state);
        const beforeHeader = wrapper.querySelector('.anyeditor-sticky-header');
        expect(beforeHeader?.querySelector('.sticky-header-path')?.textContent).toBe('file1.ts');
        expect(beforeHeader?.querySelector('.multibuffer-header-added')?.textContent).toBe('');

        // Simulate multibuffer file stats change / header update
        const spyGetHeaders = vi.spyOn(multibuffer, 'getFileHeaders').mockReturnValue([
            {
                fileIndex: 0,
                fileId: 'src/file1.ts',
                fileName: 'renamed.ts',
                dirName: 'src',
                path: 'src/renamed.ts',
                line: 0,
                collapsed: false,
                added: 5,
                removed: 2,
            }
        ]);

        // Call renderChanges: replaces slot with fresh DOM node instead of mutating spans in-place
        renderer.renderChanges(state);

        const afterHeader = wrapper.querySelector('.anyeditor-sticky-header');
        expect(afterHeader).not.toBe(beforeHeader);
        expect(wrapper.querySelectorAll('.anyeditor-sticky-header').length).toBe(1);
        expect(afterHeader?.querySelector('.sticky-header-path')?.textContent).toBe('renamed.ts');
        expect(afterHeader?.querySelector('.multibuffer-header-dir')?.textContent).toBe('  src');
        expect(afterHeader?.querySelector('.multibuffer-header-added')?.textContent).toBe('  +5');
        expect(afterHeader?.querySelector('.multibuffer-header-removed')?.textContent).toBe(' −2');

        spyGetHeaders.mockRestore();
    });

    it('keeps a bounded sliding window of composited sticky slots around activeIdx', () => {
        const container = createMockElement('div');
        const contentContainer = createMockElement('div');
        const wrapper = createMockElement('div');
        container.appendChild(contentContainer);
        wrapper.appendChild(container);

        // 70 files * 3 lines (60px each) = 4200px total: bounded by both MAX_SLOT_COUNT_RADIUS (25) and SLOT_RADIUS_PX (1500px)
        const entries = Array.from({ length: 70 }, (_, idx) => ({
            id: `src/file${idx}.ts`,
            path: `src/file${idx}.ts`,
            code: new Code('a\nb', `src/file${idx}.ts`, ''),
            originalCode: new Code('', `src/file${idx}.ts`, ''),
        }));
        const multibuffer = new MultiBufferCode(entries, { headerRows: 1 });
        const renderer = new StickyHeaderRenderer(
            container,
            wrapper,
            { getVisualIndexForLine: (line: number) => line },
            true,
            contentContainer
        );
        const state = {
            code: multibuffer,
            settings: { lineHeight: 20, buffer: 25 },
        } as unknown as EditorState;

        // Each file = 60px. At scrollTop = 40 -> activeIdx = 0, window [0..25] (26 slots).
        renderer.render(state, 40);
        let banners = contentContainer.querySelectorAll('.anyeditor-sticky-banner');
        expect(banners.length).toBe(26);
        expect(banners[0].querySelector('.sticky-header-path')?.textContent).toBe('file0.ts');
        expect(banners[25].querySelector('.sticky-header-path')?.textContent).toBe('file25.ts');

        // Scroll into file35 (y = 35 * 60 = 2100 -> scrollTop = 2120): window [10..60] (51 slots), evicting file0..9 & 61..69.
        renderer.render(state, 2120);
        banners = contentContainer.querySelectorAll('.anyeditor-sticky-banner');
        const names = banners.map((b: any) => b.querySelector('.sticky-header-path')?.textContent);
        expect(banners.length).toBe(51);
        expect(names).not.toContain('file9.ts');
        expect(names).toContain('file10.ts');
        expect(names).toContain('file35.ts');
        expect(names).toContain('file60.ts');
        expect(names).not.toContain('file61.ts');
        expect(renderer.getElement().querySelector('.sticky-header-path')?.textContent).toBe('file35.ts');
        expect(wrapper.querySelectorAll('.anyeditor-sticky-header').length).toBe(1);
        expect(banners.find((b: any) => b.querySelector('.sticky-header-path')?.textContent === 'file34.ts').classList.contains('anyeditor-sticky-passed')).toBe(true);
        expect(banners.find((b: any) => b.querySelector('.sticky-header-path')?.textContent === 'file35.ts').classList.contains('anyeditor-sticky-passed')).toBe(false);
        expect(banners.find((b: any) => b.querySelector('.sticky-header-path')?.textContent === 'file36.ts').classList.contains('anyeditor-sticky-passed')).toBe(false);
    });

    it('updates slot top and height in-place when lines or diff gaps change without recreating DOM nodes', () => {
        const container = createMockElement('div');
        const contentContainer = createMockElement('div');
        const wrapper = createMockElement('div');
        container.appendChild(contentContainer);
        wrapper.appendChild(container);

        const onJumpToFile = vi.fn();

        const file1 = new Code('line 1\nline 2', 'src/file1.ts', '');
        const file2 = new Code('line A\nline B', 'src/file2.ts', '');
        const multibuffer = new MultiBufferCode([
            { id: 'src/file1.ts', path: 'src/file1.ts', code: file1, originalCode: new Code('', 'src/file1.ts', '') },
            { id: 'src/file2.ts', path: 'src/file2.ts', code: file2, originalCode: new Code('', 'src/file2.ts', '') },
        ], { headerRows: 1 });

        const renderer = new StickyHeaderRenderer(
            container,
            wrapper,
            {
                onJumpToFile,
                getVisualIndexForLine: (line: number) => line,
            },
            true,
            contentContainer
        );

        const state = {
            code: multibuffer,
            settings: { lineHeight: 20, buffer: 25 },
        } as unknown as EditorState;

        // Scroll into file2 (initially at line 3 -> y = 60px, file1 height = 60px).
        renderer.render(state, 70);
        const slotsBefore = contentContainer.querySelectorAll('.anyeditor-sticky-slot');
        const bannersBefore = contentContainer.querySelectorAll('.anyeditor-sticky-banner');
        expect(slotsBefore.length).toBe(2);
        expect(slotsBefore[0].style.height).toBe('60px');
        expect(slotsBefore[1].style.top).toBe('60px');

        // Simulate inserting lines / expanding gap in file1: file2 header shifts from line 3 to line 7 (+80px).
        const headersSpy = vi.spyOn(multibuffer, 'getFileHeaders').mockReturnValue([
            { ...multibuffer.getFileHeaders()[0], line: 0 },
            { ...multibuffer.getFileHeaders()[1], line: 7 },
        ]);

        renderer.render(state, 150);
        const slotsAfter = contentContainer.querySelectorAll('.anyeditor-sticky-slot');
        const bannersAfter = contentContainer.querySelectorAll('.anyeditor-sticky-banner');
        expect(slotsAfter.length).toBe(2);
        expect(slotsAfter[0]).toBe(slotsBefore[0]);
        expect(slotsAfter[1]).toBe(slotsBefore[1]);
        expect(bannersAfter[0]).toBe(bannersBefore[0]);
        expect(bannersAfter[1]).toBe(bannersBefore[1]);
        expect(slotsAfter[0].style.height).toBe('140px');
        expect(slotsAfter[1].style.top).toBe('140px');

        // Active click handler picks up the updated header line dynamically.
        bannersAfter[1].querySelector('.sticky-header-path').click();
        expect(onJumpToFile).toHaveBeenCalledWith(7);

        headersSpy.mockRestore();
    });

    it('caps slots by MAX_SLOT_COUNT_RADIUS when many tiny or collapsed files fit inside ±1500px', () => {
        const container = createMockElement('div');
        const contentContainer = createMockElement('div');
        const wrapper = createMockElement('div');
        container.appendChild(contentContainer);
        wrapper.appendChild(container);

        // 150 single-header collapsed files (20px each = 3000px total) would all fall inside scrollTop ± 1500px
        const entries = Array.from({ length: 150 }, (_, idx) => ({
            id: `src/collapsed${idx}.ts`,
            path: `src/collapsed${idx}.ts`,
            code: new Code('a', `src/collapsed${idx}.ts`, ''),
            originalCode: new Code('', `src/collapsed${idx}.ts`, ''),
        }));
        const multibuffer = new MultiBufferCode(entries, { headerRows: 1 });
        multibuffer.setAllFilesCollapsed(true);
        const renderer = new StickyHeaderRenderer(
            container,
            wrapper,
            { getVisualIndexForLine: (line: number) => line },
            true,
            contentContainer
        );
        const state = {
            code: multibuffer,
            settings: { lineHeight: 20, buffer: 25 },
        } as unknown as EditorState;

        // Centered on file75 (y = 1500px -> scrollTop = 1510): capped to [50..100] = 51 slots instead of all 150
        renderer.render(state, 1510);
        const banners = contentContainer.querySelectorAll('.anyeditor-sticky-banner');
        const names = banners.map((b: any) => b.querySelector('.sticky-header-path')?.textContent);
        expect(banners.length).toBe(51);
        expect(names[0]).toBe('collapsed50.ts');
        expect(names[50]).toBe('collapsed100.ts');
        expect(renderer.getElement().querySelector('.sticky-header-path')?.textContent).toBe('collapsed75.ts');
    });

    it('keeps pre-warmed standby slots mounted on negative overscroll while clearing active sticky state', () => {
        const container = createMockElement('div');
        const contentContainer = createMockElement('div');
        const wrapper = createMockElement('div');
        container.appendChild(contentContainer);
        wrapper.appendChild(container);

        const file1 = new Code('line 1\nline 2', 'src/file1.ts', '');
        const file2 = new Code('line A\nline B', 'src/file2.ts', '');
        const multibuffer = new MultiBufferCode([
            { id: 'src/file1.ts', path: 'src/file1.ts', code: file1, originalCode: new Code('', 'src/file1.ts', '') },
            { id: 'src/file2.ts', path: 'src/file2.ts', code: file2, originalCode: new Code('', 'src/file2.ts', '') },
        ], { headerRows: 1 });

        const renderer = new StickyHeaderRenderer(
            container,
            wrapper,
            { getVisualIndexForLine: (line: number) => line },
            true,
            contentContainer
        );
        const state = {
            code: multibuffer,
            settings: { lineHeight: 20, buffer: 25 },
        } as unknown as EditorState;

        renderer.render(state, 10);
        const slotsAtScroll = contentContainer.querySelectorAll('.anyeditor-sticky-slot');
        expect(slotsAtScroll.length).toBe(2);
        expect(wrapper.querySelectorAll('.anyeditor-sticky-header').length).toBe(1);

        // Bounce into negative overscroll (e.g. macOS rubber-band scrollTop = -15)
        renderer.render(state, -15);
        const slotsAtOverscroll = contentContainer.querySelectorAll('.anyeditor-sticky-slot');
        expect(slotsAtOverscroll.length).toBe(2);
        expect(slotsAtOverscroll[0]).toBe(slotsAtScroll[0]);
        expect(slotsAtOverscroll[1]).toBe(slotsAtScroll[1]);
        expect(wrapper.querySelectorAll('.anyeditor-sticky-header').length).toBe(0);
        expect(renderer.getActiveLine()).toBeNull();
        expect(slotsAtOverscroll[0].querySelector('.anyeditor-sticky-banner')?.classList.contains('anyeditor-sticky-passed')).toBe(false);
    });
});

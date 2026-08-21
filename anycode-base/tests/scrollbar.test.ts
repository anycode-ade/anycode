import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ScrollbarMarkersRenderer } from '../src/renderer/ScrollbarMarkersRenderer';
import { EditorState } from '../src/editor';
import { Code } from '../src/code';
import { Search } from '../src/search';

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
            setProperty(prop: string, val: string) {
                styleObj[prop] = val;
            },
            removeProperty(prop: string) {
                delete styleObj[prop];
            },
            get transform() {
                return styleObj.transform || '';
            },
            set transform(val: string) {
                styleObj.transform = val;
            },
            get height() {
                return styleObj.height || '';
            },
            set height(val: string) {
                styleObj.height = val;
            },
            get display() {
                return styleObj.display || '';
            },
            set display(val: string) {
                styleObj.display = val;
            },
        },
        dataset: {},
        classList: {
            add(...cls: string[]) {
                cls.forEach(c => classListSet.add(c));
            },
            remove(...cls: string[]) {
                cls.forEach(c => classListSet.delete(c));
            },
            contains(c: string) {
                return classListSet.has(c);
            },
        },
        setAttribute(name: string, val: string) {},
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
        isConnected: true,
        clientHeight: 600,
        scrollHeight: 5000,
        scrollTop: 0,
    };
}

describe('ScrollbarMarkersRenderer', () => {
    let originalDocument: any;
    let container: any;
    let wrapper: any;

    beforeEach(() => {
        originalDocument = (globalThis as any).document;
        (globalThis as any).document = {
            createElement: (tag: string) => createMockElement(tag),
            createDocumentFragment: () => createMockElement('fragment'),
        };
        container = createMockElement('div');
        wrapper = createMockElement('div');
        wrapper.appendChild(container);
    });

    afterEach(() => {
        (globalThis as any).document = originalDocument;
    });

    it('positions thumb at the bottom when scrolled to maxScrollTop', () => {
        const renderer = new ScrollbarMarkersRenderer(
            container,
            () => {},
            () => {},
            () => {},
            true,
            wrapper
        );

        container.clientHeight = 600;
        container.scrollHeight = 5000;

        const mockState: Partial<EditorState> = {
            code: new Code('a\n'.repeat(249) + 'a', 'test.ts', 'typescript'),
            settings: { lineHeight: 20, buffer: 5 },
            search: new Search(),
            errorLines: new Map(),
            scrollbarMarkersEnabled: true,
        };

        renderer.render(mockState as EditorState, true, [], []);
        renderer.updateGeometry(600, 5000);

        // Max scroll top = 5000 - 600 = 4400
        renderer.updateThumbPosition(4400);

        const thumb = (renderer as any).thumb;
        expect(thumb.style.display).toBe('block');

        // INSET = 2, availableHeight = 600 - 4 = 596
        // sliderSize = max(20, floor(596 * 596 / 5000)) = 71
        // maxSliderPosition = 596 - 71 = 525
        // sliderPosition = INSET + maxSliderPosition = 2 + 525 = 527
        expect(thumb.style.transform).toBe('translateY(527px)');
        expect(thumb.style.height).toBe('71px');
    });

    it('recalculates thumb position and size correctly after zoom/resize (smaller clientHeight)', () => {
        const renderer = new ScrollbarMarkersRenderer(
            container,
            () => {},
            () => {},
            () => {},
            true,
            wrapper
        );

        container.clientHeight = 600;
        container.scrollHeight = 5000;

        const mockState: Partial<EditorState> = {
            code: new Code('a\n'.repeat(249) + 'a', 'test.ts', 'typescript'),
            settings: { lineHeight: 20, buffer: 5 },
            search: new Search(),
            errorLines: new Map(),
            scrollbarMarkersEnabled: true,
        };

        renderer.render(mockState as EditorState, true, [], []);
        renderer.updateGeometry(600, 5000);

        // Zoom in: clientHeight reduces to 400px
        container.clientHeight = 400;

        // updateGeometry called with no args (ResizeObserver behavior)
        renderer.updateGeometry();

        // When scrolled to new bottom: maxScrollTop = 5000 - 400 = 4600
        renderer.updateThumbPosition(4600);

        const thumb = (renderer as any).thumb;

        // INSET = 2, availableHeight = 400 - 4 = 396
        // sliderSize = max(20, floor(396 * 396 / 5000)) = 31
        // maxSliderPosition = 396 - 31 = 365
        // sliderPosition = INSET + 365 = 367
        expect(thumb.style.transform).toBe('translateY(367px)');
        expect(thumb.style.height).toBe('31px');
    });

    it('recalculates thumb when zoomed out (larger clientHeight)', () => {
        const renderer = new ScrollbarMarkersRenderer(
            container,
            () => {},
            () => {},
            () => {},
            true,
            wrapper
        );

        container.clientHeight = 400;
        container.scrollHeight = 5000;

        const mockState: Partial<EditorState> = {
            code: new Code('a\n'.repeat(249) + 'a', 'test.ts', 'typescript'),
            settings: { lineHeight: 20, buffer: 5 },
            search: new Search(),
            errorLines: new Map(),
            scrollbarMarkersEnabled: true,
        };

        renderer.render(mockState as EditorState, true, [], []);
        renderer.updateGeometry(400, 5000);

        // Zoom out: clientHeight expands to 800px
        container.clientHeight = 800;

        // Update geometry on resize
        renderer.updateGeometry();

        // When scrolled to new bottom: maxScrollTop = 5000 - 800 = 4200
        renderer.updateThumbPosition(4200);

        const thumb = (renderer as any).thumb;

        // INSET = 2, availableHeight = 800 - 4 = 796
        // sliderSize = max(20, floor(796 * 796 / 5000)) = 126
        // maxSliderPosition = 796 - 126 = 670
        // sliderPosition = INSET + 670 = 672
        expect(thumb.style.transform).toBe('translateY(672px)');
        expect(thumb.style.height).toBe('126px');
    });
});

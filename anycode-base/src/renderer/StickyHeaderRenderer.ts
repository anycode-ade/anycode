import { EditorState } from "../editor";
import { MultiBufferHeaderInfo } from "../multibuffer";

export interface StickyHeaderCallbacks {
    onToggleCollapse?: (line: number) => void;
    onJumpToFile?: (line: number) => void;
    getVisualIndexForLine?: (line: number) => number;
}

export class StickyHeaderRenderer {
    private container: HTMLDivElement;
    private wrapper: HTMLDivElement;
    private element: HTMLDivElement;
    private contentEl: HTMLDivElement;
    private titleEl: HTMLSpanElement;
    private chevronEl: HTMLSpanElement;
    private fileNameEl: HTMLSpanElement;
    private addedEl: HTMLSpanElement;
    private removedEl: HTMLSpanElement;
    private enabled: boolean = true;
    private currentActiveLine: number | null = null;
    private callbacks: StickyHeaderCallbacks;

    constructor(
        container: HTMLDivElement,
        wrapper: HTMLDivElement | undefined,
        callbacks: StickyHeaderCallbacks = {},
        enabled: boolean = true
    ) {
        this.container = container;
        this.wrapper = wrapper || container;
        this.callbacks = callbacks;
        this.enabled = enabled;

        this.element = document.createElement('div');
        this.element.className = 'anyeditor-sticky-header';
        this.element.style.display = 'none';

        this.contentEl = document.createElement('div');
        this.contentEl.className = 'sticky-header-content';

        this.titleEl = document.createElement('span');
        this.titleEl.className = 'multibuffer-header';

        this.chevronEl = document.createElement('span');
        this.chevronEl.className = 'sticky-header-chevron';

        this.fileNameEl = document.createElement('span');
        this.fileNameEl.className = 'sticky-header-path';

        this.titleEl.appendChild(this.chevronEl);
        this.titleEl.appendChild(this.fileNameEl);

        this.addedEl = document.createElement('span');
        this.addedEl.className = 'multibuffer-header-added';

        this.removedEl = document.createElement('span');
        this.removedEl.className = 'multibuffer-header-removed';

        this.contentEl.appendChild(this.titleEl);
        this.contentEl.appendChild(this.addedEl);
        this.contentEl.appendChild(this.removedEl);

        this.element.appendChild(this.contentEl);

        this.element.addEventListener('click', this.handleClick);

        if (this.wrapper) {
            this.wrapper.appendChild(this.element);
        }
    }

    public setEnabled(enabled: boolean, state?: EditorState, scrollTop?: number) {
        this.enabled = enabled;
        if (!enabled) {
            this.hide();
        } else if (state) {
            this.render(state, scrollTop !== undefined ? scrollTop : (this.container?.scrollTop ?? 0));
        }
    }

    public isEnabled(): boolean {
        return this.enabled;
    }

    public getElement(): HTMLDivElement {
        return this.element;
    }

    public getActiveLine(): number | null {
        return this.currentActiveLine;
    }

    private hide() {
        if (this.element.style.display !== 'none') {
            this.element.style.display = 'none';
        }
        if (this.contentEl.style.opacity !== '') {
            this.contentEl.style.opacity = '';
        }
        if (this.element.style.transform !== '') {
            this.element.style.transform = '';
        }
        this.currentActiveLine = null;
    }

    private handleClick = (e: MouseEvent) => {
        if (this.currentActiveLine === null) return;
        e.preventDefault();
        e.stopPropagation();

        const target = e.target as HTMLElement;
        if (target === this.chevronEl || this.chevronEl.contains(target)) {
            this.callbacks.onToggleCollapse?.(this.currentActiveLine);
        } else {
            this.callbacks.onJumpToFile?.(this.currentActiveLine);
        }
    };

    public render(state: EditorState | null, scrollTop: number) {
        if (!this.enabled || !state) {
            this.hide();
            return;
        }

        const multibufferCode = state.code as any;
        if (!multibufferCode || typeof multibufferCode.getFileHeaders !== 'function') {
            this.hide();
            return;
        }

        const headers: MultiBufferHeaderInfo[] = multibufferCode.getFileHeaders();
        if (!headers || headers.length === 0) {
            this.hide();
            return;
        }

        const lineHeight = state.settings.lineHeight || 20;
        const getVisualIndex = this.callbacks.getVisualIndexForLine ?? ((line: number) => line);

        const headerPositions = headers.map(header => ({
            header,
            y: getVisualIndex(header.line) * lineHeight,
        }));

        let activeIdx = -1;
        for (let i = 0; i < headerPositions.length; i++) {
            if (headerPositions[i].y <= scrollTop) {
                activeIdx = i;
            } else {
                break;
            }
        }

        if (activeIdx === -1) {
            this.hide();
            return;
        }

        const current = headerPositions[activeIdx];
        if (scrollTop <= current.y) {
            this.hide();
            return;
        }

        const next = headerPositions[activeIdx + 1];

        let translateY = 0;
        if (next) {
            const distanceToNext = next.y - scrollTop;
            if (distanceToNext < lineHeight && distanceToNext >= 0) {
                translateY = distanceToNext - lineHeight;
            }
        }

        this.currentActiveLine = current.header.line;

        const chevronText = `${current.header.collapsed ? '▸' : '▾'} `;
        if (this.chevronEl.textContent !== chevronText) {
            this.chevronEl.textContent = chevronText;
        }

        if (this.fileNameEl.textContent !== current.header.fileName) {
            this.fileNameEl.textContent = current.header.fileName;
        }

        if (this.element.title !== current.header.path) {
            this.element.title = current.header.path;
        }

        const added = current.header.added;
        const removed = current.header.removed;

        const addedText = added > 0 ? `  +${added}` : '';
        if (this.addedEl.textContent !== addedText) {
            this.addedEl.textContent = addedText;
            this.addedEl.style.display = added > 0 ? '' : 'none';
        }

        const removedText = removed > 0 ? `${added > 0 ? ' ' : '  '}−${removed}` : '';
        if (this.removedEl.textContent !== removedText) {
            this.removedEl.textContent = removedText;
            this.removedEl.style.display = removed > 0 ? '' : 'none';
        }

        const targetTransform = translateY !== 0 ? `translateY(${translateY}px)` : '';
        if (this.element.style.transform !== targetTransform) {
            this.element.style.transform = targetTransform;
        }

        const progress = Math.max(0, Math.min(1, (lineHeight + translateY) / lineHeight));
        const opacity = translateY !== 0 ? Math.pow(progress, 2.5) : 1;
        const opacityStr = opacity < 1 ? String(Math.round(opacity * 1000) / 1000) : '';
        if (this.contentEl.style.opacity !== opacityStr) {
            this.contentEl.style.opacity = opacityStr;
        }

        if (this.element.style.display !== 'flex') {
            this.element.style.display = 'flex';
        }
    }

    public clean() {
        this.element.removeEventListener('click', this.handleClick);
        this.element.remove();
    }
}

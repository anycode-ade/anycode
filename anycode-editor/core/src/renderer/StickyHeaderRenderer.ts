import { EditorState } from "../editor";
import { MultiBufferHeaderInfo } from "../multibuffer";

export interface StickyHeaderCallbacks {
    onToggleCollapse?: (line: number) => void;
    onJumpToFile?: (line: number) => void;
    getVisualIndexForLine?: (line: number) => number;
}

const SLOT_RADIUS_PX = 1500;
const MAX_SLOT_COUNT_RADIUS = 25;

interface StickySlot {
    sig: string;
    slotEl: HTMLDivElement;
    element: HTMLDivElement;
    contentEl: HTMLDivElement;
    clickHandler: (e: MouseEvent) => void;
}

export class StickyHeaderRenderer {
    private container: HTMLDivElement;
    private host: HTMLDivElement;
    private hiddenElement: HTMLDivElement;
    private slots: Map<string, StickySlot> = new Map();
    private activeSlotKey: string | null = null;
    private enabled: boolean = true;
    private currentActiveLine: number | null = null;
    private callbacks: StickyHeaderCallbacks;

    constructor(
        container: HTMLDivElement,
        wrapper: HTMLDivElement | undefined,
        callbacks: StickyHeaderCallbacks = {},
        enabled: boolean = true,
        stickyHost?: HTMLDivElement
    ) {
        this.container = container;
        this.host = stickyHost || container || wrapper!;
        this.callbacks = callbacks;
        this.enabled = enabled;

        this.hiddenElement = document.createElement('div');
        this.hiddenElement.className = 'anyeditor-sticky-header';
        this.hiddenElement.style.display = 'none';
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
        if (this.activeSlotKey !== null) {
            const active = this.slots.get(this.activeSlotKey);
            if (active) return active.element;
        }
        return this.hiddenElement;
    }

    public getActiveLine(): number | null {
        return this.currentActiveLine;
    }

    private disposeSlot(slot: StickySlot) {
        slot.element.removeEventListener('click', slot.clickHandler);
        slot.slotEl.remove();
    }

    private clearActive() {
        if (this.activeSlotKey !== null) {
            const prev = this.slots.get(this.activeSlotKey);
            if (prev) {
                prev.element.classList.remove('anyeditor-sticky-header');
                if (prev.contentEl.style.opacity !== '') {
                    prev.contentEl.style.opacity = '';
                }
            }
            this.activeSlotKey = null;
        }
        this.currentActiveLine = null;
    }

    private hide() {
        for (const slot of this.slots.values()) {
            this.disposeSlot(slot);
        }
        this.slots.clear();
        this.activeSlotKey = null;
        this.currentActiveLine = null;
    }

    private createSlot(
        key: string,
        header: MultiBufferHeaderInfo,
        sig: string
    ): StickySlot {
        const slotEl = document.createElement('div');
        slotEl.className = 'anyeditor-sticky-slot';

        const element = document.createElement('div');
        element.className = 'anyeditor-sticky-banner';
        element.title = header.path;

        const contentEl = document.createElement('div');
        contentEl.className = 'sticky-header-content';

        const titleEl = document.createElement('span');
        titleEl.className = 'multibuffer-header';

        const chevronEl = document.createElement('span');
        chevronEl.className = `sticky-header-chevron ${header.collapsed ? 'collapsed' : 'expanded'}`;

        const iconEl = document.createElement('span');
        const iconClassName = header.iconClassName ?? '';
        iconEl.className = `multibuffer-header-icon ${iconClassName}`.trim();
        iconEl.style.display = iconClassName ? '' : 'none';

        const fileNameEl = document.createElement('span');
        fileNameEl.className = 'sticky-header-path';
        fileNameEl.textContent = header.fileName;

        const dirNameEl = document.createElement('span');
        dirNameEl.className = 'multibuffer-header-dir';
        dirNameEl.textContent = header.dirName ? `  ${header.dirName}` : '';

        titleEl.appendChild(chevronEl);
        titleEl.appendChild(iconEl);
        titleEl.appendChild(fileNameEl);
        titleEl.appendChild(dirNameEl);

        const added = header.added ?? 0;
        const removed = header.removed ?? 0;

        const addedEl = document.createElement('span');
        addedEl.className = 'multibuffer-header-added';
        addedEl.textContent = added > 0 ? `  +${added}` : '';
        addedEl.style.display = added > 0 ? '' : 'none';

        const removedEl = document.createElement('span');
        removedEl.className = 'multibuffer-header-removed';
        removedEl.textContent = removed > 0 ? `${added > 0 ? ' ' : '  '}−${removed}` : '';
        removedEl.style.display = removed > 0 ? '' : 'none';

        contentEl.appendChild(titleEl);
        contentEl.appendChild(addedEl);
        contentEl.appendChild(removedEl);
        element.appendChild(contentEl);
        slotEl.appendChild(element);

        const clickHandler = (e: MouseEvent) => {
            if (this.activeSlotKey !== key || this.currentActiveLine === null) return;
            e.preventDefault();
            e.stopPropagation();

            const target = e.target as HTMLElement;
            if (target === chevronEl || chevronEl.contains(target)) {
                this.callbacks.onToggleCollapse?.(this.currentActiveLine);
            } else {
                this.callbacks.onJumpToFile?.(this.currentActiveLine);
            }
        };
        element.addEventListener('click', clickHandler);

        return { sig, slotEl, element, contentEl, clickHandler };
    }

    public render(state: EditorState | null, scrollTop: number) {
        if (!this.enabled || !state) {
            this.hide();
            return;
        }

        const multibufferCode = state.code as any;
        const headers: MultiBufferHeaderInfo[] | undefined = multibufferCode?.getFileHeaders?.();
        if (!headers || headers.length === 0) {
            this.hide();
            return;
        }

        const lineHeight = state.settings.lineHeight || 20;
        const headerHeight = lineHeight * (state.code.getHeaderLayout()?.rows ?? 1);
        const getVisualIndex = this.callbacks.getVisualIndexForLine ?? ((line: number) => line);
        const positions = headers.map(h => getVisualIndex(h.line) * lineHeight);

        let activeIdx = -1;
        for (let i = 0; i < positions.length; i++) {
            if (positions[i] <= scrollTop) {
                activeIdx = i;
            } else {
                break;
            }
        }

        // Keep slots within [centerIdx ± MAX_SLOT_COUNT_RADIUS] and [scrollTop ± SLOT_RADIUS_PX]
        // on the compositor so fast wheel/trackpad flicks across boundaries never drop a frame
        // before rAF, while capping total GPU layers when many files are collapsed or small.
        const centerIdx = Math.max(0, activeIdx);
        const minIdx = Math.max(0, centerIdx - MAX_SLOT_COUNT_RADIUS);
        const maxIdx = Math.min(headers.length - 1, centerIdx + MAX_SLOT_COUNT_RADIUS);
        const minY = scrollTop - SLOT_RADIUS_PX;
        const maxY = scrollTop + SLOT_RADIUS_PX;
        const wantedKeys = new Set<string>();

        for (let i = minIdx; i <= maxIdx; i++) {
            const top = positions[i];
            const nextTop = i + 1 < positions.length ? positions[i + 1] : null;
            if ((nextTop ?? Infinity) < minY || top > maxY) continue;

            const header = headers[i];
            const key = header.fileId || String(header.fileIndex);
            wantedKeys.add(key);

            const height = nextTop !== null ? Math.max(headerHeight, nextTop - top) : null;
            const sig = `${header.path}\0${header.fileName}\0${header.dirName ?? ''}\0${header.iconClassName ?? ''}\0${header.collapsed ? 1 : 0}\0${header.added ?? 0}\0${header.removed ?? 0}`;

            let slot = this.slots.get(key);
            if (!slot || slot.sig !== sig) {
                if (slot) {
                    this.disposeSlot(slot);
                    if (this.activeSlotKey === key) this.activeSlotKey = null;
                }
                slot = this.createSlot(key, header, sig);
                this.slots.set(key, slot);
                this.host.appendChild(slot.slotEl);
            }

            const topPx = `${top}px`;
            if (slot.slotEl.style.top !== topPx) {
                slot.slotEl.style.top = topPx;
            }
            if (height !== null) {
                const heightPx = `${height}px`;
                if (slot.slotEl.style.height !== heightPx) slot.slotEl.style.height = heightPx;
                if (slot.slotEl.style.bottom !== '') slot.slotEl.style.bottom = '';
            } else {
                if (slot.slotEl.style.height !== '') slot.slotEl.style.height = '';
                if (slot.slotEl.style.bottom !== '0px') slot.slotEl.style.bottom = '0px';
            }
            const bannerHeightPx = `${headerHeight}px`;
            if (slot.element.style.height !== bannerHeightPx) {
                slot.element.style.height = bannerHeightPx;
            }

            const passed = i < activeIdx;
            if (passed) {
                slot.element.classList.add('anyeditor-sticky-passed');
            } else {
                slot.element.classList.remove('anyeditor-sticky-passed');
            }
        }

        for (const [key, slot] of this.slots) {
            if (!wantedKeys.has(key)) {
                this.disposeSlot(slot);
                this.slots.delete(key);
                if (this.activeSlotKey === key) this.activeSlotKey = null;
            }
        }

        if (activeIdx === -1 || scrollTop <= positions[activeIdx]) {
            this.clearActive();
            return;
        }

        const activeKey = headers[activeIdx].fileId || String(headers[activeIdx].fileIndex);
        if (this.activeSlotKey !== activeKey) {
            this.clearActive();
            this.activeSlotKey = activeKey;
            this.slots.get(activeKey)!.element.classList.add('anyeditor-sticky-header');
        }

        const activeSlot = this.slots.get(activeKey)!;
        this.currentActiveLine = headers[activeIdx].line;

        const nextTop = activeIdx + 1 < positions.length ? positions[activeIdx + 1] : undefined;
        const distanceToNext = nextTop !== undefined ? nextTop - scrollTop : headerHeight;
        const inPushZone = nextTop !== undefined && distanceToNext >= 0 && distanceToNext < headerHeight;
        const progress = Math.max(0, Math.min(1, distanceToNext / headerHeight));
        const fadeStart = 0.55;
        const fadeProgress = Math.max(0, (progress - fadeStart) / (1 - fadeStart));
        const opacity = inPushZone ? Math.pow(fadeProgress, 2) : 1;
        const opacityStr = opacity < 1 ? String(Math.round(opacity * 1000) / 1000) : '';
        if (activeSlot.contentEl.style.opacity !== opacityStr) {
            activeSlot.contentEl.style.opacity = opacityStr;
        }
    }

    public clean() {
        this.hide();
    }
}

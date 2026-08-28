import { CSS_CLASS } from "../constants";
import { EditorState } from "../editor";
import { DiffInfo } from "../diff";
import type { VisualRow } from "./Renderer";

type DiffRange = {
    startRow: number;
    endRow: number;
    targetLine: number;
    type: DiffInfo['changeType'];
};

type MarkerTarget = {
    line: number;
    searchIndex: number;
};

type SearchMarker = {
    line: number;
    column: number;
    selected: boolean;
};

function arraysEqual<T>(
    left: T[],
    right: T[],
    equals: (a: T, b: T) => boolean
): boolean {
    return left.length === right.length
        && left.every((value, index) => equals(value, right[index]));
}

export class ScrollbarMarkersRenderer {
    private container: HTMLDivElement;
    private wrapper: HTMLDivElement;
    private element: HTMLDivElement;
    private diffLayer: HTMLDivElement;
    private wordLayer: HTMLDivElement;
    private searchLayer: HTMLDivElement;
    private errorLayer: HTMLDivElement;
    private thumb: HTMLDivElement;
    private state: EditorState | null = null;
    private includeSearch = true;
    private wordLines: number[] = [];
    private diffRanges: DiffRange[] = [];
    private errorLines: number[] = [];
    private searchMarkers: SearchMarker[] = [];
    private totalRows = 0;
    private visualRows: VisualRow[] | null = null;
    private rightOffset = -1;
    private enabled = true;
    private revealLineCenter: (state: EditorState, line: number) => void;
    private selectSearchMatch: (state: EditorState, index: number) => void;
    private onImmediateScroll?: () => void;
    private onDragStateChange?: (isDragging: boolean, state?: EditorState) => void;

    private resizeObserver: ResizeObserver | null = null;

    constructor(
        container: HTMLDivElement,
        revealLineCenter: (state: EditorState, line: number) => void,
        selectSearchMatch: (state: EditorState, index: number) => void,
        onImmediateScroll?: () => void,
        enabled: boolean = true,
        wrapper?: HTMLDivElement,
        onDragStateChange?: (isDragging: boolean, state?: EditorState) => void
    ) {
        this.container = container;
        this.wrapper = wrapper || container;
        this.revealLineCenter = revealLineCenter;
        this.selectSearchMatch = selectSearchMatch;
        this.onImmediateScroll = onImmediateScroll;
        this.enabled = enabled;
        this.onDragStateChange = onDragStateChange;

        this.element = document.createElement('div');
        this.element.className = CSS_CLASS.SMR;
        this.element.setAttribute('aria-label', 'Scrollbar markers');

        this.thumb = document.createElement('div');
        this.thumb.className = CSS_CLASS.SMRT;
        this.thumb.setAttribute('aria-label', 'Scrollbar thumb');

        this.element.addEventListener('pointerdown', this.handlePointer);

        this.diffLayer = this.createLayer(CSS_CLASS.SMR_DIFF_LAYER);
        this.wordLayer = this.createLayer(CSS_CLASS.SMR_WORD_LAYER);
        this.searchLayer = this.createLayer(CSS_CLASS.SMR_SEARCH_LAYER);
        this.errorLayer = this.createLayer(CSS_CLASS.SMR_ERROR_LAYER);
        this.element.append(
            this.diffLayer,
            this.wordLayer,
            this.searchLayer,
            this.errorLayer,
            this.thumb
        );
        if (this.enabled) this.wrapper.appendChild(this.element);

        this.setupResizeObserver();
    }

    private setupResizeObserver() {
        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(() => {
                this.updateGeometry();
                if (this.onImmediateScroll) {
                    this.onImmediateScroll();
                } else {
                    this.updateThumbPosition();
                }
            });
            if (this.wrapper) this.resizeObserver.observe(this.wrapper);
            if (this.container && this.container !== this.wrapper) {
                this.resizeObserver.observe(this.container);
            }
        }
    }

    private fadeTimer: number | null = null;

    public triggerFadeIn() {
        if (!this.element) return;
        if (!this.element.classList.contains("visible")) {
            this.element.classList.add("visible");
        }

        if (this.fadeTimer !== null) {
            window.clearTimeout(this.fadeTimer);
        }

        this.fadeTimer = window.setTimeout(() => {
            if (this.element && !this.element.classList.contains("dragging")) {
                this.element.classList.remove("visible");
            }
            this.fadeTimer = null;
        }, 1000);
    }

    public clean() {
        if (this.fadeTimer !== null) {
            window.clearTimeout(this.fadeTimer);
            this.fadeTimer = null;
        }
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
    }

    public setEnabled(enabled: boolean) {
        if (this.enabled === enabled) return;

        this.enabled = enabled;
        if (!enabled) {
            this.clear();
            this.element.remove();
            return;
        }

        if (!this.element.isConnected) {
            this.wrapper.appendChild(this.element);
        }
    }

    private getVisualIndexCallback?: (line: number) => number;
    private getLineIndexCallback?: (visualIndex: number) => number;

    public render(
        state: EditorState | null,
        includeSearch: boolean = true,
        wordLines: number[] = this.wordLines,
        getVisualIndex?: (line: number) => number,
        getLineIndex?: (visualIndex: number) => number,
        totalVisualRowsOverride?: number
    ) {
        if (!this.enabled) return;

        this.state = state;
        this.includeSearch = includeSearch;
        this.getVisualIndexCallback = getVisualIndex;
        this.getLineIndexCallback = getLineIndex;
        const rightOffset = this.getScrollbarOffset();

        if (!state) {
            this.clear();
            return;
        }

        this.applyScrollbarSettings(state);

        const search = state.search;
        const searchMatches = includeSearch && search.isActive() && search.getPattern()
            ? search.getMatches()
            : [];
        const nextWordLines = wordLines;
        this.visualRows = null;
        const totalRows = Math.max(1, totalVisualRowsOverride ?? state.code.linesLength());
        const layoutChanged = totalRows !== this.totalRows;
        this.totalRows = totalRows;
        const nextDiffRanges = this.getDiffRanges(state);
        const nextErrorLines = this.getErrorLines(state);
        const selected = search.getSelected();
        const nextSearchMarkers = searchMatches.map((match, index) => ({
            line: match.line,
            column: match.column,
            selected: index === selected,
        }));

        if (rightOffset !== this.rightOffset) {
            this.rightOffset = rightOffset;
            this.element.style.right = `${rightOffset}px`;
        }

        const diffRangesUnchanged = arraysEqual(nextDiffRanges, this.diffRanges, (a, b) =>
            a.startRow === b.startRow
            && a.endRow === b.endRow
            && a.targetLine === b.targetLine
            && a.type === b.type
        );
        const wordLinesUnchanged = arraysEqual(nextWordLines, this.wordLines, (a, b) => a === b);
        const searchMarkersUnchanged = arraysEqual(nextSearchMarkers, this.searchMarkers, (a, b) =>
            a.line === b.line
            && a.column === b.column
            && a.selected === b.selected
        );
        const errorLinesUnchanged = arraysEqual(nextErrorLines, this.errorLines, (a, b) => a === b);

        const hasAnyMarkers = nextSearchMarkers.length > 0
            || nextWordLines.length > 0
            || nextErrorLines.length > 0
            || nextDiffRanges.length > 0;

        if (!hasAnyMarkers) {
            if (this.wordLines.length > 0 || this.diffRanges.length > 0 || this.errorLines.length > 0 || this.searchMarkers.length > 0) {
                this.wordLines = [];
                this.diffRanges = [];
                this.errorLines = [];
                this.searchMarkers = [];
                this.diffLayer.replaceChildren();
                this.wordLayer.replaceChildren();
                this.searchLayer.replaceChildren();
                this.errorLayer.replaceChildren();
            }
        } else if (!layoutChanged && diffRangesUnchanged && wordLinesUnchanged && searchMarkersUnchanged && errorLinesUnchanged) {
            // Nothing changed! Do not touch layers!
            if (!this.element.classList.contains("active")) {
                this.element.classList.add("active");
            }
            this.updateThumbPosition();
            return;
        } else {
            if (layoutChanged || !diffRangesUnchanged) {
                this.diffRanges = nextDiffRanges;
                this.renderDiffLayer(totalRows);
            }
            if (layoutChanged || !wordLinesUnchanged) {
                this.wordLines = [...nextWordLines];
                this.renderLineLayer(this.wordLayer, CSS_CLASS.SMR_WORD, this.wordLines, totalRows);
            }
            if (layoutChanged || !searchMarkersUnchanged) {
                this.searchMarkers = nextSearchMarkers;
                this.renderSearchLayer(totalRows);
            }
            if (layoutChanged || !errorLinesUnchanged) {
                this.errorLines = nextErrorLines;
                this.renderLineLayer(this.errorLayer, CSS_CLASS.SMR_ERROR, this.errorLines, totalRows);
            }
        }

        if (!this.element.classList.contains("active")) {
            this.element.classList.add("active");
        }
        this.updateThumbPosition();
    }

    private cachedClientHeight = 0;
    private cachedScrollHeight = 0;
    private lastSliderSize = -1;
    private lastSliderPosition = -1;
    private lastThumbScrollTop = -1;

    private getGeometry(clientHeightOverride?: number, scrollHeightOverride?: number): { clientHeight: number; scrollHeight: number } {
        if (clientHeightOverride && clientHeightOverride > 0) {
            this.cachedClientHeight = clientHeightOverride;
        } else if (this.container?.clientHeight > 0) {
            this.cachedClientHeight = this.container.clientHeight;
        }

        if (scrollHeightOverride && scrollHeightOverride > 0) {
            this.cachedScrollHeight = scrollHeightOverride;
        } else if (this.state?.settings?.lineHeight) {
            this.cachedScrollHeight = (this.totalRows || this.state.code.linesLength()) * this.state.settings.lineHeight;
        } else if (this.container?.scrollHeight > 0) {
            this.cachedScrollHeight = this.container.scrollHeight;
        }

        return {
            clientHeight: this.cachedClientHeight || 600,
            scrollHeight: this.cachedScrollHeight || 0,
        };
    }

    public updateGeometry(clientHeight?: number, scrollHeight?: number) {
        this.getGeometry(clientHeight, scrollHeight);
    }

    private cachedMinSliderSize = 20;
    private lastScrollbarStyle = "";
    private lastScrollbarWidth = -1;
    private lastScrollbarMinSize = -1;

    private applyScrollbarSettings(state: EditorState) {
        const scrollbarSettings = state.settings?.scrollbar;
        const style = scrollbarSettings?.style || "rounded";
        const width = scrollbarSettings?.width ?? -1;
        const minSize = scrollbarSettings?.minSize ?? -1;

        if (
            this.lastScrollbarStyle === style &&
            this.lastScrollbarWidth === width &&
            this.lastScrollbarMinSize === minSize
        ) {
            return;
        }

        this.lastScrollbarStyle = style;
        this.lastScrollbarWidth = width;
        this.lastScrollbarMinSize = minSize;

        this.element.classList.remove("style-rounded", "style-flat");
        this.element.classList.add(`style-${style}`);
        if (scrollbarSettings?.style !== undefined) {
            this.element.dataset.scrollbarStyle = style;
        } else {
            delete this.element.dataset.scrollbarStyle;
        }

        if (width > 0) {
            this.element.style.setProperty("--smr-custom-width", `${width}px`);
        } else {
            this.element.style.removeProperty("--smr-custom-width");
        }

        if (minSize > 0) {
            this.element.style.setProperty("--smr-min-size", `${minSize}px`);
            this.cachedMinSliderSize = minSize;
        } else {
            this.element.style.removeProperty("--smr-min-size");
            this.cachedMinSliderSize = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(pointer: coarse)").matches ? 28 : 20;
        }
    }

    private getMinimumSliderSize(): number {
        return this.cachedMinSliderSize;
    }

    public updateThumbPosition(scrollTopOverride?: number, triggerFade: boolean = false, clientHeightOverride?: number) {
        if (!this.enabled || !this.thumb || this.thumb.classList.contains("dragging")) return;

        const scrollTop = scrollTopOverride !== undefined ? scrollTopOverride : (this.container?.scrollTop ?? 0);
        const { clientHeight, scrollHeight } = this.getGeometry(clientHeightOverride);

        if (scrollHeight <= clientHeight || clientHeight <= 0) {
            if (this.thumb.style.display !== 'none') this.thumb.style.display = 'none';
            return;
        }

        if (this.thumb.style.display !== 'block') this.thumb.style.display = 'block';

        // Monaco Editor Scrollbar Math with 2px inset
        const INSET = 2;
        const availableHeight = Math.max(1, clientHeight - INSET * 2);
        const sliderSize = Math.round(Math.max(this.getMinimumSliderSize(), Math.floor((availableHeight * availableHeight) / scrollHeight)));
        const maxSliderPosition = Math.max(0, availableHeight - sliderSize);
        const maxScrollTop = Math.max(1, scrollHeight - clientHeight);
        const clampedScrollTop = Math.max(0, Math.min(maxScrollTop, scrollTop));
        const sliderPosition = INSET + Math.max(0, Math.min(maxSliderPosition, Math.round(clampedScrollTop * (maxSliderPosition / maxScrollTop))));

        if (this.lastSliderSize !== sliderSize) {
            this.lastSliderSize = sliderSize;
            this.thumb.style.height = `${sliderSize}px`;
        }
        if (this.lastSliderPosition !== sliderPosition) {
            this.lastSliderPosition = sliderPosition;
            this.thumb.style.transform = `translateY(${sliderPosition}px)`;
        }
        this.lastThumbScrollTop = scrollTop;

        if (triggerFade) {
            this.triggerFadeIn();
        }
    }

    private clear() {
        const hasMarkers = this.wordLines.length > 0
            || this.diffRanges.length > 0
            || this.errorLines.length > 0
            || this.searchMarkers.length > 0;
        if (!hasMarkers && !this.element.classList.contains('active')) return;

        this.wordLines = [];
        this.diffRanges = [];
        this.errorLines = [];
        this.searchMarkers = [];
        this.totalRows = 0;
        this.visualRows = null;
        this.diffLayer.replaceChildren();
        this.wordLayer.replaceChildren();
        this.searchLayer.replaceChildren();
        this.errorLayer.replaceChildren();
        this.element.style.height = '';
        this.element.classList.remove('active');
        if (this.thumb) this.thumb.style.display = 'none';
    }

    private createLayer(className: string): HTMLDivElement {
        const layer = document.createElement('div');
        layer.className = className;
        return layer;
    }

    private renderDiffLayer(totalRows: number) {
        const fragment = document.createDocumentFragment();
        for (let index = 0; index < this.diffRanges.length; index++) {
            const range = this.diffRanges[index];
            const marker = document.createElement('span');
            marker.className = `${CSS_CLASS.SMR_DIFF} ${range.type}`;
            marker.dataset.rangeIndex = index.toString();
            marker.style.top = `${(range.startRow / totalRows) * 100}%`;
            marker.style.height = `${((range.endRow - range.startRow + 1) / totalRows) * 100}%`;
            fragment.appendChild(marker);
        }
        this.diffLayer.replaceChildren(fragment);
    }

    private renderLineLayer(
        layer: HTMLDivElement,
        className: string,
        lines: number[],
        totalRows: number
    ) {
        const fragment = document.createDocumentFragment();
        for (const line of lines) {
            fragment.appendChild(this.createLineMarker(className, line, totalRows));
        }
        layer.replaceChildren(fragment);
    }

    private renderSearchLayer(totalRows: number) {
        const fragment = document.createDocumentFragment();
        for (const marker of this.searchMarkers) {
            const className = marker.selected ? `${CSS_CLASS.SMR_SEARCH} selected` : CSS_CLASS.SMR_SEARCH;
            fragment.appendChild(this.createLineMarker(className, marker.line, totalRows));
        }
        this.searchLayer.replaceChildren(fragment);
    }

    private getVisualRowForLine(line: number): number {
        return this.getVisualIndexCallback ? this.getVisualIndexCallback(line) : line;
    }

    private getLineForVisualRow(visualRow: number, targetLine?: number): number {
        return this.getLineIndexCallback ? this.getLineIndexCallback(visualRow) : (targetLine ?? visualRow);
    }

    private createLineMarker(className: string, line: number, totalRows: number): HTMLSpanElement {
        const marker = document.createElement('span');
        marker.className = `${CSS_CLASS.SMR_MARKER} ${className}`;
        const visualRow = this.getVisualRowForLine(line);
        marker.style.top = `${((visualRow + 0.5) / totalRows) * 100}%`;
        return marker;
    }

    private getScrollbarOffset(): number {
        return 0;
    }

    private getDiffRanges(state: EditorState): DiffRange[] {
        if (!state.diffs || !state.diffs.hasChanges()) return [];

        const rangesByHunk = new Map<number, DiffRange>();
        const hunks = state.diffs.getHunks();
        const totalLines = state.code.linesLength();

        for (const hunk of hunks) {
            const rawStart = Math.max(0, Math.min(totalLines - 1, hunk.startLine - 1));
            const rawEnd = hunk.changeType === 'deleted'
                ? rawStart
                : Math.max(rawStart, Math.min(totalLines - 1, hunk.startLine + Math.max(1, hunk.lineCount) - 2));

            const startRow = this.getVisualRowForLine(rawStart);
            const endRow = this.getVisualRowForLine(rawEnd);

            rangesByHunk.set(hunk.hunkId, {
                startRow,
                endRow,
                targetLine: rawStart,
                type: hunk.changeType,
            });
        }

        return Array.from(rangesByHunk.values());
    }

    private getErrorLines(state: EditorState): number[] {
        return Array.from(state.errorLines.keys())
            .filter((line) => line >= 0 && line < state.code.linesLength());
    }

    private getTargets(state: EditorState): MarkerTarget[] {
        const searchMatches = this.includeSearch && state.search.isActive() && state.search.getPattern()
            ? state.search.getMatches()
            : [];

        return [
            ...this.diffRanges.map((range) => ({
                line: range.targetLine,
                searchIndex: -1,
            })),
            ...this.wordLines.map((line) => ({ line, searchIndex: -1 })),
            ...searchMatches.map((match, searchIndex) => ({ line: match.line, searchIndex })),
            ...this.errorLines.map((line) => ({ line, searchIndex: -1 })),
        ];
    }

    private handlePointer = (event: PointerEvent) => {
        if (!this.state || !this.element.classList.contains('active')) return;

        const target = event.target as HTMLElement | null;
        const isMarker = target?.classList.contains(CSS_CLASS.SMR_MARKER) || target?.classList.contains(CSS_CLASS.SMR_DIFF);

        if (target === this.thumb || !isMarker) {
            event.preventDefault();
            event.stopPropagation();
            this.element.setPointerCapture(event.pointerId);
            this.thumb.classList.add('dragging');
            this.element.classList.add('dragging');
            this.onDragStateChange?.(true, this.state || undefined);

            const startY = event.clientY;
            const startX = event.clientX;
            const { clientHeight, scrollHeight } = this.getGeometry();
            const maxScrollTop = Math.max(1, scrollHeight - clientHeight);

            if (maxScrollTop <= 0 || clientHeight <= 0) return;

            const INSET = 2;
            const availableHeight = Math.max(1, clientHeight - INSET * 2);
            const MINIMUM_SLIDER_SIZE = this.getMinimumSliderSize();
            const sliderSize = Math.round(Math.max(MINIMUM_SLIDER_SIZE, Math.floor((availableHeight * availableHeight) / scrollHeight)));
            const maxSliderPosition = Math.max(0, availableHeight - sliderSize);
            const sliderRatio = maxSliderPosition / maxScrollTop;

            let startScrollTop = this.container.scrollTop;

            // Track click: Monaco centers the slider under the pointer
            if (target !== this.thumb) {
                const trackRect = this.element.getBoundingClientRect();
                const offsetWithinTrack = event.clientY - trackRect.top - INSET;
                const desiredSliderPos = Math.max(0, Math.min(maxSliderPosition, offsetWithinTrack - sliderSize / 2));
                startScrollTop = Math.round(desiredSliderPos / sliderRatio);

                this.container.scrollTop = startScrollTop;
                if (this.onImmediateScroll) {
                    this.onImmediateScroll();
                }
                this.thumb.style.transform = `translateY(${INSET + Math.round(startScrollTop * sliderRatio)}px)`;
            }

            const initialScrollTop = startScrollTop;
            const clampedInitialScrollTop = Math.max(0, Math.min(maxScrollTop, initialScrollTop));
            const initialSliderPos = Math.max(0, Math.min(maxSliderPosition, Math.round(clampedInitialScrollTop * sliderRatio)));

            const handleThumbMove = (moveEvent: PointerEvent) => {
                const deltaY = moveEvent.clientY - startY;
                const targetSliderPos = Math.max(0, Math.min(maxSliderPosition, initialSliderPos + deltaY));
                const targetScrollTop = Math.round(targetSliderPos / sliderRatio);

                this.container.scrollTop = targetScrollTop;
                if (this.onImmediateScroll) {
                    this.onImmediateScroll();
                }
                this.thumb.style.transform = `translateY(${INSET + Math.round(targetSliderPos)}px)`;
            };

            const handleThumbUp = (upEvent: PointerEvent) => {
                this.element.releasePointerCapture(upEvent.pointerId);
                this.thumb.classList.remove('dragging');
                this.element.classList.remove('dragging');
                this.onDragStateChange?.(false, this.state || undefined);
                this.element.removeEventListener('pointermove', handleThumbMove);
                this.element.removeEventListener('pointerup', handleThumbUp);
                this.element.removeEventListener('pointercancel', handleThumbUp);
                this.updateThumbPosition(this.container.scrollTop, true);
            };

            this.element.addEventListener('pointermove', handleThumbMove);
            this.element.addEventListener('pointerup', handleThumbUp);
            this.element.addEventListener('pointercancel', handleThumbUp);
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        this.element.setPointerCapture(event.pointerId);
        this.element.classList.add('dragging');
        this.onDragStateChange?.(true, this.state || undefined);

        const revealClosestMarker = (clientY: number) => {
            const state = this.state;
            if (!state) return;

            const activeMarker = this.updateActiveMarker(clientY);
            if (activeMarker?.classList.contains(CSS_CLASS.SMR_DIFF)) {
                const rangeIndex = Number(activeMarker.dataset.rangeIndex);
                const range = this.diffRanges[rangeIndex];
                if (range) {
                    const rect = activeMarker.getBoundingClientRect();
                    const ratio = Math.max(
                        0,
                        Math.min(1, (clientY - rect.top) / Math.max(1, rect.height))
                    );
                    const visualRow = Math.min(
                        range.endRow,
                        range.startRow
                            + Math.floor(ratio * (range.endRow - range.startRow + 1))
                    );
                    const line = this.getLineForVisualRow(visualRow, range.targetLine);
                    this.revealLineCenter(state, line);
                    return;
                }
            }

            const markers = this.getTargets(state);
            if (markers.length === 0) return;

            const rect = this.element.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (clientY - rect.top) / Math.max(1, rect.height)));
            const targetLine = ratio * Math.max(0, state.code.linesLength() - 1);

            let closest = markers[0];
            let closestDistance = Math.abs(closest.line - targetLine);
            for (let index = 1; index < markers.length; index++) {
                const distance = Math.abs(markers[index].line - targetLine);
                if (distance < closestDistance) {
                    closest = markers[index];
                    closestDistance = distance;
                }
            }

            if (closest.searchIndex >= 0) {
                this.selectSearchMatch(state, closest.searchIndex);
                this.updateSelectedSearchMarker(state, closest.searchIndex);
            }
            this.revealLineCenter(state, closest.line);
        };

        const handlePointerMove = (moveEvent: PointerEvent) => {
            revealClosestMarker(moveEvent.clientY);
        };
        const handlePointerUp = (upEvent: PointerEvent) => {
            this.element.releasePointerCapture(upEvent.pointerId);
            this.element.classList.remove('dragging');
            this.element.querySelector(`.${CSS_CLASS.SMR_ACTIVE}`)?.classList.remove(CSS_CLASS.SMR_ACTIVE);
            this.onDragStateChange?.(false, this.state || undefined);
            this.element.removeEventListener('pointermove', handlePointerMove);
            this.element.removeEventListener('pointerup', handlePointerUp);
            this.element.removeEventListener('pointercancel', handlePointerUp);
        };

        revealClosestMarker(event.clientY);
        this.element.addEventListener('pointermove', handlePointerMove);
        this.element.addEventListener('pointerup', handlePointerUp);
        this.element.addEventListener('pointercancel', handlePointerUp);
    };

    private updateActiveMarker(clientY: number): HTMLElement | null {
        const markers = Array.from(
            this.element.querySelectorAll<HTMLElement>(`.${CSS_CLASS.SMR_MARKER}, .${CSS_CLASS.SMR_DIFF}`)
        );
        let closest: HTMLElement | null = null;
        let closestDistance = Number.POSITIVE_INFINITY;

        for (const marker of markers) {
            const rect = marker.getBoundingClientRect();
            const distance = clientY < rect.top
                ? rect.top - clientY
                : clientY > rect.bottom
                    ? clientY - rect.bottom
                    : 0;
            if (distance < closestDistance) {
                closest = marker;
                closestDistance = distance;
            }
        }

        const current = this.element.querySelector<HTMLElement>(`.${CSS_CLASS.SMR_ACTIVE}`);
        if (current === closest) return closest;
        current?.classList.remove(CSS_CLASS.SMR_ACTIVE);
        closest?.classList.add(CSS_CLASS.SMR_ACTIVE);
        return closest;
    }

    private updateSelectedSearchMarker(state: EditorState, selected: number) {
        const matches = this.includeSearch && state.search.isActive() && state.search.getPattern()
            ? state.search.getMatches()
            : [];
        const nextMarkers = matches.map((match, index) => ({
            line: match.line,
            column: match.column,
            selected: index === selected,
        }));

        if (arraysEqual(nextMarkers, this.searchMarkers, (a, b) =>
            a.line === b.line
            && a.column === b.column
            && a.selected === b.selected
        )) {
            return;
        }

        this.searchMarkers = nextMarkers;
        this.renderSearchLayer(Math.max(1, this.totalRows));
    }
}

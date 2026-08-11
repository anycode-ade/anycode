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
    private visualRowByLine = new Map<number, number>();
    private lineByVisualRow: number[] = [];
    private rightOffset = -1;
    private enabled = true;
    private revealLineCenter: (state: EditorState, line: number) => void;
    private selectSearchMatch: (state: EditorState, index: number) => void;
    private onImmediateScroll?: () => void;

    private resizeObserver: ResizeObserver | null = null;

    constructor(
        container: HTMLDivElement,
        revealLineCenter: (state: EditorState, line: number) => void,
        selectSearchMatch: (state: EditorState, index: number) => void,
        onImmediateScroll?: () => void,
        enabled: boolean = true,
        wrapper?: HTMLDivElement
    ) {
        this.container = container;
        this.wrapper = wrapper || container;
        this.revealLineCenter = revealLineCenter;
        this.selectSearchMatch = selectSearchMatch;
        this.onImmediateScroll = onImmediateScroll;
        this.enabled = enabled;

        this.element = document.createElement('div');
        this.element.className = 'smr';
        this.element.setAttribute('aria-label', 'Scrollbar markers');

        this.thumb = document.createElement('div');
        this.thumb.className = 'smrt';
        this.thumb.setAttribute('aria-label', 'Scrollbar thumb');

        this.element.addEventListener('pointerdown', this.handlePointer);

        this.diffLayer = this.createLayer('smrdl');
        this.wordLayer = this.createLayer('smrwl');
        this.searchLayer = this.createLayer('smrsl');
        this.errorLayer = this.createLayer('smrel');
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
                this.updateThumbPosition();
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
        this.element.classList.add('visible');

        if (this.fadeTimer !== null) {
            window.clearTimeout(this.fadeTimer);
        }

        this.fadeTimer = window.setTimeout(() => {
            if (this.element && !this.element.classList.contains('dragging')) {
                this.element.classList.remove('visible');
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

    public render(
        state: EditorState | null,
        includeSearch: boolean = true,
        wordLines: number[] = this.wordLines,
        visualRows: VisualRow[] = []
    ) {
        if (!this.enabled) return;

        this.state = state;
        this.includeSearch = includeSearch;
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
        const nextVisualRowByLine = this.getVisualRowByLine(visualRows);
        const layoutChanged = !this.mapsEqual(nextVisualRowByLine, this.visualRowByLine);
        this.visualRowByLine = nextVisualRowByLine;
        this.lineByVisualRow = this.getLineByVisualRow(visualRows);
        const nextDiffRanges = this.getDiffRanges(state, visualRows);
        const nextErrorLines = this.getErrorLines(state);
        const totalRows = Math.max(1, visualRows.length || state.code.linesLength());
        const selected = search.getSelected();
        const nextSearchMarkers = searchMatches.map((match, index) => ({
            line: match.line,
            column: match.column,
            selected: index === selected,
        }));

        const scaleChanged = totalRows !== this.totalRows;
        if (rightOffset !== this.rightOffset) {
            this.rightOffset = rightOffset;
            this.element.style.right = `${rightOffset}px`;
        }

        if (
            nextSearchMarkers.length === 0
            && nextWordLines.length === 0
            && nextErrorLines.length === 0
            && nextDiffRanges.length === 0
        ) {
            this.wordLines = [];
            this.diffRanges = [];
            this.errorLines = [];
            this.searchMarkers = [];
            this.diffLayer.replaceChildren();
            this.wordLayer.replaceChildren();
            this.searchLayer.replaceChildren();
            this.errorLayer.replaceChildren();
        } else {
            if (
                scaleChanged
                || !arraysEqual(nextDiffRanges, this.diffRanges, (a, b) =>
                    a.startRow === b.startRow
                    && a.endRow === b.endRow
                    && a.targetLine === b.targetLine
                    && a.type === b.type
                )
            ) {
                this.diffRanges = nextDiffRanges;
                this.renderDiffLayer(totalRows);
            }
            if (
                scaleChanged || layoutChanged
                || !arraysEqual(nextWordLines, this.wordLines, (a, b) => a === b)
            ) {
                this.wordLines = [...nextWordLines];
                this.renderLineLayer(this.wordLayer, 'smrw', this.wordLines, totalRows);
            }
            if (
                scaleChanged || layoutChanged
                || !arraysEqual(nextSearchMarkers, this.searchMarkers, (a, b) =>
                    a.line === b.line
                    && a.column === b.column
                    && a.selected === b.selected
                )
            ) {
                this.searchMarkers = nextSearchMarkers;
                this.renderSearchLayer(totalRows);
            }
            if (
                scaleChanged || layoutChanged
                || !arraysEqual(nextErrorLines, this.errorLines, (a, b) => a === b)
            ) {
                this.errorLines = nextErrorLines;
                this.renderLineLayer(this.errorLayer, 'smre', this.errorLines, totalRows);
            }
        }

        this.totalRows = totalRows;
        this.element.classList.add('active');
        this.updateThumbPosition();
    }

    private cachedClientHeight = 0;
    private cachedScrollHeight = 0;

    public updateGeometry(clientHeight?: number, scrollHeight?: number) {
        const trackRect = this.element ? this.element.getBoundingClientRect() : null;
        const trackHeight = trackRect ? trackRect.height : 0;
        if (trackHeight > 0) {
            this.cachedClientHeight = trackHeight;
        } else if (clientHeight && clientHeight > 0) {
            this.cachedClientHeight = clientHeight;
        } else if (this.container) {
            const containerRect = this.container.getBoundingClientRect();
            this.cachedClientHeight = containerRect.height || this.container.clientHeight;
        }

        if (scrollHeight && scrollHeight > 0) {
            this.cachedScrollHeight = scrollHeight;
        } else if (this.container) {
            this.cachedScrollHeight = this.container.scrollHeight;
        }
    }

    private applyScrollbarSettings(state: EditorState) {
        const scrollbarSettings = state.settings?.scrollbar;
        const style = scrollbarSettings?.style || 'mac';

        this.element.classList.remove('style-mac', 'style-windows', 'style-minimal');
        this.element.classList.add(`style-${style}`);

        if (scrollbarSettings?.width !== undefined && scrollbarSettings.width > 0) {
            this.element.style.setProperty('--smr-custom-width', `${scrollbarSettings.width}px`);
        } else {
            this.element.style.removeProperty('--smr-custom-width');
        }
    }

    private getMinimumSliderSize(): number {
        if (this.state?.settings?.scrollbar?.minSize !== undefined && this.state.settings.scrollbar.minSize > 0) {
            return this.state.settings.scrollbar.minSize;
        }
        if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
            return 28;
        }
        return 20;
    }

    public updateThumbPosition(scrollTopOverride?: number) {
        if (!this.enabled || !this.thumb || !this.container) return;
        const scrollTop = scrollTopOverride !== undefined ? scrollTopOverride : this.container.scrollTop;
        const clientHeight = this.cachedClientHeight || this.container.clientHeight;
        const scrollHeight = this.cachedScrollHeight || this.container.scrollHeight;

        if (scrollHeight <= clientHeight || clientHeight <= 0) {
            this.thumb.style.display = 'none';
            return;
        }

        this.thumb.style.display = 'block';

        // Monaco Editor Scrollbar Math with 2px inset
        const INSET = 2;
        const availableHeight = Math.max(1, clientHeight - INSET * 2);
        const MINIMUM_SLIDER_SIZE = this.getMinimumSliderSize();
        const sliderSize = Math.round(Math.max(MINIMUM_SLIDER_SIZE, Math.floor((availableHeight * availableHeight) / scrollHeight)));
        const maxSliderPosition = Math.max(0, availableHeight - sliderSize);
        const maxScrollTop = Math.max(1, scrollHeight - clientHeight);
        const sliderRatio = maxSliderPosition / maxScrollTop;

        // Clamp scrollTop to [0, maxScrollTop] to prevent macOS elastic overscroll from pulling thumb out of bounds
        const clampedScrollTop = Math.max(0, Math.min(maxScrollTop, scrollTop));
        const sliderPosition = INSET + Math.max(0, Math.min(maxSliderPosition, Math.round(clampedScrollTop * sliderRatio)));

        this.thumb.style.height = `${sliderSize}px`;
        this.thumb.style.transform = `translateY(${sliderPosition}px)`;
        this.triggerFadeIn();
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
        this.visualRowByLine.clear();
        this.lineByVisualRow = [];
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
            marker.className = `smrd ${range.type}`;
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
            const className = marker.selected ? 'smrs selected' : 'smrs';
            fragment.appendChild(this.createLineMarker(className, marker.line, totalRows));
        }
        this.searchLayer.replaceChildren(fragment);
    }

    private createLineMarker(className: string, line: number, totalRows: number): HTMLSpanElement {
        const marker = document.createElement('span');
        marker.className = `smrm ${className}`;
        const visualRow = this.visualRowByLine.get(line) ?? line;
        marker.style.top = `${((visualRow + 0.5) / totalRows) * 100}%`;
        return marker;
    }

    private getScrollbarOffset(): number {
        return 0;
    }

    private getVisualRowByLine(visualRows: VisualRow[]): Map<number, number> {
        const rows = new Map<number, number>();
        visualRows.forEach((row, index) => {
            if (row.kind === 'real') rows.set(row.lineIndex, index);
        });
        return rows;
    }

    private getLineByVisualRow(visualRows: VisualRow[]): number[] {
        return visualRows.map((row) => {
            if (row.kind === 'real') return row.lineIndex;
            if (row.kind === 'ghost') return Math.max(0, row.anchorLine - 1);
            return Math.max(0, Math.round((row.hiddenStart + row.hiddenEnd) / 2));
        });
    }

    private mapsEqual(left: Map<number, number>, right: Map<number, number>): boolean {
        if (left.size !== right.size) return false;
        for (const [line, row] of left) {
            if (right.get(line) !== row) return false;
        }
        return true;
    }

    private getDiffRanges(state: EditorState, visualRows: VisualRow[]): DiffRange[] {
        if (!state.diffs || state.diffs.size === 0) return [];

        const rangesByHunk = new Map<number, DiffRange>();
        const typeByHunk = new Map<number, DiffInfo['changeType']>();
        const targetLineByHunk = new Map<number, number>();

        for (const [lineNumber, info] of state.diffs) {
            typeByHunk.set(info.hunkId, info.changeType);
            targetLineByHunk.set(
                info.hunkId,
                Math.max(0, Math.min(state.code.linesLength() - 1, lineNumber - 1))
            );
        }

        visualRows.forEach((row, rowIndex) => {
            const info = row.kind === 'real'
                ? state.diffs?.get(row.lineIndex + 1)
                : row.kind === 'ghost'
                    ? { hunkId: row.hunkId, changeType: typeByHunk.get(row.hunkId) ?? 'deleted' }
                    : undefined;
            if (!info) return;

            const existing = rangesByHunk.get(info.hunkId);
            if (!existing) {
                rangesByHunk.set(info.hunkId, {
                    startRow: rowIndex,
                    endRow: rowIndex,
                    targetLine: targetLineByHunk.get(info.hunkId) ?? 0,
                    type: info.changeType,
                });
                return;
            }

            existing.startRow = Math.min(existing.startRow, rowIndex);
            existing.endRow = Math.max(existing.endRow, rowIndex);
            if (existing.type !== info.changeType) existing.type = 'modified';
        });

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
        const isMarker = target?.classList.contains('smrm') || target?.classList.contains('smrd');

        if (target === this.thumb || !isMarker) {
            event.preventDefault();
            event.stopPropagation();
            this.element.setPointerCapture(event.pointerId);
            this.thumb.classList.add('dragging');
            this.element.classList.add('dragging');

            const startY = event.clientY;
            const startX = event.clientX;
            const clientHeight = this.container.clientHeight;
            const scrollHeight = this.container.scrollHeight;
            const maxScrollTop = Math.max(0, scrollHeight - clientHeight);

            if (maxScrollTop <= 0 || clientHeight <= 0) return;

            const INSET = 2;
            const availableHeight = Math.max(1, clientHeight - INSET * 2);
            const MINIMUM_SLIDER_SIZE = this.getMinimumSliderSize();
            const sliderSize = Math.round(Math.max(MINIMUM_SLIDER_SIZE, Math.floor((availableHeight * availableHeight) / scrollHeight)));
            const maxSliderPosition = Math.max(1, availableHeight - sliderSize);
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

            const handleThumbMove = (moveEvent: PointerEvent) => {
                const deltaY = moveEvent.clientY - startY;
                const initialSliderPos = initialScrollTop * sliderRatio;
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
                this.element.removeEventListener('pointermove', handleThumbMove);
                this.element.removeEventListener('pointerup', handleThumbUp);
                this.element.removeEventListener('pointercancel', handleThumbUp);
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

        const revealClosestMarker = (clientY: number) => {
            const state = this.state;
            if (!state) return;

            const activeMarker = this.updateActiveMarker(clientY);
            if (activeMarker?.classList.contains('smrd')) {
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
                    const line = this.lineByVisualRow[visualRow] ?? range.targetLine;
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
            this.element.querySelector('.smr-active')?.classList.remove('smr-active');
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
            this.element.querySelectorAll<HTMLElement>('.smrm, .smrd')
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

        const current = this.element.querySelector<HTMLElement>('.smr-active');
        if (current === closest) return closest;
        current?.classList.remove('smr-active');
        closest?.classList.add('smr-active');
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

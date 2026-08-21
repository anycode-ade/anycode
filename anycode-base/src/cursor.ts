import { AnycodeLine } from './types';
import { isDiagnosticElement } from './utils';

export function removeCursor() {
    if (typeof window === 'undefined') return;
    const sel = window.getSelection();
    if (sel) sel.removeAllRanges();
}

export function moveCursor(
    lineDiv: HTMLElement,
    column: number,
    focus: boolean = true,
    visualIndex?: number,
    lineHeight: number = 20,
    stickyWidth: number = 80,
    cachedScrollTop?: number,
    cachedClientHeight?: number
) {
    if (!lineDiv || !lineDiv.isConnected) {
        return;
    }
    
    let character: number = column;
    const children = lineDiv.children;
    const len = children.length;

    let chunk: Element | null = null;
    let chunkCharacter = 0;
    let brChildIndex = -1;
    let nonDiagIndex = 0;

    for (let i = 0; i < len; i++) {
        const child = children[i];
        if (isDiagnosticElement(child)) continue;

        const currentNonDiagIndex = nonDiagIndex++;
        const chunkLength = child.textContent?.length ?? 0;

        if (chunkLength === 0) {
            chunk = child;
            chunkCharacter = 0;
            if (child.tagName === 'BR') {
                brChildIndex = currentNonDiagIndex;
            }
            break;
        }

        if (character < chunkLength) {
            chunk = child;
            chunkCharacter = character;
            if (child.tagName === 'BR') {
                brChildIndex = currentNonDiagIndex;
            }
            break;
        } else {
            character -= chunkLength;
            chunk = child;
            chunkCharacter = chunkLength;
            if (child.tagName === 'BR') {
                brChildIndex = currentNonDiagIndex;
            }
        }
    }

    if (!chunk) {
        return;
    }

    // Special handling for BR elements: set cursor relative to parent, not inside BR
    let ch: Node;
    let chunkOffset: number;
    
    if (chunk.tagName === 'BR') {
        const parent = chunk.parentElement;
        if (!parent || brChildIndex === -1) return;
        
        ch = parent;
        chunkOffset = brChildIndex;
    } else {
        ch = chunk.firstChild || chunk;
        chunkOffset = chunkCharacter;
    }
    
    if (focus) {
        const scrollable = lineDiv?.parentElement?.parentElement;
        if (scrollable) {
            scrollCursorIntoViewVertically(scrollable, visualIndex, lineHeight, cachedScrollTop, cachedClientHeight);
            scrollCursorIntoViewHorizontally(scrollable, ch, chunkOffset, stickyWidth, column);
        }
    }

    const sel = typeof window !== 'undefined' ? window.getSelection() : null;
    if (!sel) return;

    if (sel.rangeCount > 0) {
        const currentRange = sel.getRangeAt(0);
        if (currentRange.startContainer === ch &&
            currentRange.startOffset === chunkOffset &&
            currentRange.collapsed) {
            return;
        }
    }

    try {
        const range = document.createRange();
        range.setStart(ch, chunkOffset);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
    } catch {
        // Range out of bounds or element disconnected
    }
}

function scrollCursorIntoViewVertically(
    scrollable: HTMLElement,
    visualIndex?: number,
    lineHeight: number = 20,
    cachedScrollTop?: number,
    cachedClientHeight?: number
) {
    if (visualIndex === undefined) return;
    const cursorTop = visualIndex * lineHeight;
    const cursorBottom = cursorTop + lineHeight;
    const clientHeight = cachedClientHeight !== undefined && cachedClientHeight > 0
        ? cachedClientHeight
        : scrollable.clientHeight;
    const scrollTop = cachedScrollTop !== undefined
        ? cachedScrollTop
        : scrollable.scrollTop;

    if (cursorTop < scrollTop) {
        scrollable.scrollTop = cursorTop;
    } else if (cursorBottom > scrollTop + clientHeight) {
        scrollable.scrollTop = cursorBottom - clientHeight;
    }
}

function scrollCursorIntoViewHorizontally(
    scrollable: HTMLElement,
    ch: Node,
    chunkOffset: number,
    stickyWidth: number = 80,
    column: number = 0
) {
    let cursorLeft = 0;
    try {
        const range = document.createRange();
        range.setStart(ch, Math.min(chunkOffset, ch.textContent?.length ?? 0));
        range.collapse(true);
        const rect = range.getBoundingClientRect();
            if (rect.width === 0 && rect.left === 0) {
            cursorLeft = stickyWidth + column * 7.8;
        } else {
            const scrollableRect = scrollable.getBoundingClientRect();
            cursorLeft = rect.left - scrollableRect.left + scrollable.scrollLeft;
        }
    } catch {
        cursorLeft = stickyWidth + column * 7.8;
    }

    const visibleLeft = scrollable.scrollLeft + stickyWidth;
    const visibleRight = scrollable.scrollLeft + scrollable.clientWidth;

    if (cursorLeft < visibleLeft) {
        scrollable.scrollLeft = Math.max(0, cursorLeft - stickyWidth);
    } else if (cursorLeft + 20 > visibleRight) {
        scrollable.scrollLeft = cursorLeft - scrollable.clientWidth + 40;
    }
}

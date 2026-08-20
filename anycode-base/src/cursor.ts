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
    
    var character: number = column;
    
    const chunks = Array.from(lineDiv.children)
        .filter((child) => !isDiagnosticElement(child))
        .map(l => l as AnycodeLine);
        
    let chunkCharacter = 0;
    let chunk: Element | null = null;

    for (let chunkNode of chunks) {
        const chunkLength = chunkNode.textContent!.length;
        if (chunkLength === 0) {
            chunk = chunkNode;
            chunkCharacter = 0;
            break;
        }
        if (character < chunkLength) {
            chunk = chunkNode;
            chunkCharacter = character;
            break;
        } else {
            character -= chunkLength;
        }
    }

    if (!chunk) {
        chunk = chunks[chunks.length - 1];
        chunkCharacter = chunk?.textContent?.length ?? 0;
    }
    
    if (!chunk) {
        return;
    }

    // Special handling for BR elements: set cursor relative to parent, not inside BR
    let ch: Node;
    let chunkOffset: number;
    
    if (chunk.tagName === 'BR') {
        // Find the index of the BR element within its parent
        const parent = chunk.parentElement;
        if (!parent) return;
        
        const childIndex = Array.from(parent.children)
            .filter(child => !isDiagnosticElement(child))
            .indexOf(chunk as Element);
        
        if (childIndex === -1) return;
        
        ch = parent;
        chunkOffset = childIndex;
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
        if (typeof sel.setPosition === 'function') {
            sel.setPosition(ch, chunkOffset);
        } else if (typeof sel.collapse === 'function') {
            sel.collapse(ch, chunkOffset);
        } else {
            const doc = (ch as any)?.ownerDocument || (typeof document !== 'undefined' ? document : null);
            if (!doc) return;
            const range = doc.createRange();
            range.setStart(ch, chunkOffset);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
        }
    } catch (error) {
        console.warn('Failed to set selection position:', error);
    }
}

function scrollCursorIntoViewVertically(
    container: HTMLElement,
    visualIndex?: number,
    lineHeight: number = 20,
    cachedScrollTop?: number,
    cachedClientHeight?: number
) {
    if (visualIndex === undefined) return;
    const lineTop = visualIndex * lineHeight;
    const scrollTop = cachedScrollTop !== undefined ? cachedScrollTop : container.scrollTop;
    const clientHeight = cachedClientHeight !== undefined && cachedClientHeight > 0 ? cachedClientHeight : container.clientHeight;

    if (lineTop < scrollTop) {
        container.scrollTop = lineTop;
    } else if (lineTop + lineHeight > scrollTop + clientHeight) {
        container.scrollTop = lineTop + lineHeight - clientHeight;
    }
}

function scrollCursorIntoViewHorizontally(
    container: HTMLElement, 
    cursorNode: Node, 
    cursorOffset: number, 
    leftPlus: number, 
    column: number
) {
    // Fast path: if column is small (typical typing), cursor is definitely in view!
    // ZERO DOM READS!
    if (column < 30) {
        return;
    }

    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    const scrollWidth = container.scrollWidth;
    const clientWidth = container.clientWidth;
    const scrollLeft = container.scrollLeft;

    if (scrollWidth <= clientWidth && scrollLeft === 0) {
        return;
    }

    const padding = 20;
    const charWidth = 8.5; // Monospace font JetBrains Mono estimated char width
    const estimatedCursorLeft = leftPlus + column * charWidth;
    const leftVisible = scrollLeft + leftPlus + padding;
    const rightVisible = Math.max(leftVisible, scrollLeft + clientWidth - padding);

    let scrolled = false;
    if (estimatedCursorLeft < leftVisible) {
        container.scrollLeft = Math.max(0, estimatedCursorLeft - leftPlus - padding);
        scrolled = true;
    } else if (estimatedCursorLeft > rightVisible) {
        container.scrollLeft = estimatedCursorLeft - clientWidth + padding * 2;
        scrolled = true;
    }

    if (scrolled && isSafari) {
        try {
            const doc = cursorNode.ownerDocument || document;
            const sel = doc.defaultView?.getSelection() || window.getSelection();
            if (sel && sel.rangeCount > 0) {
                const currentRange = sel.getRangeAt(0).cloneRange();
                sel.removeAllRanges();
                sel.addRange(currentRange);
            }
        } catch (e) {
            console.warn('Failed to fix Safari caret repaint:', e);
        }
    }
}

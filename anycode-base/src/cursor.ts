import { AnycodeLine } from './types';
import { isDiagnosticElement } from './utils';

export function removeCursor() {
    const sel = window.getSelection();
    if (sel) sel.removeAllRanges();
}

export function moveCursor(
    lineDiv: HTMLElement,
    column: number,
    focus: boolean = true
) {
    // Ensure the lineDiv is connected to the DOM before proceeding
    if (!lineDiv.isConnected) {
        // console.warn('moveCursor: lineDiv is not connected to DOM');
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
        return
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
    
    // Ensure we're working with the correct document context
    const doc = ch.ownerDocument || document;
    const range = doc.createRange();
    range.setStart(ch, chunkOffset);
    range.collapse(true);
    
    // Check if the range is already the same as the current selection
    // Do this early to avoid unnecessary scrolling and DOM operations
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
        const currentRange = sel.getRangeAt(0);
        if (currentRange.startContainer === range.startContainer &&
            currentRange.startOffset === range.startOffset &&
            currentRange.collapsed === range.collapsed) {
            // console.log('moveCursor: range already the same, skipping update');
            return;
        }
    }
    
    if (focus) {
        const scrollable = lineDiv?.parentElement?.parentElement;
        if (scrollable) {
            scrollCursorIntoViewVertically(scrollable, lineDiv);
            
            let stickyWidth = (scrollable as any)._stickyWidth;
            if (stickyWidth === undefined) {
                const buttons = scrollable.querySelector('.buttons') as HTMLElement | null;
                const gutter = scrollable.querySelector('.gutter') as HTMLElement | null;
                const folds = scrollable.querySelector('.folds') as HTMLElement | null;
                stickyWidth = (buttons?.offsetWidth ?? 0) +
                    (gutter?.offsetWidth ?? 0) +
                    (folds?.offsetWidth ?? 0);
                (scrollable as any)._stickyWidth = stickyWidth;
            }
            
            scrollCursorIntoViewHorizontally(scrollable, ch, chunkOffset, stickyWidth);
        }
    }

    if (sel) {
        // Ensure the range is valid and in the same document as the selection
        try {
            sel.removeAllRanges();
            sel.addRange(range);
        } catch (error) {
            console.warn('Failed to add range to selection:', error);
        }
    }
}

function scrollCursorIntoViewVertically(
    container: HTMLElement, lineDiv: HTMLElement
) {
    const containerRect = container.getBoundingClientRect();
    const lineRect = lineDiv.getBoundingClientRect();

    if (lineRect.top < containerRect.top) {
        container.scrollTop -= (containerRect.top - lineRect.top);
    } else if (lineRect.bottom > containerRect.bottom) {
        container.scrollTop += (lineRect.bottom - containerRect.bottom);
    }
}

function scrollCursorIntoViewHorizontally(
    container: HTMLElement, 
    cursorNode: Node, 
    cursorOffset: number, 
    leftPlus: number, 
) {

    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    
    // Ensure we're working with the correct document context
    const doc = cursorNode.ownerDocument || document;
    const range = doc.createRange();
    range.setStart(cursorNode, cursorOffset);
    range.collapse(true);

    const cursorRect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    const padding = 20; // Padding in pixels to keep cursor away from the edges
    const leftVisible = containerRect.left + leftPlus + padding;
    const rightVisible = Math.max(leftVisible, containerRect.right - padding);

    let scrolled = false;
    if (cursorRect.left < leftVisible) {
        const delta = leftVisible - cursorRect.left;
        container.scrollLeft -= delta;
        scrolled = true;
    } else if (cursorRect.right > rightVisible) {
        const delta = cursorRect.right - rightVisible;
        container.scrollLeft += delta;
        scrolled = true;
    }

    if (scrolled && isSafari) {
        // Safari-specific multiple carets bug fix:
        // Force repaint of the container and reset selection in the next animation frame.
        // requestAnimationFrame(() => {
            try {
                // 1. Force WebKit repaint/reflow (Repaint Hack)
                const prevOpacity = container.style.opacity;
                container.style.opacity = '0.99';
                container.offsetHeight; // Forces repaint
                container.style.opacity = prevOpacity || '';

                // 2. Re-apply selection to clean ghost carets
                const sel = doc.defaultView?.getSelection() || window.getSelection();
                if (sel && sel.rangeCount > 0) {
                    const currentRange = sel.getRangeAt(0).cloneRange();
                    sel.removeAllRanges();
                    sel.addRange(currentRange);
                }
            } catch (e) {
                console.warn('Failed to fix Safari caret repaint:', e);
            }
        // });
    }
}

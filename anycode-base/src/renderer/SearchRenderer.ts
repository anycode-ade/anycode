import { AnycodeLine } from "../utils";
import { EditorState } from "../editor";
import { Search } from "../search";

/**
 * SearchRenderer is responsible for search UI and search highlighting.
 * Manages search box, highlighting matches, and navigating between results.
 */
export class SearchRenderer {
    private container: HTMLDivElement;
    private searchContainer: HTMLDivElement | null = null;
    private searchMatchLabel: HTMLDivElement | null = null;

    // Dependencies
    private getLineFn: (lineNumber: number) => AnycodeLine | null;
    private focusFn: (state: EditorState, focusLine: number | null) => boolean;

    constructor(
        container: HTMLDivElement,
        getLine: (lineNumber: number) => AnycodeLine | null,
        focus: (state: EditorState, focusLine: number | null) => boolean
    ) {
        this.container = container;
        this.getLineFn = getLine;
        this.focusFn = focus;
    }

    // ========== Search UI ==========

    public renderSearch(
        search: Search,
        state: EditorState,
        handlers?: {
            onKeyDown?: (event: KeyboardEvent, input: HTMLTextAreaElement) => void,
            onInputChange?: (value: string) => void,
        }
    ) {
        if (this.searchContainer) {
            this.removeAllHighlights(search);
            this.searchContainer.remove();
            this.searchMatchLabel = null;
        }

        // Create a container for the search UI
        this.searchContainer = document.createElement('div');
        this.searchContainer.className = 'search';
        this.searchContainer.style.display = 'flex';
        this.searchContainer.style.flexDirection = 'column';
        this.searchContainer.style.position = 'fixed';

        // Create a search textarea field for multiline search (full width)
        const inputField = document.createElement('textarea');
        inputField.className = 'search-input';
        inputField.placeholder = 'Search';
        inputField.value = search.getPattern();
        inputField.rows = 1;

        inputField.addEventListener('focus', () => {
            console.log('[Search] input field focused');
            search.setFocused(true);
        });

        inputField.addEventListener('blur', () => {
            console.log('[Search] input field blurred');
            search.setFocused(false);
        });

        // Create close button
        const closeButton = document.createElement('button');
        closeButton.className = 'search-close-button';
        closeButton.innerHTML = '&times;'; // × symbol
        closeButton.title = 'Close search';

        // Add click handler for close button
        closeButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (handlers && handlers.onKeyDown) {
                let esc = { key: 'Escape', bubbles: true, cancelable: true };
                handlers.onKeyDown(new KeyboardEvent('keydown', esc), inputField as HTMLTextAreaElement);
            } else {
                this.removeAllHighlights(search);
                this.removeSearch();
                search.clear();
            }
        });

        // Create a label to display match information
        const matchLabel = document.createElement('div');
        matchLabel.className = 'search-label';
        matchLabel.textContent = '';
        matchLabel.style.userSelect = 'none';
        matchLabel.style.pointerEvents = 'none';

        // Create previous button
        const prevButton = document.createElement('button');
        prevButton.className = 'search-button';
        prevButton.innerHTML = '&#8593;'; // Up arrow
        prevButton.title = 'Previous match';

        // Create next button
        const nextButton = document.createElement('button');
        nextButton.className = 'search-button';
        nextButton.innerHTML = '&#8595;'; // Down arrow
        nextButton.title = 'Next match';

        // Add click handlers for buttons
        prevButton.addEventListener('click', () => {
            let matches = search.getMatches();
            if (matches.length === 0) return;
            this.removeSelectedHighlight(search);
            search.selectPrev();
            this.focusFn(state, search.getSelectedMatch()?.line ?? null);
            this.updateSearchHighlights(search);
            search.setNeedsFocus(true);
            this.focusSearchInput();
        });

        nextButton.addEventListener('click', () => {
            let matches = search.getMatches();
            if (matches.length === 0) return;
            this.removeSelectedHighlight(search);
            search.selectNext();
            this.focusFn(state, search.getSelectedMatch()?.line ?? null);
            this.updateSearchHighlights(search);
            search.setNeedsFocus(true);
            this.focusSearchInput();
        });

        // Create controls row
        const controlsRow = document.createElement('div');
        controlsRow.style.display = 'flex';
        controlsRow.style.alignItems = 'center';
        controlsRow.style.justifyContent = 'space-between';

        // Left side: close button and up and down buttons
        const leftControls = document.createElement('div');
        leftControls.style.display = 'flex';
        leftControls.style.alignItems = 'center';
        leftControls.appendChild(prevButton);
        leftControls.appendChild(nextButton);
        leftControls.appendChild(closeButton);

        controlsRow.appendChild(matchLabel);
        controlsRow.appendChild(leftControls);

        this.searchMatchLabel = matchLabel;

        // Wire input and keyboard handlers
        if (handlers && handlers.onKeyDown) {
            inputField.addEventListener('keydown', (e) =>
                handlers!.onKeyDown!(e, inputField as HTMLTextAreaElement));
        }

        if (handlers && handlers.onInputChange) {
            inputField.addEventListener('input', () => {
                inputField.style.height = 'auto';
                const newHeight = Math.min(inputField.scrollHeight, 200);
                inputField.style.height = `${newHeight}px`;
                handlers!.onInputChange!(inputField.value);
            });
            inputField.addEventListener('beforeinput', (e) => e.stopPropagation());
        }

        // Add textarea and controls row to container
        this.searchContainer.appendChild(inputField);
        this.searchContainer.appendChild(controlsRow);
        this.container!.appendChild(this.searchContainer);

        inputField.focus();

        this.updateSearchHighlights(search);
    }

    public removeSearch() {
        let searchContainer = document.querySelector('.search');
        if (searchContainer) searchContainer.remove();
        this.searchMatchLabel = null;
    }

    public focusSearchInput() {
        if (this.searchContainer) {
            const inputField = this.searchContainer.querySelector('.search-input') as HTMLTextAreaElement;
            if (inputField) {
                inputField.focus();
            }
        }
    }

    public updateSearchLabel(text: string) {
        if (!this.searchMatchLabel) return;
        if (this.searchMatchLabel.textContent !== text) {
            this.searchMatchLabel.textContent = text;
        }
    }

    // ========== Search Highlighting ==========

    public updateSearchHighlights(search: Search) {
        const pattern = search.getPattern();
        const matches = search.getMatches();
        const selected = search.getSelected();
        const patternLines = pattern.split(/\r?\n/);
        const isMultiline = patternLines.length > 1;

        if (!pattern) {
            this.updateSearchLabel('');
        } else if (matches.length === 0) {
            this.updateSearchLabel('No matches');
        } else {
            this.updateSearchLabel(`Match ${selected + 1} of ${matches.length}`);
        }

        for (let i = 0; i < matches.length; i++) {
            const match = matches[i];
            const isSelected = i === selected;

            if (!isMultiline) {
                // Single-line search
                let line = this.getLineFn(match.line);
                if (!line) continue;

                this.renderHighlights(line, match.column, match.column + pattern.length, isSelected);
            } else {
                // Multiline search
                const firstLinePattern = patternLines[0];
                const remainingLines = patternLines.slice(1);

                // Highlight first line (from match.column to end of first pattern line)
                let firstLineDiv = this.getLineFn(match.line);
                if (firstLineDiv) {
                    const firstLineEnd = match.column + firstLinePattern.length;
                    this.renderHighlights(firstLineDiv, match.column, firstLineEnd, isSelected);
                }

                // Highlight intermediate lines (full line match)
                for (let j = 0; j < remainingLines.length - 1; j++) {
                    const lineIndex = match.line + j + 1;
                    let lineDiv = this.getLineFn(lineIndex);
                    if (!lineDiv) continue;

                    // Use pattern line length since matches correspond to text
                    const lineLength = patternLines[j + 1].length;
                    this.renderHighlights(lineDiv, 0, lineLength, isSelected);
                }

                // Highlight last line (from start to end of last pattern line)
                if (remainingLines.length > 0) {
                    const lastLineIndex = match.line + remainingLines.length;
                    let lastLineDiv = this.getLineFn(lastLineIndex);
                    if (lastLineDiv) {
                        const lastLinePattern = remainingLines[remainingLines.length - 1];
                        const lastLineEnd = lastLinePattern.length;
                        this.renderHighlights(lastLineDiv, 0, lastLineEnd, isSelected);
                    }
                }
            }
        }
    }

    public renderHighlights(
        lineDiv: AnycodeLine,
        startColumn: number,
        endColumn: number,
        selected: boolean
    ) {
        const spans = Array.from(lineDiv.querySelectorAll('span'))
            .filter((span) => !span.classList.contains('diagnostic') && !span.closest('.diagnostic'));
        let charCount = 0;

        for (let span of spans) {
            if (!span.textContent) continue;

            const textLength = span.textContent.length;

            // Check if the current span is fully within the range
            if (charCount + textLength <= startColumn || charCount >= endColumn) {
                charCount += textLength; // Skip spans outside the range
                continue;
            }

            if (charCount >= startColumn && charCount + textLength <= endColumn) {
                // Fully matched span
                if (!span.classList.contains('highlight'))
                    span.classList.add('highlight');
                if (selected && !span.classList.contains('selected'))
                    span.classList.add('selected');
            } else {
                // Partially matched span
                const startOffset = Math.max(0, startColumn - charCount);
                const endOffset = Math.min(textLength, endColumn - charCount);

                const beforeText = span.textContent.slice(0, startOffset);
                const highlightedText = span.textContent.slice(startOffset, endOffset);
                const afterText = span.textContent.slice(endOffset);

                const fragment = document.createDocumentFragment();

                if (beforeText) {
                    const beforeSpan = span.cloneNode(false);
                    beforeSpan.textContent = beforeText;
                    fragment.appendChild(beforeSpan);
                }

                if (highlightedText) {
                    const highlightSpan = span.cloneNode(false) as HTMLElement;
                    if (!highlightSpan.classList.contains('highlight'))
                        highlightSpan.classList.add('highlight');
                    if (selected && !highlightSpan.classList.contains('selected'))
                        highlightSpan.classList.add('selected');
                    highlightSpan.textContent = highlightedText;
                    fragment.appendChild(highlightSpan);
                }

                if (afterText) {
                    const afterSpan = span.cloneNode(false);
                    afterSpan.textContent = afterText;
                    fragment.appendChild(afterSpan);
                }

                span.replaceWith(fragment);
            }

            charCount += textLength;
        }
    }

    public removeAllHighlights(search: Search) {
        const pattern = search.getPattern();
        const patternLines = pattern.split(/\r?\n/);
        const isMultiline = patternLines.length > 1;
        const matches = search.getMatches();

        for (let index = 0; index < matches.length; index++) {
            const m = matches[index];

            if (!isMultiline) {
                // Single-line: remove highlight from first line only
                let line = this.getLineFn(m.line);
                if (line) {
                    this.removeHighlights(line);
                }
            } else {
                // Multiline: remove highlights from all lines of the pattern
                const firstLine = this.getLineFn(m.line);
                if (firstLine) {
                    this.removeHighlights(firstLine);
                }

                // Remove highlights from intermediate and last lines
                for (let j = 1; j < patternLines.length; j++) {
                    const lineIndex = m.line + j;
                    const line = this.getLineFn(lineIndex);
                    if (line) {
                        this.removeHighlights(line);
                    }
                }
            }
        }
    }

    public removeSelectedHighlight(search: Search) {
        const pattern = search.getPattern();
        const patternLines = pattern.split(/\r?\n/);
        const isMultiline = patternLines.length > 1;
        const matches = search.getMatches();
        const selectedIndex = search.getSelected();

        // Only remove the highlight from the currently selected match
        if (selectedIndex >= 0 && selectedIndex < matches.length) {
            const match = matches[selectedIndex];

            if (!isMultiline) {
                // Single-line: remove .selected class from first line only
                let line = this.getLineFn(match.line);
                if (line) {
                    // Only remove the .selected class, leave .highlight in place
                    this.removeHighlights(line, true);
                }
            } else {
                // Multiline: remove .selected class from all lines of the pattern
                const firstLine = this.getLineFn(match.line);
                if (firstLine) {
                    this.removeHighlights(firstLine, true);
                }

                // Remove .selected class from intermediate and last lines
                for (let j = 1; j < patternLines.length; j++) {
                    const lineIndex = match.line + j;
                    const line = this.getLineFn(lineIndex);
                    if (line) {
                        this.removeHighlights(line, true);
                    }
                }
            }
        }
    }

    private removeHighlights(lineDiv: AnycodeLine, selectedOnly: boolean = false) {
        const highlightedSpans = Array.from(lineDiv.querySelectorAll('span.highlight, span.selected'));

        for (const span of highlightedSpans) {
            span.classList.remove('highlight');
            if (selectedOnly) span.classList.remove('selected');
            else span.classList.remove('highlight', 'selected');
        }

        // After removing highlight classes, merge adjacent spans with the same class list
        let i = 0;
        while (i < lineDiv.childNodes.length - 1) {
            const current = lineDiv.childNodes[i] as ChildNode;
            const next = lineDiv.childNodes[i + 1] as ChildNode;

            if (
                current.nodeType === Node.ELEMENT_NODE &&
                next.nodeType === Node.ELEMENT_NODE
            ) {
                const currentEl = current as HTMLElement;
                const nextEl = next as HTMLElement;
                if (
                    currentEl.tagName === 'SPAN' &&
                    nextEl.tagName === 'SPAN' &&
                    currentEl.className === nextEl.className
                ) {
                    // Concatenate text and remove the next span
                    currentEl.textContent = (currentEl.textContent || '') + (nextEl.textContent || '');
                    lineDiv.removeChild(nextEl);
                    continue;
                }
            }
            i++;
        }
    }
}

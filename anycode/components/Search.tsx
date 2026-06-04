import { memo, useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Icons } from "./Icons";
import "./Search.css";
import type { SearchResult, SearchMatch } from "../types";

const StopIcon = () => (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
        <rect x="6" y="6" width="8" height="8" fill="currentColor"/>
    </svg>
);

const UpIcon = () => (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M10 5L4.5 10.5H8.5V15H11.5V10.5H15.5L10 5Z" fill="currentColor" />
    </svg>
);

const DownIcon = () => (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M10 15L15.5 9.5H11.5V5H8.5V9.5H4.5L10 15Z" fill="currentColor" />
    </svg>
);

const SEARCH_FILE_ROW_HEIGHT = 28;
const SEARCH_MATCH_ROW_HEIGHT = 22;
const SEARCH_RESULTS_OVERSCAN = 12;

interface SearchPreviewProps {
    match: SearchMatch;
    pattern: string;
    maxLength?: number;
}

const SearchPreview = memo(({ match, pattern, maxLength = 100 }: SearchPreviewProps) => {
    const previewChars = Array.from(match.preview);
    const displayChars = maxLength > 0 ? previewChars.slice(0, maxLength) : previewChars;
    const displayPreview = displayChars.join("");
    
    if (!pattern.trim()) {
        return <span className="search-preview" title={match.preview}>{displayPreview}</span>;
    }

    const previewStart = Math.max(0, match.column - 50);
    const matchPositionInPreview = match.column - previewStart;
    const patternLength = Array.from(pattern).length;
    
    if (
        matchPositionInPreview < 0
        || matchPositionInPreview >= displayChars.length
    ) {
        const matchIndex = displayPreview.indexOf(pattern);
        if (matchIndex === -1) {
            return <span className="search-preview" title={match.preview}>{displayPreview}</span>;
        }
        const beforeMatch = displayPreview.slice(0, matchIndex);
        const matchText = displayPreview.slice(matchIndex, matchIndex + pattern.length);
        const afterMatch = displayPreview.slice(matchIndex + pattern.length);
        
        return (
            <span className="search-preview" title={match.preview}>
                {beforeMatch}
                <mark className="search-match">{matchText}</mark>
                {afterMatch}
            </span>
        );
    }
    
    const beforeMatch = displayChars.slice(0, matchPositionInPreview).join("");
    const matchText = displayChars.slice(matchPositionInPreview, matchPositionInPreview + patternLength).join("");
    const afterMatch = displayChars.slice(matchPositionInPreview + patternLength).join("");
    
    return (
        <span className="search-preview" title={match.preview}>
            {beforeMatch}
            <mark className="search-match">{matchText}</mark>
            {afterMatch}
        </span>
    );
});
SearchPreview.displayName = "SearchPreview";

interface SearchProps {
    id: string;
    focusRequestToken?: number | null;
    inputValue: string;
    onInputValueChange: (value: string) => void;
    onEnter: (data: { id: string; pattern: string }) => void;
    onInputChange?: () => void;
    onCancel: () => void;
    onClear?: () => void;
    onMatchClick: (filePath: string, match: SearchMatch) => void;
    results: SearchResult[];
    searchEnded: boolean;
}

type SearchNavItem =
    | { key: string; type: "file"; filePath: string }
    | { key: string; type: "match"; filePath: string; match: SearchMatch };

interface SearchFileRowProps {
    fileResult: SearchResult;
    isExpanded: boolean;
    fileKey: string;
    activeItemKey: string | null;
    itemRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
    onToggleFile: (filePath: string) => void;
    onActivate: (itemKey: string | null) => void;
}

const SearchFileRow = memo(({
    fileResult,
    isExpanded,
    fileKey,
    activeItemKey,
    itemRefs,
    onToggleFile,
    onActivate,
}: SearchFileRowProps) => {
    return (
        <div
            ref={(el) => {
                if (el) {
                    itemRefs.current.set(fileKey, el);
                } else {
                    itemRefs.current.delete(fileKey);
                }
            }}
            className="file-path"
            onClick={() => {
                onActivate(fileKey);
                onToggleFile(fileResult.file_path);
            }}
            role="option"
            aria-selected={activeItemKey === fileKey}
            data-active={activeItemKey === fileKey ? 'true' : 'false'}
        >
            <span className={`file-arrow ${isExpanded ? 'expanded' : ''}`}>▶</span>
            <span className="file-path-label" title={fileResult.display_path}>{fileResult.display_path}</span>
            <span className="file-match-badge">{fileResult.matches.length}</span>
        </div>
    );
});
SearchFileRow.displayName = "SearchFileRow";

interface SearchMatchRowProps {
    filePath: string;
    itemKey: string;
    match: SearchMatch;
    activeItemKey: string | null;
    searchPattern: string;
    itemRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
    onActivate: (itemKey: string | null) => void;
    onMatchClick: (filePath: string, match: SearchMatch) => void;
}

const SearchMatchRow = memo(({
    filePath,
    itemKey,
    match,
    activeItemKey,
    searchPattern,
    itemRefs,
    onActivate,
    onMatchClick,
}: SearchMatchRowProps) => {
    return (
        <div
            className="search-item"
            ref={(el) => {
                if (el) {
                    itemRefs.current.set(itemKey, el);
                } else {
                    itemRefs.current.delete(itemKey);
                }
            }}
            onClick={() => {
                onActivate(itemKey);
                onMatchClick(filePath, match);
            }}
            role="option"
            aria-selected={activeItemKey === itemKey}
            data-active={activeItemKey === itemKey ? 'true' : 'false'}
        >
            <strong>{match.line + 1} </strong>
            <SearchPreview match={match} pattern={searchPattern} />
        </div>
    );
});
SearchMatchRow.displayName = "SearchMatchRow";

const Search = ({ id, focusRequestToken, inputValue, onInputValueChange, onEnter, onInputChange, onCancel, onClear, onMatchClick, results, searchEnded }: SearchProps) => {
    const searchPatternRef = useRef("");
    const [visibleMatches, setVisibleMatches] = useState<Record<string, Set<string> | undefined>>({});
    const [activeItemKey, setActiveItemKey] = useState<string | null>(null);
    const [elapsedTime, setElapsedTime] = useState<number>(0);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const startTimeRef = useRef<number | null>(null);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const resultsRef = useRef<HTMLDivElement | null>(null);
    const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const shouldAutoScrollRef = useRef(false);
    const [resultsViewport, setResultsViewport] = useState({ height: 0, scrollTop: 0 });
    
    // Clear visible matches when search starts (when searchEnded becomes false)
    useEffect(() => {
        if (!searchEnded) {
            setVisibleMatches({});
            setElapsedTime(0);
            startTimeRef.current = Date.now();
            
            // Start timer
            intervalRef.current = setInterval(() => {
                if (startTimeRef.current) {
                    const elapsed = (Date.now() - startTimeRef.current) / 1000;
                    setElapsedTime(elapsed);
                }
            }, 100); // Update every 100ms for smooth display
        } else {
            // Stop timer when search ends
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
            startTimeRef.current = null;
        }
        
        // Cleanup on unmount
        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
        };
    }, [searchEnded]);

    // Auto-resize textarea based on content
    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.style.height = "auto";
            inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
        }
    }, [inputValue]);

    useEffect(() => {
        const el = inputRef.current;
        if (!el || !inputValue) return;
        // Place caret at the end for restored value after mount/autofocus.
        const end = inputValue.length;
        el.setSelectionRange(end, end);
    }, [inputValue]);

    useEffect(() => {
        if (focusRequestToken == null) {
            return;
        }
        inputRef.current?.focus();
    }, [focusRequestToken]);

    useEffect(() => {
        const el = resultsRef.current;
        if (!el) return;

        let frame: number | null = null;
        const updateViewport = () => {
            frame = null;
            setResultsViewport((prev) => {
                const next = {
                    height: el.clientHeight,
                    scrollTop: el.scrollTop,
                };
                return prev.height === next.height && prev.scrollTop === next.scrollTop
                    ? prev
                    : next;
            });
        };
        const scheduleUpdate = () => {
            if (frame !== null) return;
            frame = window.requestAnimationFrame(updateViewport);
        };

        updateViewport();
        el.addEventListener('scroll', scheduleUpdate, { passive: true });

        const resizeObserver = new ResizeObserver(scheduleUpdate);
        resizeObserver.observe(el);

        return () => {
            el.removeEventListener('scroll', scheduleUpdate);
            resizeObserver.disconnect();
            if (frame !== null) {
                window.cancelAnimationFrame(frame);
            }
        };
    }, []);

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        onInputValueChange(e.target.value);
        onInputChange?.();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            resultsRef.current?.focus();
            return;
        }

        // ESC cancels the search
        if (e.key === "Escape" && !searchEnded) {
            e.preventDefault();
            onCancel();
            return;
        }
        // Enter submits the search, Shift+Enter inserts newline
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            searchPatternRef.current = inputValue; // Save the pattern used for search
            if (onEnter) {
                onEnter({ id: id, pattern: inputValue });
            }
        }
        // Shift+Enter allows default behavior (inserts \n)
    };

    const totalMatches = useMemo(() => results.reduce(
        (sum, fileResult) => sum + fileResult.matches.length,
        0
    ), [results]);
    const totalFiles = results.length;
    const elapsedMs = Math.max(0, Math.round(elapsedTime * 1000));
    const hasQuery = inputValue.trim().length > 0 || results.length > 0;

    const navItems = useMemo<SearchNavItem[]>(() => {
        const items: SearchNavItem[] = [];

        for (const fileResult of results) {
            const fileKey = `file:${fileResult.file_path}`;
            items.push({ key: fileKey, type: "file", filePath: fileResult.file_path });

            const isExpanded = !!visibleMatches[fileResult.file_path];
            if (!isExpanded) continue;

            for (let matchIndex = 0; matchIndex < fileResult.matches.length; matchIndex += 1) {
                const match = fileResult.matches[matchIndex];
                const key = `match:${fileResult.file_path}:${match.line}:${match.column}:${matchIndex}`;
                items.push({
                    key,
                    type: "match",
                    filePath: fileResult.file_path,
                    match,
                });
            }
        }

        return items;
    }, [results, visibleMatches]);

    const resultsByPath = useMemo(() => {
        return new Map(results.map((fileResult) => [fileResult.file_path, fileResult]));
    }, [results]);

    const firstMatchByFile = useMemo(() => {
        const map = new Map<string, SearchNavItem>();
        for (const item of navItems) {
            if (item.type === "match" && !map.has(item.filePath)) {
                map.set(item.filePath, item);
            }
        }
        return map;
    }, [navItems]);

    const matchItems = useMemo(
        () => navItems.filter((item): item is Extract<SearchNavItem, { type: "match" }> => item.type === "match"),
        [navItems]
    );

    const virtualRows = useMemo(() => {
        const offsets = new Array<number>(navItems.length);
        const heights = new Array<number>(navItems.length);
        let totalHeight = 0;

        for (let index = 0; index < navItems.length; index += 1) {
            const item = navItems[index];
            offsets[index] = totalHeight;
            const rowHeight = item.type === "file" ? SEARCH_FILE_ROW_HEIGHT : SEARCH_MATCH_ROW_HEIGHT;
            heights[index] = rowHeight;
            totalHeight += rowHeight;
        }

        return { offsets, heights, totalHeight };
    }, [navItems]);

    const visibleResultRange = useMemo(() => {
        if (navItems.length === 0) {
            return { start: 0, end: 0, offsetTop: 0 };
        }

        const viewportStart = Math.max(0, resultsViewport.scrollTop);
        const viewportEnd = viewportStart + Math.max(resultsViewport.height, SEARCH_FILE_ROW_HEIGHT);
        let start = 0;
        let end = navItems.length;

        for (let index = 0; index < navItems.length; index += 1) {
            const rowEnd = virtualRows.offsets[index] + virtualRows.heights[index];
            if (rowEnd >= viewportStart) {
                start = Math.max(0, index - SEARCH_RESULTS_OVERSCAN);
                break;
            }
        }

        for (let index = start; index < navItems.length; index += 1) {
            const rowStart = virtualRows.offsets[index];
            if (rowStart > viewportEnd) {
                end = Math.min(navItems.length, index + SEARCH_RESULTS_OVERSCAN);
                break;
            }
        }

        return {
            start,
            end,
            offsetTop: virtualRows.offsets[start] ?? 0,
        };
    }, [navItems.length, resultsViewport.height, resultsViewport.scrollTop, virtualRows]);

    useEffect(() => {
        if (navItems.length === 0) {
            setActiveItemKey(null);
            return;
        }

        if (!activeItemKey || !navItems.some((item) => item.key === activeItemKey)) {
            setActiveItemKey(navItems[0].key);
        }
    }, [activeItemKey, navItems]);

    useEffect(() => {
        if (!activeItemKey || !shouldAutoScrollRef.current) {
            return;
        }

        const activeEl = itemRefs.current.get(activeItemKey);
        if (activeEl) {
            activeEl.scrollIntoView({ block: 'nearest' });
        } else {
            const activeIndex = navItems.findIndex((item) => item.key === activeItemKey);
            const nextTop = activeIndex >= 0 ? virtualRows.offsets[activeIndex] : null;
            if (nextTop !== null) {
                resultsRef.current?.scrollTo({ top: nextTop });
            }
        }
        shouldAutoScrollRef.current = false;
    }, [activeItemKey, navItems, virtualRows.offsets]);

    const handleFileClick = useCallback((filePath: string) => {
        // Toggle the visibility of matches for the clicked file
        setVisibleMatches((prevState) => ({
            ...prevState,
            [filePath]: prevState[filePath] ? undefined : new Set(), // If the file is clicked, toggle visibility
        }));
    }, []);

    const handleMatchClick = useCallback((filePath: string, match: SearchMatch) => {
        onMatchClick(filePath, match);
    }, [onMatchClick]);

    const navigateResultsByKey = useCallback((key: string): boolean => {
        if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(key)) {
            return false;
        }

        if (navItems.length === 0) {
            return true;
        }

        const currentIndex = Math.max(0, navItems.findIndex((item) => item.key === activeItemKey));
        const current = navItems[currentIndex];

        if (key === 'ArrowDown') {
            const nextIndex = Math.min(navItems.length - 1, currentIndex + 1);
            const next = navItems[nextIndex];
            setActiveItemKey(next.key);
            shouldAutoScrollRef.current = true;
            return true;
        }

        if (key === 'ArrowUp') {
            const prevIndex = Math.max(0, currentIndex - 1);
            const prevItem = navItems[prevIndex];
            setActiveItemKey(prevItem.key);
            shouldAutoScrollRef.current = true;
            return true;
        }

        if (key === 'ArrowLeft') {
            if (!current) return true;
            if (current.type === 'match') {
                setActiveItemKey(`file:${current.filePath}`);
                shouldAutoScrollRef.current = true;
                return true;
            }
            setVisibleMatches((prev) => ({ ...prev, [current.filePath]: undefined }));
            return true;
        }

        if (key === 'ArrowRight') {
            if (!current) return true;
            if (current.type === 'file') {
                setVisibleMatches((prev) => ({ ...prev, [current.filePath]: new Set() }));
                const firstMatch = firstMatchByFile.get(current.filePath);
                if (firstMatch) {
                    setActiveItemKey(firstMatch.key);
                    shouldAutoScrollRef.current = true;
                }
            }
            return true;
        }

        if (key === 'Enter') {
            const selected = navItems[currentIndex];
            if (!selected) return true;
            if (selected.type === 'file') {
                handleFileClick(selected.filePath);
            } else {
                setVisibleMatches((prev) => ({ ...prev, [selected.filePath]: new Set() }));
                onMatchClick(selected.filePath, selected.match);
                resultsRef.current?.blur();
            }
            return true;
        }

        return false;
    }, [activeItemKey, firstMatchByFile, handleFileClick, navItems, onMatchClick]);

    const handleResultsKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            inputRef.current?.focus();
            return;
        }

        const handled = navigateResultsByKey(event.key);
        if (handled) {
            event.preventDefault();
            event.stopPropagation();
        }
    }, [navigateResultsByKey]);

    const handleResultsMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        if (event.button !== 0) {
            return;
        }
        resultsRef.current?.focus();
    }, []);

    const navigateMatches = useCallback((direction: "prev" | "next") => {
        if (matchItems.length === 0) return;

        let currentMatchIndex = matchItems.findIndex((item) => item.key === activeItemKey);
        if (currentMatchIndex === -1) {
            currentMatchIndex = direction === "next" ? -1 : 0;
        }

        const nextIndex = direction === "next"
            ? (currentMatchIndex + 1 + matchItems.length) % matchItems.length
            : (currentMatchIndex - 1 + matchItems.length) % matchItems.length;

        const nextMatch = matchItems[nextIndex];
        setVisibleMatches((prev) => ({ ...prev, [nextMatch.filePath]: new Set() }));
        setActiveItemKey(nextMatch.key);
        shouldAutoScrollRef.current = true;
        onMatchClick(nextMatch.filePath, nextMatch.match);
    }, [activeItemKey, matchItems, onMatchClick]);

    const handleExpandAll = useCallback(() => {
        setVisibleMatches(() => {
            const next: Record<string, Set<string> | undefined> = {};
            for (const fileResult of results) {
                next[fileResult.file_path] = new Set();
            }
            return next;
        });
    }, [results]);

    const handleCollapseAll = useCallback(() => {
        setVisibleMatches({});
    }, []);

    return (
        <div className="search-container">
            
            <div className="search-input-wrapper">
                <textarea
                    className="search-input"
                    value={inputValue}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    ref={inputRef}
                    autoFocus
                    rows={1}
                    title={`Search... (Enter to search, Shift+Enter for newline)`}
                    placeholder={`Search...`}
                />
            </div>

            <div className="search-summary">
                {hasQuery ? (
                    <span className="search-summary-text">{`${totalMatches} matches · ${totalFiles} files · ${elapsedMs} ms`}</span>
                ) : (
                    <span className="search-summary-text search-summary-text-empty"></span>
                )}
            </div>

            <div className="search-actions-row">
                <div className="search-actions-group">
                {searchEnded && matchItems.length > 0 && (
                    <>
                        <button
                            className="search-button"
                            onClick={() => navigateMatches("prev")}
                            title="Previous match"
                        >
                            <UpIcon />
                        </button>
                        <button
                            className="search-button"
                            onClick={() => navigateMatches("next")}
                            title="Next match"
                        >
                            <DownIcon />
                        </button>
                    </>
                )}
                {searchEnded ? (
                    <>
                        {inputValue.trim() && (
                            <button 
                                className="search-button replay"
                                onClick={() => {
                                    searchPatternRef.current = inputValue; // Save the pattern used for search
                                    onEnter({ id: id, pattern: inputValue });
                                }}
                                title="Replay search"
                            >
                                <Icons.Refresh />
                            </button>
                        )}
                        {(inputValue.trim() || results.length > 0) && (
                            <button
                                className="search-button"
                                onClick={() => {
                                    onClear?.();
                                }}
                                title="Clear results"
                            >
                                ✕
                            </button>
                        )}
                    </>
                ) : (
                    <>
                        <button 
                            className="search-button search-button-cancel"
                            onClick={onCancel}
                            title="Cancel search"
                        >
                            <StopIcon />
                        </button>
                        <span className="search-loading"><span>.</span><span>.</span><span>.</span></span>
                    </>
                )}
                <button
                    className="search-button"
                    onClick={handleExpandAll}
                    title="Expand all files"
                >
                    <Icons.ChevronDown />
                </button>
                <button
                    className="search-button"
                    onClick={handleCollapseAll}
                    title="Collapse all files"
                >
                    <Icons.ChevronUp />
                </button>
                </div>
            </div>

            <div
                ref={resultsRef}
                className="search-results"
                role="listbox"
                tabIndex={0}
                aria-label="Search results"
                onKeyDown={handleResultsKeyDown}
                onMouseDown={handleResultsMouseDown}
            >
                {results.length > 0 ? (
                    <div
                        className="search-virtual-spacer"
                        style={{ height: virtualRows.totalHeight }}
                    >
                        <div
                            className="search-virtual-window"
                            style={{ transform: `translateY(${visibleResultRange.offsetTop}px)` }}
                        >
                            {navItems.slice(visibleResultRange.start, visibleResultRange.end).map((item) => {
                                if (item.type === "file") {
                                    const fileResult = resultsByPath.get(item.filePath);
                                    if (!fileResult) return null;
                                    return (
                                        <SearchFileRow
                                            key={item.key}
                                            fileResult={fileResult}
                                            isExpanded={!!visibleMatches[item.filePath]}
                                            fileKey={item.key}
                                            activeItemKey={activeItemKey}
                                            itemRefs={itemRefs}
                                            onToggleFile={handleFileClick}
                                            onActivate={setActiveItemKey}
                                        />
                                    );
                                }

                                return (
                                    <SearchMatchRow
                                        key={item.key}
                                        filePath={item.filePath}
                                        itemKey={item.key}
                                        match={item.match}
                                        activeItemKey={activeItemKey}
                                        searchPattern={searchPatternRef.current}
                                        itemRefs={itemRefs}
                                        onActivate={setActiveItemKey}
                                        onMatchClick={handleMatchClick}
                                    />
                                );
                            })}
                        </div>
                    </div>
                ) : (
                    <div className="no-results">No results found</div>
                )}
            </div>
        </div>
    );
};

export default Search;

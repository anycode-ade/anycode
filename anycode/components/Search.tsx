import { useState, useRef, useEffect, useMemo, useCallback } from "react";
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

interface SearchPreviewProps {
    match: SearchMatch;
    pattern: string;
    isCaseSensitive: boolean;
    maxLength?: number;
}

const SearchPreview = ({ match, pattern, isCaseSensitive, maxLength = 100 }: SearchPreviewProps) => {
    const displayPreview = maxLength > 0 ? match.preview.slice(0, maxLength) : match.preview;
    
    if (!pattern.trim()) {
        return <span className="search-preview" title={match.preview}>{displayPreview}</span>;
    }

    // Preview is created as: chars[preview_start..preview_end] 
    // where preview_start = max(0, match.column - 50)
    // So the match position in preview is: match.column - preview_start = min(50, match.column)
    const previewStart = Math.max(0, match.column - 50);
    const matchPositionInPreview = match.column - previewStart;
    const patternLength = pattern.length;
    
    // Ensure we don't go beyond preview bounds
    if (matchPositionInPreview < 0 || matchPositionInPreview + patternLength > displayPreview.length) {
        // Fallback: try to find pattern in preview
        const matchIndex = isCaseSensitive ? displayPreview.indexOf(pattern) : displayPreview.toLowerCase().indexOf(pattern.toLowerCase());
        if (matchIndex === -1) {
            return <span className="search-preview" title={match.preview}>{displayPreview}</span>;
        }
        const beforeMatch = displayPreview.slice(0, matchIndex);
        const matchText = displayPreview.slice(matchIndex, matchIndex + patternLength);
        const afterMatch = displayPreview.slice(matchIndex + patternLength);
        
        return (
            <span className="search-preview" title={match.preview}>
                {beforeMatch}
                <mark className="search-match">{matchText}</mark>
                {afterMatch}
            </span>
        );
    }
    
    // Split preview using match.column position
    const beforeMatch = displayPreview.slice(0, matchPositionInPreview);
    const matchText = displayPreview.slice(matchPositionInPreview, matchPositionInPreview + patternLength);
    const afterMatch = displayPreview.slice(matchPositionInPreview + patternLength);
    
    return (
        <span className="search-preview" title={match.preview}>
            {beforeMatch}
            <mark className="search-match">{matchText}</mark>
            {afterMatch}
        </span>
    );
};

interface SearchProps {
    id: string;
    focusRequestToken?: number | null;
    inputValue: string;
    onInputValueChange: (value: string) => void;
    isCaseSensitive: boolean;
    onCaseSensitiveChange: (value: boolean) => void;
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

const Search = ({ id, focusRequestToken, inputValue, onInputValueChange, isCaseSensitive, onCaseSensitiveChange, onEnter, onInputChange, onCancel, onClear, onMatchClick, results, searchEnded }: SearchProps) => {
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

        if (e.altKey && e.key.toLowerCase() === "c") {
            e.preventDefault();
            const nextCaseSensitive = !isCaseSensitive;
            onCaseSensitiveChange(nextCaseSensitive);
            searchPatternRef.current = inputValue;
            if (onEnter && inputValue) {
                onEnter({ id: id, pattern: inputValue });
            }
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

    const totalMatches = results.reduce(
        (sum, fileResult) => sum + fileResult.matches.length,
        0
    );
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
        activeEl?.scrollIntoView({ block: 'nearest' });
        shouldAutoScrollRef.current = false;
    }, [activeItemKey]);

    const handleFileClick = (filePath: string) => {
        // Toggle the visibility of matches for the clicked file
        setVisibleMatches((prevState) => ({
            ...prevState,
            [filePath]: prevState[filePath] ? undefined : new Set(), // If the file is clicked, toggle visibility
        }));
    };

    const handleMatchClick = (filePath: string, match: SearchMatch) => {
        onMatchClick(filePath, match);
    };

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
                <div className="search-input-container">
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
                    <div className="search-input-actions">
                        <button
                            className={`search-option-btn ${isCaseSensitive ? 'active' : ''}`}
                            onClick={() => onCaseSensitiveChange(!isCaseSensitive)}
                            title="Match Case (Alt+C)"
                        >
                            <Icons.MatchCase />
                        </button>
                    </div>
                </div>
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
                    results.map((fileResult, index) => {
                        const isExpanded = !!visibleMatches[fileResult.file_path];
                        const fileKey = `file:${fileResult.file_path}`;
                        return (
                        <div key={index} className="file-result">
                            <p
                                ref={(el) => {
                                    if (el) {
                                        itemRefs.current.set(fileKey, el);
                                    } else {
                                        itemRefs.current.delete(fileKey);
                                    }
                                }}
                                className="file-path"
                                onClick={() => {
                                    setActiveItemKey(fileKey);
                                    handleFileClick(fileResult.file_path);
                                }}
                                role="option"
                                aria-selected={activeItemKey === fileKey}
                                data-active={activeItemKey === fileKey ? 'true' : 'false'}
                            >
                                <span className={`file-arrow ${isExpanded ? 'expanded' : ''}`}>▶</span>
                                <span className="file-path-label" title={fileResult.display_path}>{fileResult.display_path}</span>
                                <span className="file-match-badge">{fileResult.matches.length}</span>
                            </p>
                            {isExpanded && ( 
                                <div className="matches">
                                    {fileResult.matches.map((match, matchIndex) => {
                                        const matchKey = `match:${fileResult.file_path}:${match.line}:${match.column}:${matchIndex}`;

                                        return (
                                            <div key={matchKey} className="search-item"
                                                ref={(el) => {
                                                    if (el) {
                                                        itemRefs.current.set(matchKey, el);
                                                    } else {
                                                        itemRefs.current.delete(matchKey);
                                                    }
                                                }}
                                                onClick={() => {
                                                    setActiveItemKey(matchKey);
                                                    handleMatchClick(fileResult.file_path, match);
                                                }}
                                                role="option"
                                                aria-selected={activeItemKey === matchKey}
                                                data-active={activeItemKey === matchKey ? 'true' : 'false'}
                                            >
                                                <strong>{match.line + 1} </strong>
                                                <SearchPreview match={match} pattern={searchPatternRef.current} isCaseSensitive={isCaseSensitive} />
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                        );
                    })
                ) : (
                    <div className="no-results">No results found</div>
                )}
            </div>
        </div>
    );
};

export default Search;

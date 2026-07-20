import { memo, useState, useRef, useEffect, useMemo, useCallback } from "react";
import type { RefObject } from "react";
import type { Socket } from "socket.io-client";
import { Icons } from "./Icons";
import { FileIcon } from "./FileIcon";
import { usePersistedScroll } from "../hooks/usePersistedScroll";
import "./Search.css";
import type { FileSearchResult, SearchResult, SearchMatch } from "../types";

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
const FILES_SEARCH_ROW_HEIGHT = 38;

type SearchMode = "content" | "files";

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
    wsRef: RefObject<Socket | null>;
    isConnected: boolean;
    focusRequestToken?: number | null;
    inputValue: string;
    onInputValueChange: (value: string) => void;
    onEnter: (data: { id: string; pattern: string }) => void;
    onInputChange?: () => void;
    onCancel: () => void;
    onClear?: () => void;
    onMatchClick: (filePath: string, match: SearchMatch) => void;
    onFileClick: (filePath: string) => void;
    results: SearchResult[];
    searchEnded: boolean;
    fileIconsStyle?: 'colored' | 'monochrome' | 'disabled';
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
    fileIconsStyle?: 'colored' | 'monochrome' | 'disabled';
}

const SearchFileRow = memo(({
    fileResult,
    isExpanded,
    fileKey,
    activeItemKey,
    itemRefs,
    onToggleFile,
    onActivate,
    fileIconsStyle,
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
            <FileIcon
                path={fileResult.file_path}
                styleType={fileIconsStyle}
                className="search-file-icon"
            />
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

type FilesSearchBatch = {
    query?: string;
    request_id?: string;
    results?: FileSearchResult[];
};

type FilesSearchError = {
    query?: string;
    request_id?: string;
    message?: string;
};

const Search = ({ id, wsRef, isConnected, focusRequestToken, inputValue, onInputValueChange, onEnter, onInputChange, onCancel, onClear, onMatchClick, onFileClick, results, searchEnded, fileIconsStyle }: SearchProps) => {
    const searchPatternRef = useRef("");
    const activeFilesRequestRef = useRef<{ query: string; requestId: string } | null>(null);
    const filesSearchRequestCounterRef = useRef(0);
    const [visibleMatches, setVisibleMatches] = useState<Record<string, Set<string> | undefined>>({});
    const [activeItemKey, setActiveItemKey] = useState<string | null>(null);
    const [activeFileSearchPath, setActiveFileSearchPath] = useState<string | null>(null);
    const [elapsedTime, setElapsedTime] = useState<number>(0);
    const [searchMode, setSearchMode] = useState<SearchMode>("content");
    const [fileResults, setFileResults] = useState<FileSearchResult[]>([]);
    const [filesSearchEnded, setFilesSearchEnded] = useState(true);
    const [filesSearchError, setFilesSearchError] = useState<string | null>(null);
    const [isModeToggleCompact, setIsModeToggleCompact] = useState(false);
    const inputWrapperRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const startTimeRef = useRef<number | null>(null);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const resultsRef = usePersistedScroll<HTMLDivElement>('search-panel', 'session', [results, fileResults, searchMode]);
    const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const shouldAutoScrollRef = useRef(false);
    const [resultsViewport, setResultsViewport] = useState({ height: 0, scrollTop: 0 });
    const activeSearchEnded = searchMode === "content" ? searchEnded : filesSearchEnded;
    
    // Clear visible matches when search starts (when searchEnded becomes false)
    useEffect(() => {
        if (!activeSearchEnded) {
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
    }, [activeSearchEnded]);

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
        const el = inputWrapperRef.current;
        if (!el) return;

        const updateCompactMode = () => {
            setIsModeToggleCompact(el.clientWidth < 250);
        };

        updateCompactMode();
        const resizeObserver = new ResizeObserver(updateCompactMode);
        resizeObserver.observe(el);
        return () => resizeObserver.disconnect();
    }, []);

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
        if (searchMode === "content") {
            onInputChange?.();
        } else {
            wsRef.current?.emit('search:files:cancel');
            activeFilesRequestRef.current = null;
            setFileResults([]);
            setFilesSearchEnded(true);
            setFilesSearchError(null);
        }
    };

    const startFilesSearch = useCallback((pattern: string) => {
        const trimmed = pattern.trim();
        if (!trimmed || !wsRef.current || !isConnected) return;

        filesSearchRequestCounterRef.current += 1;
        const requestId = `${Date.now()}:${filesSearchRequestCounterRef.current}`;
        activeFilesRequestRef.current = { query: trimmed.toLowerCase(), requestId };
        setFileResults([]);
        setFilesSearchError(null);
        setFilesSearchEnded(false);
        setActiveFileSearchPath(null);
        resultsRef.current?.scrollTo({ top: 0 });
        wsRef.current.emit('search:files:start', { query: trimmed, request_id: requestId });
    }, [isConnected, wsRef]);

    const cancelFilesSearch = useCallback(() => {
        wsRef.current?.emit('search:files:cancel');
        activeFilesRequestRef.current = null;
        setFilesSearchEnded(true);
    }, [wsRef]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            resultsRef.current?.focus();
            return;
        }

        // ESC cancels the search
        if (e.key === "Escape" && !activeSearchEnded) {
            e.preventDefault();
            if (searchMode === "content") {
                onCancel();
            } else {
                cancelFilesSearch();
            }
            return;
        }
        // Enter submits the search, Shift+Enter inserts newline
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            searchPatternRef.current = inputValue; // Save the pattern used for search
            if (searchMode === "content" && onEnter) {
                onEnter({ id: id, pattern: inputValue });
            } else {
                startFilesSearch(inputValue);
            }
        }
        // Shift+Enter allows default behavior (inserts \n)
    };

    useEffect(() => {
        if (!wsRef.current || !isConnected) return;

        const socket = wsRef.current;
        const isActiveFilesSearchMessage = (message: { query?: string; request_id?: string }) => {
            const activeRequest = activeFilesRequestRef.current;
            return Boolean(
                activeRequest
                && message.query === activeRequest.query
                && message.request_id === activeRequest.requestId
            );
        };

        const handleResults = (message: FilesSearchBatch) => {
            if (!isActiveFilesSearchMessage(message)) return;
            setFileResults((prevResults) => {
                const nextByPath = new Map(prevResults.map((result) => [result.path, result]));
                for (const result of message.results ?? []) {
                    nextByPath.set(result.path, result);
                }
                return Array.from(nextByPath.values()).sort((a, b) => a.path.localeCompare(b.path));
            });
        };

        const handleEnd = (message: FilesSearchBatch) => {
            if (!isActiveFilesSearchMessage(message)) return;
            setFilesSearchEnded(true);
            activeFilesRequestRef.current = null;
        };

        const handleError = (message: FilesSearchError) => {
            if (!isActiveFilesSearchMessage(message)) return;
            setFilesSearchError(message.message ?? 'Search failed');
            setFilesSearchEnded(true);
            activeFilesRequestRef.current = null;
        };

        socket.on('search:files:results', handleResults);
        socket.on('search:files:end', handleEnd);
        socket.on('search:files:error', handleError);

        return () => {
            socket.off('search:files:results', handleResults);
            socket.off('search:files:end', handleEnd);
            socket.off('search:files:error', handleError);
        };
    }, [isConnected, wsRef]);

    const totalMatches = useMemo(() => results.reduce(
        (sum, fileResult) => sum + fileResult.matches.length,
        0
    ), [results]);
    const totalFiles = results.length;
    const totalFileNameMatches = fileResults.length;
    const elapsedMs = Math.max(0, Math.round(elapsedTime * 1000));
    const hasQuery = inputValue.trim().length > 0 || results.length > 0 || fileResults.length > 0;

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

    const visibleFileResultRange = useMemo(() => {
        if (fileResults.length === 0) {
            return { start: 0, end: 0, offsetTop: 0, totalHeight: 0 };
        }

        const start = Math.max(0, Math.floor(resultsViewport.scrollTop / FILES_SEARCH_ROW_HEIGHT) - SEARCH_RESULTS_OVERSCAN);
        const visibleCount = Math.ceil(Math.max(resultsViewport.height, FILES_SEARCH_ROW_HEIGHT) / FILES_SEARCH_ROW_HEIGHT) + SEARCH_RESULTS_OVERSCAN * 2;
        const end = Math.min(fileResults.length, start + visibleCount);

        return {
            start,
            end,
            offsetTop: start * FILES_SEARCH_ROW_HEIGHT,
            totalHeight: fileResults.length * FILES_SEARCH_ROW_HEIGHT,
        };
    }, [fileResults.length, resultsViewport.height, resultsViewport.scrollTop]);

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
        if (searchMode === "files") {
            if (fileResults.length === 0) {
                setActiveFileSearchPath(null);
                return;
            }
            if (!activeFileSearchPath || !fileResults.some((result) => result.path === activeFileSearchPath)) {
                setActiveFileSearchPath(fileResults[0].path);
            }
            return;
        }

        if (navItems.length === 0) {
            setActiveItemKey(null);
            return;
        }

        if (!activeItemKey || !navItems.some((item) => item.key === activeItemKey)) {
            setActiveItemKey(navItems[0].key);
        }
    }, [activeFileSearchPath, activeItemKey, fileResults, navItems, searchMode]);

    useEffect(() => {
        if (searchMode !== "content" || !activeItemKey || !shouldAutoScrollRef.current) {
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
    }, [activeItemKey, navItems, virtualRows.offsets, searchMode]);

    useEffect(() => {
        if (searchMode !== "files" || !activeFileSearchPath || !shouldAutoScrollRef.current) {
            return;
        }

        const activeIndex = fileResults.findIndex((result) => result.path === activeFileSearchPath);
        if (activeIndex >= 0) {
            const nextTop = activeIndex * FILES_SEARCH_ROW_HEIGHT;
            const viewport = resultsViewport;
            const container = resultsRef.current;
            if (container) {
                const itemBottom = nextTop + FILES_SEARCH_ROW_HEIGHT;
                if (nextTop < viewport.scrollTop) {
                    container.scrollTo({ top: nextTop });
                } else if (itemBottom > viewport.scrollTop + viewport.height) {
                    container.scrollTo({ top: itemBottom - viewport.height });
                }
            }
        }
        shouldAutoScrollRef.current = false;
    }, [activeFileSearchPath, fileResults, searchMode, resultsViewport]);

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

        if (searchMode === "files") {
            if (fileResults.length === 0) return true;
            const currentIndex = Math.max(0, fileResults.findIndex((result) => result.path === activeFileSearchPath));
            if (key === 'ArrowDown') {
                setActiveFileSearchPath(fileResults[Math.min(fileResults.length - 1, currentIndex + 1)].path);
                shouldAutoScrollRef.current = true;
                return true;
            }
            if (key === 'ArrowUp') {
                setActiveFileSearchPath(fileResults[Math.max(0, currentIndex - 1)].path);
                shouldAutoScrollRef.current = true;
                return true;
            }
            if (key === 'Enter') {
                onFileClick(fileResults[currentIndex].path);
                resultsRef.current?.blur();
                return true;
            }
            return true;
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
    }, [activeFileSearchPath, activeItemKey, fileResults, firstMatchByFile, handleFileClick, navItems, onFileClick, onMatchClick, searchMode]);

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

    const setMode = useCallback((mode: SearchMode) => {
        if (mode === searchMode) return;
        if (searchMode === "content") {
            onCancel();
        } else {
            cancelFilesSearch();
        }
        setSearchMode(mode);
        resultsRef.current?.scrollTo({ top: 0 });
    }, [cancelFilesSearch, onCancel, searchMode]);

    return (
        <div className="search-container">
            
            <div
                ref={inputWrapperRef}
                className={`search-input-wrapper ${isModeToggleCompact ? "search-input-wrapper-compact" : ""}`}
            >
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
                <div className="search-mode-toggle" role="tablist" aria-label="Search mode">
                    <button
                        type="button"
                        className={`search-mode-button ${searchMode === "content" ? "active" : ""}`}
                        onClick={() => setMode("content")}
                        role="tab"
                        aria-selected={searchMode === "content"}
                    >
                        {isModeToggleCompact ? "C" : "Content"}
                    </button>
                    <button
                        type="button"
                        className={`search-mode-button ${searchMode === "files" ? "active" : ""}`}
                        onClick={() => setMode("files")}
                        role="tab"
                        aria-selected={searchMode === "files"}
                    >
                        {isModeToggleCompact ? "F" : "Files"}
                    </button>
                </div>
            </div>

            <div className="search-summary">
                {hasQuery ? (
                    <span className="search-summary-text">
                        {searchMode === "content"
                            ? `${totalMatches} matches · ${totalFiles} files · ${elapsedMs} ms`
                            : `${totalFileNameMatches} files · ${elapsedMs} ms`}
                    </span>
                ) : (
                    <span className="search-summary-text search-summary-text-empty"></span>
                )}
            </div>

            <div className="search-actions-row">
                <div className="search-actions-group">
                {searchMode === "content" && searchEnded && matchItems.length > 0 && (
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
                {activeSearchEnded ? (
                    <>
                        {inputValue.trim() && (
                            <button 
                                className="search-button replay"
                                onClick={() => {
                                    searchPatternRef.current = inputValue; // Save the pattern used for search
                                    if (searchMode === "content") {
                                        onEnter({ id: id, pattern: inputValue });
                                    } else {
                                        startFilesSearch(inputValue);
                                    }
                                }}
                                title="Replay search"
                            >
                                <Icons.Refresh />
                            </button>
                        )}
                        {(inputValue.trim() || results.length > 0 || fileResults.length > 0) && (
                            <button
                                className="search-button"
                                onClick={() => {
                                    if (searchMode === "content") {
                                        onClear?.();
                                    } else {
                                        cancelFilesSearch();
                                        setFileResults([]);
                                        setFilesSearchError(null);
                                    }
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
                            onClick={searchMode === "content" ? onCancel : cancelFilesSearch}
                            title="Cancel search"
                        >
                            <StopIcon />
                        </button>
                        <span className="search-loading"><span>.</span><span>.</span><span>.</span></span>
                    </>
                )}
                {searchMode === "content" && <button
                    className="search-button"
                    onClick={handleExpandAll}
                    title="Expand all files"
                >
                    <Icons.ChevronDown />
                </button>}
                {searchMode === "content" && <button
                    className="search-button"
                    onClick={handleCollapseAll}
                    title="Collapse all files"
                >
                    <Icons.ChevronUp />
                </button>}
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
                {searchMode === "files" ? (
                    fileResults.length > 0 ? (
                        <div className="search-virtual-spacer" style={{ height: visibleFileResultRange.totalHeight }}>
                            <div
                                className="search-virtual-window"
                                style={{ transform: `translateY(${visibleFileResultRange.offsetTop}px)` }}
                            >
                                {fileResults.slice(visibleFileResultRange.start, visibleFileResultRange.end).map((result) => (
                                    <button
                                        key={result.path}
                                        className="search-file-name-result"
                                        type="button"
                                        data-active={activeFileSearchPath === result.path ? 'true' : 'false'}
                                        onClick={() => {
                                            setActiveFileSearchPath(result.path);
                                            onFileClick(result.path);
                                        }}
                                        title={result.path}
                                    >
                                        <FileIcon path={result.path} styleType={fileIconsStyle} className="search-file-icon" />
                                        <span className="search-file-name-result-text">
                                            <span className="search-file-name-result-name">{result.name}</span>
                                            <span className="search-file-name-result-path">{result.display_path ?? result.path}</span>
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="no-results">{filesSearchError ?? (filesSearchEnded ? "No results found" : "Searching...")}</div>
                    )
                ) : results.length > 0 ? (
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
                                            fileIconsStyle={fileIconsStyle}
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

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { SearchEnd, SearchResult, SearchResultsBatch } from '../types';
import { normalizePath } from '../utils';

type UseSearchParams = {
    wsRef: React.RefObject<Socket | null>;
    isConnected: boolean;
};

export const useSearch = ({ wsRef, isConnected }: UseSearchParams) => {
    const SEARCH_INPUT_STORAGE_KEY = 'searchInput';
    const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
    const [searchEnded, setSearchEnded] = useState<boolean>(true);
    const [searchInput, setSearchInput] = useState<string>(() => {
        if (typeof window === 'undefined') return '';
        return localStorage.getItem(SEARCH_INPUT_STORAGE_KEY) ?? '';
    });
    const pendingResultsRef = useRef<Map<string, SearchResult>>(new Map());
    const flushFrameRef = useRef<number | null>(null);

    const applySearchResultUpdate = (resultsMap: Map<string, SearchResult>, result: SearchResult) => {
        if (result.matches.length === 0) {
            resultsMap.delete(result.file_path);
            return;
        }

        resultsMap.set(result.file_path, result);
    };

    const flushPendingResults = useCallback(() => {
        flushFrameRef.current = null;

        setSearchResults((prevResults) => {
            if (pendingResultsRef.current.size === 0) {
                return prevResults;
            }

            const pendingResults = pendingResultsRef.current;
            pendingResultsRef.current = new Map();

            const resultsMap = new Map(prevResults.map((result) => [result.file_path, result]));
            for (const result of pendingResults.values()) {
                applySearchResultUpdate(resultsMap, result);
            }

            return Array.from(resultsMap.values());
        });
    }, []);

    const scheduleResultsFlush = useCallback(() => {
        if (flushFrameRef.current !== null) {
            return;
        }

        flushFrameRef.current = window.requestAnimationFrame(flushPendingResults);
    }, [flushPendingResults]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (searchInput) {
            localStorage.setItem(SEARCH_INPUT_STORAGE_KEY, searchInput);
        } else {
            localStorage.removeItem(SEARCH_INPUT_STORAGE_KEY);
        }
    }, [searchInput]);

    const startSearch = useCallback((pattern: string) => {
        if (!pattern) return;
        if (!wsRef.current || !isConnected) return;

        pendingResultsRef.current.clear();
        if (flushFrameRef.current !== null) {
            window.cancelAnimationFrame(flushFrameRef.current);
            flushFrameRef.current = null;
        }
        wsRef.current.emit('search:start', { pattern });
        setSearchResults([]);
        setSearchEnded(false);
    }, [wsRef, isConnected]);

    const cancelSearch = useCallback(() => {
        if (!wsRef.current || !isConnected) return;

        wsRef.current.emit('search:cancel');
        setSearchEnded(true);
    }, [wsRef, isConnected]);

    const handleSearchResults = useCallback((message: SearchResultsBatch) => {
        for (const result of message.results) {
            const normalized = {
                ...result,
                file_path: normalizePath(result.file_path),
                display_path: normalizePath(result.display_path),
            };
            pendingResultsRef.current.set(normalized.file_path, normalized);
        }
        scheduleResultsFlush();
    }, [scheduleResultsFlush]);

    const handleSearchEnd = useCallback((_result: SearchEnd) => {
        if (flushFrameRef.current !== null) {
            window.cancelAnimationFrame(flushFrameRef.current);
            flushFrameRef.current = null;
        }
        flushPendingResults();
        setSearchEnded(true);
    }, [flushPendingResults]);

    const clearResults = useCallback(() => {
        pendingResultsRef.current.clear();
        if (flushFrameRef.current !== null) {
            window.cancelAnimationFrame(flushFrameRef.current);
            flushFrameRef.current = null;
        }
        setSearchResults([]);
        setSearchEnded(true);
    }, []);

    useEffect(() => {
        return () => {
            if (flushFrameRef.current !== null) {
                window.cancelAnimationFrame(flushFrameRef.current);
            }
        };
    }, []);

    return {
        searchInput,
        setSearchInput,
        searchResults,
        searchEnded,
        startSearch,
        cancelSearch,
        clearResults,
        handleSearchResults,
        handleSearchEnd,
    };
};

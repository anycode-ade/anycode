import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { FileSearchResult, SearchEnd, SearchResult, SearchResultsBatch } from '../types';
import { normalizePath } from '../utils';

type UseSearchParams = {
    wsRef: React.RefObject<Socket | null>;
    isConnected: boolean;
    projectId?: string | null;
};

export const useSearch = ({ wsRef, isConnected, projectId }: UseSearchParams) => {
    const SEARCH_INPUT_STORAGE_KEY = 'searchInput';
    const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
    const [searchEnded, setSearchEnded] = useState<boolean>(true);
    const [searchInput, setSearchInput] = useState<string>(() => {
        if (typeof window === 'undefined') return '';
        return localStorage.getItem(SEARCH_INPUT_STORAGE_KEY) ?? '';
    });
    const pendingResultsRef = useRef<Map<string, SearchResult>>(new Map());
    const flushFrameRef = useRef<number | null>(null);
    const projectIdRef = useRef(projectId);
    projectIdRef.current = projectId;

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

    const startSearch = useCallback((pattern: string, targetProjectId = projectId) => {
        if (!pattern || !targetProjectId) return;
        if (!wsRef.current || !isConnected) return;

        pendingResultsRef.current.clear();
        if (flushFrameRef.current !== null) {
            window.cancelAnimationFrame(flushFrameRef.current);
            flushFrameRef.current = null;
        }
        wsRef.current.emit('search:start', { pattern, project_id: targetProjectId });
        setSearchResults([]);
        setSearchEnded(false);
    }, [wsRef, isConnected, projectId]);

    const cancelSearch = useCallback(() => {
        if (!wsRef.current || !isConnected) return;

        wsRef.current.emit('search:cancel');
        setSearchEnded(true);
    }, [wsRef, isConnected]);

    const handleSearchResults = useCallback((message: SearchResultsBatch) => {
        if (message.project_id && message.project_id !== projectIdRef.current) return;
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

    const handleSearchEnd = useCallback((result: SearchEnd) => {
        if (result.project_id && result.project_id !== projectIdRef.current) return;
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

    const searchFiles = useCallback((query: string): Promise<FileSearchResult[]> => {
        return new Promise((resolve) => {
            const socket = wsRef.current;
            const targetProjectId = projectId;
            if (!socket || !isConnected || !targetProjectId) {
                resolve([]);
                return;
            }

            const requestId = `files-search-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
            let results: FileSearchResult[] = [];

            const handleResults = (data: { query?: string; request_id?: string; project_id?: string; results?: FileSearchResult[] }) => {
                if (
                    data.request_id === requestId
                    && (!data.project_id || data.project_id === targetProjectId)
                    && Array.isArray(data.results)
                ) {
                    results = results.concat(data.results);
                }
            };

            const handleEnd = (data: { query?: string; request_id?: string }) => {
                if (data.request_id === requestId) {
                    cleanup();
                    resolve(results);
                }
            };

            const handleError = () => {
                cleanup();
                resolve(results);
            };

            const cleanup = () => {
                socket.off('search:files:results', handleResults);
                socket.off('search:files:end', handleEnd);
                socket.off('search:files:error', handleError);
                clearTimeout(timer);
            };

            const timer = setTimeout(() => {
                cleanup();
                resolve(results);
            }, 3000);

            socket.on('search:files:results', handleResults);
            socket.on('search:files:end', handleEnd);
            socket.on('search:files:error', handleError);
            socket.emit('search:files:start', {
                query,
                request_id: requestId,
                project_id: targetProjectId,
            });
        });
    }, [wsRef, isConnected, projectId]);

    const resetSearch = useCallback(() => {
        cancelSearch();
        clearResults();
        setSearchInput('');
    }, [cancelSearch, clearResults]);

    const previousProjectIdRef = useRef(projectId);
    useEffect(() => {
        if (previousProjectIdRef.current === projectId) return;
        previousProjectIdRef.current = projectId;
        cancelSearch();
        clearResults();
    }, [projectId, cancelSearch, clearResults]);

    return {
        searchInput,
        setSearchInput,
        searchResults,
        searchEnded,
        startSearch,
        cancelSearch,
        searchFiles,
        clearResults,
        resetSearch,
        handleSearchResults,
        handleSearchEnd,
    };
};

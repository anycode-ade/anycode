import { useCallback, useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { SearchEnd, SearchResult } from '../types';

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

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (searchInput) {
            localStorage.setItem(SEARCH_INPUT_STORAGE_KEY, searchInput);
        } else {
            localStorage.removeItem(SEARCH_INPUT_STORAGE_KEY);
        }
    }, [searchInput]);

    const startSearch = useCallback((pattern: string, preview?: boolean) => {
        if (!pattern) return;
        if (!wsRef.current || !isConnected) return;

        wsRef.current.emit('search:start', { pattern, preview });
        setSearchResults([]);
        setSearchEnded(false);
    }, [wsRef, isConnected]);

    const cancelSearch = useCallback(() => {
        if (!wsRef.current || !isConnected) return;

        wsRef.current.emit('search:cancel');
        setSearchEnded(true);
    }, [wsRef, isConnected]);

    const handleSearchResult = useCallback((message: SearchResult | SearchResult[]) => {
        const messages = Array.isArray(message) ? message : [message];
        setSearchResults((prevResults) => {
            const resultsMap = new Map(prevResults.map((result) => [result.file_path, result]));
            for (const item of messages) {
                const sortedMatches = [...item.matches].sort((a, b) => {
                    if (a.line !== b.line) return a.line - b.line;
                    return a.column - b.column;
                });
                if (item.matches.length === 0) {
                    resultsMap.delete(item.file_path);
                } else {
                    resultsMap.set(item.file_path, { ...item, matches: sortedMatches });
                }
            }
            return Array.from(resultsMap.values()).sort((a, b) => {
                const countDelta = b.matches.length - a.matches.length;
                if (countDelta !== 0) return countDelta;

                const depthA = a.display_path.split('/').length;
                const depthB = b.display_path.split('/').length;
                if (depthA !== depthB) return depthA - depthB;

                return a.display_path.localeCompare(b.display_path);
            });
        });
    }, []);

    const handleSearchEnd = useCallback((_result: SearchEnd) => {
        setSearchEnded(true);
    }, []);

    const clearResults = useCallback(() => {
        setSearchResults([]);
        setSearchEnded(true);
    }, []);

    return {
        searchInput,
        setSearchInput,
        searchResults,
        searchEnded,
        startSearch,
        cancelSearch,
        clearResults,
        handleSearchResult,
        handleSearchEnd,
    };
};

import { useCallback, useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { SearchEnd, SearchResult } from '../types';

type UseSearchParams = {
    wsRef: React.RefObject<Socket | null>;
    isConnected: boolean;
};

export const useSearch = ({ wsRef, isConnected }: UseSearchParams) => {
    const SEARCH_INPUT_STORAGE_KEY = 'searchInput';
    const CASE_SENSITIVE_STORAGE_KEY = 'searchCaseSensitive';
    const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
    const [searchEnded, setSearchEnded] = useState<boolean>(true);
    const [searchInput, setSearchInput] = useState<string>(() => {
        if (typeof window === 'undefined') return '';
        return localStorage.getItem(SEARCH_INPUT_STORAGE_KEY) ?? '';
    });
    const [isCaseSensitive, setIsCaseSensitive] = useState<boolean>(() => {
        if (typeof window === 'undefined') return false;
        return localStorage.getItem(CASE_SENSITIVE_STORAGE_KEY) === 'true';
    });

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (searchInput) {
            localStorage.setItem(SEARCH_INPUT_STORAGE_KEY, searchInput);
        } else {
            localStorage.removeItem(SEARCH_INPUT_STORAGE_KEY);
        }
    }, [searchInput]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        localStorage.setItem(CASE_SENSITIVE_STORAGE_KEY, String(isCaseSensitive));
    }, [isCaseSensitive]);

    const startSearch = useCallback((pattern: string, caseSensitiveOverride?: boolean) => {
        if (!pattern) return;
        if (!wsRef.current || !isConnected) return;

        const useCaseSensitive = caseSensitiveOverride ?? isCaseSensitive;
        wsRef.current.emit('search:start', { pattern, case_sensitive: useCaseSensitive });
        setSearchResults([]);
        setSearchEnded(false);
    }, [wsRef, isConnected, isCaseSensitive]);

    const cancelSearch = useCallback(() => {
        if (!wsRef.current || !isConnected) return;

        wsRef.current.emit('search:cancel');
        setSearchEnded(true);
    }, [wsRef, isConnected]);

    const handleSearchResult = useCallback((message: SearchResult) => {
        setSearchResults((prevResults) => {
            const resultsMap = new Map(prevResults.map((result) => [result.file_path, result]));
            const sortedMatches = [...message.matches].sort((a, b) => {
                if (a.line !== b.line) return a.line - b.line;
                return a.column - b.column;
            });
            if (message.matches.length === 0) {
                resultsMap.delete(message.file_path);
            } else {
                resultsMap.set(message.file_path, { ...message, matches: sortedMatches });
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
        isCaseSensitive,
        setIsCaseSensitive,
        searchResults,
        searchEnded,
        startSearch,
        cancelSearch,
        clearResults,
        handleSearchResult,
        handleSearchEnd,
    };
};

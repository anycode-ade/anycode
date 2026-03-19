import { useCallback, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { SearchEnd, SearchResult } from '../types';

type UseSearchParams = {
    wsRef: React.RefObject<Socket | null>;
    isConnected: boolean;
};

export const useSearch = ({ wsRef, isConnected }: UseSearchParams) => {
    const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
    const [searchEnded, setSearchEnded] = useState<boolean>(true);

    const startSearch = useCallback((pattern: string) => {
        if (!pattern) return;
        if (!wsRef.current || !isConnected) return;

        wsRef.current.emit('search:start', { pattern });
        setSearchResults([]);
        setSearchEnded(false);
    }, [wsRef, isConnected]);

    const cancelSearch = useCallback(() => {
        if (!wsRef.current || !isConnected) return;

        wsRef.current.emit('search:cancel');
        setSearchEnded(true);
    }, [wsRef, isConnected]);

    const handleSearchResult = useCallback((message: SearchResult) => {
        setSearchResults((prevResults) => {
            const resultsMap = new Map(prevResults.map((result) => [result.file_path, result]));
            resultsMap.set(message.file_path, message);
            return Array.from(resultsMap.values());
        });
    }, []);

    const handleSearchEnd = useCallback((_result: SearchEnd) => {
        setSearchEnded(true);
    }, []);

    return {
        searchResults,
        searchEnded,
        startSearch,
        cancelSearch,
        handleSearchResult,
        handleSearchEnd,
    };
};

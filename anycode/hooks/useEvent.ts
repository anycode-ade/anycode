import { useCallback, useRef } from 'react';

export function useEvent<T extends (...args: any[]) => any>(fn: T): T {
    const fnRef = useRef(fn);
    fnRef.current = fn;

    return useCallback(((...args: Parameters<T>) => {
        return fnRef.current(...args);
    }) as T, []);
}


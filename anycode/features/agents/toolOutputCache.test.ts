import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolOutputCache } from './toolOutputCache';

describe('ToolOutputCache', () => {
    let cache: ToolOutputCache;

    beforeEach(() => {
        vi.useRealTimers();
    });

    it('stores and retrieves tool output', () => {
        cache = new ToolOutputCache();
        cache.set('tool-1', 'npm test output: passed');
        expect(cache.get('tool-1')).toBe('npm test output: passed');
    });

    it('evicts oldest items when maxBytes limit is reached (LRU)', () => {
        // Limit: 50 bytes. Each char ~2 bytes.
        // String of 10 chars is ~20 bytes.
        cache = new ToolOutputCache({ maxBytes: 50 });

        cache.set('t1', '1234567890'); // ~20 bytes
        cache.set('t2', '1234567890'); // ~20 bytes
        expect(cache.getSize()).toBe(2);

        // Adding third item exceeds 50 bytes (total 60 bytes) -> t1 must be evicted
        cache.set('t3', '1234567890');
        expect(cache.get('t1')).toBeUndefined();
        expect(cache.get('t2')).toBe('1234567890');
        expect(cache.get('t3')).toBe('1234567890');
    });

    it('refreshes LRU order upon get()', () => {
        cache = new ToolOutputCache({ maxBytes: 50 });

        cache.set('t1', '1234567890');
        cache.set('t2', '1234567890');

        // Access t1, making it the most recently used (t2 becomes oldest)
        expect(cache.get('t1')).toBe('1234567890');

        // Adding t3 should now evict t2, NOT t1!
        cache.set('t3', '1234567890');
        expect(cache.get('t2')).toBeUndefined();
        expect(cache.get('t1')).toBe('1234567890');
        expect(cache.get('t3')).toBe('1234567890');
    });

    it('evicts items after TTL expires', () => {
        vi.useFakeTimers();
        cache = new ToolOutputCache({ ttlMs: 1000 }); // 1 sec TTL

        cache.set('t1', 'short-lived');
        expect(cache.get('t1')).toBe('short-lived');

        // Fast-forward 1.5 seconds
        vi.advanceTimersByTime(1500);

        // Lazy check on get
        expect(cache.get('t1')).toBeUndefined();
        expect(cache.getSize()).toBe(0);
    });

    it('sweep() purges expired items', () => {
        vi.useFakeTimers();
        cache = new ToolOutputCache({ ttlMs: 1000 });

        cache.set('t1', 'val1');
        cache.set('t2', 'val2');
        expect(cache.getSize()).toBe(2);

        vi.advanceTimersByTime(1500);

        cache.sweep();
        expect(cache.getSize()).toBe(0);
    });

    it('notifies subscribers when an item expires', () => {
        vi.useFakeTimers();
        cache = new ToolOutputCache({ ttlMs: 1000 });
        const expired: string[] = [];
        const unsubscribe = cache.subscribe((id) => expired.push(id));

        cache.set('t1', 'content');
        vi.advanceTimersByTime(1500);

        cache.sweep();
        expect(expired).toEqual(['t1']);

        unsubscribe();
    });
});


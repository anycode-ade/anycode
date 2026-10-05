export type CacheEntry = {
    output: string;
    size: number;
    expiresAt: number;
};

export class ToolOutputCache {
    private cache = new Map<string, CacheEntry>();
    private currentBytes = 0;
    private readonly maxBytes: number;
    private readonly ttlMs: number;
    private sweepInterval: ReturnType<typeof setInterval> | null = null;
    private listeners = new Set<(expiredToolId: string) => void>();

    constructor(options?: { maxBytes?: number; ttlMs?: number }) {
        this.maxBytes = options?.maxBytes ?? 100 * 1024 * 1024; // Default: 100 MB
        this.ttlMs = options?.ttlMs ?? 5 * 60 * 1000; // 5 minutes
    }

    subscribe(listener: (expiredToolId: string) => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private notifyExpired(toolId: string): void {
        for (const listener of this.listeners) {
            try {
                listener(toolId);
            } catch (e) {
                console.error('Error in toolOutputCache listener', e);
            }
        }
    }

    get(toolId: string): string | undefined {
        const entry = this.cache.get(toolId);
        if (!entry) return undefined;

        const now = Date.now();
        if (now > entry.expiresAt) {
            this.delete(toolId);
            this.notifyExpired(toolId);
            return undefined;
        }

        entry.expiresAt = now + this.ttlMs;
        // Refresh position in Map for LRU
        this.cache.delete(toolId);
        this.cache.set(toolId, entry);

        return entry.output;
    }

    has(toolId: string): boolean {
        return this.get(toolId) !== undefined;
    }

    set(toolId: string, output: string): void {
        this.delete(toolId);

        const size = output.length * 2; // Approximate byte size for UTF-16 in JS Heap

        // Evict oldest entries if exceeding capacity
        while (this.currentBytes + size > this.maxBytes && this.cache.size > 0) {
            const oldestKey = this.cache.keys().next().value;
            if (!oldestKey) break;
            this.delete(oldestKey);
        }

        this.cache.set(toolId, {
            output,
            size,
            expiresAt: Date.now() + this.ttlMs,
        });
        this.currentBytes += size;

        this.startSweepInterval();
    }

    delete(toolId: string): void {
        const entry = this.cache.get(toolId);
        if (entry) {
            this.currentBytes -= entry.size;
            this.cache.delete(toolId);
        }
        if (this.cache.size === 0) {
            this.stopSweepInterval();
        }
    }

    clear(): void {
        this.cache.clear();
        this.currentBytes = 0;
        this.stopSweepInterval();
    }

    getCurrentBytes(): number {
        return this.currentBytes;
    }

    getSize(): number {
        return this.cache.size;
    }

    sweep(): void {
        const now = Date.now();
        for (const [toolId, entry] of this.cache.entries()) {
            if (now > entry.expiresAt) {
                this.delete(toolId);
                this.notifyExpired(toolId);
            } else {
                // Since Map retains insertion / refresh order, earlier entries expire first
                break;
            }
        }
    }

    private startSweepInterval(): void {
        if (!this.sweepInterval) {
            const intervalMs = Math.min(this.ttlMs, 30_000);
            this.sweepInterval = setInterval(() => this.sweep(), intervalMs);
            if (typeof this.sweepInterval === 'object' && 'unref' in this.sweepInterval) {
                (this.sweepInterval as any).unref();
            }
        }
    }

    private stopSweepInterval(): void {
        if (this.sweepInterval) {
            clearInterval(this.sweepInterval);
            this.sweepInterval = null;
        }
    }
}

export const toolOutputCache = new ToolOutputCache();

if (typeof window !== 'undefined') {
    (window as any).toolOutputCache = toolOutputCache;
}

import { describe, it, expect } from 'vitest';
import { moveCursor, removeCursor } from '../src/cursor';

describe('cursor', () => {
    it('handles cursor movement without errors with mock elements', () => {
        const scrollable = {
            scrollTop: 100,
            clientHeight: 200,
            scrollWidth: 200,
            clientWidth: 200,
            scrollLeft: 0,
        };

        const mockLineDiv = {
            isConnected: true,
            children: [
                {
                    textContent: 'const x = 1;',
                    firstChild: { nodeType: 3 },
                    classList: { contains: () => false },
                },
            ],
            parentElement: {
                parentElement: scrollable,
            },
        } as any;

        expect(() => moveCursor(mockLineDiv, 5, true, 1, 20)).not.toThrow();
        // scrollTop adjusted from 100 to 20 because lineTop (1 * 20 = 20) < scrollTop (100)
        expect(scrollable.scrollTop).toBe(20);
    });

    it('handles removeCursor gracefully', () => {
        expect(() => removeCursor()).not.toThrow();
    });
});

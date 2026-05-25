import { describe, it, expect } from 'vitest';
import { DiffRenderer } from '../src/renderer/DiffRenderer';
import { VisualRow } from '../src/renderer/Renderer';

describe('DiffRenderer.insertSeparators', () => {
    it('should add gaps at start and end of file when appropriate', () => {
        const renderer = new DiffRenderer({} as any, {} as any, {} as any, {} as any);
        renderer.setFocusedDiffMode(true);

        // Case 1: Gap at start only (line 0 is hidden, lines 1 and 2 are visible)
        const rows1: VisualRow[] = [
            { kind: 'real', lineIndex: 1 },
            { kind: 'real', lineIndex: 2 },
        ];
        const result1 = renderer.insertSeparators(rows1, 3);
        expect(result1).toEqual([
            { kind: 'separator', hiddenStart: 0, hiddenEnd: 0, hiddenCount: 1 },
            { kind: 'real', lineIndex: 1 },
            { kind: 'real', lineIndex: 2 },
        ]);

        // Case 2: Gap at end only (lines 0 and 1 are visible, line 2 is hidden)
        const rows2: VisualRow[] = [
            { kind: 'real', lineIndex: 0 },
            { kind: 'real', lineIndex: 1 },
        ];
        const result2 = renderer.insertSeparators(rows2, 3);
        expect(result2).toEqual([
            { kind: 'real', lineIndex: 0 },
            { kind: 'real', lineIndex: 1 },
            { kind: 'separator', hiddenStart: 2, hiddenEnd: 2, hiddenCount: 1 },
        ]);

        // Case 3: Gaps at both start and end
        const rows3: VisualRow[] = [
            { kind: 'real', lineIndex: 2 },
            { kind: 'real', lineIndex: 3 },
        ];
        const result3 = renderer.insertSeparators(rows3, 6);
        expect(result3).toEqual([
            { kind: 'separator', hiddenStart: 0, hiddenEnd: 1, hiddenCount: 2 },
            { kind: 'real', lineIndex: 2 },
            { kind: 'real', lineIndex: 3 },
            { kind: 'separator', hiddenStart: 4, hiddenEnd: 5, hiddenCount: 2 },
        ]);

        // Case 4: No gaps (first and last lines are visible)
        const rows4: VisualRow[] = [
            { kind: 'real', lineIndex: 0 },
            { kind: 'real', lineIndex: 1 },
            { kind: 'real', lineIndex: 2 },
        ];
        const result4 = renderer.insertSeparators(rows4, 3);
        expect(result4).toEqual([
            { kind: 'real', lineIndex: 0 },
            { kind: 'real', lineIndex: 1 },
            { kind: 'real', lineIndex: 2 },
        ]);

        // Case 5: Empty file
        const rows5: VisualRow[] = [];
        const result5 = renderer.insertSeparators(rows5, 0);
        expect(result5).toEqual([]);

        // Case 6: Entire file hidden
        const rows6: VisualRow[] = [];
        const result6 = renderer.insertSeparators(rows6, 5);
        expect(result6).toEqual([
            { kind: 'separator', hiddenStart: 0, hiddenEnd: 4, hiddenCount: 5 },
        ]);

        // Case 7: Only ghost rows in input (entire file is hidden, but ghost rows exist)
        const rows7: VisualRow[] = [
            { kind: 'ghost', hunkId: 0, anchorLine: 1, originalLineIndex: 0 },
        ];
        const result7 = renderer.insertSeparators(rows7, 3);
        expect(result7).toEqual([
            { kind: 'ghost', hunkId: 0, anchorLine: 1, originalLineIndex: 0 },
            { kind: 'separator', hiddenStart: 0, hiddenEnd: 2, hiddenCount: 3 },
        ]);

        // Case 8: Gaps hidden by fold
        const rows8: VisualRow[] = [
            { kind: 'real', lineIndex: 0 },
            { kind: 'real', lineIndex: 4 },
        ];
        // Suppose lines 1, 2, 3 are hidden by fold
        const isHiddenByFold = (lineIndex: number) => lineIndex >= 1 && lineIndex <= 3;
        const result8 = renderer.insertSeparators(rows8, 5, isHiddenByFold);
        expect(result8).toEqual([
            { kind: 'real', lineIndex: 0 },
            { kind: 'real', lineIndex: 4 },
        ]);

        // Case 9: Gaps when folding is disabled (predicate returns false or is not passed)
        const result9 = renderer.insertSeparators(rows8, 5);
        expect(result9).toEqual([
            { kind: 'real', lineIndex: 0 },
            { kind: 'separator', hiddenStart: 1, hiddenEnd: 3, hiddenCount: 3 },
            { kind: 'real', lineIndex: 4 },
        ]);
    });
});


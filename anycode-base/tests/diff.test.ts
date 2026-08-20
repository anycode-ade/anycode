import { describe, it, expect } from 'vitest';
import { computeGitChanges, computeGitChangesWithStats, computeGitChangesFromSource } from '../src/diff';

describe('computeGitChanges', () => {
    it('returns exact added and removed line counts from diff blocks', () => {
        const result = computeGitChangesWithStats(
            'line1\nold\nline3',
            'line1\nnew1\nnew2\nline3\nnew4',
        );

        expect(result.added).toBe(3);
        expect(result.removed).toBe(1);
        expect(result.diffs.get(2)).toEqual({
            changeType: 'modified',
            oldLineNumbers: [2],
            hunkId: 0,
        });
    });

    it('should handle simple addition', () => {
        const original = 'line1\nline2';
        const current = 'line1\nadded\nline2';
        const result = computeGitChanges(original, current);

        expect(result.get(2)).toEqual({
            changeType: 'added',
            hunkId: 0
        });
    });

    it('should handle simple deletion', () => {
        const original = 'line1\nline2\nline3';
        const current = 'line1\nline3';
        const result = computeGitChanges(original, current);

        expect(result.get(2)).toEqual({
            changeType: 'deleted',
            oldLineNumbers: [2],
            ghostAnchorLine: 2,
            hunkId: 0
        });
    });

    it('should handle modification', () => {
        const original = 'line1\nold\nline3';
        const current = 'line1\nnew\nline3';
        const result = computeGitChanges(original, current);

        expect(result.get(2)).toEqual({
            changeType: 'modified',
            oldLineNumbers: [2],
            hunkId: 0
        });
    });

    it('should handle multiple consecutive additions', () => {
        const original = 'line1\nline2';
        const current = 'line1\nadded1\nadded2\nline2';
        const result = computeGitChanges(original, current);

        expect(result.get(2)).toEqual({ changeType: 'added', hunkId: 0 });
        expect(result.get(3)).toEqual({ changeType: 'added', hunkId: 0 });
    });

    it('should handle separate hunks', () => {
        const original = '1\n2\n3\n4\n5\n6\n7';
        const current = '1\n2\nadded2.5\n3\n4\n5\n6\nadded6.5\n7';
        const result = computeGitChanges(original, current);

        expect(result.get(3)).toEqual({ changeType: 'added', hunkId: 0 });
        expect(result.get(8)).toEqual({ changeType: 'added', hunkId: 1 });
    });

    it('should handle deletion at the very beginning of the file', () => {
        const original = 'line1\nline2\nline3';
        const current = 'line2\nline3';
        const result = computeGitChanges(original, current);

        expect(result.get(1)).toEqual({
            changeType: 'deleted',
            oldLineNumbers: [1],
            ghostAnchorLine: 1,
            hunkId: 0,
        });
    });

    it('should handle deletion at the end of the file', () => {
        const original = 'line1\nline2\n';
        const current = 'line1\n';
        const result = computeGitChanges(original, current);

        expect(result.get(2)).toEqual({
            changeType: 'deleted',
            oldLineNumbers: [2],
            ghostAnchorLine: 2,
            hunkId: 0,
        });
    });

    it('should handle empty to empty string diff', () => {
        const result = computeGitChanges('', '');
        expect(result.size).toBe(0);
    });

    it('should mark blank lines as added when diffing a new file from Code lines', () => {
        const result = computeGitChanges([''], [
            '.settings-panel {',
            '    display: flex;',
            '',
            '}',
            '',
            '.settings-section {',
        ]);

        expect(result.get(1)).toEqual({ changeType: 'added', hunkId: 0 });
        expect(result.get(2)).toEqual({ changeType: 'added', hunkId: 0 });
        expect(result.get(3)).toEqual({ changeType: 'added', hunkId: 0 });
        expect(result.get(4)).toEqual({ changeType: 'added', hunkId: 0 });
        expect(result.get(5)).toEqual({ changeType: 'added', hunkId: 0 });
        expect(result.get(6)).toEqual({ changeType: 'added', hunkId: 0 });
    });

    it('should handle complete replacement of content', () => {
        const original = 'oldContent';
        const current = 'newContent';
        const result = computeGitChanges(original, current);

        expect(result.get(1)).toEqual({
            changeType: 'modified',
            oldLineNumbers: [1],
            hunkId: 0,
        });
    });

    it('should handle carriage returns and mixed newlines', () => {
        const original = 'line1\r\nline2\r\n';
        const current = 'line1\r\nadded\r\nline2\r\n';
        const result = computeGitChanges(original, current);

        expect(result.get(2)).toEqual({
            changeType: 'added',
            hunkId: 0,
        });
    });

    it('should compute diff on 1,000,000 identical lines in less than 50ms', () => {
        const lines = new Array(1000000).fill('const x = 1;');
        const start = performance.now();
        const result = computeGitChangesWithStats(lines, lines);
        const duration = performance.now() - start;

        expect(result.diffs.size).toBe(0);
        expect(result.added).toBe(0);
        expect(result.removed).toBe(0);
        expect(duration).toBeLessThan(50);
    });

    it('should compute diff on 1,000,000 lines with middle modification in less than 50ms', () => {
        const original = new Array(1000000).fill('const x = 1;');
        const current = original.slice();
        current[500000] = 'const x = 2;';

        const start = performance.now();
        const result = computeGitChangesWithStats(original, current);
        const duration = performance.now() - start;

        expect(result.diffs.size).toBe(1);
        expect(result.diffs.get(500001)?.changeType).toBe('modified');
        expect(duration).toBeLessThan(50);
    });

    it('should compute diff with dirtyRange on 1,000,000 lines in less than 5ms', () => {
        const lineContent = 'const x = 1;';
        const modifiedContent = 'const x = 2;';
        const origSource = {
            linesLength: () => 1000000,
            lineLength: (i: number) => 12,
            line: (i: number) => lineContent,
        };
        const currSource = {
            linesLength: () => 1000000,
            lineLength: (i: number) => 12,
            line: (i: number) => i === 500000 ? modifiedContent : lineContent,
        };

        const start = performance.now();
        const result = computeGitChangesFromSource(origSource, currSource, { start: 500000, end: 500000 });
        const duration = performance.now() - start;

        expect(result.diffs.size).toBe(1);
        expect(result.diffs.get(500001)?.changeType).toBe('modified');
        expect(duration).toBeLessThan(5);
    });
});

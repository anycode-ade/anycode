import { describe, it, expect } from 'vitest';
import { computeGitChanges } from '../src/diff';

describe('computeGitChanges', () => {
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

    it('should handle complete deletion of file content', () => {
        const original = 'line1\nline2\n';
        const current = '';
        const result = computeGitChanges(original, current);

        expect(result.get(1)).toEqual({
            changeType: 'deleted',
            oldLineNumbers: [1, 2, 3],
            ghostAnchorLine: 1,
            hunkId: 0,
        });
    });
});

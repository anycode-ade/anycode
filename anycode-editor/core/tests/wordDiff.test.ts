import { describe, expect, it } from 'vitest';
import { computeWordDiffRanges, sameTextRanges, type TextRange } from '../src/wordDiff';

const slices = (text: string, ranges: TextRange[] | undefined) =>
    ranges?.map(({ start, end }) => text.slice(start, end));

describe('computeWordDiffRanges', () => {
    it('highlights only changed words and punctuation on both sides of a similar replacement', () => {
        const oldText = 'let total = calculateSum(a, b)';
        const newText = 'let total = calculateTotal(a, b, c)';

        const result = computeWordDiffRanges(oldText, newText);

        expect(slices(newText, result?.newRanges)).toEqual(['calculateTotal', ', c']);
        expect(slices(oldText, result?.oldRanges)).toEqual(['calculateSum']);
    });

    it('reports old ranges for a pure deletion inside the line', () => {
        const oldText = 'foo(a, b)';
        const newText = 'foo(a)';

        const result = computeWordDiffRanges(oldText, newText);

        expect(result?.newRanges).toBeUndefined();
        expect(slices(oldText, result?.oldRanges)).toEqual([', b']);
    });

    it('returns UTF-16 offsets for Cyrillic text after a supplementary character', () => {
        const oldText = '🙂 Привет, дорогой друг!';
        const newText = '🙂 Привет, любимый друг!';

        const result = computeWordDiffRanges(oldText, newText);

        expect(slices(newText, result?.newRanges)).toEqual(['любимый']);
        expect(slices(oldText, result?.oldRanges)).toEqual(['дорогой']);
    });

    it('suppresses word highlights when the lines are mostly unrelated', () => {
        const result = computeWordDiffRanges(
            'let greeting = "Привет, мир! Как твои дела сегодня?"',
            'let title = "Welcome to the AnyDiff application!"',
        );

        expect(result).toBeUndefined();
    });

    it('highlights whitespace-only and empty-line changes', () => {
        expect(computeWordDiffRanges('', '    ')).toEqual({ newRanges: [{ start: 0, end: 4 }] });
        expect(computeWordDiffRanges('  ', '    ')?.newRanges).toEqual([{ start: 2, end: 4 }]);
        expect(computeWordDiffRanges('\t', '    ')).toEqual({
            oldRanges: [{ start: 0, end: 1 }],
            newRanges: [{ start: 0, end: 4 }],
        });
    });

    it('skips lines beyond the bounded word-diff input size', () => {
        expect(computeWordDiffRanges(`${'a'.repeat(512)}x`, `${'a'.repeat(512)}y`)).toBeUndefined();
    });

    it('skips lines that exceed the word-token limit', () => {
        const oldText = Array.from({ length: 101 }, (_, index) => `w${index}`).join(' ');
        const newText = oldText.replace('w50', 'changed');

        expect(computeWordDiffRanges(oldText, newText)).toBeUndefined();
    });

    it('skips high-token-pair changes', () => {
        const words = Array.from({ length: 100 }, (_, index) => `w${index}`);
        const oldText = words.join(' ');
        const newText = [...words.slice(1), words[0]].join(' ');

        expect(computeWordDiffRanges(oldText, newText)).toBeUndefined();
    });
});

describe('sameTextRanges', () => {
    it('treats missing and empty ranges as equal and compares values', () => {
        const ranges = [{ start: 1, end: 3 }];
        expect(sameTextRanges(undefined, undefined)).toBe(true);
        expect(sameTextRanges(undefined, [])).toBe(true);
        expect(sameTextRanges(ranges, ranges)).toBe(true);
        expect(sameTextRanges(ranges, [{ start: 1, end: 3 }])).toBe(true);
        expect(sameTextRanges(ranges, [{ start: 1, end: 4 }])).toBe(false);
        expect(sameTextRanges(ranges, undefined)).toBe(false);
    });
});

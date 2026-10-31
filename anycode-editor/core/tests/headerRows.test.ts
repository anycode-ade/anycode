import { describe, expect, it } from 'vitest';
import type { VisualSegment } from '../src/renderer/Renderer';
import { insertHeaderPads } from '../src/renderer/headerRows';

const real = (startLine: number, count: number, startVisualIndex: number): VisualSegment =>
    ({ kind: 'real', startLine, count, startVisualIndex });

describe('insertHeaderPads', () => {
    it('gives each header a pad row directly after its own row', () => {
        const result = insertHeaderPads([real(0, 5, 0)], { lines: [0, 3], rows: 2 });

        expect(result.totalRows).toBe(7);
        expect(result.segments).toEqual([
            real(0, 1, 0),
            { kind: 'headerPad', headerLine: 0, padCount: 1, startVisualIndex: 1 },
            real(1, 2, 2),
            real(3, 1, 4),
            { kind: 'headerPad', headerLine: 3, padCount: 1, startVisualIndex: 5 },
            real(4, 1, 6),
        ]);
    });

    it('reserves rows-1 pad rows per header', () => {
        const result = insertHeaderPads([real(0, 2, 0)], { lines: [0], rows: 3 });

        expect(result.totalRows).toBe(4);
        expect(result.segments).toEqual([
            real(0, 1, 0),
            { kind: 'headerPad', headerLine: 0, padCount: 2, startVisualIndex: 1 },
            real(1, 1, 3),
        ]);
    });

    it('handles consecutive headers with no body rows between them', () => {
        const result = insertHeaderPads([real(0, 3, 0)], { lines: [0, 1], rows: 2 });

        expect(result.totalRows).toBe(5);
        expect(result.segments).toEqual([
            real(0, 1, 0),
            { kind: 'headerPad', headerLine: 0, padCount: 1, startVisualIndex: 1 },
            real(1, 1, 2),
            { kind: 'headerPad', headerLine: 1, padCount: 1, startVisualIndex: 3 },
            real(2, 1, 4),
        ]);
    });

    it('shifts ghost and separator segments by the pad rows before them', () => {
        const ghost: VisualSegment = {
            kind: 'ghost', hunkId: 7, anchorLine: 2, oldLineNumbers: [10, 11], ghostCount: 2, startVisualIndex: 2,
        };
        const separator: VisualSegment = { kind: 'separator', hiddenStart: 5, hiddenEnd: 9, startVisualIndex: 6 };
        const result = insertHeaderPads(
            [real(0, 2, 0), ghost, real(2, 2, 4), separator],
            { lines: [0], rows: 2 },
        );

        expect(result.segments).toEqual([
            real(0, 1, 0),
            { kind: 'headerPad', headerLine: 0, padCount: 1, startVisualIndex: 1 },
            real(1, 1, 2),
            { ...ghost, startVisualIndex: 3 },
            real(2, 2, 5),
            { ...separator, startVisualIndex: 7 },
        ]);
        expect(result.totalRows).toBe(8);
    });

    it('adds no pad segments for single-row headers', () => {
        const result = insertHeaderPads([real(0, 4, 0)], { lines: [0, 2], rows: 1 });

        expect(result.totalRows).toBe(4);
        expect(result.segments.some((seg) => seg.kind === 'headerPad')).toBe(false);
    });

    it('leaves a segment without headers as one segment', () => {
        const result = insertHeaderPads([real(10, 3, 0)], { lines: [0, 50], rows: 2 });

        expect(result.totalRows).toBe(3);
        expect(result.segments).toEqual([real(10, 3, 0)]);
    });
});

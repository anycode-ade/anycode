import type { HeaderLayout } from '../code';
import type { VisualSegment } from './Renderer';

/**
 * Reserves the pad rows that follow each multi-row header.
 *
 * A header keeps its own visual row (the `real` row for its line) and the
 * `layout.rows - 1` rows after it become a `headerPad` segment. Pad rows have
 * no DOM of their own: the header element is sized to cover them, so scroll
 * math stays `visualIndex * lineHeight`.
 *
 * Real segments are split around header lines. Other segments keep their
 * shape and only have `startVisualIndex` recomputed.
 */
export function insertHeaderPads(
    segments: readonly VisualSegment[],
    layout: HeaderLayout,
): { segments: VisualSegment[]; totalRows: number } {
    const padCount = layout.rows - 1;
    const out: VisualSegment[] = [];
    let visualCursor = 0;
    let headerCursor = 0;

    const pushReal = (startLine: number, count: number) => {
        out.push({ kind: 'real', startLine, count, startVisualIndex: visualCursor });
        visualCursor += count;
    };

    for (const segment of segments) {
        if (segment.kind !== 'real') {
            out.push({ ...segment, startVisualIndex: visualCursor });
            visualCursor += segment.kind === 'ghost' ? segment.ghostCount : 1;
            continue;
        }

        const end = segment.startLine + segment.count;
        let start = segment.startLine;
        while (headerCursor < layout.lines.length && layout.lines[headerCursor] < start) {
            headerCursor++;
        }
        while (headerCursor < layout.lines.length && layout.lines[headerCursor] < end) {
            const headerLine = layout.lines[headerCursor++];
            if (headerLine > start) pushReal(start, headerLine - start);
            pushReal(headerLine, 1);
            if (padCount > 0) {
                out.push({ kind: 'headerPad', headerLine, padCount, startVisualIndex: visualCursor });
                visualCursor += padCount;
            }
            start = headerLine + 1;
        }
        if (start < end) pushReal(start, end - start);
    }

    return { segments: out, totalRows: visualCursor };
}

import { DiffHunk, DiffModel } from './diff';

export interface ParsedDiffFile {
    id: string;
    path: string;
    oldPath?: string;
    status: 'modified' | 'added' | 'deleted' | 'renamed';
    added: number;
    removed: number;
    newLines: string[];
    oldLines: string[];
    newLineNumbers: (number | undefined)[];
    oldLineNumbers: (number | undefined)[];
    diffs: DiffModel;
}

export type DiffFile = ParsedDiffFile;

export function ensureDiffModel(file: any): DiffModel {
    if (file.diffs instanceof DiffModel) {
        return file.diffs;
    }
    const hunks = file.diffHunks || file.diffs?.hunks || [];
    const model = new DiffModel(hunks, file.added || 0, file.removed || 0);
    file.diffs = model;
    return model;
}

interface RawDiffHunkItem {
    kind: 'context' | 'added' | 'removed';
    text: string;
    oldLine?: number;
    newLine?: number;
}

function unquoteGitPath(path: string): string {
    const trimmed = path.trim();
    if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
        try {
            return JSON.parse(trimmed);
        } catch {
            return trimmed.slice(1, -1);
        }
    }
    return trimmed;
}

function parseHunkHeader(
    raw: string,
    start: number,
    end: number,
): { oldLine: number; oldCount: number; newLine: number; newCount: number } | null {
    // Format: @@ -oldStart[,oldCount] +newStart[,newCount] @@
    if (!raw.startsWith('@@ -', start)) return null;
    let pos = start + 4; // after '@@ -'

    let oldLine = 0;
    while (pos < end && raw.charCodeAt(pos) >= 48 && raw.charCodeAt(pos) <= 57) {
        oldLine = oldLine * 10 + (raw.charCodeAt(pos) - 48);
        pos++;
    }

    let oldCount = 1;
    if (pos < end && raw.charCodeAt(pos) === 44) { // ','
        pos++;
        oldCount = 0;
        while (pos < end && raw.charCodeAt(pos) >= 48 && raw.charCodeAt(pos) <= 57) {
            oldCount = oldCount * 10 + (raw.charCodeAt(pos) - 48);
            pos++;
        }
    }

    while (pos < end && raw.charCodeAt(pos) !== 43) { // '+'
        pos++;
    }
    if (pos >= end || raw.charCodeAt(pos) !== 43) return null;
    pos++; // after '+'

    let newLine = 0;
    while (pos < end && raw.charCodeAt(pos) >= 48 && raw.charCodeAt(pos) <= 57) {
        newLine = newLine * 10 + (raw.charCodeAt(pos) - 48);
        pos++;
    }

    let newCount = 1;
    if (pos < end && raw.charCodeAt(pos) === 44) { // ','
        pos++;
        newCount = 0;
        while (pos < end && raw.charCodeAt(pos) >= 48 && raw.charCodeAt(pos) <= 57) {
            newCount = newCount * 10 + (raw.charCodeAt(pos) - 48);
            pos++;
        }
    }

    return { oldLine, oldCount, newLine, newCount };
}

function extractGitHeaderPaths(line: string): { oldPath: string; newPath: string } {
    const trimmed = line.trim();
    if (trimmed.startsWith('"')) {
        const firstEndQuote = trimmed.indexOf('"', 1);
        if (firstEndQuote !== -1) {
            const oldPart = trimmed.substring(1, firstEndQuote);
            const remainder = trimmed.substring(firstEndQuote + 1).trim();
            if (remainder.startsWith('"') && remainder.endsWith('"')) {
                const newPart = remainder.substring(1, remainder.length - 1);
                return {
                    oldPath: oldPart.startsWith('a/') ? oldPart.substring(2) : oldPart,
                    newPath: newPart.startsWith('b/') ? newPart.substring(2) : newPart,
                };
            }
        }
    }

    const bIdx = trimmed.lastIndexOf(' b/');
    if (bIdx !== -1 && trimmed.startsWith('a/')) {
        return {
            oldPath: trimmed.substring(2, bIdx),
            newPath: trimmed.substring(bIdx + 3),
        };
    }

    return { oldPath: '', newPath: '' };
}

/**
 * Fast unified diff parser using index cursor scanning without rawDiff.split() or RegExp allocations.
 */
export function parseUnifiedDiff(rawDiff: string): ParsedDiffFile[] {
    if (!rawDiff || !rawDiff.trim()) return [];

    const len = rawDiff.length;
    const files: ParsedDiffFile[] = [];

    let lineStart = 0;

    const getLineEnd = (start: number): number => {
        const next = rawDiff.indexOf('\n', start);
        return next === -1 ? len : next;
    };

    const getLineText = (start: number, end: number): string => {
        let actualEnd = end;
        if (actualEnd > start && rawDiff.charCodeAt(actualEnd - 1) === 13) { // '\r'
            actualEnd--;
        }
        return rawDiff.substring(start, actualEnd);
    };

    while (lineStart < len) {
        const lineEnd = getLineEnd(lineStart);

        if (!rawDiff.startsWith('diff --git ', lineStart)) {
            lineStart = lineEnd < len ? lineEnd + 1 : len;
            continue;
        }

        // Header line: diff --git a/... b/...
        const headerText = getLineText(lineStart + 11, lineEnd);
        const { oldPath: headerOld, newPath: headerNew } = extractGitHeaderPaths(headerText);
        let oldPath = headerOld;
        let newPath = headerNew;
        let status: 'modified' | 'added' | 'deleted' | 'renamed' = 'modified';

        lineStart = lineEnd < len ? lineEnd + 1 : len;

        // Read file metadata headers (new file mode, deleted file mode, rename from/to, ---, +++)
        while (lineStart < len && !rawDiff.startsWith('diff --git ', lineStart) && !rawDiff.startsWith('@@ ', lineStart)) {
            const metaEnd = getLineEnd(lineStart);
            if (rawDiff.startsWith('new file mode ', lineStart)) {
                status = 'added';
            } else if (rawDiff.startsWith('deleted file mode ', lineStart)) {
                status = 'deleted';
            } else if (rawDiff.startsWith('rename from ', lineStart)) {
                status = 'renamed';
                oldPath = unquoteGitPath(getLineText(lineStart + 12, metaEnd));
            } else if (rawDiff.startsWith('rename to ', lineStart)) {
                status = 'renamed';
                newPath = unquoteGitPath(getLineText(lineStart + 10, metaEnd));
            } else if (rawDiff.startsWith('--- a/', lineStart)) {
                oldPath = unquoteGitPath(getLineText(lineStart + 6, metaEnd));
            } else if (rawDiff.startsWith('--- /dev/null', lineStart)) {
                status = 'added';
            } else if (rawDiff.startsWith('+++ b/', lineStart)) {
                newPath = unquoteGitPath(getLineText(lineStart + 6, metaEnd));
            } else if (rawDiff.startsWith('+++ /dev/null', lineStart)) {
                status = 'deleted';
            }
            lineStart = metaEnd < len ? metaEnd + 1 : len;
        }

        const filePath = status === 'deleted' ? (oldPath || newPath) : (newPath || oldPath);
        if (!filePath) continue;

        // Parse hunks
        const rawHunks: RawDiffHunkItem[][] = [];
        let totalAdded = 0;
        let totalRemoved = 0;

        while (lineStart < len && !rawDiff.startsWith('diff --git ', lineStart)) {
            const hunkLineEnd = getLineEnd(lineStart);
            if (!rawDiff.startsWith('@@ ', lineStart)) {
                lineStart = hunkLineEnd < len ? hunkLineEnd + 1 : len;
                continue;
            }

            const parsedHunkHeader = parseHunkHeader(rawDiff, lineStart, hunkLineEnd);
            if (!parsedHunkHeader) {
                lineStart = hunkLineEnd < len ? hunkLineEnd + 1 : len;
                continue;
            }

            const { oldCount, newCount, oldLine: startOldLine, newLine: startNewLine } = parsedHunkHeader;
            let oldLineNum = startOldLine;
            let newLineNum = startNewLine;
            let parsedOld = 0;
            let parsedNew = 0;

            lineStart = hunkLineEnd < len ? hunkLineEnd + 1 : len;

            const currentHunkItems: RawDiffHunkItem[] = [];

            while (lineStart < len && !rawDiff.startsWith('diff --git ', lineStart) && !rawDiff.startsWith('@@ ', lineStart)) {
                if (parsedOld >= oldCount && parsedNew >= newCount) {
                    break;
                }

                const itemEnd = getLineEnd(lineStart);
                if (rawDiff.startsWith('\\ No newline at end of file', lineStart)) {
                    lineStart = itemEnd < len ? itemEnd + 1 : len;
                    continue;
                }

                const firstChar = rawDiff.charCodeAt(lineStart);

                if (firstChar === 43) { // '+'
                    totalAdded++;
                    parsedNew++;
                    currentHunkItems.push({
                        kind: 'added',
                        text: getLineText(lineStart + 1, itemEnd),
                        newLine: newLineNum++,
                    });
                } else if (firstChar === 45) { // '-'
                    totalRemoved++;
                    parsedOld++;
                    currentHunkItems.push({
                        kind: 'removed',
                        text: getLineText(lineStart + 1, itemEnd),
                        oldLine: oldLineNum++,
                    });
                } else if (firstChar === 32) { // ' '
                    parsedOld++;
                    parsedNew++;
                    currentHunkItems.push({
                        kind: 'context',
                        text: getLineText(lineStart + 1, itemEnd),
                        oldLine: oldLineNum++,
                        newLine: newLineNum++,
                    });
                } else if (lineStart === itemEnd || (lineStart + 1 === itemEnd && rawDiff.charCodeAt(lineStart) === 13)) {
                    // Empty line inside hunk
                    parsedOld++;
                    parsedNew++;
                    currentHunkItems.push({
                        kind: 'context',
                        text: '',
                        oldLine: oldLineNum++,
                        newLine: newLineNum++,
                    });
                } else {
                    // Unexpected line inside hunk, break hunk
                    break;
                }

                lineStart = itemEnd < len ? itemEnd + 1 : len;
            }

            if (currentHunkItems.length > 0) {
                rawHunks.push(currentHunkItems);
            }
        }

        // Build newLines, oldLines, newLineNumbers, oldLineNumbers, and DiffHunk[]
        const newLines: string[] = [];
        const oldLines: string[] = [];
        const newLineNumbers: (number | undefined)[] = [];
        const oldLineNumbers: (number | undefined)[] = [];
        const diffHunks: DiffHunk[] = [];

        let currentHunkId = 1;

        for (const hunk of rawHunks) {
            let hunkIndex = 0;
            while (hunkIndex < hunk.length) {
                const item = hunk[hunkIndex];

                if (item.kind === 'context') {
                    newLines.push(item.text);
                    oldLines.push(item.text);
                    newLineNumbers.push(item.newLine);
                    oldLineNumbers.push(item.oldLine);
                    hunkIndex++;
                    continue;
                }

                const removedItems: RawDiffHunkItem[] = [];
                const addedItems: RawDiffHunkItem[] = [];

                while (hunkIndex < hunk.length && (hunk[hunkIndex].kind === 'removed' || hunk[hunkIndex].kind === 'added')) {
                    if (hunk[hunkIndex].kind === 'removed') {
                        removedItems.push(hunk[hunkIndex]);
                    } else {
                        addedItems.push(hunk[hunkIndex]);
                    }
                    hunkIndex++;
                }

                const hunkId = currentHunkId++;

                if (removedItems.length > 0 && addedItems.length > 0) {
                    // Modified
                    const startLine = newLines.length + 1;
                    const oldLineIndices: number[] = [];

                    for (const rem of removedItems) {
                        oldLines.push(rem.text);
                        oldLineNumbers.push(rem.oldLine);
                        oldLineIndices.push(oldLines.length);
                    }

                    for (const add of addedItems) {
                        newLines.push(add.text);
                        newLineNumbers.push(add.newLine);
                    }

                    diffHunks.push({
                        hunkId,
                        startLine,
                        lineCount: addedItems.length,
                        changeType: 'modified',
                        oldLineNumbers: oldLineIndices,
                        ghostAnchorLine: startLine,
                    });
                } else if (addedItems.length > 0) {
                    // Added
                    const startLine = newLines.length + 1;
                    for (const add of addedItems) {
                        newLines.push(add.text);
                        newLineNumbers.push(add.newLine);
                    }

                    diffHunks.push({
                        hunkId,
                        startLine,
                        lineCount: addedItems.length,
                        changeType: 'added',
                    });
                } else if (removedItems.length > 0) {
                    // Deleted (Ghost lines)
                    const oldLineIndices: number[] = [];
                    for (const rem of removedItems) {
                        oldLines.push(rem.text);
                        oldLineNumbers.push(rem.oldLine);
                        oldLineIndices.push(oldLines.length);
                    }

                    const anchorLine = Math.max(1, newLines.length);

                    diffHunks.push({
                        hunkId,
                        startLine: anchorLine,
                        lineCount: 0,
                        changeType: 'deleted',
                        oldLineNumbers: oldLineIndices,
                        ghostAnchorLine: anchorLine,
                    });
                }
            }
        }

        diffHunks.sort((a, b) => a.startLine - b.startLine);

        files.push({
            id: filePath,
            path: filePath,
            oldPath: status === 'renamed' ? oldPath : undefined,
            status,
            added: totalAdded,
            removed: totalRemoved,
            newLines,
            oldLines,
            newLineNumbers,
            oldLineNumbers,
            diffs: new DiffModel(diffHunks, totalAdded, totalRemoved),
        });
    }

    return files;
}

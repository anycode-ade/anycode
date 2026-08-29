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

interface RawDiffHunkItem {
    kind: 'context' | 'added' | 'removed';
    text: string;
    oldLine?: number;
    newLine?: number;
}

/**
 * Parses raw unified diff string (e.g. from `git diff` or `git show`) into structured ParsedDiffFile array.
 */
export function parseUnifiedDiff(rawDiff: string): ParsedDiffFile[] {
    if (!rawDiff || !rawDiff.trim()) return [];

    const lines = rawDiff.split(/\r?\n/);
    const files: ParsedDiffFile[] = [];

    let i = 0;
    while (i < lines.length) {
        const line = lines[i];

        if (!line.startsWith('diff --git ')) {
            i++;
            continue;
        }

        // Header line: diff --git a/path/to/file b/path/to/file
        const gitHeaderMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
        let oldPath = gitHeaderMatch ? gitHeaderMatch[1] : '';
        let newPath = gitHeaderMatch ? gitHeaderMatch[2] : '';
        let status: 'modified' | 'added' | 'deleted' | 'renamed' = 'modified';

        i++;
        // Read file metadata headers (new file mode, deleted file mode, rename from/to, similarity, ---, +++)
        while (i < lines.length && !lines[i].startsWith('diff --git ') && !lines[i].startsWith('@@ ')) {
            const meta = lines[i];
            if (meta.startsWith('new file mode ')) {
                status = 'added';
            } else if (meta.startsWith('deleted file mode ')) {
                status = 'deleted';
            } else if (meta.startsWith('rename from ')) {
                status = 'renamed';
                oldPath = meta.substring('rename from '.length).trim();
            } else if (meta.startsWith('rename to ')) {
                status = 'renamed';
                newPath = meta.substring('rename to '.length).trim();
            } else if (meta.startsWith('--- a/')) {
                oldPath = meta.substring('--- a/'.length).trim();
            } else if (meta.startsWith('--- /dev/null')) {
                status = 'added';
            } else if (meta.startsWith('+++ b/')) {
                newPath = meta.substring('+++ b/'.length).trim();
            } else if (meta.startsWith('+++ /dev/null')) {
                status = 'deleted';
            }
            i++;
        }

        const filePath = status === 'deleted' ? (oldPath || newPath) : (newPath || oldPath);
        if (!filePath) continue;

        // Parse hunks
        const rawHunks: RawDiffHunkItem[][] = [];
        let totalAdded = 0;
        let totalRemoved = 0;

        while (i < lines.length && !lines[i].startsWith('diff --git ')) {
            const hunkHeader = lines[i];
            if (!hunkHeader.startsWith('@@ ')) {
                i++;
                continue;
            }

            const hunkMatch = hunkHeader.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
            if (!hunkMatch) {
                i++;
                continue;
            }

            const oldCount = hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1;
            const newCount = hunkMatch[4] !== undefined ? parseInt(hunkMatch[4], 10) : 1;
            let oldLineNum = parseInt(hunkMatch[1], 10);
            let newLineNum = parseInt(hunkMatch[3], 10);
            let parsedOld = 0;
            let parsedNew = 0;
            i++;

            const currentHunkItems: RawDiffHunkItem[] = [];

            while (i < lines.length && !lines[i].startsWith('diff --git ') && !lines[i].startsWith('@@ ')) {
                if (parsedOld >= oldCount && parsedNew >= newCount) {
                    break;
                }

                const hunkLine = lines[i];
                if (hunkLine.startsWith('\\ No newline at end of file')) {
                    i++;
                    continue;
                }

                if (hunkLine.startsWith('+')) {
                    totalAdded++;
                    parsedNew++;
                    currentHunkItems.push({
                        kind: 'added',
                        text: hunkLine.substring(1),
                        newLine: newLineNum++,
                    });
                } else if (hunkLine.startsWith('-')) {
                    totalRemoved++;
                    parsedOld++;
                    currentHunkItems.push({
                        kind: 'removed',
                        text: hunkLine.substring(1),
                        oldLine: oldLineNum++,
                    });
                } else if (hunkLine.startsWith(' ') || (hunkLine === '' && (parsedOld < oldCount || parsedNew < newCount))) {
                    const text = hunkLine.startsWith(' ') ? hunkLine.substring(1) : '';
                    parsedOld++;
                    parsedNew++;
                    currentHunkItems.push({
                        kind: 'context',
                        text,
                        oldLine: oldLineNum++,
                        newLine: newLineNum++,
                    });
                } else {
                    // Unexpected line inside hunk, break hunk parsing
                    break;
                }
                i++;
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

                // Group contiguous modified/added/removed changes
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
                        oldLineIndices.push(oldLines.length); // 1-indexed in oldLines
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
                    // Pure Deleted (Ghost lines)
                    const oldLineIndices: number[] = [];
                    for (const rem of removedItems) {
                        oldLines.push(rem.text);
                        oldLineNumbers.push(rem.oldLine);
                        oldLineIndices.push(oldLines.length);
                    }

                    // For pure deletion, ghostAnchorLine is the line after which ghosts attach
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
            newLineNumbers: newLineNumbers ?? [],
            oldLineNumbers: oldLineNumbers ?? [],
            diffs: new DiffModel(diffHunks, totalAdded, totalRemoved),
        });
    }

    return files;
}

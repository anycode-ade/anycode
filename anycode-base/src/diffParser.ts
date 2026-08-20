import type { DiffInfo } from './diff';

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
    diffs: Map<number, DiffInfo>;
}

const HUNK_REGEX = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(?:.*)?$/;

function cleanDiffPath(rawPath: string): string {
    let p = rawPath.trim();
    if (p.startsWith('a/') || p.startsWith('b/')) {
        p = p.slice(2);
    }
    if (p.startsWith('"') && p.endsWith('"')) {
        p = p.slice(1, -1);
    }
    return p;
}

type RawHunkLine =
    | { kind: 'context'; text: string }
    | { kind: 'added'; text: string }
    | { kind: 'deleted'; text: string };

function processHunk(
    file: ParsedDiffFile,
    hunkId: number,
    startOldLine: number,
    startNewLine: number,
    rawHunkLines: RawHunkLine[]
) {
    let curOldLineNum = startOldLine;
    let curNewLineNum = startNewLine;

    let i = 0;
    while (i < rawHunkLines.length) {
        const item = rawHunkLines[i];

        if (item.kind === 'context') {
            file.newLines.push(item.text);
            file.newLineNumbers.push(curNewLineNum);
            file.oldLines.push(item.text);
            file.oldLineNumbers.push(curOldLineNum);
            curNewLineNum++;
            curOldLineNum++;
            i++;
            continue;
        }

        // Collect consecutive deleted lines
        const deletedItems: string[] = [];
        while (i < rawHunkLines.length && rawHunkLines[i].kind === 'deleted') {
            deletedItems.push(rawHunkLines[i].text);
            i++;
        }

        // Collect consecutive added lines
        const addedItems: string[] = [];
        while (i < rawHunkLines.length && rawHunkLines[i].kind === 'added') {
            addedItems.push(rawHunkLines[i].text);
            i++;
        }

        file.removed += deletedItems.length;
        file.added += addedItems.length;

        // Record deleted lines in oldLines
        const deletedOldLineIndices: number[] = [];
        for (const delText of deletedItems) {
            file.oldLines.push(delText);
            file.oldLineNumbers.push(curOldLineNum);
            deletedOldLineIndices.push(file.oldLines.length); // 1-indexed in oldLines
            curOldLineNum++;
        }

        if (deletedItems.length > 0 && addedItems.length > 0) {
            // Modified block: attach deleted lines to added lines
            for (let a = 0; a < addedItems.length; a++) {
                const addText = addedItems[a];
                file.newLines.push(addText);
                file.newLineNumbers.push(curNewLineNum);
                file.diffs.set(file.newLines.length, {
                    changeType: 'modified',
                    oldLineNumbers: deletedOldLineIndices,
                    hunkId,
                });
                curNewLineNum++;
            }
        } else if (addedItems.length > 0) {
            // Pure addition
            for (const addText of addedItems) {
                file.newLines.push(addText);
                file.newLineNumbers.push(curNewLineNum);
                file.diffs.set(file.newLines.length, {
                    changeType: 'added',
                    hunkId,
                });
                curNewLineNum++;
            }
        } else if (deletedItems.length > 0) {
            // Pure deletion: attach to next line (or anchor if at end)
            const ghostAnchorLine = Math.max(1, file.newLines.length + 1);
            const markerLine = Math.max(1, Math.min(ghostAnchorLine, Math.max(1, file.newLines.length)));
            file.diffs.set(markerLine, {
                changeType: 'deleted',
                oldLineNumbers: deletedOldLineIndices,
                ghostAnchorLine,
                hunkId,
            });
        }
    }
}

/**
 * Fast unified diff parser.
 * Separates new lines (for currentCode) and old lines (for originalCode)
 * and constructs exact DiffInfo diffs with ghost line mapping.
 */
export function parseUnifiedDiff(rawDiff: string): ParsedDiffFile[] {
    if (!rawDiff || rawDiff.trim().length === 0) {
        return [];
    }

    const rawLines = rawDiff.split(/\r?\n/);
    const files: ParsedDiffFile[] = [];

    let currentFile: ParsedDiffFile | null = null;
    let currentHunkId = 0;
    let currentOldStart = 0;
    let currentNewStart = 0;
    let currentHunkLines: RawHunkLine[] = [];

    const flushHunk = () => {
        if (currentFile && currentHunkLines.length > 0) {
            processHunk(
                currentFile,
                currentHunkId,
                currentOldStart,
                currentNewStart,
                currentHunkLines
            );
            currentHunkLines = [];
        }
    };

    for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];

        if (line.startsWith('diff --git ')) {
            flushHunk();
            if (currentFile) {
                files.push(currentFile);
            }
            const parts = line.slice('diff --git '.length).trim().split(' ');
            const rawA = parts[0] ?? '';
            const rawB = parts[1] ?? parts[0] ?? '';
            const pathA = cleanDiffPath(rawA);
            const pathB = cleanDiffPath(rawB);

            currentFile = {
                id: pathB || pathA,
                path: pathB || pathA,
                oldPath: pathA !== pathB ? pathA : undefined,
                status: 'modified',
                added: 0,
                removed: 0,
                newLines: [],
                oldLines: [],
                newLineNumbers: [],
                oldLineNumbers: [],
                diffs: new Map(),
            };
            currentHunkId = 0;
            continue;
        }

        if (!currentFile) {
            continue;
        }

        if (line.startsWith('new file mode')) {
            currentFile.status = 'added';
            continue;
        }
        if (line.startsWith('deleted file mode')) {
            currentFile.status = 'deleted';
            continue;
        }
        if (line.startsWith('similarity index') || line.startsWith('rename from ') || line.startsWith('rename to ')) {
            currentFile.status = 'renamed';
            if (line.startsWith('rename from ')) {
                currentFile.oldPath = line.slice('rename from '.length).trim();
            } else if (line.startsWith('rename to ')) {
                currentFile.path = line.slice('rename to '.length).trim();
                currentFile.id = currentFile.path;
            }
            continue;
        }
        if (line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('index ')) {
            continue;
        }

        const hunkMatch = HUNK_REGEX.exec(line);
        if (hunkMatch) {
            flushHunk();
            currentHunkId += 1;
            currentOldStart = parseInt(hunkMatch[1], 10);
            currentNewStart = parseInt(hunkMatch[3], 10);
            continue;
        }

        if (currentHunkId > 0) {
            if (line.startsWith('+')) {
                currentHunkLines.push({ kind: 'added', text: line.slice(1) });
            } else if (line.startsWith('-')) {
                currentHunkLines.push({ kind: 'deleted', text: line.slice(1) });
            } else if (line.startsWith(' ')) {
                currentHunkLines.push({ kind: 'context', text: line.slice(1) });
            } else if (line.startsWith('\\')) {
                // Ignore "\ No newline at end of file"
                continue;
            }
        }
    }

    flushHunk();
    if (currentFile) {
        files.push(currentFile);
    }

    return files;
}

import * as JsDiff from 'diff';

export enum EditKind {
    Insert = 'insert',
    Delete = 'delete',
}

export type Edit = {
    start: number;
    end: number;
    text: string;
    kind: EditKind;
};

export type ChangeType = 'added' | 'modified' | 'deleted';

export type DiffInfo = {
    changeType: ChangeType;
    oldLineNumbers?: number[];
    ghostAnchorLine?: number;
    hunkId: number;
};

export interface DiffHunk {
    hunkId: number;
    startLine: number;         // 1-indexed in current code (or marker line for deleted)
    lineCount: number;         // number of lines in current code (0 for pure deletion)
    changeType: ChangeType;    // 'added' | 'modified' | 'deleted'
    oldLineNumbers?: number[]; // 1-indexed line numbers from original code (for modified/deleted)
    ghostAnchorLine?: number;  // 1-indexed anchor line for ghost lines
}

export class DiffModel {
    public readonly hunks: readonly DiffHunk[];
    public readonly added: number;
    public readonly removed: number;

    constructor(hunks: readonly DiffHunk[] = [], added: number = 0, removed: number = 0) {
        this.hunks = hunks;
        this.added = added;
        this.removed = removed;
    }

    public static empty(): DiffModel {
        return new DiffModel([], 0, 0);
    }

    public get size(): number {
        let count = 0;
        for (const hunk of this.hunks) {
            count += hunk.changeType === 'deleted' ? 1 : Math.max(1, hunk.lineCount);
        }
        return count;
    }

    public hasChanges(): boolean {
        return this.hunks.length > 0;
    }

    public getHunks(): readonly DiffHunk[] {
        return this.hunks;
    }

    public get(lineNumber: number): DiffInfo | undefined {
        if (this.hunks.length === 0) return undefined;

        let low = 0;
        let high = this.hunks.length - 1;

        while (low <= high) {
            const mid = (low + high) >> 1;
            const hunk = this.hunks[mid];
            const endLine = hunk.startLine + Math.max(1, hunk.lineCount) - 1;

            if (lineNumber < hunk.startLine) {
                high = mid - 1;
            } else if (lineNumber > endLine) {
                low = mid + 1;
            } else {
                if (hunk.changeType === 'added') {
                    return { changeType: 'added', hunkId: hunk.hunkId };
                }
                if (hunk.changeType === 'modified') {
                    return { changeType: 'modified', oldLineNumbers: hunk.oldLineNumbers, hunkId: hunk.hunkId };
                }
                if (hunk.changeType === 'deleted') {
                    return {
                        changeType: 'deleted',
                        oldLineNumbers: hunk.oldLineNumbers,
                        ghostAnchorLine: hunk.ghostAnchorLine,
                        hunkId: hunk.hunkId,
                    };
                }
            }
        }

        return undefined;
    }

    *[Symbol.iterator](): IterableIterator<[number, DiffInfo]> {
        for (const hunk of this.hunks) {
            if (hunk.changeType === 'deleted') {
                yield [hunk.startLine, {
                    changeType: 'deleted',
                    oldLineNumbers: hunk.oldLineNumbers,
                    ghostAnchorLine: hunk.ghostAnchorLine,
                    hunkId: hunk.hunkId,
                }];
            } else {
                const count = Math.max(1, hunk.lineCount);
                for (let i = 0; i < count; i++) {
                    yield [hunk.startLine + i, {
                        changeType: hunk.changeType,
                        oldLineNumbers: hunk.oldLineNumbers,
                        hunkId: hunk.hunkId,
                    }];
                }
            }
        }
    }
}

export type GitChangesResult = {
    diffs: DiffModel;
    added: number;
    removed: number;
};

function splitLines(str: string): string[] {
    if (str === '') {
        return [];
    }
    return str.split(/\r?\n/);
}

function normalizeLines(lines: string[] | string): string[] {
    const normalized = typeof lines === 'string' ? splitLines(lines) : lines;
    return normalized.length === 1 && normalized[0] === '' ? [] : normalized;
}

function buildHunksFromJsDiff(
    diffs: JsDiff.ArrayChange<string>[],
    currentLineCount: number
): { hunks: DiffHunk[]; added: number; removed: number } {
    const hunks: DiffHunk[] = [];
    let oldLine = 1;
    let newLine = 1;
    let hunkId = 0;
    let added = 0;
    let removed = 0;

    for (let i = 0; i < diffs.length; i++) {
        const diff = diffs[i];
        const { added: partAdded, removed: partRemoved } = diff;
        const count = diff.count ?? diff.value.length;

        if (partAdded || partRemoved) {
            if (partRemoved) {
                removed += count;
                const deletedLineNumbers = new Array<number>(count);
                for (let j = 0; j < count; j++) {
                    deletedLineNumbers[j] = oldLine + j;
                }
                oldLine += count;

                const next = diffs[i + 1];
                if (next?.added) {
                    const addedCount = next.count ?? next.value.length;
                    added += addedCount;
                    hunks.push({
                        hunkId: hunkId++,
                        startLine: newLine,
                        lineCount: addedCount,
                        changeType: 'modified',
                        oldLineNumbers: deletedLineNumbers,
                    });
                    newLine += addedCount;
                    i++; // skip the added block
                } else {
                    const ghostAnchorLine = Math.max(1, newLine);
                    const markerLine = Math.max(1, Math.min(ghostAnchorLine, currentLineCount));
                    hunks.push({
                        hunkId: hunkId++,
                        startLine: markerLine,
                        lineCount: 0,
                        changeType: 'deleted',
                        oldLineNumbers: deletedLineNumbers,
                        ghostAnchorLine,
                    });
                }
            } else {
                // Pure addition
                added += count;
                hunks.push({
                    hunkId: hunkId++,
                    startLine: newLine,
                    lineCount: count,
                    changeType: 'added',
                });
                newLine += count;
            }
        } else {
            // Context lines (unchanged)
            oldLine += count;
            newLine += count;
        }
    }

    return { hunks, added, removed };
}

export function computeGitChanges(
    original: string[] | string,
    current: string[] | string
): DiffModel {
    return computeGitChangesWithStats(original, current).diffs;
}

export function computeGitChangesWithStats(
    original: string[] | string,
    current: string[] | string
): GitChangesResult {
    const originalLines = normalizeLines(original);
    const currentLines = normalizeLines(current);

    const origLen = originalLines.length;
    const currLen = currentLines.length;

    // Fast-path: check if identical
    if (origLen === currLen) {
        let identical = true;
        for (let i = 0; i < origLen; i++) {
            if (originalLines[i] !== currentLines[i]) {
                identical = false;
                break;
            }
        }
        if (identical) {
            return { diffs: DiffModel.empty(), added: 0, removed: 0 };
        }
    }

    if (origLen === 0 && currLen === 0) {
        return { diffs: DiffModel.empty(), added: 0, removed: 0 };
    }

    if (origLen === 0) {
        const hunk: DiffHunk = {
            hunkId: 0,
            startLine: 1,
            lineCount: currLen,
            changeType: 'added',
        };
        return { diffs: new DiffModel([hunk], currLen, 0), added: currLen, removed: 0 };
    }

    if (currLen === 0) {
        const deletedLineNumbers = new Array<number>(origLen);
        for (let i = 0; i < origLen; i++) {
            deletedLineNumbers[i] = i + 1;
        }
        const hunk: DiffHunk = {
            hunkId: 0,
            startLine: 1,
            lineCount: 0,
            changeType: 'deleted',
            oldLineNumbers: deletedLineNumbers,
            ghostAnchorLine: 1,
        };
        return { diffs: new DiffModel([hunk], 0, origLen), added: 0, removed: origLen };
    }

    // Common prefix trimming
    let prefix = 0;
    while (prefix < origLen && prefix < currLen && originalLines[prefix] === currentLines[prefix]) {
        prefix++;
    }

    // Common suffix trimming
    let suffix = 0;
    while (
        suffix < (origLen - prefix) &&
        suffix < (currLen - prefix) &&
        originalLines[origLen - 1 - suffix] === currentLines[currLen - 1 - suffix]
    ) {
        suffix++;
    }

    if (prefix === origLen && prefix === currLen) {
        return { diffs: DiffModel.empty(), added: 0, removed: 0 };
    }

    const trimmedOrigLen = origLen - prefix - suffix;
    const trimmedCurrLen = currLen - prefix - suffix;

    if (trimmedOrigLen === 0 && trimmedCurrLen > 0) {
        const hunk: DiffHunk = {
            hunkId: 0,
            startLine: prefix + 1,
            lineCount: trimmedCurrLen,
            changeType: 'added',
        };
        return { diffs: new DiffModel([hunk], trimmedCurrLen, 0), added: trimmedCurrLen, removed: 0 };
    }

    if (trimmedCurrLen === 0 && trimmedOrigLen > 0) {
        const deletedLineNumbers = new Array<number>(trimmedOrigLen);
        for (let j = 0; j < trimmedOrigLen; j++) {
            deletedLineNumbers[j] = prefix + 1 + j;
        }
        const ghostAnchorLine = Math.max(1, prefix + 1);
        const markerLine = Math.max(1, Math.min(ghostAnchorLine, currLen === 0 ? 1 : currLen));
        const hunk: DiffHunk = {
            hunkId: 0,
            startLine: markerLine,
            lineCount: 0,
            changeType: 'deleted',
            oldLineNumbers: deletedLineNumbers,
            ghostAnchorLine,
        };
        return { diffs: new DiffModel([hunk], 0, trimmedOrigLen), added: 0, removed: trimmedOrigLen };
    }

    const trimmedOriginal = originalLines.slice(prefix, origLen - suffix);
    const trimmedCurrent = currentLines.slice(prefix, currLen - suffix);

    const rawDiffs = JsDiff.diffArrays(trimmedOriginal, trimmedCurrent);
    const diffs: JsDiff.ArrayChange<string>[] = [];

    if (prefix > 0) {
        diffs.push({ value: [] as string[], count: prefix, added: false, removed: false });
    }
    for (const d of rawDiffs) {
        diffs.push(d);
    }
    if (suffix > 0) {
        diffs.push({ value: [] as string[], count: suffix, added: false, removed: false });
    }

    const currentLineCount = currentLines.length === 0 ? 1 : currentLines.length;
    const result = buildHunksFromJsDiff(diffs, currentLineCount);

    return {
        diffs: new DiffModel(result.hunks, result.added, result.removed),
        added: result.added,
        removed: result.removed,
    };
}

export type LineSource = {
    linesLength(): number;
    lineLength(i: number): number;
    line(i: number): string;
};

function getEffectiveSourceLength(source: LineSource): number {
    const len = source.linesLength();
    if (len === 0) return 0;
    if (len === 1 && source.lineLength(0) === 0) return 0;
    return len;
}

export function computeGitChangesFromSource(
    original: LineSource,
    current: LineSource,
    dirtyRange?: { start: number; end: number } | null
): GitChangesResult {
    const origLen = getEffectiveSourceLength(original);
    const currLen = getEffectiveSourceLength(current);

    if (origLen === 0 && currLen === 0) {
        return { diffs: DiffModel.empty(), added: 0, removed: 0 };
    }

    if (origLen === 0) {
        const hunk: DiffHunk = {
            hunkId: 0,
            startLine: 1,
            lineCount: currLen,
            changeType: 'added',
        };
        return { diffs: new DiffModel([hunk], currLen, 0), added: currLen, removed: 0 };
    }

    if (currLen === 0) {
        const deletedLineNumbers = new Array<number>(origLen);
        for (let i = 0; i < origLen; i++) {
            deletedLineNumbers[i] = i + 1;
        }
        const hunk: DiffHunk = {
            hunkId: 0,
            startLine: 1,
            lineCount: 0,
            changeType: 'deleted',
            oldLineNumbers: deletedLineNumbers,
            ghostAnchorLine: 1,
        };
        return { diffs: new DiffModel([hunk], 0, origLen), added: 0, removed: origLen };
    }

    // Find common prefix (using dirtyRange if available)
    let prefix = 0;
    if (dirtyRange && dirtyRange.start > 0) {
        prefix = Math.max(0, Math.min(origLen, currLen, dirtyRange.start));
    } else {
        while (prefix < origLen && prefix < currLen) {
            if (original.lineLength(prefix) !== current.lineLength(prefix) || original.line(prefix) !== current.line(prefix)) {
                break;
            }
            prefix++;
        }
    }

    // Find common suffix (using dirtyRange if available)
    let suffix = 0;
    if (dirtyRange && dirtyRange.end >= 0) {
        const maxUnchangedSuffix = Math.max(0, currLen - 1 - dirtyRange.end);
        suffix = Math.max(0, Math.min(origLen - prefix, currLen - prefix, maxUnchangedSuffix));
    } else {
        while (suffix < (origLen - prefix) && suffix < (currLen - prefix)) {
            const oIdx = origLen - 1 - suffix;
            const cIdx = currLen - 1 - suffix;
            if (original.lineLength(oIdx) !== current.lineLength(cIdx) || original.line(oIdx) !== current.line(cIdx)) {
                break;
            }
            suffix++;
        }
    }

    if (prefix === origLen && prefix === currLen) {
        return { diffs: DiffModel.empty(), added: 0, removed: 0 };
    }

    const trimmedOrigLen = origLen - prefix - suffix;
    const trimmedCurrLen = currLen - prefix - suffix;

    if (trimmedOrigLen === 0 && trimmedCurrLen > 0) {
        const hunk: DiffHunk = {
            hunkId: 0,
            startLine: prefix + 1,
            lineCount: trimmedCurrLen,
            changeType: 'added',
        };
        return { diffs: new DiffModel([hunk], trimmedCurrLen, 0), added: trimmedCurrLen, removed: 0 };
    }

    if (trimmedCurrLen === 0 && trimmedOrigLen > 0) {
        const deletedLineNumbers = new Array<number>(trimmedOrigLen);
        for (let j = 0; j < trimmedOrigLen; j++) {
            deletedLineNumbers[j] = prefix + 1 + j;
        }
        const ghostAnchorLine = Math.max(1, prefix + 1);
        const markerLine = Math.max(1, Math.min(ghostAnchorLine, currLen === 0 ? 1 : currLen));
        const hunk: DiffHunk = {
            hunkId: 0,
            startLine: markerLine,
            lineCount: 0,
            changeType: 'deleted',
            oldLineNumbers: deletedLineNumbers,
            ghostAnchorLine,
        };
        return { diffs: new DiffModel([hunk], 0, trimmedOrigLen), added: 0, removed: trimmedOrigLen };
    }

    const trimmedOriginal: string[] = [];
    for (let i = prefix; i < origLen - suffix; i++) {
        trimmedOriginal.push(original.line(i));
    }

    const trimmedCurrent: string[] = [];
    for (let i = prefix; i < currLen - suffix; i++) {
        trimmedCurrent.push(current.line(i));
    }

    const rawDiffs = JsDiff.diffArrays(trimmedOriginal, trimmedCurrent);
    const diffs: JsDiff.ArrayChange<string>[] = [];

    if (prefix > 0) {
        diffs.push({ value: [] as string[], count: prefix, added: false, removed: false });
    }
    for (const d of rawDiffs) {
        diffs.push(d);
    }
    if (suffix > 0) {
        diffs.push({ value: [] as string[], count: suffix, added: false, removed: false });
    }

    const currentLineCount = currLen === 0 ? 1 : currLen;
    const result = buildHunksFromJsDiff(diffs, currentLineCount);

    return {
        diffs: new DiffModel(result.hunks, result.added, result.removed),
        added: result.added,
        removed: result.removed,
    };
}

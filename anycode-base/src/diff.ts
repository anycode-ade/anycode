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

export type GitChangesResult = {
    diffs: Map<number, DiffInfo>;
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

export function computeGitChanges(
    original: string[] | string,
    current: string[] | string
): Map<number, DiffInfo> {
    return computeGitChangesWithStats(original, current).diffs;
}

export function computeGitChangesWithStats(
    original: string[] | string,
    current: string[] | string
): GitChangesResult {
    const changes = new Map<number, DiffInfo>();
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
            return { diffs: changes, added: 0, removed: 0 };
        }
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
        return { diffs: changes, added: 0, removed: 0 };
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

    let oldLine = 1;
    let newLine = 1;
    let hunkId = 0;
    let inChangeBlock = false;
    let added = 0;
    let removed = 0;

    for (let i = 0; i < diffs.length; i++) {
        const diff = diffs[i];
        const { added: partAdded, removed: partRemoved } = diff;
        const count = diff.count ?? diff.value.length;

        if (partAdded) added += count;
        if (partRemoved) removed += count;

        if (partAdded || partRemoved) {
            inChangeBlock = true;

            if (partRemoved) {
                const deletedLineNumbers: number[] = [];
                for (let j = 0; j < count; j++) {
                    deletedLineNumbers.push(oldLine + j);
                }
                oldLine += count;

                const next = diffs[i + 1];
                if (next?.added) {
                    const addedCount = next.value.length;
                    added += addedCount;
                    for (let j = 0; j < addedCount; j++) {
                        changes.set(newLine + j, {
                            changeType: 'modified',
                            oldLineNumbers: deletedLineNumbers,
                            hunkId: hunkId,
                        });
                    }
                    newLine += addedCount;
                    i++; // skip the added block
                } else {
                    const ghostAnchorLine = Math.max(1, newLine);
                    const markerLine = Math.max(1, Math.min(ghostAnchorLine, currentLineCount));

                    changes.set(markerLine, {
                        changeType: 'deleted',
                        oldLineNumbers: deletedLineNumbers,
                        ghostAnchorLine,
                        hunkId: hunkId,
                    });
                }
            } else {
                // Pure addition
                for (let j = 0; j < count; j++) {
                    changes.set(newLine + j, {
                        changeType: 'added',
                        hunkId: hunkId,
                    });
                }
                newLine += count;
            }
        } else {
            // Context lines (unchanged)
            if (inChangeBlock) {
                hunkId++;
                inChangeBlock = false;
            }
            oldLine += count;
            newLine += count;
        }
    }

    if (inChangeBlock) {
        hunkId++;
    }

    return { diffs: changes, added, removed };
}

export type LineSource = {
    linesLength(): number;
    lineLength(i: number): number;
    line(i: number): string;
};

export function computeGitChangesFromSource(
    original: LineSource,
    current: LineSource,
    dirtyRange?: { start: number; end: number } | null
): GitChangesResult {
    const changes = new Map<number, DiffInfo>();
    const origLen = original.linesLength();
    const currLen = current.linesLength();

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
        return { diffs: changes, added: 0, removed: 0 };
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

    let oldLine = 1;
    let newLine = 1;
    let hunkId = 0;
    let inChangeBlock = false;
    let added = 0;
    let removed = 0;

    for (let i = 0; i < diffs.length; i++) {
        const diff = diffs[i];
        const { added: partAdded, removed: partRemoved } = diff;
        const count = diff.count ?? diff.value.length;

        if (partAdded) added += count;
        if (partRemoved) removed += count;

        if (partAdded || partRemoved) {
            inChangeBlock = true;

            if (partRemoved) {
                const deletedLineNumbers: number[] = [];
                for (let j = 0; j < count; j++) {
                    deletedLineNumbers.push(oldLine + j);
                }
                oldLine += count;

                const next = diffs[i + 1];
                if (next?.added) {
                    const addedCount = next.value.length;
                    added += addedCount;
                    for (let j = 0; j < addedCount; j++) {
                        changes.set(newLine + j, {
                            changeType: 'modified',
                            oldLineNumbers: deletedLineNumbers,
                            hunkId: hunkId,
                        });
                    }
                    newLine += addedCount;
                    i++; // skip the added block
                } else {
                    const ghostAnchorLine = Math.max(1, newLine);
                    const markerLine = Math.max(1, Math.min(ghostAnchorLine, currentLineCount));

                    changes.set(markerLine, {
                        changeType: 'deleted',
                        oldLineNumbers: deletedLineNumbers,
                        ghostAnchorLine,
                        hunkId: hunkId,
                    });
                }
            } else {
                // Pure addition
                for (let j = 0; j < count; j++) {
                    changes.set(newLine + j, {
                        changeType: 'added',
                        hunkId: hunkId,
                    });
                }
                newLine += count;
            }
        } else {
            // Context lines (unchanged)
            if (inChangeBlock) {
                hunkId++;
                inChangeBlock = false;
            }
            oldLine += count;
            newLine += count;
        }
    }

    if (inChangeBlock) {
        hunkId++;
    }

    return { diffs: changes, added, removed };
}

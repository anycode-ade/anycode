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

export function computeGitChanges(
    original: string, current: string
): Map<number, DiffInfo> {
    const changes = new Map<number, DiffInfo>();
    const diffs = JsDiff.diffLines(original, current);
    const currentLineCount = current === '' ? 1 : current.split('\n').length;

    let oldLine = 1;
    let newLine = 1;
    let hunkId = 0;
    let inChangeBlock = false;

    const countLines = (value: string): number => {
        if (value === '') {
            return 0;
        }
        const parts = value.split('\n');
        return value.endsWith('\n') ? parts.length - 1 : parts.length;
    };

    for (let i = 0; i < diffs.length; i++) {
        const diff = diffs[i];
        const { added, removed } = diff;
        const count = countLines(diff.value);

        if (added || removed) {
            inChangeBlock = true;

            if (removed) {
                const deletedLineNumbers: number[] = [];
                for (let j = 0; j < count; j++) {
                    deletedLineNumbers.push(oldLine + j);
                }
                oldLine += count;

                const next = diffs[i + 1];
                if (next?.added) {
                    const addedCount = countLines(next.value);
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

    return changes;
}

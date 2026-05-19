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
  const currentLineCount = current === '' ? 1 : current.split('\n').length;
  const patch = JsDiff.createTwoFilesPatch(
    'a', 'b', original, current, '', '', { context: 0 }
  );

  const lines = patch.split('\n');
  let hunkId = 0;
  let lastChangeWasConsecutive = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('@@ -')) {
      const headerMatch = line.match(/ \+(\d+)(?:,(\d+))?/);
      if (headerMatch) {
        const oldHeaderMatch = line.match(/@@ -(\d+)(?:,(\d+))?/);
        let newLine = parseInt(headerMatch[1], 10);
        let oldLine = oldHeaderMatch ? parseInt(oldHeaderMatch[1], 10) : 1;
        i++;
        lastChangeWasConsecutive = false;

        let iterations = 0;
        while (i < lines.length && !lines[i].startsWith('@@')) {
          iterations++;
          if (iterations > 1000) {
            console.error('INFINITE LOOP DETECTED at i =', i, 'line:', lines[i]);
            break;
          }

          const currentLine = lines[i];

          if (currentLine.startsWith('\\')) {
            i++;
            continue;
          }

          if (currentLine.startsWith('-') || currentLine.startsWith('+')) {
            const deletedLineNumbers: number[] = [];
            const addedLineNumbers: number[] = [];

            while (i < lines.length && lines[i].startsWith('-')) {
              deletedLineNumbers.push(oldLine);
              oldLine++;
              i++;
            }

            if (i < lines.length && lines[i].startsWith('\\')) {
              i++;
            }

            while (i < lines.length && lines[i].startsWith('+')) {
              addedLineNumbers.push(newLine);
              newLine++;
              i++;
            }

            if (i < lines.length && lines[i].startsWith('\\')) {
              i++;
            }

            if (deletedLineNumbers.length > 0 && addedLineNumbers.length > 0) {
              for (const lineNum of addedLineNumbers) {
                changes.set(lineNum, {
                  changeType: 'modified',
                  oldLineNumbers: deletedLineNumbers,
                  hunkId: hunkId,
                });
              }
            } else if (addedLineNumbers.length > 0) {
              // added
              for (const lineNum of addedLineNumbers) {
                changes.set(lineNum, {
                  changeType: 'added',
                  hunkId: hunkId,
                });
              }
            } else if (deletedLineNumbers.length > 0) {
              // deleted
              // JsDiff can emit +0 for deletions before the first line.
              // ghostAnchorLine is the line BEFORE which ghost lines appear.
              // markerLine is the line where the deletion marker appears in gutter
              // (aligned with the ghost anchor line in our renderer model).
              const ghostAnchorLine = Math.max(1, newLine + 1);
              const markerLine = Math.max(1, Math.min(ghostAnchorLine, currentLineCount));
              changes.set(markerLine, {
                changeType: 'deleted',
                oldLineNumbers: deletedLineNumbers,
                ghostAnchorLine,
                hunkId: hunkId,
              });
            }

            lastChangeWasConsecutive = true;
            continue;
          } else if (currentLine.startsWith(' ')) {
            if (lastChangeWasConsecutive) {
              hunkId++;
              lastChangeWasConsecutive = false;
            }
            oldLine++;
            newLine++;
            i++;
          } else {
            i++;
          }
        }
        // At the end of a @@ hunk, reset for next hunk
        if (lastChangeWasConsecutive) {
          hunkId++;
        }
        i--;
      }
    }
  }

  return changes;
}

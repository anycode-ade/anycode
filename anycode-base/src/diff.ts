import { diffChars, diffLines, Change } from 'diff';
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
  oldLines?: string[];
  hunkId: number;
};

export function computeGitChanges(
  original: string, current: string
): Map<number, DiffInfo> {
  const changes = new Map<number, DiffInfo>();
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
        let newLine = parseInt(headerMatch[1], 10);
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
            const deletedLines: string[] = [];
            const addedLineNumbers: number[] = [];

            while (i < lines.length && lines[i].startsWith('-')) {
              deletedLines.push(lines[i].slice(1));
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

            if (deletedLines.length > 0 && addedLineNumbers.length > 0) {
              for (const lineNum of addedLineNumbers) {
                changes.set(lineNum, {
                  changeType: 'modified',
                  oldLines: deletedLines,
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
            } else if (deletedLines.length > 0) {
              // deleted
              changes.set(newLine, {
                changeType: 'deleted',
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
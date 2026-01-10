import { diffChars, diffLines, Change } from 'diff';

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

/**
 * Computes a minimal list of text edits that convert `oldText` into `newText`.
 * 
 * @param oldText - The original string.
 * @param newText - The new string to transform into.
 * @returns An array of edits with character ranges and replacement text.
 */
export function computeDiffEdits(
    oldText: string,
    newText: string
): Edit[] {
    const changes = diffChars(oldText, newText);
    const edits: Edit[] = [];

    let oldPosChars = 0;

    for (const change of changes) {
        const value = change.value;
        const valueCharLen = [...value].length;

        if (!change.added && !change.removed) {
            oldPosChars += valueCharLen;
        } else if (change.removed) {
            const start = oldPosChars;
            const end = start + valueCharLen;

            if (edits.length > 0) {
                const last = edits[edits.length - 1];
                if (last.end === start && last.text === '') {
                    last.end = end;
                } else {
                    edits.push({
                        kind: EditKind.Delete,
                        start,
                        end,
                        text: '',
                    });
                }
            } else {
                edits.push({
                    kind: EditKind.Delete,
                    start,
                    end,
                    text: '',
                });
            }

            oldPosChars = end;
        } else if (change.added) {
            // Сдвигаем вставку в позицию последнего удаления, если есть
            let start = oldPosChars;
            const last = edits.length > 0 ? edits[edits.length - 1] : null;
            if (last && last.kind === EditKind.Delete && last.end === oldPosChars) {
                start = last.start;  // вставляем на начало удалённого участка
            }
            const end = start;

            if (edits.length > 0) {
                const lastEdit = edits[edits.length - 1];
                if (lastEdit.end === start && lastEdit.kind === EditKind.Insert) {
                    lastEdit.text += value;
                } else {
                    edits.push({
                        kind: EditKind.Insert,
                        start,
                        end,
                        text: value,
                    });
                }
            } else {
                edits.push({
                    kind: EditKind.Insert,
                    start,
                    end,
                    text: value,
                });
            }
        }
    }

    const newEdits: Edit[] = [];
    for (const edit of edits) {
        newEdits.push(...splitReplaceEdit(edit));
        // newEdits.push(edit);
    }

    for (const edit of newEdits) {
        if (edit.kind === EditKind.Delete) {
            edit.text = oldText.slice(edit.start, edit.end);
        }
    }

    return newEdits;
}
 
function splitReplaceEdit(edit: Edit): Edit[] {
    const { start, end, text, kind } = edit;

    if (start === end || kind === EditKind.Delete) {
        return [edit];
    }

    // Replace → delete + insert
    return [
        { kind: EditKind.Delete, start, end, text: '' },
        { kind: EditKind.Insert, start, end: start, text },
    ];
}

export type LineDiff = { line: number; old_value: string };

export type DiffResult = {
  changed: LineDiff[];
  unchanged: number[];
};

// export function computeLinesDiff(oldText: string, newText: string): DiffResult {
//     const oldLines = oldText.split('\n');
//     const newLines = newText.split('\n');
//     const changes = diffLines(oldText, newText, { newlineIsToken: false });
    
//     const changed: LineDiff[] = [];
//     const unchanged: number[] = [];
//     let oldLineNumber = 0;
//     let newLineNumber = 0;

//     console.log(changes);
  
//     for (const change of changes) {
//       const lines = change.value.split('\n');
      
//       // Убираем последнюю пустую строку, если она есть (из-за \n в конце)
//       if (lines[lines.length - 1] === '') {
//         lines.pop();
//       }
  
//       if (change.removed) {
//         // Строки были удалены/изменены в старом тексте
//         for (const line of lines) {
//           changed.push({ line: oldLineNumber, old_value: line });
//           oldLineNumber++;
//         }
//       } else if (change.added) {
//         // Строки были добавлены в новом тексте
//         // Не увеличиваем oldLineNumber, так как этих строк не было в старом тексте
//         newLineNumber += lines.length;
//       } else {
//         // Неизменённые строки
//         for (let i = 0; i < lines.length; i++) {
//           unchanged.push(oldLineNumber);
//           oldLineNumber++;
//           newLineNumber++;
//         }
//       }
//     }
  
//     return { changed, unchanged };
//   }
  
export enum LineChangeType {
    Unchanged = 'unchanged',
    Modified = 'modified',
    Added = 'added',
    Deleted = 'deleted',
  }
  
  export type LineInfo = {
    oldLine?: number;      // Номер в старом тексте (undefined для добавленных)
    newLine?: number;      // Номер в новом тексте (undefined для удаленных)
    type: LineChangeType;
    oldValue?: string;     // Содержимое в старом тексте
    newValue?: string;     // Содержимое в новом тексте
  };
  
  export type DiffHunk = {
    oldStart: number;      // Начало в старом тексте
    oldCount: number;      // Количество строк в старом тексте
    newStart: number;      // Начало в новом тексте
    newCount: number;      // Количество строк в новом тексте
    type: 'addition' | 'deletion' | 'modification';
    lines: LineInfo[];
  };
  
  export type DetailedDiff = {
    hunks: DiffHunk[];
    lines: LineInfo[];     // Плоский список всех строк с их статусами
  };
  
  export function computeDetailedDiff(oldText: string, newText: string): DetailedDiff {
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    const changes = diffLines(oldText, newText);
    
    const hunks: DiffHunk[] = [];
    const allLines: LineInfo[] = [];
    
    let oldLineNumber = 0;
    let newLineNumber = 0;
    let currentHunk: DiffHunk | null = null;
  
    // Сначала собираем все removed и added блоки
    const pendingRemoved: string[] = [];
    const pendingAdded: string[] = [];
    let hunkOldStart = oldLineNumber;
    let hunkNewStart = newLineNumber;
  
    const flushHunk = () => {
      if (pendingRemoved.length === 0 && pendingAdded.length === 0) {
        return;
      }
  
      // Пытаемся сопоставить одинаковые строки в removed и added
      const removedLines = [...pendingRemoved];
      const addedLines = [...pendingAdded];
      const matchedIndices = new Set<number>();
  
      let localOldLine = hunkOldStart;
      let localNewLine = hunkNewStart;
  
      // Сначала находим точные совпадения в той же позиции
      const minLen = Math.min(removedLines.length, addedLines.length);
      for (let i = 0; i < minLen; i++) {
        if (removedLines[i] === addedLines[i]) {
          matchedIndices.add(i);
        }
      }
  
      const hunkLines: LineInfo[] = [];
      let hasChanges = false; // Флаг, что есть реальные изменения
  
      // Обрабатываем строки
      for (let i = 0; i < Math.max(removedLines.length, addedLines.length); i++) {
        const removedLine = i < removedLines.length ? removedLines[i] : undefined;
        const addedLine = i < addedLines.length ? addedLines[i] : undefined;
  
        if (matchedIndices.has(i) && removedLine === addedLine) {
          // Строки идентичны - это unchanged
          const lineInfo: LineInfo = {
            oldLine: localOldLine,
            newLine: localNewLine,
            type: LineChangeType.Unchanged,
            oldValue: removedLine,
            newValue: addedLine,
          };
          hunkLines.push(lineInfo);
          allLines.push(lineInfo);
          localOldLine++;
          localNewLine++;
        } else {
          hasChanges = true;
          // Строки различаются
          if (removedLine !== undefined) {
            const lineInfo: LineInfo = {
              oldLine: localOldLine,
              type: LineChangeType.Deleted,
              oldValue: removedLine,
            };
            hunkLines.push(lineInfo);
            allLines.push(lineInfo);
            localOldLine++;
          }
          if (addedLine !== undefined) {
            const lineInfo: LineInfo = {
              newLine: localNewLine,
              type: LineChangeType.Added,
              newValue: addedLine,
            };
            hunkLines.push(lineInfo);
            allLines.push(lineInfo);
            localNewLine++;
          }
        }
      }
  
      oldLineNumber = localOldLine;
      newLineNumber = localNewLine;
      
      // Создаем hunk только если есть реальные изменения
      if (hasChanges) {
        const hunk: DiffHunk = {
          oldStart: hunkOldStart,
          oldCount: pendingRemoved.length,
          newStart: hunkNewStart,
          newCount: pendingAdded.length,
          type: pendingRemoved.length === 0 ? 'addition' : 
                pendingAdded.length === 0 ? 'deletion' : 'modification',
          lines: hunkLines,
        };
        hunks.push(hunk);
      }
      
      pendingRemoved.length = 0;
      pendingAdded.length = 0;
    };
  
    for (const change of changes) {
      const lines = splitLines(change.value);
      
      if (change.removed) {
        if (pendingRemoved.length === 0) {
          hunkOldStart = oldLineNumber;
          hunkNewStart = newLineNumber;
        }
        pendingRemoved.push(...lines);
      } else if (change.added) {
        pendingAdded.push(...lines);
      } else {
        // Неизмененные строки - сначала закрываем текущий hunk
        flushHunk();
        
        // Добавляем неизмененные строки
        for (const line of lines) {
          allLines.push({
            oldLine: oldLineNumber,
            newLine: newLineNumber,
            type: LineChangeType.Unchanged,
            oldValue: line,
            newValue: line,
          });
          oldLineNumber++;
          newLineNumber++;
        }
      }
    }
    
    // Закрываем последний hunk
    flushHunk();
    
    return { hunks, lines: allLines };
  }
  
  // Упрощенная версия - только changed/unchanged
  export type SimpleDiff = {
    changed: Array<{ line: number; old_value: string }>;
    unchanged: number[];
  };
  
  export function computeLinesDiff(oldText: string, newText: string): SimpleDiff {
    const detailed = computeDetailedDiff(oldText, newText);
    
    const changed: Array<{ line: number; old_value: string }> = [];
    const unchanged: number[] = [];
    
    for (const line of detailed.lines) {
      if (line.type === LineChangeType.Unchanged && line.oldLine !== undefined) {
        unchanged.push(line.oldLine);
      } else if (
        (line.type === LineChangeType.Deleted || line.type === LineChangeType.Modified) &&
        line.oldLine !== undefined &&
        line.oldValue !== undefined
      ) {
        changed.push({ line: line.oldLine, old_value: line.oldValue });
      }
    }
    
    return { changed, unchanged };
  }
  
  function splitLines(text: string): string[] {
    const lines = text.split('\n');
    // Убираем последнюю пустую строку, если она есть
    if (lines[lines.length - 1] === '') {
      lines.pop();
    }
    return lines;
  }


import * as JsDiff from 'diff';

export type ChangeType = 'added' | 'modified' | 'deleted';

export function computeGitChanges(original: string, current: string): Map<number, ChangeType> {
  const changes = new Map<number, ChangeType>();
  const patch = JsDiff.createTwoFilesPatch('a', 'b', original, current, '', '', { context: 0 });
  console.log(patch);
  
  const lines = patch.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.startsWith('@@ -')) {
      const headerMatch = line.match(/ \+(\d+)(?:,(\d+))?/);
      if (headerMatch) {
        let newLine = parseInt(headerMatch[1], 10);
        i++;
        
        let iterations = 0; // Защита от бесконечного цикла
        // Обрабатываем блок изменений до следующего заголовка или конца
        while (i < lines.length && !lines[i].startsWith('@@')) {
          iterations++;
          if (iterations > 1000) {
            console.error('INFINITE LOOP DETECTED at i =', i, 'line:', lines[i]);
            break;
          }
          
          const currentLine = lines[i];
          console.log(`[${i}] Processing: "${currentLine}"`);
          
          // Пропускаем служебные строки
          if (currentLine.startsWith('\\')) {
            console.log(`  -> Skipping service line`);
            i++;
            continue;
          }
          
          // Если начинается блок изменений (- или +)
          if (currentLine.startsWith('-') || currentLine.startsWith('+')) {
            console.log(`  -> Found change block`);
            let hasDeleted = false;
            const addedLines: number[] = [];
            
            // Собираем все удаления
            while (i < lines.length && lines[i].startsWith('-')) {
              console.log(`    -> Deleting line at i=${i}: "${lines[i]}"`);
              hasDeleted = true;
              i++;
            }
            
            // Пропускаем "\ No newline"
            if (i < lines.length && lines[i].startsWith('\\')) {
              console.log(`    -> Skipping \\ at i=${i}`);
              i++;
            }
            
            // Собираем все добавления
            while (i < lines.length && lines[i].startsWith('+')) {
              console.log(`    -> Adding line ${newLine} at i=${i}: "${lines[i]}"`);
              addedLines.push(newLine);
              newLine++;
              i++;
            }
            
            // Пропускаем "\ No newline"
            if (i < lines.length && lines[i].startsWith('\\')) {
              console.log(`    -> Skipping \\ at i=${i}`);
              i++;
            }
            
            // Определяем тип изменения
            if (hasDeleted && addedLines.length > 0) {
              addedLines.forEach(lineNum => changes.set(lineNum, 'modified'));
            } else if (addedLines.length > 0) {
              addedLines.forEach(lineNum => changes.set(lineNum, 'added'));
            } else if (hasDeleted) {
              changes.set(newLine, 'deleted');
            }
            
            console.log(`  -> After change block, i=${i}`);
            // НЕ ДЕЛАЕМ i++ здесь, потому что уже увеличили в while циклах выше
            continue; // ⚠️ ВАЖНО! Переходим к следующей итерации
          } else if (currentLine.startsWith(' ')) {
            // Контекстная строка
            console.log(`  -> Context line`);
            newLine++;
            i++;
          } else {
            // Неизвестная строка, пропускаем
            console.log(`  -> Unknown line, skipping`);
            i++;
          }
        }
        i--; // Коррекция цикла
      }
    }
  }
  
  console.log('computeGitChanges');
  console.log(changes);
  
  return changes;
}
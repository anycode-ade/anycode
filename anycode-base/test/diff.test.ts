import { describe, it, expect, beforeEach } from 'vitest';
import { computeDetailedDiff, computeDiffEdits, computeGitChanges } from '../src/diff';
import { createPatch, structuredPatch } from 'diff';
import * as JsDiff from 'diff';

describe('Code', () => {
    it('simple replacement', () => {
        const oldText = "hello";
        const newText = "hullo";
        const edits = computeDiffEdits(oldText, newText);

        expect(edits).toEqual([
            { start: 1, end: 2, text: 'e', kind: "delete" },
            { start: 1, end: 1, text: 'u', kind: "insert" },
        ]);
    });

    it('insertion and deletion', () => {
        const oldText = "abc";
        const newText = "abXYc";
        const edits = computeDiffEdits(oldText, newText);

        expect(edits).toEqual([
            { start: 2, end: 2, text: 'XY', kind: "insert" },
        ]);
    });

    it('deletion only', () => {
        const oldText = "abcdef";
        const newText = "abef";
        const edits = computeDiffEdits(oldText, newText);

        expect(edits).toEqual([
            { start: 2, end: 4, text: 'cd', kind: "delete" },
        ]);
    });

    it('insertion at the beginning', () => {
        const oldText = "world";
        const newText = "hello world";
        const edits = computeDiffEdits(oldText, newText);

        expect(edits).toEqual([
            { start: 0, end: 0, text: 'hello ', kind: "insert" },
        ]);
    });

    it('insertion at the end', () => {
        const oldText = "end";
        const newText = "endgame";
        const edits = computeDiffEdits(oldText, newText);
        expect(edits).toEqual([
            { start: 3, end: 3, text: 'game', kind: "insert" },
        ]);
    });

    it('complete replacement', () => {
        const oldText = "abc";
        const newText = "xyz";
        const edits = computeDiffEdits(oldText, newText);

        expect(edits).toEqual([
            { start: 0, end: 3, text: 'abc', kind: "delete" },
            { start: 0, end: 0, text: 'xyz', kind: "insert" },
        ]);
    });

    it('should compute edits for multi-line text', () => {
        const oldText = `function add(a, b) {
  return a + b;
}`;

        const newText = `function add(x, y) {
  return x + y;
}`;

        const edits = computeDiffEdits(oldText, newText);

        expect(edits).toEqual([
            { start: 13, end: 14, text: 'a', kind: "delete" },
            { start: 13, end: 13, text: 'x', kind: "insert" },
            { start: 16, end: 17, text: 'b', kind: "delete" },
            { start: 16, end: 16, text: 'y', kind: "insert" },
            { start: 30, end: 31, text: 'a', kind: "delete" },
            { start: 30, end: 30, text: 'x', kind: "insert" },
            { start: 34, end: 35, text: 'b', kind: "delete" },
            { start: 34, end: 34, text: 'y', kind: "insert" },
        ]);
    });

    it('should compute edit insert string', () => {
        const oldText = `print len`;
        const newText = `print(len(fruits))`;
        const edits = computeDiffEdits(oldText, newText);
        console.log(edits);
        expect(edits).toEqual([
            { start: 5, end: 6, text: ' ', kind: "delete" },
            { start: 5, end: 5, text: '(', kind: "insert" },
            { start: 9, end: 9, text: '(fruits))', kind: "insert" }
        ]);
    });

    
    it('should compute edit unicode string', () => {
        const oldText = `println!("Current value: {}", i);`;
        const newText = `println!("Current значение: {}", i);`;
        const edits = computeDiffEdits(oldText, newText);
        console.log(edits);
        expect(edits).toEqual([
            { start: 18, end: 23, text: 'value', kind: "delete" },
            { start: 18, end: 18, text: 'значение', kind: "insert" }
        ]);
    });
});

import { computeLinesDiff } from '../src/diff';

describe('computeLinesDiff', () => {
    it('diffs lines of JS code correctly', () => {
        const oldCode = `function sum(a, b) {\n    return a + b;\n}`;
        const newCode = `function sum(a, b) {\n    return a - b;\n}`;
        const result = computeLinesDiff(oldCode, newCode);
        expect(result).toEqual({
            changed: [
                { line: 1, old_value: '    return a + b;' }
            ],
            unchanged: [0, 2]
        });
    });

    it('diffs lines of JS code correctly 2 ', () => {
        const oldCode = `function sum(a, b) {\n    return a + b;\n}\nconsole.log(sum(2, 3));`;
        const newCode = `function sum(a, b) {\n    return a - b;\n}\n`;
        const result = computeLinesDiff(oldCode, newCode);
        console.log(result);
        expect(result).toEqual({
            changed: [
                { line: 1, old_value: '    return a + b;' },
                { line: 3, old_value: 'console.log(sum(2, 3));' }
            ],
            unchanged: [0, 2]
        });
    });

    // it('diffs lines of JS code correctly 3 ', () => {
    //     const oldCode = `function sum(a, b) {\n    return a + b;\n}`;
    //     const newCode = `function sum(a, b) {\n\n    return a + b;\n}`;
    //     const result = computeLinesDiff(oldCode, newCode);
    //     console.log(result);
    //     expect(result).toEqual({
    //         changed: [
    //             { line: 1, old_value: '    return a + b;' },
    //             { line: 3, old_value: 'console.log(sum(2, 3));' }
    //         ],
    //         unchanged: [0, 2]
    //     });
    // });

    it ('diffs lines of JS code correctly 4 ', () => {
        const oldCode = `function sum(a, bb) {\n    return a + b;\n}`;
        const newCode = `function sum(a, b) {\n    return a - b;\n}`;
        const patch = structuredPatch('file.js', 'file.js', oldCode, newCode);
        console.dir(patch, { depth: null });
    });
    
    it ('diffs lines of JS code correctly 5 ', () => {
        const oldCode = `function sum(a, b) {\n\n    return a - b;\n}`;
        const newCode = `function sum(a, b) {\n\n\n    return a - b;\n}`;
        
        const diff = computeGitChanges(oldCode, newCode);
        
        console.log('diff:', diff)
    });

    it ('diffs lines of JS code correctly 6 ', () => {
        const oldCode = `from datetime import datetime

# Current date
today = datetime.now()

# Target date - next New Year (January 1st)
next_new_year = datetime(today.year + 1, 1, 1)

# Difference between dates
time_until_new_year = next_new_year - today

# Extract days, hours and minutes
days = time_until_new_year.days
hours = time_until_new_year.seconds // 3600
minutes = (time_until_new_year.seconds % 3600) // 60

print(f"Days until New Year: {days} days, {hours} hours and {minutes} minutes!")`;
        const newCode = `from datetime import datetime

# Текущая дата
today = datetime.now()

# Целевая дата - следующий Новый Год (1 января)
next_new_year = datetime(today.year + 1, 1, 1)

# Разница между датами
time_until_new_year = next_new_year - today

# Извлекаем дни, часы и минуты
days = time_until_new_year.days
hours = time_until_new_year.seconds // 3600
minutes = (time_until_new_year.seconds % 3600) // 60

print(f"До Нового Года: {days} дней, {hours} часов и {minutes} минут!")`;
        
        const diff = computeGitChanges(oldCode, newCode);
        
        console.log('diff:', diff)
    });

    it ('diffs lines of JS code correctly 7 ', () => {
        const oldCode = `from datetime import datetime

# Текущая дата
today = datetime.now()

# Целевая дата - следующий Новый Год (1 января)
next_new_year = datetime(today.year + 1, 1, 1)

# Разница между датами
time_until_new_year = next_new_year - today

# Извлекаем дни, часы и минуты
days = time_until_new_year.days
hours = time_until_new_year.seconds // 3600
minutes = (time_until_new_year.seconds % 3600) // 60

print(f"До Нового Года: {days} дней, {hours} часов и {minutes} минут!")`;
        const newCode = `from datetime import datetime


# Current date
today = datetime.now()

# Target date - next New Year (January 1st)
next_new_year = datetime(today.year + 1, 1, 1)

# Difference between dates
time_until_new_year = next_new_year - today

# Extract days, hours and minutes
days = time_until_new_year.days
hours = time_until_new_year.seconds // 3600
minutes = (time_until_new_year.seconds % 3600) // 60

print(f"Days until New Year: {days} days, {hours} hours and {minutes} minutes!")
`;
        
        const diff = computeGitChanges(oldCode, newCode);
        
        console.log('diff:', diff)
    });
});
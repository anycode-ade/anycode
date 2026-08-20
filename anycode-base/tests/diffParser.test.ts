import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from '../src/diffParser';
import { DiffCode } from '../src/diffCode';

describe('diffParser', () => {
    it('parses empty diff', () => {
        expect(parseUnifiedDiff('')).toEqual([]);
        expect(parseUnifiedDiff('   ')).toEqual([]);
    });

    it('parses modified file with hunks into newLines, oldLines, and diffs', () => {
        const rawDiff = `diff --git a/src/auth.ts b/src/auth.ts
index 1234567..89abcdef 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,4 +1,5 @@
 const a = 1;
-const b = 2;
+const b = 20;
+const c = 30;
 const d = 4;
`;
        const files = parseUnifiedDiff(rawDiff);
        expect(files).toHaveLength(1);
        expect(files[0].path).toBe('src/auth.ts');
        expect(files[0].status).toBe('modified');
        expect(files[0].added).toBe(2);
        expect(files[0].removed).toBe(1);

        expect(files[0].newLines).toEqual([
            'const a = 1;',
            'const b = 20;',
            'const c = 30;',
            'const d = 4;',
        ]);
        expect(files[0].oldLines).toEqual([
            'const a = 1;',
            'const b = 2;',
            'const d = 4;',
        ]);
        expect(files[0].newLineNumbers).toEqual([1, 2, 3, 4]);
        expect(files[0].oldLineNumbers).toEqual([1, 2, 3]);

        // Line 2 in newLines (1-indexed) is modified, referencing oldLine 2
        const diff2 = files[0].diffs.get(2);
        expect(diff2).toBeDefined();
        expect(diff2?.changeType).toBe('modified');
        expect(diff2?.oldLineNumbers).toEqual([2]);
    });

    it('parses new file mode', () => {
        const rawDiff = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const x = 1;
+export const y = 2;
`;
        const files = parseUnifiedDiff(rawDiff);
        expect(files).toHaveLength(1);
        expect(files[0].status).toBe('added');
        expect(files[0].added).toBe(2);
        expect(files[0].removed).toBe(0);
        expect(files[0].newLines).toEqual(['export const x = 1;', 'export const y = 2;']);
        expect(files[0].oldLines).toEqual([]);
    });

    it('parses deleted file mode', () => {
        const rawDiff = `diff --git a/src/dead.ts b/src/dead.ts
deleted file mode 100644
index 1234567..0000000
--- a/src/dead.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export const dead1 = 1;
-export const dead2 = 2;
`;
        const files = parseUnifiedDiff(rawDiff);
        expect(files).toHaveLength(1);
        expect(files[0].status).toBe('deleted');
        expect(files[0].added).toBe(0);
        expect(files[0].removed).toBe(2);
        expect(files[0].oldLines).toEqual(['export const dead1 = 1;', 'export const dead2 = 2;']);
    });

    it('parses multiple files', () => {
        const rawDiff = `diff --git a/file1.ts b/file1.ts
index 111..222 100644
--- a/file1.ts
+++ b/file1.ts
@@ -1,2 +1,2 @@
-hello
+world
 unchanged
diff --git a/file2.ts b/file2.ts
new file mode 100644
index 000..333
--- /dev/null
+++ b/file2.ts
@@ -0,0 +1 @@
+newline
`;
        const files = parseUnifiedDiff(rawDiff);
        expect(files).toHaveLength(2);
        expect(files[0].path).toBe('file1.ts');
        expect(files[1].path).toBe('file2.ts');
    });
});

describe('DiffCode', () => {
    it('creates per-file diff code with correct line count, offsets, line numbers, and paired originalDiffCode', () => {
        const rawDiff = `diff --git a/test.ts b/test.ts
index 123..456 100644
--- a/test.ts
+++ b/test.ts
@@ -10,3 +10,4 @@
 line 10
-old 11
+new 11
+extra 12
 line 12
`;
        const [parsed] = parseUnifiedDiff(rawDiff);
        const diffCode = new DiffCode(parsed);
        const origDiffCode = diffCode.getOriginalDiffCode();

        // New code has 4 lines (no duplicate lines!)
        expect(diffCode.linesLength()).toBe(4);
        expect(diffCode.line(0)).toBe('line 10');
        expect(diffCode.line(1)).toBe('new 11');
        expect(diffCode.line(2)).toBe('extra 12');
        expect(diffCode.line(3)).toBe('line 12');

        expect(diffCode.getDisplayLineNumber(0)).toBe(10);
        expect(diffCode.getDisplayLineNumber(1)).toBe(11);
        expect(diffCode.getDisplayLineNumber(2)).toBe(12);
        expect(diffCode.getDisplayLineNumber(3)).toBe(13);

        // Original code has 3 lines
        expect(origDiffCode.linesLength()).toBe(3);
        expect(origDiffCode.line(0)).toBe('line 10');
        expect(origDiffCode.line(1)).toBe('old 11');
        expect(origDiffCode.line(2)).toBe('line 12');

        // Diff map correctly connects line 2 in new code to old line 2 in original code
        const diffs = diffCode.getDiffs();
        const diff2 = diffs.get(2);
        expect(diff2?.changeType).toBe('modified');
        expect(diff2?.oldLineNumbers).toEqual([2]);
        // When DiffRenderer looks up originalCode.line(2 - 1):
        expect(origDiffCode.line(diff2!.oldLineNumbers![0] - 1)).toBe('old 11');
    });
});

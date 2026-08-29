import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from '../src/diffParser';
import { DiffCode } from '../src/diffCode';
import { MultiBufferCode } from '../src/multibuffer';

describe('diffParser', () => {
    it('parses empty or invalid diff', () => {
        expect(parseUnifiedDiff('')).toEqual([]);
        expect(parseUnifiedDiff('   \n  ')).toEqual([]);
    });

    it('parses a single modified file', () => {
        const diff = `diff --git a/src/index.ts b/src/index.ts
index 1234567..89abcdef 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
 import { a } from './a';
-const x = 1;
+const x = 2;
+const y = 3;
 export { x };
`;
        const files = parseUnifiedDiff(diff);
        expect(files).toHaveLength(1);

        const file = files[0];
        expect(file.id).toBe('src/index.ts');
        expect(file.path).toBe('src/index.ts');
        expect(file.status).toBe('modified');
        expect(file.added).toBe(2);
        expect(file.removed).toBe(1);
        expect(file.newLines).toEqual([
            "import { a } from './a';",
            'const x = 2;',
            'const y = 3;',
            'export { x };',
        ]);
        expect(file.oldLines).toEqual([
            "import { a } from './a';",
            'const x = 1;',
            'export { x };',
        ]);
        expect(file.diffs.hasChanges()).toBe(true);
        expect(file.diffs.getHunks()).toHaveLength(1);
        expect(file.diffs.getHunks()[0].changeType).toBe('modified');
        expect(file.diffs.getHunks()[0].startLine).toBe(2);
        expect(file.diffs.getHunks()[0].lineCount).toBe(2);
    });

    it('parses added and deleted files', () => {
        const diff = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const hello = 'world';
+export const foo = 'bar';
diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
index 1234567..0000000
--- a/src/old.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-const deprecated = true;
-export default deprecated;
`;
        const files = parseUnifiedDiff(diff);
        expect(files).toHaveLength(2);

        expect(files[0].path).toBe('src/new.ts');
        expect(files[0].status).toBe('added');
        expect(files[0].added).toBe(2);
        expect(files[0].removed).toBe(0);
        expect(files[0].newLines).toHaveLength(2);

        expect(files[1].path).toBe('src/old.ts');
        expect(files[1].status).toBe('deleted');
        expect(files[1].added).toBe(0);
        expect(files[1].removed).toBe(2);
        expect(files[1].oldLines).toHaveLength(2);
    });

    it('parses paths with spaces and quotes', () => {
        const diff = `diff --git "a/src/my file with spaces.ts" "b/src/my file with spaces.ts"
index 1111111..2222222 100644
--- "a/src/my file with spaces.ts"
+++ "b/src/my file with spaces.ts"
@@ -1,1 +1,2 @@
 const a = 1;
+const b = 2;
`;
        const files = parseUnifiedDiff(diff);
        expect(files).toHaveLength(1);
        expect(files[0].path).toBe('src/my file with spaces.ts');
        expect(files[0].added).toBe(1);
        expect(files[0].removed).toBe(0);
    });

    it('parses CRLF line endings and renames', () => {
        const diff = `diff --git a/old-name.ts b/new-name.ts\r\nsimilarity index 90%\r\nrename from old-name.ts\r\nrename to new-name.ts\r\n--- a/old-name.ts\r\n+++ b/new-name.ts\r\n@@ -1,2 +1,2 @@\r\n const x = 1;\r\n-const y = 2;\r\n+const y = 3;\r\n`;
        const files = parseUnifiedDiff(diff);
        expect(files).toHaveLength(1);
        expect(files[0].path).toBe('new-name.ts');
        expect(files[0].oldPath).toBe('old-name.ts');
        expect(files[0].status).toBe('renamed');
        expect(files[0].added).toBe(1);
        expect(files[0].removed).toBe(1);
    });

    it('creates DiffCode and integrates with MultiBufferCode', async () => {
        const diff = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,3 @@
 const a = 1;
+const b = 2;
 export default a;
`;
        const files = parseUnifiedDiff(diff);
        expect(files).toHaveLength(1);

        const diffCode = DiffCode.fromParsedFile(files[0]);
        const origDiffCode = DiffCode.fromParsedFile(files[0], true);

        expect(diffCode.linesLength()).toBe(3);
        expect(origDiffCode.linesLength()).toBe(2);
        expect(diffCode.getPosition(15)).toBeDefined();

        const multibuffer = new MultiBufferCode([
            {
                id: files[0].id,
                path: files[0].path,
                added: files[0].added,
                removed: files[0].removed,
                readOnly: true,
                diffCode,
                originalDiffCode: origDiffCode,
            },
        ]);

        await multibuffer.init();
        expect(multibuffer.linesLength()).toBeGreaterThan(0);
        expect(multibuffer.computeGitChanges().hasChanges()).toBe(true);
    });
});

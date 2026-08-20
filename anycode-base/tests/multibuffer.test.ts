import { describe, expect, it } from 'vitest';
import { Code } from '../src/code';
import { MultiBufferCode, isDiffEntry, isCodeEntry } from '../src/multibuffer';
import { DiffCode } from '../src/diffCode';
import { parseUnifiedDiff } from '../src/diffParser';

describe('MultiBufferCode', () => {
    it('keeps deleted-file entries read-only', () => {
        const currentCode = new Code('', 'deleted.ts', '');
        const multibuffer = new MultiBufferCode([{
            id: 'deleted.ts',
            path: 'deleted.ts',
            readOnly: true,
            code: currentCode,
            originalCode: new Code('export const removed = true;\n', 'deleted.ts', ''),
        }]);

        multibuffer.insert('unexpected', multibuffer.getOffset(1, 0));

        expect(currentCode.getContent()).toBe('');
    });

    it('uses the active file Code history for undo and redo', () => {
        const firstCode = new Code('first', 'first.ts', '');
        const secondCode = new Code('second', 'second.ts', '');
        const multibuffer = new MultiBufferCode([
            { id: 'first.ts', path: 'first.ts', code: firstCode, originalCode: new Code('', 'first.ts', '') },
            { id: 'second.ts', path: 'second.ts', code: secondCode, originalCode: new Code('', 'second.ts', '') },
        ]);

        const firstOffset = multibuffer.getOffset(1, firstCode.getContentLength());
        multibuffer.insert('!', firstOffset);
        const secondOffset = multibuffer.getOffset(3, secondCode.getContentLength());
        multibuffer.insert('?', secondOffset);

        expect(multibuffer.undo(secondOffset)).toBeDefined();
        expect(firstCode.getContent()).toBe('first!');
        expect(secondCode.getContent()).toBe('second');
        expect(multibuffer.undo(secondOffset)).toBeUndefined();

        expect(multibuffer.undo(firstOffset)).toBeDefined();
        expect(firstCode.getContent()).toBe('first');
        expect(multibuffer.redo(firstOffset)).toBeDefined();
        expect(firstCode.getContent()).toBe('first!');
    });

    it('supports hybrid DiffCode and Code entries and JIT materializeFile', async () => {
        const rawDiff = `diff --git a/a.ts b/a.ts
index 111..222 100644
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,3 @@
 const a = 1;
+const b = 2;
 const c = 3;
diff --git a/b.ts b/b.ts
index 333..444 100644
--- a/b.ts
+++ b/b.ts
@@ -1,1 +1,2 @@
 export const x = 10;
+export const y = 20;
`;
        const [parsedA, parsedB] = parseUnifiedDiff(rawDiff);
        const diffCodeA = new DiffCode(parsedA);
        const diffCodeB = new DiffCode(parsedB);

        const multibuffer = new MultiBufferCode([
            { kind: 'diff', id: 'a.ts', path: 'a.ts', diffCode: diffCodeA },
            { kind: 'diff', id: 'b.ts', path: 'b.ts', diffCode: diffCodeB },
        ]);

        expect(multibuffer.linesLength()).toBe(1 + 3 + 1 + 2); // 2 headers + 3 lines + 2 lines = 7 lines
        expect(multibuffer.isDiffEntry('a.ts')).toBe(true);
        expect(multibuffer.isDiffEntry('b.ts')).toBe(true);

        const diffs = multibuffer.getMultibufferDiffs();
        expect(diffs.size).toBe(2); // one added line in a.ts, one in b.ts

        // Now materialize a.ts into a full interactive Code instance
        const realCodeA = new Code('const a = 1;\nconst b = 2;\nconst c = 3;', 'a.ts', '');
        const originalCodeA = new Code('const a = 1;\nconst c = 3;', 'a.ts', '');
        await realCodeA.init();
        await originalCodeA.init();

        const materialized = multibuffer.materializeFile('a.ts', realCodeA, originalCodeA);
        expect(materialized).toBe(true);
        expect(multibuffer.isDiffEntry('a.ts')).toBe(false);
        expect(multibuffer.isDiffEntry('b.ts')).toBe(true);

        // Edit materialized file in multibuffer
        const offset = multibuffer.getOffset(2, 'const b = 2;'.length);
        multibuffer.insert(' // added comment', offset);
        expect(realCodeA.getContent()).toContain('const b = 2; // added comment');
    });
});

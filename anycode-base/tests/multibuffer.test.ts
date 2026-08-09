import { describe, expect, it } from 'vitest';
import { Code } from '../src/code';
import { MultiBufferCode } from '../src/multibuffer';

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

        multibuffer.tx();
        multibuffer.insert('unexpected', multibuffer.getOffset(1, 0));
        multibuffer.commit();

        expect(currentCode.getContent()).toBe('');
    });
});

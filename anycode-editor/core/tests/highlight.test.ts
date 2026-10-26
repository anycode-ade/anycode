import { describe, it, expect, beforeAll } from 'vitest';
import { Code } from '../src/code';
import { setWasmBasePath } from '../src/utils';
import * as path from 'path';

describe('Syntax Highlighting Tests', () => {
    beforeAll(() => {
        // Set path for local wasm binaries
        setWasmBasePath(path.resolve(__dirname, '../wasm') + '/');
    });

    describe('Basic Highlighting', () => {
        it('should correctly highlight basic Python structures', async () => {
            const pythonCode = `# This is a comment
def my_func(x):
    return x + 42
`;
            const code = new Code(pythonCode, 'test.py', 'python');
            await code.init();

            // Line 0: comment
            const nodesLine0 = code.getLineNodes(0);
            expect(nodesLine0.some(n => n.name === 'comment' && n.text === '# This is a comment')).toBe(true);

            // Line 1: def my_func(x):
            const nodesLine1 = code.getLineNodes(1);
            expect(nodesLine1.some(n => n.name === 'keyword' && n.text === 'def')).toBe(true);
            expect(nodesLine1.some(n => n.name === 'function' && n.text === 'my_func')).toBe(true);
            expect(nodesLine1.some(n => n.name === 'variable.parameter' && n.text === 'x')).toBe(true);

            // Line 2: return x + 42
            const nodesLine2 = code.getLineNodes(2);
            expect(nodesLine2.some(n => n.name === 'keyword' && n.text === 'return')).toBe(true);
            expect(nodesLine2.some(n => n.name === 'constant' && n.text === '42')).toBe(true);
        });

        it('should correctly highlight basic JavaScript structures', async () => {
            const jsCode = `// Comment
const val = "hello";
if (val === "hello") {
    console.log(123);
}
`;
            const code = new Code(jsCode, 'test.js', 'javascript');
            await code.init();

            // Line 0: comment
            const nodesLine0 = code.getLineNodes(0);
            expect(nodesLine0.some(n => n.name === 'comment' && n.text === '// Comment')).toBe(true);

            // Line 1: const val = "hello";
            const nodesLine1 = code.getLineNodes(1);
            expect(nodesLine1.some(n => n.name === 'keyword' && n.text === 'const')).toBe(true);
            expect(nodesLine1.some(n => n.name === 'string' && n.text === '"hello"')).toBe(true);

            // Line 2: if (val === "hello") {
            const nodesLine2 = code.getLineNodes(2);
            expect(nodesLine2.some(n => n.name === 'keyword' && n.text === 'if')).toBe(true);
            expect(nodesLine2.some(n => n.name === 'punctuation.bracket' && n.text === '{')).toBe(true);

            // Line 3: console.log(123);
            const nodesLine3 = code.getLineNodes(3);
            expect(nodesLine3.some(n => n.name === 'variable.builtin' && n.text === 'console')).toBe(true);
            expect(nodesLine3.some(n => n.name === 'number' && n.text === '123')).toBe(true);
        });
    });

    describe('Syntax Error Recovery Highlighting', () => {
        it('should correctly highlight code inside and after syntax errors in Python', async () => {
            const pythonCode = `print("hi")
print("hi"
print("hi")
print("hi")
`;
            const code = new Code(pythonCode, 'test.py', 'python');
            await code.init();

            // Line 0: print("hi") - normal highlight
            const nodesLine0 = code.getLineNodes(0);
            expect(nodesLine0.some(n => n.name === 'function.builtin' && n.text === 'print')).toBe(true);
            expect(nodesLine0.some(n => n.name === 'string' && n.text === '"hi"')).toBe(true);

            // Line 2 (which is print("hi") after the missing paren on line 1)
            const nodesLine2 = code.getLineNodes(2);
            expect(nodesLine2.some(n => n.name === 'function.builtin' && n.text === 'print')).toBe(true);
            expect(nodesLine2.some(n => n.name === 'string' && n.text === '"hi"')).toBe(true);
            // Ensure the entire line is not grouped under a single 'error' token
            const errorNodes = nodesLine2.filter(n => n.name === 'error');
            if (errorNodes.length > 0) {
                expect(errorNodes.some(n => n.text === 'print("hi")')).toBe(false);
            }
        });

        it('should correctly highlight code inside and after syntax errors in JavaScript', async () => {
            const jsCode = `console.log("hi");
console.log("hi"
console.log("hi");
`;
            const code = new Code(jsCode, 'test.js', 'javascript');
            await code.init();

            // Line 2 (console.log("hi"); after the missing paren on line 1)
            const nodesLine2 = code.getLineNodes(2);
            expect(nodesLine2.some(n => n.name === 'string' && n.text === '"hi"')).toBe(true);
            const errorNodes = nodesLine2.filter(n => n.name === 'error');
            if (errorNodes.length > 0) {
                expect(errorNodes.some(n => n.text.includes('console.log'))).toBe(false);
            }
        });
    });
});

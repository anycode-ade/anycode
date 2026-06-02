import { describe, it, expect, beforeAll } from 'vitest';
import { Code } from '../src/code';
import { setWasmBasePath } from '../src/utils';
import * as path from 'path';

describe('Code Tests', () => {
    beforeAll(() => {
        // Set path for local wasm binaries
        setWasmBasePath(path.resolve(__dirname, '../wasm') + '/');
    });

    describe('TypeScript Parsing', () => {
        it('should correctly parse and highlight basic TypeScript structures', async () => {
            const tsCode = `// TS Comment
const num: number = 42;
function greet(name: string): void {
    console.log(\`Hello \${name}\`);
}
`;
            const code = new Code(tsCode, 'test.ts', 'typescript');
            await code.init();

            // Line 0: comment
            const nodesLine0 = code.getLineNodes(0);
            expect(nodesLine0.some(n => n.name === 'comment' && n.text === '// TS Comment')).toBe(true);

            // Line 1: const num: number = 42;
            const nodesLine1 = code.getLineNodes(1);
            expect(nodesLine1.some(n => n.name === 'keyword' && n.text === 'const')).toBe(true);
            expect(nodesLine1.some(n => n.name === 'type' && n.text === 'number')).toBe(true);
            expect(nodesLine1.some(n => n.name === 'number' && n.text === '42')).toBe(true);

            // Line 2: function greet(name: string): void {
            const nodesLine2 = code.getLineNodes(2);
            expect(nodesLine2.some(n => n.name === 'keyword' && n.text === 'function')).toBe(true);
            expect(nodesLine2.some(n => n.name === 'function' && n.text === 'greet')).toBe(true);
            expect(nodesLine2.some(n => n.name === 'type' && n.text === 'string')).toBe(true);
            expect(nodesLine2.some(n => n.name === 'type' && n.text === 'void')).toBe(true);
        });
    });

    describe('Python Parsing', () => {
        it('should correctly parse and highlight basic Python structures', async () => {
            const pythonCode = `# Python Comment
def calc_sum(a, b):
    return a + b
`;
            const code = new Code(pythonCode, 'test.py', 'python');
            await code.init();

            // Line 0: comment
            const nodesLine0 = code.getLineNodes(0);
            expect(nodesLine0.some(n => n.name === 'comment' && n.text === '# Python Comment')).toBe(true);

            // Line 1: def calc_sum(a, b):
            const nodesLine1 = code.getLineNodes(1);
            expect(nodesLine1.some(n => n.name === 'keyword' && n.text === 'def')).toBe(true);
            expect(nodesLine1.some(n => n.name === 'function' && n.text === 'calc_sum')).toBe(true);
            expect(nodesLine1.some(n => n.name === 'variable.parameter' && n.text === 'a')).toBe(true);

            // Line 2: return a + b
            const nodesLine2 = code.getLineNodes(2);
            expect(nodesLine2.some(n => n.name === 'keyword' && n.text === 'return')).toBe(true);
            expect(nodesLine2.some(n => n.name === 'variable' && n.text === 'a')).toBe(true);
        });
    });

    describe('JavaScript Parsing', () => {
        it('should correctly parse and highlight basic JavaScript structures', async () => {
            const jsCode = `// JS Comment
let message = "hello";
if (message) {
    console.log(message);
}
`;
            const code = new Code(jsCode, 'test.js', 'javascript');
            await code.init();

            // Line 0: comment
            const nodesLine0 = code.getLineNodes(0);
            expect(nodesLine0.some(n => n.name === 'comment' && n.text === '// JS Comment')).toBe(true);

            // Line 1: let message = "hello";
            const nodesLine1 = code.getLineNodes(1);
            expect(nodesLine1.some(n => n.name === 'keyword' && n.text === 'let')).toBe(true);
            expect(nodesLine1.some(n => n.name === 'string' && n.text === '"hello"')).toBe(true);

            // Line 2: if (message) {
            const nodesLine2 = code.getLineNodes(2);
            expect(nodesLine2.some(n => n.name === 'keyword' && n.text === 'if')).toBe(true);
            expect(nodesLine2.some(n => n.name === 'punctuation.bracket' && n.text === '{')).toBe(true);
        });
    });

    describe('Rust Parsing', () => {
        it('should correctly parse and highlight basic Rust structures', async () => {
            const rustCode = `// Rust Comment
fn main() {
    let x = 5;
    println!("Value: {}", x);
}
`;
            const code = new Code(rustCode, 'main.rs', 'rust');
            await code.init();

            // Line 0: comment
            const nodesLine0 = code.getLineNodes(0);
            expect(nodesLine0.some(n => n.name === 'comment' && n.text === '// Rust Comment')).toBe(true);

            // Line 1: fn main() {
            const nodesLine1 = code.getLineNodes(1);
            expect(nodesLine1.some(n => n.name === 'keyword' && n.text === 'fn')).toBe(true);
            expect(nodesLine1.some(n => n.name === 'function' && n.text === 'main')).toBe(true);

            // Line 2: let x = 5;
            const nodesLine2 = code.getLineNodes(2);
            expect(nodesLine2.some(n => n.name === 'keyword' && n.text === 'let')).toBe(true);
            expect(nodesLine2.some(n => n.name === 'constant' && n.text === '5')).toBe(true);
        });
    });

    describe('Go Parsing', () => {
        it('should correctly parse and highlight basic Go structures', async () => {
            const goCode = `// Go Comment
package main
import "fmt"
func main() {
    x := 42
    fmt.Println(x)
}
`;
            const code = new Code(goCode, 'main.go', 'go');
            await code.init();

            // Line 0: comment
            const nodesLine0 = code.getLineNodes(0);
            expect(nodesLine0.some(n => n.name === 'comment' && n.text === '// Go Comment')).toBe(true);

            // Line 1: package main
            const nodesLine1 = code.getLineNodes(1);
            expect(nodesLine1.some(n => n.name === 'keyword' && n.text === 'package')).toBe(true);

            // Line 2: import "fmt"
            const nodesLine2 = code.getLineNodes(2);
            expect(nodesLine2.some(n => n.name === 'keyword' && n.text === 'import')).toBe(true);
            expect(nodesLine2.some(n => n.name === 'string' && n.text === '"fmt"')).toBe(true);

            // Line 3: func main() {
            const nodesLine3 = code.getLineNodes(3);
            expect(nodesLine3.some(n => n.name === 'keyword' && n.text === 'func')).toBe(true);
            expect(nodesLine3.some(n => n.name === 'function' && n.text === 'main')).toBe(true);
        });
    });

    describe('JSON Parsing', () => {
        it('should correctly parse and highlight basic JSON structures', async () => {
            const jsonCode = `{
    "name": "anycode",
    "active": true,
    "version": 1
}
`;
            const code = new Code(jsonCode, 'package.json', 'json');
            await code.init();

            // Line 1: "name": "anycode",
            const nodesLine1 = code.getLineNodes(1);
            expect(nodesLine1.some(n => n.name === 'variable' && n.text === '"name"')).toBe(true);
            expect(nodesLine1.some(n => n.name === 'string' && n.text === '"anycode"')).toBe(true);

            // Line 2: "active": true,
            const nodesLine2 = code.getLineNodes(2);
            expect(nodesLine2.some(n => n.name === 'variable' && n.text === '"active"')).toBe(true);
            expect(nodesLine2.some(n => n.name === 'constant.builtin.boolean' && n.text === 'true')).toBe(true);

            // Line 3: "version": 1
            const nodesLine3 = code.getLineNodes(3);
            expect(nodesLine3.some(n => n.name === 'variable' && n.text === '"version"')).toBe(true);
            expect(nodesLine3.some(n => n.name === 'constant.numeric' && n.text === '1')).toBe(true);
        });
    });

    describe('CSS Parsing', () => {
        it('should correctly parse and highlight basic CSS structures', async () => {
            const cssCode = `/* CSS Comment */
.editor {
    color: red;
}
`;
            const code = new Code(cssCode, 'style.css', 'css');
            await code.init();

            // Line 0: comment
            const nodesLine0 = code.getLineNodes(0);
            expect(nodesLine0.some(n => n.name === 'comment' && n.text === '/* CSS Comment */')).toBe(true);

            // Line 1: .editor {
            const nodesLine1 = code.getLineNodes(1);
            expect(nodesLine1.some(n => n.name === 'identifier' && n.text === 'editor')).toBe(true);
            expect(nodesLine1.some(n => n.name === 'punctuation.bracket' && n.text === '{')).toBe(true);

            // Line 2: color: red;
            const nodesLine2 = code.getLineNodes(2);
            expect(nodesLine2.some(n => n.name === 'function' && n.text === 'color')).toBe(true);
            expect(nodesLine2.some(n => n.name === 'constant' && n.text === 'red')).toBe(true);
        });
    });

    describe('HTML Parsing', () => {
        it('should correctly parse and highlight basic HTML structures', async () => {
            const htmlCode = `<!-- HTML Comment -->
<div class="container"></div>
`;
            const code = new Code(htmlCode, 'index.html', 'html');
            await code.init();

            // Line 0: comment
            const nodesLine0 = code.getLineNodes(0);
            expect(nodesLine0.some(n => n.name === 'comment' && n.text === '<!-- HTML Comment -->')).toBe(true);

            // Line 1: <div class="container"></div>
            const nodesLine1 = code.getLineNodes(1);
            expect(nodesLine1.some(n => n.name === 'type' && n.text === 'div')).toBe(true);
            expect(nodesLine1.some(n => n.name === 'variable' && n.text === 'class')).toBe(true);
            expect(nodesLine1.some(n => n.name === 'string' && n.text === 'container')).toBe(true);
        });
    });

    describe('YAML Parsing', () => {
        it('should correctly parse and highlight basic YAML structures', async () => {
            const yamlCode = `# YAML Comment
name: test
port: 80
`;
            const code = new Code(yamlCode, 'config.yaml', 'yaml');
            await code.init();

            // Line 0: comment
            const nodesLine0 = code.getLineNodes(0);
            expect(nodesLine0.some(n => n.name === 'comment' && n.text === '# YAML Comment')).toBe(true);

            // Line 1: name: test
            const nodesLine1 = code.getLineNodes(1);
            expect(nodesLine1.some(n => n.name === 'type' && n.text === 'name')).toBe(true);
            expect(nodesLine1.some(n => n.name === 'type' && n.text === 'test')).toBe(true);

            // Line 2: port: 80
            const nodesLine2 = code.getLineNodes(2);
            expect(nodesLine2.some(n => n.name === 'type' && n.text === 'port')).toBe(true);
            expect(nodesLine2.some(n => n.name === 'type' && n.text === '80')).toBe(true);
        });
    });

    describe('TOML Parsing', () => {
        it('should correctly parse and highlight basic TOML structures', async () => {
            const tomlCode = `# TOML Comment
[server]
port = 80
`;
            const code = new Code(tomlCode, 'config.toml', 'toml');
            await code.init();

            // Line 0: comment
            const nodesLine0 = code.getLineNodes(0);
            expect(nodesLine0.some(n => n.name === 'comment' && n.text === '# TOML Comment')).toBe(true);

            // Line 1: [server]
            const nodesLine1 = code.getLineNodes(1);
            expect(nodesLine1.some(n => n.name === 'type' && n.text === 'server')).toBe(true);

            // Line 2: port = 80
            const nodesLine2 = code.getLineNodes(2);
            expect(nodesLine2.some(n => n.name === 'variable.other.member' && n.text === 'port')).toBe(true);
            expect(nodesLine2.some(n => n.name === 'constant.numeric.integer' && n.text === '80')).toBe(true);
        });
    });

    describe('C Parsing', () => {
        it('should correctly parse and highlight basic C structures', async () => {
            const cCode = `#include <stdio.h>
int main() {
    // C Comment
    int num = 42;
    return 0;
}
`;
            const code = new Code(cCode, 'main.c', 'c');
            await code.init();

            // Line 0: #include <stdio.h>
            const nodesLine0 = code.getLineNodes(0);
            expect(nodesLine0.some(n => n.name === 'keyword.directive' && n.text === '#include')).toBe(true);

            // Line 1: int main() {
            const nodesLine1 = code.getLineNodes(1);
            expect(nodesLine1.some(n => n.name === 'type.builtin' && n.text === 'int')).toBe(true);
            expect(nodesLine1.some(n => n.name === 'function' && n.text === 'main')).toBe(true);

            // Line 2: // C Comment
            const nodesLine2 = code.getLineNodes(2);
            expect(nodesLine2.some(n => n.name === 'comment' && n.text === '// C Comment')).toBe(true);

            // Line 3: int num = 42;
            const nodesLine3 = code.getLineNodes(3);
            expect(nodesLine3.some(n => n.name === 'type.builtin' && n.text === 'int')).toBe(true);
            expect(nodesLine3.some(n => n.name === 'constant.numeric' && n.text === '42')).toBe(true);

            // Line 4: return 0;
            const nodesLine4 = code.getLineNodes(4);
            expect(nodesLine4.some(n => n.name === 'keyword.control.return' && n.text === 'return')).toBe(true);
        });
    });

    describe('C++ Parsing', () => {
        it('should correctly parse and highlight basic C++ structures', async () => {
            const cppCode = `// CPP Comment
#include <iostream>
class MyClass {
    int x = 100;
};
`;
            const code = new Code(cppCode, 'main.cpp', 'cpp');
            await code.init();

            // Line 0: comment
            const nodesLine0 = code.getLineNodes(0);
            expect(nodesLine0.some(n => n.name === 'comment' && n.text === '// CPP Comment')).toBe(true);

            // Line 2: class MyClass {
            const nodesLine2 = code.getLineNodes(2);
            expect(nodesLine2.some(n => n.name === 'keyword' && n.text === 'class')).toBe(true);
            expect(nodesLine2.some(n => n.name === 'type' && n.text === 'MyClass')).toBe(true);
        });
    });

    describe('Java Parsing', () => {
        it('should correctly parse and highlight basic Java structures', async () => {
            const javaCode = `// Java Comment
public class Main {
    public static void main(String[] args) {
        int val = 10;
    }
}
`;
            const code = new Code(javaCode, 'Main.java', 'java');
            await code.init();

            // Line 0: comment
            const nodesLine0 = code.getLineNodes(0);
            expect(nodesLine0.some(n => n.name === 'comment' && n.text === '// Java Comment')).toBe(true);

            // Line 1: public class Main {
            const nodesLine1 = code.getLineNodes(1);
            expect(nodesLine1.some(n => n.name === 'type' && n.text === 'Main')).toBe(true);

            // Line 2: public static void main(String[] args) {
            const nodesLine2 = code.getLineNodes(2);
            expect(nodesLine2.some(n => n.name === 'type.builtin' && n.text === 'void')).toBe(true);
            expect(nodesLine2.some(n => n.name === 'function.method' && n.text === 'main')).toBe(true);
            expect(nodesLine2.some(n => n.name === 'type' && n.text === 'String')).toBe(true);
        });
    });

    describe('C# Parsing', () => {
        it('should correctly parse and highlight basic C# structures', async () => {
            const csharpCode = `// C# Comment
public class Calculator {
    public int Add(int a, int b) {
        return a + b;
    }
}
`;
            const code = new Code(csharpCode, 'Program.cs', 'csharp');
            await code.init();

            // Line 0: comment
            const nodesLine0 = code.getLineNodes(0);
            expect(nodesLine0.some(n => n.name === 'comment' && n.text === '// C# Comment')).toBe(true);

            // Line 1: public class Calculator {
            const nodesLine1 = code.getLineNodes(1);
            expect(nodesLine1.some(n => n.name === 'type' && n.text === 'Calculator')).toBe(true);

            // Line 2: public int Add(int a, int b) {
            const nodesLine2 = code.getLineNodes(2);
            expect(nodesLine2.some(n => n.name === 'type' && n.text === 'int')).toBe(true);
            expect(nodesLine2.some(n => n.name === 'function' && n.text === 'Add')).toBe(true);
        });
    });

    describe('Bash Parsing', () => {
        it('should correctly parse and highlight basic Bash structures', async () => {
            const bashCode = `# Bash Comment
echo "hello world"
if true; then
    exit 0
fi
`;
            const code = new Code(bashCode, 'script.sh', 'bash');
            await code.init();

            // Line 0: comment
            const nodesLine0 = code.getLineNodes(0);
            expect(nodesLine0.some(n => n.name === 'comment' && n.text === '# Bash Comment')).toBe(true);

            // Line 1: echo "hello world"
            const nodesLine1 = code.getLineNodes(1);
            expect(nodesLine1.some(n => n.name === 'function.call' && n.text === 'echo')).toBe(true);
            expect(nodesLine1.some(n => n.name === 'string' && n.text === '"hello world"')).toBe(true);

            // Line 2: if true; then
            const nodesLine2 = code.getLineNodes(2);
            expect(nodesLine2.some(n => n.name === 'keyword' && n.text === 'if')).toBe(true);
            expect(nodesLine2.some(n => n.name === 'keyword' && n.text === 'then')).toBe(true);
        });
    });

    describe('Kotlin Parsing', () => {
        it('should correctly parse and highlight basic Kotlin structures', async () => {
            const kotlinCode = `// Kotlin Comment
fun main() {
    val x = 10
}
`;
            const code = new Code(kotlinCode, 'main.kt', 'kotlin');
            await code.init();

            // Line 0: comment
            const nodesLine0 = code.getLineNodes(0);
            expect(nodesLine0.some(n => n.name === 'comment' && n.text === '// Kotlin Comment')).toBe(true);

            // Line 1: fun main() {
            const nodesLine1 = code.getLineNodes(1);
            expect(nodesLine1.some(n => n.name === 'keyword' && n.text === 'fun')).toBe(true);
            expect(nodesLine1.some(n => n.name === 'variable' && n.text === 'main')).toBe(true);
        });
    });

    describe('Lua Parsing', () => {
        it('should correctly parse and highlight basic Lua structures', async () => {
            const luaCode = `-- Lua Comment
local x = true
`;
            const code = new Code(luaCode, 'main.lua', 'lua');
            await code.init();

            // Line 0: comment
            const nodesLine0 = code.getLineNodes(0);
            expect(nodesLine0.some(n => n.name === 'comment' && n.text === '-- Lua Comment')).toBe(true);

            // Line 1: local x = true
            const nodesLine1 = code.getLineNodes(1);
            expect(nodesLine1.some(n => n.name === 'keyword' && n.text === 'local')).toBe(true);
            expect(nodesLine1.some(n => n.name === 'boolean' && n.text === 'true')).toBe(true);
        });
    });

    describe('Zig Parsing', () => {
        it('should correctly parse and highlight basic Zig structures', async () => {
            const zigCode = `// Zig Comment
const std = @import("std");
pub fn main() void {
    const x = 42;
}
`;
            const code = new Code(zigCode, 'main.zig', 'zig');
            await code.init();

            // Line 0: comment
            const nodesLine0 = code.getLineNodes(0);
            expect(nodesLine0.some(n => n.name === 'comment' && n.text === '// Zig Comment')).toBe(true);

            // Line 1: const std = @import("std");
            const nodesLine1 = code.getLineNodes(1);
            expect(nodesLine1.some(n => n.name === 'keyword' && n.text === 'const')).toBe(true);
            expect(nodesLine1.some(n => n.name === 'function.builtin' && n.text === '@import')).toBe(true);

            // Line 2: pub fn main() void {
            const nodesLine2 = code.getLineNodes(2);
            expect(nodesLine2.some(n => n.name === 'keyword' && n.text === 'pub')).toBe(true);
            expect(nodesLine2.some(n => n.name === 'keyword' && n.text === 'fn')).toBe(true);

            // Line 3: const x = 42;
            const nodesLine3 = code.getLineNodes(3);
            expect(nodesLine3.some(n => n.name === 'keyword' && n.text === 'const')).toBe(true);
            expect(nodesLine3.some(n => n.name === 'constant' && n.text === '42')).toBe(true);
        });
    });

    describe('Smart Cache Invalidation', () => {
        it('should keep cache for lines above edit and clear lines at and below edit', async () => {
            const jsCode = `// Line 0
const a = 1;
// Line 2
const b = 2;
// Line 4
`;
            const code = new Code(jsCode, 'test.js', 'javascript');
            await code.init();

            // Populate cache
            code.getLineNodes(0);
            code.getLineNodes(1);
            code.getLineNodes(2);
            code.getLineNodes(3);
            code.getLineNodes(4);

            const cache = (code as any).linesCache as Map<number, any>;
            expect(cache.size).toBe(5);
            expect(cache.has(0)).toBe(true);
            expect(cache.has(1)).toBe(true);
            expect(cache.has(2)).toBe(true);
            expect(cache.has(3)).toBe(true);
            expect(cache.has(4)).toBe(true);

            // Edit on line 2: insert text at start of line 2 (offset 22)
            // Pre-edit line 2 is '// Line 2'
            const offsetLine2 = code.getOffset(2, 0);
            code.insert('// edited ', offsetLine2);

            // Verify cache status
            expect(cache.has(0)).toBe(true);
            expect(cache.has(1)).toBe(true);
            expect(cache.has(2)).toBe(false);
            expect(cache.has(3)).toBe(false);
            expect(cache.has(4)).toBe(false);

            // Re-populate cache
            code.getLineNodes(0);
            code.getLineNodes(1);
            code.getLineNodes(2);
            code.getLineNodes(3);
            code.getLineNodes(4);
            expect(cache.size).toBe(5);

            // Edit on line 3: remove 5 chars from start of line 3 (offset of line 3)
            const offsetLine3 = code.getOffset(3, 0);
            code.remove(offsetLine3, 5);

            // Verify cache status
            expect(cache.has(0)).toBe(true);
            expect(cache.has(1)).toBe(true);
            expect(cache.has(2)).toBe(true);
            expect(cache.has(3)).toBe(false);
            expect(cache.has(4)).toBe(false);
        });
    });
});

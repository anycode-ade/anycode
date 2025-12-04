# anycode-base

Core code editor component with tree-sitter support for syntax analysis and code highlighting. Serves as the foundation of the anycode editor and can be used as a standalone library.

## Description

`anycode-base` is a high-performance code editor for web applications, built on top of tree-sitter for parsing and virtual rendering. The editor supports multiple programming languages, integrates with LSP for code completion and navigation, and provides a flexible API for customization.

## Key Features

- **Syntax Analysis**: Uses web-tree-sitter for code parsing and syntax highlighting
- **Virtual Rendering**: Efficient rendering of large files with scroll virtualization
- **Multi-language Support**: JavaScript, TypeScript, Python, Rust, Go, C/C++, Java, Kotlin, C#, HTML, CSS, JSON, YAML, TOML, Lua, Zig, Bash, and more
- **LSP Integration**: Language Server Protocol support for code completion, go-to-definition, and hover information
- **Change History**: Undo/redo functionality
- **Search**: Built-in text search
- **Text Selection**: Support for multiple selections and cursor operations
- **Theme Customization**: Flexible theme system for appearance customization

## Installation

```bash
npm install anycode-base
```

## Usage

### Basic Example

```typescript
import { AnycodeEditor } from 'anycode-base';

const code = `// Hello from Anycode Editor!
function greet(name) {
    return \`Hello, \${name}!\`;
}

console.log(greet('World'));
`;

async function init() {
    const editor = new AnycodeEditor(code, 'example.js', 'javascript');
    await editor.init();
    editor.render();
    document.getElementById('editor')
        .appendChild(editor.getContainer());
}

init();

```


#### Main Methods

**Initialization & Lifecycle:**
- `async init(): Promise<void>` - Initialize the editor (must be called before use)
- `clean(): void` - Clean up and remove the editor from DOM
- `getContainer(): HTMLDivElement` - Get the editor's DOM container

**Rendering:**
- `render(): void` - Render the editor
- `renderCursorOrSelection(): void` - Render cursor or selection only

**Text Operations:**
- `getText(): string` - Get all text content
- `setText(newText: string): void` - Set text content
- `getTextLength(): number` - Get the length of text content
- `applyChange(change: Change): void` - Apply a change object to the editor

**Cursor & Focus:**
- `getCursor(): { line: number, column: number }` - Get current cursor position
- `setCursor(line: number, column: number): void` - Set cursor position
- `requestFocus(line: number, column: number, center?: boolean): void` - Request focus at position
- `requestedFocus(): boolean` - Check if focus was requested

**Scroll:**
- `hasScroll(): boolean` - Check if editor has scroll position
- `restoreScroll(): void` - Restore previous scroll position

**LSP Integration:**
- `setCompletionProvider(provider: (request: CompletionRequest) => Promise<Completion[]>): void` - Set completion provider
- `setGoToDefinitionProvider(provider: (request: DefinitionRequest) => Promise<DefinitionResponse>): void` - Set go-to-definition provider
- `setCompletions(completions: Completion[]): void` - Set completions manually
- `async toggleCompletion(): Promise<void>` - Toggle completion popup
- `async showCompletion(): Promise<void>` - Show completion popup
- `applyCompletion(index: number): void` - Apply completion at index

**Callbacks & Events:**
- `setOnChange(func: (change: Change) => void): void` - Set callback for text changes
- `setOnCursorChange(callback: (newState: Position, oldState: Position) => void): void` - Set callback on cursor change

**UI Customization:**
- `setRunButtonLines(lines: number[]): void` - Set lines that show run buttons
- `setErrors(errors: { line: number, message: string }[]): void` - Set error markers for lines

## Supported Languages

- JavaScript / TypeScript
- Python
- Rust
- Go
- C / C++
- Java
- Kotlin
- C#
- HTML / CSS
- JSON / YAML / TOML
- Lua
- Zig
- Bash

A complete list of languages can be found in the `src/langs/` directory.

## Dependencies

- `web-tree-sitter` - Tree-sitter parser for syntax analysis
- `vscode-textbuffer` - Efficient text buffer management
- `typescript` - Type definitions

## License

MIT

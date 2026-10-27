# anycode-editor

A fast code editor component for the web. Syntax highlighting uses tree-sitter (WebAssembly), rendering is virtualized (only visible lines are in the DOM), and language features (completion, hover, go-to-definition, references, diagnostics) are plugged in through callbacks.

It is the core of [anycode](https://github.com/anycode-ade/anycode) and can be used as a standalone library. Browser only, ESM only.

## Install

```bash
npm install anycode-editor
```

## Quick start

**1. Serve the grammars.** The package ships tree-sitter WASM files in `node_modules/anycode-editor/wasm/`. Copy the folder to your static assets:

```bash
cp -r node_modules/anycode-editor/wasm public/wasm
```

**2. Create the editor.**

```ts
import { AnycodeEditor, setWasmBasePath } from 'anycode-editor';

setWasmBasePath('/wasm/'); // must match the URL the files are served from

const editor = new AnycodeEditor(
    'function greet(name) {\n    return `Hello, ${name}!`;\n}\n',
    'example.js',
    'javascript',
);
await editor.init();
editor.render();
document.getElementById('editor')!.appendChild(editor.getContainer());
```

Notes:

- The parent element needs a height (for example `height: 100%` inside a sized container). The editor scrolls inside it.
- Styles are imported by the library itself. Your bundler must support importing CSS from JS (Vite, webpack, and esbuild do).
- Without `setWasmBasePath`, grammars are requested from `/tree-sitter-<language>.wasm` at the site root.

## Constructor

```ts
new AnycodeEditor(text = '', filename = 'test.txt', language = '', options = {})
```

`language` is a grammar id, which is also the WASM file name: `'javascript'` loads `tree-sitter-javascript.wasm`.

Supported ids: `bash`, `c`, `cpp`, `csharp`, `css`, `dockerfile`, `go`, `html`, `java`, `javascript`, `json`, `kotlin`, `lua`, `markdown`, `markdown_inline`, `php`, `python`, `ruby`, `rust`, `sql`, `toml`, `tsx`, `typescript`, `vue`, `yaml`, `zig`.

### Options

| Option | Default | Description |
| --- | --- | --- |
| `line`, `column` | cursor at first editable line | Initial cursor position |
| `readOnly` | `false` | Block editing from the keyboard (see [Read-only](#read-only)) |
| `theme` | `anycode` palette (`src/theme.ts`) | Map of highlight capture name to CSS color, e.g. `{ keyword: '#CC8242', string: '#6A8759' }` |
| `codeFoldingEnabled` | `true` | Code folding |
| `wordHighlightEnabled` | `true` | Highlight occurrences of the word under the cursor |
| `scrollbarMarkersEnabled` | `true` | Markers (errors, diffs, search) on the scrollbar |
| `stickyHeaderEnabled` | `true` | Sticky header with the current scope |
| `focusedDiffEnabled` | `false` | Show only changed regions (see `focusedDiffContextLines`) |
| `focusedDiffContextLines` | `3` | Context lines around changes in focused diff mode |
| `originalCode` | none | A `Code` model to diff against |
| `code` | none | An existing `Code` model to use instead of `text` |
| `scrollbarStyle`, `scrollbarMinSize`, `scrollbarWidth` | defaults | Scrollbar appearance |

## Modes

### Read-only

```ts
new AnycodeEditor(text, 'file.ts', 'typescript', { readOnly: true });
```

Blocks keyboard editing. Line numbers stay visible. The cursor and selection highlight are not drawn, and folds are hidden. In a multibuffer, read-only is set per file with `MultiBufferEntry.readOnly`.

### Diff

The editor can show a diff against a baseline in three modes:

| Mode | Shows |
| --- | --- |
| `'plain'` | The file only, no diff markers |
| `'combine'` | The whole file with added and removed lines marked |
| `'diff'` | Only changed regions, plus `contextLines` lines around them (focused diff) |

```ts
editor.setDiffMode('combine');
editor.setDiffMode('diff', 5); // 5 context lines
editor.setDiffMode('plain');
```

The baseline is:

- the `originalCode` option (a `Code` model), or
- `setOriginalText(text)` / `setOriginalCode(content)`, or
- if none is set, the text at the moment diff mode is first enabled.

Related: `setDiffEnabled(enabled)`, `setFocusedDiffMode(enabled, contextLines?)`, `getOriginalText()`, `getOriginalCodeModel()`.

### Multibuffer

`MultiBufferCode` shows several files as one document, with a header per file. Each file is a `MultiBufferEntry`:

```ts
type MultiBufferEntry = {
    id: string;          // unique file id
    path: string;        // shown in the file header
    code: Code;          // the file's current content
    originalCode: Code;  // the file's baseline (for the diff)
    readOnly?: boolean;  // block edits in this file
    added?: number;      // optional counters shown in the header
    removed?: number;
};
```

For a review view, build two multibuffers (current and baseline) and open them as one diff editor:

```ts
import { AnycodeEditor, Code, MultiBufferCode } from 'anycode-editor';

const entries = files.map((f) => ({
    id: f.id,
    path: f.path,
    readOnly: true,
    code: new Code(f.after, f.path, 'typescript'),
    originalCode: new Code(f.before, f.path, 'typescript'),
}));

const current = new MultiBufferCode(entries);
const original = new MultiBufferCode(entries.map((e) => ({ ...e, code: e.originalCode })));

const editor = new AnycodeEditor('', 'review', '', {
    code: current,
    originalCode: original,
    focusedDiffEnabled: true,
});
await editor.init();
```

File management and navigation:

- `addEntries(entries, atIndex?)` (async) / `removeEntries(ids)`
- `getFileIdAtLine(line)` / `getFirstLineForFile(id)` / `getMultibufferLineForLocalLine(fileId, localLine)`
- `getFileHeaders()` - headers with path, line, and counters
- `toggleMultibufferFileAtLine(line)` - collapse or expand a file
- `getFileText(id)` / `notifyFileChanged(id)`
- `setOnFileChange((change) => ...)` - `{ fileId, change }` for edits in one file
- `editor.setOnMultibufferToggle(cb)` - called when a file is collapsed or expanded

## API

Exported from `anycode-editor`: `AnycodeEditor`, `MultiBufferCode`, `Code`, `LruCache`, `Operation`, `setWasmBasePath`, `addCssToDocument`, `generateCssClasses`, `FastSyntaxHighlighter`, `TokenDictionary`, `BinaryTokens`, and the types `Change`, `Edit`, `Position`, `FilePosition`, `FoldRange`, `Completion`, `CompletionRequest`, `DefinitionRequest`, `DefinitionResponse`, `Diagnostic`, `Hover`, `Range`, and others.

### Lifecycle and rendering

- `init(): Promise<void>` - must be called before use
- `render()` / `renderCursorOrSelection()` - draw the editor
- `getContainer(): HTMLDivElement` - DOM node to attach
- `clean()` - remove the editor from the DOM

### Text

- `getText()` / `setText(text)` / `getTextLength()`
- `getSelectedText()`
- `applyChange(change)` - apply an external change
- `getCodeModel(): Code` - underlying model

### Cursor and focus

- `getCursor(): { line, column }` / `setCursor(line, column)`
- `requestFocus(line, column, center?)` / `requestedFocus()`
- `hasScroll()` / `restoreScroll()`

### Events

- `setOnChange((change) => void)` or `addOnChangeListener(listener)` (returns an unsubscribe function)
- `setOnCursorChange((newState, oldState) => void)` or `addCursorChangeListener(callback)` (returns an unsubscribe function)

### Language features

Set providers as async callbacks. The request and response types are exported from the package.

- `setCompletionProvider(provider)` / `setCompletions(list)`
- `setHoverProvider(provider)`
- `setGoToDefinitionProvider(provider)`
- `setReferencesPeekProvider(provider)`
- `toggleCompletion()` / `showCompletion()` / `applyCompletion(index)`

### Diagnostics and run buttons

- `setErrors([{ line, message }])` / `getErrorLines()`
- `setRunButtonLines(lines)`

### Diff

- `setOriginalText(text)` / `getOriginalText()`
- `setDiffMode('plain' | 'diff' | 'combine', contextLines?)`
- `setFocusedDiffMode(enabled, contextLines?)`

## Dependencies

- [`web-tree-sitter`](https://github.com/tree-sitter/tree-sitter/tree/master/lib/binding_web) - parser runtime
- [`vscode-textbuffer`](https://www.npmjs.com/package/vscode-textbuffer) - text buffer
- [`diff`](https://www.npmjs.com/package/diff) - diffing

## Repository

Source: [anycode-ade/anycode](https://github.com/anycode-ade/anycode), package directory `anycode-editor/core`.

## License

MIT

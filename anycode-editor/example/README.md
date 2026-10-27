# Anycode Editor Example

Single-page examples of the `anycode-editor` package. One page, five demos (tabs):

- **Simple** - editable editor with syntax highlighting
- **Ignore edits** - `ignoreEdits: true`
- **Diff** - `setOriginalText` with plain, combined and focused diff modes
- **Multibuffer** - several files in one `MultiBufferCode` with diff and file navigation
- **LSP** - hover, completion, diagnostics, go to definition and references wired to a mock language server (`mock-lsp.js`, regex-based, not a real server)

The example runs against the editor source in this repo (`vite.config.js` aliases `anycode-editor` to `../core/src`). Remove the alias to use the published package from `node_modules`.

## Installation

```bash
npm install
```

## Running

```bash
npm run dev
```

The browser opens at `http://localhost:3000`. If the port is busy, Vite stops; use `npx vite --port <port>`.

## Building

```bash
npm run build
```

## Project Structure

- `index.html` - page with the tabs and editor container
- `main.js` - all demos
- `styles.css`, `demo.css` - page and demo layout styles
- `public/` - tree-sitter `.wasm` files, served at the site root (copied from the package on `npm install`)
- `vite.config.js` - Vite configuration
- `package.json` - project dependencies
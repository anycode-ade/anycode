# LSP in Anycode

Anycode uses the Language Server Protocol to add completion, hover, go-to-definition, references, and diagnostics on top of the custom editor.

## Install

Anycode runs the exact server command configured in [`anycode-backend/config.toml`](../../anycode-backend/config.toml). The only requirement is that the configured binary is available on `PATH`.

### Rust

```bash
rustup component add rust-analyzer
```

### Go

```bash
go install golang.org/x/tools/gopls@latest
```

### Python

Windows:

```powershell
irm https://astral.sh/uv/install.ps1 | iex
uvx ty server
```

Linux and macOS:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
uvx ty server
```

### TypeScript, JavaScript, CSS, JSON

```bash
npm install -g typescript-language-server typescript vscode-langservers-extracted
```

### Bash

```bash
npm install -g bash-language-server
```

### C and C++

Installation instructions: https://clangd.llvm.org/installation.html

### Java

Windows and Linux: download the latest JDTLS release archive from Eclipse and unpack it, then add the extracted `bin` directory to `PATH`.

macOS:

```bash
brew install jdtls
```

### Kotlin

Windows and Linux: download the standalone Kotlin LSP ZIP from the Kotlin LSP releases page, unpack it, and add the extracted directory to `PATH`.

macOS:

```bash
brew install --cask kotlin-lsp
```

### Zig

Windows and Linux: download the prebuilt ZLS archive that matches your platform from the ZLS releases page, unpack it, and add the extracted directory to `PATH`.

macOS:

```bash
brew install zls
```

### Lua

Windows and Linux: download the prebuilt LuaLS archive from the LuaLS releases page, unpack it, and add the extracted directory to `PATH`.

macOS:

```bash
brew install lua-language-server
```

### C#

```bash
dotnet tool install --global roslyn-language-server --prerelease
```

Notes:

- `uvx ty server` matches the Python entry in [`config.toml`](../../anycode-backend/config.toml).
- For release-based servers, put the extracted binary directory on `PATH`.
- If a platform-specific package manager provides a different binary name, keep the configured command in `config.toml` pointed at the binary Anycode should run.

## How It Works

Anycode starts one LSP process per language from [`anycode-backend/config.toml`](../../anycode-backend/config.toml).

The flow is:

1. The backend reads `language.lsp` for the current file type.
2. On first use, [`LspManager`](../../anycode-backend/src/lsp.rs) spawns the server as a child process.
3. The backend speaks JSON-RPC over stdio using the standard LSP `Content-Length` framing.
4. File events are forwarded to the server as `didOpen`, `didChange`, `didSave`, and `didClose`.
5. Frontend requests like completion, hover, definition, and references go through Socket.IO handlers.
6. Diagnostics are pushed back from the backend to the frontend as `lsp:diagnostics`.

## Frontend API

The frontend request types live in [`anycode-base/src/lsp.ts`](../../anycode-base/src/lsp.ts).

Current request/response flow:

- `lsp:completion` -> `handle_completion` in [`anycode-backend/src/handlers/lsp_handler.rs`](../../anycode-backend/src/handlers/lsp_handler.rs)
- `lsp:hover` -> `handle_hover`
- `lsp:definition` -> `handle_definition`
- `lsp:references` -> `handle_references`
- `lsp:diagnostics` -> emitted from the backend when a server publishes diagnostics

## Configuration

The default language server commands are defined in [`anycode-backend/config.toml`](../../anycode-backend/config.toml).

Important details:

- `lsp` is stored as an array of command tokens.
- The backend joins those tokens with spaces before spawning the process.
- The first token becomes the LSP name used for `.vscode/settings.json` integration.
- Settings with keys like `<lsp_name>.*` are read and forwarded as initialization options.
- If a language does not define `lsp`, Anycode still supports editing, but not LSP features for that language.

## Supported LSP Features

Anycode currently uses these LSP requests:

- completion
- hover
- definition
- references
- publish diagnostics

## Where To Look In Code

- [`anycode-backend/src/lsp.rs`](../../anycode-backend/src/lsp.rs)
- [`anycode-backend/src/handlers/lsp_handler.rs`](../../anycode-backend/src/handlers/lsp_handler.rs)
- [`anycode-backend/config.toml`](../../anycode-backend/config.toml)
- [`anycode-base/src/lsp.ts`](../../anycode-base/src/lsp.ts)

## Adding A New Language Server

1. Add the language entry to [`anycode-backend/config.toml`](../../anycode-backend/config.toml).
2. Put the server command into `language.lsp`.
3. Make sure the binary is available on `PATH`.
4. If the server needs per-project settings, add the corresponding keys to `.vscode/settings.json`.
5. Restart Anycode and open a file with that language.

## Troubleshooting

- If the server does not start, verify the command can be run directly in a terminal.
- If completion works but diagnostics do not, check that the server writes diagnostics to stdout/stderr in standard LSP format.
- If a server expects workspace settings, make sure the `.vscode/settings.json` file exists in the project root.
- If a language server behaves differently on another machine, compare the exact command in `config.toml` and the installed server version.

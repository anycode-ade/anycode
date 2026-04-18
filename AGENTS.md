# AGENTS.md

This file provides guidance for AI coding agents working with the Anycode codebase.

## Project Overview

Anycode is a web-based IDE with a Rust backend and React frontend. It provides code editing, file management, terminal emulation, LSP integration, and AI agent support via the Agent Client Protocol (ACP).

## Repository Structure

```
anycode_refactor/
├── anycode/              # React frontend application
├── anycode-base/         # Core editor library (TypeScript, Tree-Sitter)
├── anycode-react/        # React wrapper for the editor
├── anycode-backend/      # Rust backend (Axum, Tokio, Socket.IO)
└── anycode-example/      # Example usage of the editor library
```

## Tech Stack

### Frontend
- React 19, TypeScript, Vite
- Tree-Sitter (WASM) for syntax parsing
- Socket.IO for WebSocket communication
- xterm.js for terminal emulation

### Backend
- Rust with Axum web framework
- Tokio async runtime
- Socket.IO for real-time communication
- LSP integration for language intelligence
- ACP for AI agent integration

## Development Commands

### Frontend (anycode/)
```bash
pnpm install          # Install dependencies
pnpm dev              # Start dev server (localhost:5173)
pnpm build            # Production build
```

### Backend (anycode-backend/)
```bash
cargo build --release # Build release binary
cargo run --release   # Run the backend server
cargo test            # Run tests
```

### Core Library (anycode-base/)
```bash
pnpm install          # Install dependencies
pnpm build            # Build the library
pnpm test             # Run tests
```

## Key Files

### Frontend (anycode/)
- `App.tsx` - Main React component, manages all UI state
- `types.ts` - TypeScript interfaces
- `agents.ts` - AI agent configuration
- `components/agent/` - ACP components

### Backend (anycode-backend/src/)
- `main.rs` - Entry point, server setup
- `app_state.rs` - Shared application state
- `handlers/io_handler.rs` - File I/O operations
- `handlers/lsp_handler.rs` - LSP request handling
- `handlers/terminal_handler.rs` - Terminal management
- `handlers/acp_handler.rs` - ACP message handling
- `lsp.rs` - LSP process management
- `acp.rs` - ACP client implementation
- `terminal.rs` - PTY management

### Core Editor (anycode-base/src/)
- `editor.ts` - Main editor class
- `renderer.ts` - Virtual rendering engine
- `code.ts` - Code manipulation
- `actions.ts` - Editor actions
- `langs/` - Language configurations

## Architecture Notes

### Communication
All frontend-backend communication uses Socket.IO WebSockets with event-based messaging:
- File operations: `open_file`, `save_file`, `create_file`, `delete_file`
- LSP: `lsp_completion`, `lsp_definition`, `lsp_hover`, `lsp_references`
- Terminal: `create_terminal`, `terminal_input`, `resize_terminal`
- ACP: `acp_start`, `acp_stop`, `acp_send`, `acp_message`

### State Management
- Frontend uses React state with persistence via localStorage
- Backend maintains shared state via `Arc<AppState>` with Tokio mutexes

### Editor Architecture
The editor uses a virtual rendering approach for performance:
1. Tree-Sitter parses code into AST
2. Only visible lines are rendered to DOM
3. Scroll events trigger re-render of visible region

## Code Style

### TypeScript/React
- Functional components with hooks
- TypeScript strict mode
- CSS modules for styling

### Rust
- Standard Rust formatting (`cargo fmt`)
- Error handling with `anyhow` and `thiserror`
- Async/await with Tokio

## Testing

### Frontend
```bash
cd anycode-base && pnpm test  # Editor library tests
```

### Backend
```bash
cd anycode-backend && cargo test  # Rust tests
```

## Common Tasks

### Adding a new Socket.IO event
1. Define handler in appropriate `handlers/*.rs` file
2. Register handler in `main.rs` socket setup
3. Add corresponding frontend emit/listener in React components

### Adding LSP support for a new language
1. Add language server binary/command to `lsp.rs`
2. Add language configuration in `anycode-base/src/langs/`
3. Map file extension to language ID

### Adding a new AI agent
1. Add agent configuration in `anycode/agents.ts`
2. Ensure ACP compatibility in backend `acp.rs`

## Important Considerations

- The editor is custom-built, not Monaco/CodeMirror - changes require understanding Tree-Sitter and virtual rendering
- WebSocket events are the primary communication method - REST is not used
- The backend serves the frontend in production (files copied to `dist/`)
- LSP processes are spawned per-language and reused across files

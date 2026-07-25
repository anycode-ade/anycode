# Technical Overview of Anycode

**anycode** is a high-performance web-based IDE designed for writing, editing, and managing code directly in the browser. Built with a focus on speed, responsiveness, and extensibility, the project supports a wide range of programming languages, Language Server Protocol (LSP) integration, AI Agent Client Protocol (ACP), terminal emulation, and built-in Diff editing.

## Technology Stack

### Backend (Rust)

-   **Tokio**: The industry-standard asynchronous runtime for writing high-performance network applications in Rust.
-   **Axum**: A minimal and powerful web framework used for HTTP routing and controller architecture.
-   **Socketioxide**: A `Socket.IO` server implementation providing reliable real-time bidirectional WebSocket communication with the client.
-   **Notify**: Cross-platform library for recursive real-time file system event monitoring (File Watcher).
-   **Agent Client Protocol (ACP)**: Rust implementation of the protocol for interacting with AI agents (ACP v1.2.0 / Schema v1.4.0).
-   **LSP-types**: Data structures for working with the Language Server Protocol (LSP).

### Frontend (TypeScript/React)

-   **React 19 & TypeScript**: Interactive, strictly-typed UI for the IDE shell — file explorer, editor tabs, AI agent panel, search, Git changes, and settings.
-   **Vite**: Next-generation build tool with instant Hot Module Replacement (HMR) and optimized production builds; output is copied into `anycode-backend/dist` for serving.
-   **PNPM workspaces**: Monorepo package manager linking `anycode`, `anycode-base`, and `anycode-react` with shared, efficient dependency storage.
-   **Socket.IO Client**: Real-time bidirectional WebSocket transport to the Rust backend for file I/O, LSP, terminal, ACP, and file-watcher events.
-   **web-tree-sitter**: WASM Tree-sitter runtime for incremental AST parsing, syntax highlighting, and code folding inside the browser.
-   **vscode-textbuffer**: Piece-table text model optimized for frequent insert/delete operations in the editor core (`anycode-base`).
-   **Xterm.js**: Terminal emulator powering the integrated terminal UI (with fit and serialize addons).
-   **Dockview**: Dockable multi-panel layout system for editor groups, sidebars, and tool windows.
-   **react-markdown**: Streaming Markdown rendering for AI agent chat (GFM and soft line breaks via remark plugins).

## Architecture and Component Interaction

The project follows a monorepo architecture managed by `pnpm workspaces`, enabling centralized dependency management and seamless integration between packages:

-   `anycode-backend/` (Rust): The server component bridging the web UI and the user's local operating system. Handles file I/O operations, search, PTY terminal processes, LSP sessions, and ACP clients for AI agents. Runs background watcher services for file events (`spawn_file_watcher`) and Git status (`spawn_git_status_watcher`). Communicates with the frontend via **WebSockets** (`Socket.IO`).
-   `anycode-base/`: Core editor engine in pure TypeScript (framework-agnostic):
    -   Text model management (`vscode-textbuffer`).
    -   `web-tree-sitter` integration for real-time AST parsing and Code Folding calculation.
    -   Diff calculation engine (`diff.ts`) and Focused Diff Mode support.
    -   Scrollbar markers rendering engine (Scrollbar Markers).
    -   Virtualized rendering system ensuring only visible lines are rendered to DOM for maximum performance on large files.
-   `anycode-react/`: React wrapper component for `anycode-base` providing React context, lifecycle management, and event handling.
-   `anycode/`: Main web application assembling all components together (layout panels, file manager, terminal, AI agent chat panel, search, theme manager).

## Key Features: Detailed Overview

### Editor Engine

The core of `anycode` is a custom-built editor engine powered by `anycode-base`:
-   **Tree-sitter AST Parsing**: Instead of simple regex patterns, the editor builds a full Abstract Syntax Tree (AST) of the code. This enables precise syntax highlighting and serves as the foundation for structural code analysis.
-   **Text Buffer Management**: Built on `vscode-textbuffer`, optimized for frequent text insertions and deletions.

### Rendering Virtualization: How It Works

The key to high performance with massive files is virtualization. Instead of rendering thousands of DOM nodes for every line, `anycode` guarantees that only a small, fixed number of DOM elements exist at any time.

1.  **Viewport**: Only lines physically visible within the viewing area (plus a small buffer) are rendered into the DOM.
2.  **Spacers**: Top and bottom `div` spacer elements dynamically adjust their heights based on hidden lines above and below the viewport, expanding the container to match the true scrollable height of the file.
3.  **Dynamic Scroll Updates**: As the user scrolls up or down, out-of-view lines are recycled from the DOM and new incoming lines are appended, updating spacer heights in real time.

This guarantees constant-time rendering performance regardless of whether a file contains 100 or 100,000 lines of code.

### Code Rendering and Editing

Editor responsiveness is achieved through multi-stage optimizations:
1.  **Text Model Update**: Modifications (character insertion or deletion) apply instantly to `vscode-textbuffer`.
2.  **Incremental Parsing**: Changes are passed to `tree-sitter`, which incrementally updates only the affected AST nodes in sub-milliseconds without re-parsing the whole document.
3.  **Cache Update and Repaint**: Highlight data for affected lines is recomputed and flushed to the line cache, triggering targeted DOM repaints.

### Diff Support and Focused Diff Editor

`anycode-base` includes built-in text diffing and change tracking:
-   **Line-by-Line Diff Calculation (`computeGitChanges`)**: Compares original file contents against current edits to identify added, modified, and deleted lines.
-   **Ghost Rows for Deleted Code**: Deleted lines are displayed inline as "ghost rows" with full syntax highlighting and original line numbering preserved.
-   **Focused Diff Mode**: Automatically collapses unchanged code blocks, rendering only modified hunks with a configurable context line boundary (default: 3 lines).
-   **Interactive Expansion & Navigation**: Collapsed regions can be expanded with a single click, with keyboard cursor navigation adapting to hidden line offsets.
-   **Gutter and Scrollbar Markers**: Change indicators are rendered on the editor gutter and scrollbar area for fast navigation.

### Code Folding

Allows collapsing and expanding structural code blocks (functions, classes, loops):
-   **Smart Block Detection**: The editor detects structural boundaries automatically using Tree-sitter AST queries.
-   **Interactive Controls**: Code folding toggles are accessible via arrow icons on the editor gutter.
-   **Rendering Optimization**: Collapsed code is removed from the visible viewport layout, eliminating DOM overhead.

### Scrollbar Markers

Visualizes key file-wide points of interest directly on the scrollbar track:
-   **Color-Coded Indicators**: Highlights Git diff changes, search query results, LSP diagnostic errors/warnings, and occurrence highlights for the word under the cursor.
-   **Click Navigation**: Clicking any scrollbar marker instantly scrolls the viewport to the target line.

### AI Agent Integration (ACP)

Built-in support for the **Agent Client Protocol (ACP)** enables seamless interaction with AI coding assistants:
-   **Agent and Session Management**: Connect and switch between different AI agents (Grok, Anthropic Claude, etc.) with persistent session history.
-   **Real-Time Streaming**: Supports streaming text, code blocks, Markdown rendering, and tool calls in real time.
-   **Codebase Integration**: AI agents can inspect project files, execute terminal commands, and apply code edits directly in the IDE.

### Real-Time File System & Git Watcher

The Rust backend runs background watcher services to monitor file system and repository events:
-   **Recursive File Watching (`notify`)**: Recursively watches the project workspace for file creation, modification, and deletion events triggered by external tools, Git commands, or AI agents.
-   **Live Incremental Edits (`watcher:edits`)**: When an open file is modified externally, the backend computes a text diff and broadcasts incremental edits to the frontend via WebSockets. The editor seamlessly updates the document text without losing focus or cursor position.
-   **Automatic Git Status Refresh**: File system events instantly update Git diff markers in the editor, file explorer tree badges, and the Git Changes panel.

### Language Server Protocol (LSP) Integration

The Rust backend acts as an LSP client for background language servers (e.g., `rust-analyzer`, `gopls`):
1.  Frontend sends user actions (hover, go-to-definition, completion) to the backend over WebSockets.
2.  Backend forwards requests to the corresponding LSP server process.
3.  LSP responses (type info, hover documentation, diagnostics) are relayed back to the UI.

### Integrated Terminal

Combines **Xterm.js** on the frontend and **portable-pty** on the Rust backend, spawning native shell instances (`zsh`, `bash`) connected over WebSockets.

# Technical Overview of Anycode

**anycode** is a high-performance web-based IDE designed for writing, editing, and managing code directly in the browser. Built with a focus on speed, responsiveness, and extensibility, the project supports a wide range of programming languages, Language Server Protocol (LSP) integration, AI Agent Client Protocol (ACP), terminal emulation, and built-in Diff editing.

## Technology Stack

### Backend (Rust)

-   **Tokio**: The industry-standard asynchronous runtime for writing high-performance network applications in Rust.
-   **Axum**: A minimal and powerful web framework used for HTTP routing and controller architecture.
-   **Socketioxide**: A `Socket.IO` server implementation providing reliable real-time bidirectional WebSocket communication with the client.
-   **LSP-types**: Data structures for working with the Language Server Protocol (LSP).

### Frontend (TypeScript/React)

-   **React & TypeScript**: Interactive, strictly-typed user interface built with modern React.
-   **Vite**: Next-generation build tool delivering instant Hot Module Replacement (HMR) and optimized production builds.
-   **PNPM**: Efficient package manager optimized for monorepos via `pnpm workspaces`.

## Architecture and Component Interaction

The project follows a monorepo architecture managed by `pnpm workspaces`, enabling centralized dependency management and seamless integration between packages:

-   `anycode-backend/` (Rust): The server component bridging the web UI and the user's local operating system. Handles file I/O operations, search, PTY terminal processes, LSP sessions, and ACP clients for AI agents. Communicates with the frontend via **WebSockets** (`Socket.IO`).
-   `anycode-base/`: Core editor engine in pure TypeScript (framework-agnostic):
    -   Text model management (`vscode-textbuffer`).
    -   `web-tree-sitter` integration for real-time AST parsing and Code Folding calculation.
    -   Diff calculation engine (`diff.ts`) and Focused Diff Mode support.
    -   Scrollbar markers rendering engine (Scrollbar Markers).
    -   Virtualized rendering system ensuring only visible lines are rendered to DOM for maximum performance on large files.
-   `anycode-react/`: React wrapper component for `anycode-base` providing React context, lifecycle management, and event handling.
-   `anycode/`: Main web application assembling all components together (layout panels, file manager, terminal, AI agent chat, search, theme manager).

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

### Language Server Protocol (LSP) Integration

The Rust backend acts as an LSP client for background language servers (e.g., `rust-analyzer`, `gopls`):
1.  Frontend sends user actions (hover, go-to-definition, completion) to the backend over WebSockets.
2.  Backend forwards requests to the corresponding LSP server process.
3.  LSP responses (type info, hover documentation, diagnostics) are relayed back to the UI.

### Integrated Terminal

Combines **Xterm.js** on the frontend and **portable-pty** on the Rust backend, spawning native shell instances (`zsh`, `bash`) connected over WebSockets.

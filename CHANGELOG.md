# Changelog

All notable changes are documented here by release tag.

## v0.0.21 - 2026-06-23

### Highlights
- Added scrollbar markers in the editor for diffs, search matches, diagnostics, and word highlights, with click/drag navigation along the scrollbar area.
- Added dedicated TSX syntax highlighting and an Xcode-inspired theme with configurable accent colors.
- Added configurable editor font settings and refined agent message styling.
- Improved Dockview header actions so the hover target adapts on wider panel headers while staying compact in narrow groups.
- Fixed file URI encoding.

### Commits
- `5c4e1f2` Make header action hover area responsive
- `3321e42` Add editor scrollbar markers
- `9e621f5` feat: add configurable font settings and style agent messages
- `4312db8` Add Xcode theme and accent colors
- `e36b2f1` Add dedicated TSX syntax highlighting
- `245c589` Fix file URI encoding

## v0.0.20 - 2026-06-08

### Highlights
- Expanded the file explorer with create-file, create-folder, rename, delete, copy-path, and refresh actions. The new context menus work for both files and folders, file operations are handled by the backend, and open editor tabs stay synchronized when paths are renamed or deleted.
- Added a live backend connection indicator to the toolbar so connection loss and recovery are visible without opening developer tools.
- Added language-aware file and folder icons throughout the explorer, tabs, search, changes, and settings UI. File icons can be displayed in colored, monochrome, or disabled mode.
- Added Tree-Sitter syntax highlighting, folding queries, language detection, and bundled WASM parsers for Markdown, Markdown Inline, PHP, Ruby, Vue, Dockerfile, and SQL. Markdown fenced code blocks now support embedded highlighting for common languages.
- Added tab context-menu actions to close all other tabs and copy a file name, complementing the existing close, close-right, copy-path, and pin controls.
- Added reset actions for agent and terminal panes and fixed layout restoration after closing panes, including stale saved-layout state.
- Refreshed the file tree, toolbar, settings, search, agent, terminal, and panel styling with improved empty states, spacing, controls, and responsive behavior.
- Fixed SVG files being hidden from the file explorer, fixed delayed/stale Git changes panel updates, and corrected the file-tree context menu backdrop blur.
- Added editor language-detection tests and backend Git/file-operation coverage for the new behavior.
- Added a Dockerfile for building the frontend and a statically linked Anycode backend release image.

### Commits
- `ee5c81a` Fix file tree context menu backdrop blur
- `4aa9edb` Fix changes panel updates
- `00f1a77` remove stray syntax test files
- `b29a96a` add file tree actions and connection status
- `e03d28b` fix: stop ignoring svg files in the file explorer (resolves #20)
- `8c22295` feat(toolbar): add close other tabs action and copy name option
- `e4cf6e8` Add syntax highlighting for web and data languages
- `9c1dbe6` Add reset action for agent and terminal panes
- `11cb8bb` add file icons and refresh panel UI
- `52066aa` Fix layout close restore behavior

## v0.0.19 - 2026-06-05

### Highlights
- Refactored ACP support with prompt attachments, permission auto-approval, session resume/close support, usage reporting, and smoother streaming updates.
- Added bracket pair highlighting and restored syntax highlighting around syntax errors, backed by new editor tests.
- Improved Git workflows with cached status updates, deleted-file diff previews, refreshed diff markers, and expanded backend Git tests.
- Optimized editor and search rendering, including scroll performance, Safari caret fixes, and faster search/change updates.
- Upgraded Tree-Sitter WASM assets, major frontend dependencies, GitHub Actions, and the Rust 1.96.0 toolchain.
- Polished agent input/message styling, layout constraints, and mobile panel resize handles.
- Fixed terminal echo test hangs and cleaned up backend warnings and unused code.

### Commits
- `2790046` style(agent): refine ACP input/message styles and update layout panel constraints
- `decf248` Optimize search and git change updates
- `6cd689d` perf: optimize scroll rendering, rename focus methods, and resolve Safari caret bugs
- `79d52c1` perf(git): cache status updates and optimize editor refresh
- `f301257` ci: upgrade github actions to versions targeting Node 24
- `da2a03e` refactor: resolve backend warnings and clean up unused code
- `8087d2a` test(terminal): use cat instead of bash for test_terminal_echo to avoid CI job control hangs
- `d1f4ee9` fix(terminal): fix test_terminal_echo hang by flushing PTY writer and killing child process on loop exit
- `e393b5c` fix(git): support diff preview for deleted files tracked in Git
- `fe76a02` fix(git): update editor original content on git status update to clear diff markers
- `e3436fd` upgrade web-tree-sitter to 0.26.9 and refresh wasm assets
- `b5e19ab` build: upgrade frontend dependencies to latest major versions (xterm v6, dockview v6, diff v9, cpy-cli v7)
- `59832a9` chore: upgrade Rust toolchain to 1.96.0 and cleanup Cargo.toml dependencies
- `996306d` fix: restore syntax highlighting inside/after syntax errors, add tests, configure CI
- `9d21b58` feat(anycode-base): add bracket pair highlighting
- `b9f44ab` feat(layout): optimize panel resize handles for mobile touch devices
- `959e30b` feat: refactor ACP, add prompt attachments, auto-approve permissions and optimize streaming
- `31a8360` refactor renderer dom typing and line-height handling

## v0.0.18 - 2026-05-27

### Commits
- `5992830` feat: add word highlighting 

## v0.0.17 - 2026-05-26

### Commits
- `af1729b` chore(release): bump backend version to 0.0.17
- `5959476` refactor: implement git staging/unstaging and fix status updates
- `6247a69` tmp commit
- `e00c340` fix: allow active folders to toggle when clicked
- `0cf54ee` refactor(backend): modularize runtime wiring and harden git change propagation
- `e8a0723` fix(git): emit changes:update immediately after commit to refresh diff state
- `285d225` fix watcher sync for cached files and gate lsp sync
- `d26e6de` feat: add code folding support via Tree-sitter queries
- `9c051ce` fix: start terminal IDs from 1 instead of 2
- `863e014` style: disable text selection on tab labels
- `ff6c7a7` feat: add tab reordering via drag and drop and fix ghost snap-back animation
- `b850486` style: adjust diff gap gutter button padding
- `5e96dff` feat(toolbar): implement pin/unpin tab functionality with localStorage persistence
- `ec1ce58` Move file tree folder loading into hook
- `124efd3` Add tab context menu and switch terminal tabs to id-based selection
- `6376862` Improve file tree and tab activation sync

## v0.0.16 - 2026-05-23

### Commits
- `d38ba58` Optimize agent/editor UI updates and simplify runnable initialization
- `5162334` Fix backend autosave and LSP notification errors
- `75ca040` Release v0.0.16
- `3fe1b83` Polish agent command styling
- `cc21d2a` Remove autosave config lock from editor hot path

## v0.0.15 - 2026-05-22

### Commits
- `0732954` Fix ARM64 release cross build context
- `5300c6c` Release v0.0.15
- `f1fadc6` Polish agent scrolling, search focus, and themed panels
- `3aed4a6` feat: add anycode theme cloned from vesper with #242424 background and set as default
- `d839e62` Add theming system and stabilize editor workflows
- `9a7187b` Fix selection rendering in focused diff mode
- `fd1ac68` feat: optimize diff computation, fix diff renderer separators, and fix backend compilation
- `167c654` refactor(base): rewrite diff computation logic using line-by-line diffing and cleanup debug logs
- `286cf51` refactor(diff): add syntax-highlighted ghost rows and streamline renderer flow
- `b41978c` refactor(acp/editor/ui): remove runtime ACP permission mode switch and stabilize diff/editor behavior
- `b01b034` Refactor diff mode flow and include original content on file open
- `9e6a966` Fix layout save noise and ignore .zed
- `dde49ed` fix(editor): clear stale editor when closing last tab
- `c17a85d` feat(diff): add diff view modes and focused context rendering
- `0e7934c` fix(diff): include EOF ghost rows in focused diff rendering
- `2bdfc69` chore: sync pending workspace changes
- `4e66202` fix(acp): merge consecutive error messages

## v0.0.14 - 2026-05-09

### Commit at tag
- `620fb30` Improve search actions UX and fast navigation focus

# Changelog

All notable changes are documented here by release tag.

## v0.0.28 - 2026-09-03

### Highlights
- Major rendering performance optimizations: binary token encoding, elimination of forced reflows, and sparse ghost index.
- Sticky file headers, point-based coordinates, transaction support, and diff mode controls for multibuffer review.
- Fixed multibuffer cursor desync, focus sync, and scroll retention across panel switches.
- Fixed LSP document navigation, Windows URI parsing, and preserved diff mode on definition navigation.
- Added copy buttons to ACP markdown code blocks, collapsible long chat messages, and refined auto-scroll.
- Added virtual scrolling to the git changes panel and fixed scrollbar thumb geometry on resize/zoom.

### Commits
- `27042ba` feat(editor): propagate diff mode to multibuffer and restore original content on reconnect
- `9689bf3` fix(lsp): document navigation and Windows URI parsing
- `5840da8` feat(editor): implement sticky file headers for multibuffer review and integration tests
- `3a4eaba` feat(editor): point-based coordinate migration, multibuffer transactions, and test suite
- `6873538` perf: eliminate forced reflows, implement binary tokens, and optimize virtual scrolling
- `1917403` feat(changes-panel): implement virtual scrolling and fix header stats layout
- `da11ffb` Add copy button for markdown code blocks in ACP messages

## v0.0.27 - 2026-08-12

### Highlights
- Added multi-buffer change review with per-file history, focused navigation, and safer diff context handling.
- Added Git history browsing for repositories and individual files, with pagination and historical-file support.
- Added customizable scrollbars with Mac, Windows, and minimal presets, configurable width/minimum size, and persisted settings.
- Improved editor performance for large files, syntax injection, cursor and word highlighting, scrolling, and diff rendering.
- Improved ACP controls, auto-scroll, agent status and message rendering, mobile layout behavior, and settings/layout persistence.
- Added Git push status feedback, stronger Git status/history handling, expanded backend coverage, and demo/e2e coverage.

### Commits
- `b419fcb` Add multibuffer change review
- `82dbff0` Add Git file history timeline
- `3a77956` feat: custom scrollbar implementation with mac visuals, zero reflow, auto-hide, and mobile touch support
- `1df55a8` Improve ACP controls and auto-scroll behavior
- `991060d` Persist settings panel layout

## v0.0.26 - 2026-08-03

### Highlights
- Improved ACP agent launching on Windows, conversation search, message rendering, code previews, prompt input, tool-call collapsing, and session replay.
- Fixed stale editor flashes, panel transition flicker, scroll behavior, and terminal resize handling.
- Improved Git status and revert handling for staged, unstaged, untracked, and deleted files.

### Commits
- `2359eb1` fix: launch ACP commands on Windows
- `3b9d173` fix ACP code previews and prompt input
- `0f23f8f` Fix reverting untracked files
- `f37d081` Optimize ACP agent rendering and tool call collapse
- `07de903` Add search to agent conversations

## v0.0.25 - 2026-07-29

### Highlights
- Improved LSP lifecycle handling, diagnostics, configuration requests, stderr logging, and completion reliability.
- Normalized filesystem paths across backend Socket.IO events and frontend file/search state, including Windows path handling.
- Improved Git status path resolution and file watcher/search consistency.
- Added Windows installation and release build support.

### Commits
- `eda7d94` fix: normalize paths and harden LSP
- `28824a2` Merge pull request #26 from anycode-ade/chore/windows


## v0.0.24 - 2026-07-21

### Highlights
- Upgraded TypeScript to version `7.0.2` across the workspace projects (`anycode-base`, `anycode-react`, and root configurations).
- Refactored layout resizing and group boundaries.
- Upgraded `dockview` and `dockview-react` to version `7.0.2` for modern layout management and responsiveness.
- Implemented editor scroll position persistence (`usePersistedScroll`) to prevent layout/scroll resets when switching between files or panels.
- Configured and integrated the new Grok agent into ACP (Agent Client Protocol) configurations, complete with custom message layout and icon styling support.
- Relocated Language Server Protocol (LSP) docs to the `docs/` folder, resolved relative documentation links, and updated installation instructions for the dotnet LSP.

### Commits
- `d81f605` doc: move lsp.md one level up to docs/ and fix relative links
- `53c1ebc` Merge branch 'pr-25'
- `6675a4b` Refactor layout resize, scroll persistence, upgrade dockview, and integrate Grok agent
- `529fe7f` Update installation docs for dotnet LSP

## v0.0.23 - 2026-07-15

### Highlights
- Updated `agent-client-protocol` dependency to version `1.2.0` and `agent-client-protocol-schema` to version `1.4.0`.
- Removed obsolete unstable features (`unstable_session_usage`, `unstable_session_close`, `unstable_session_resume`), aligning with the newly stabilized schema.
- Updated schema-related imports and trait conversions in the Rust backend.
- Fixed a bug where user prompt messages appeared twice in the chat history by ignoring the agent's echo `user_message_chunk` raw updates (as the client already registers and renders prompt submission immediately).

### Commits
- `94211df` Make release notes professional
- `55cf84c` Bump version to 0.0.23 and add release notes
- `98f8b54` Update agent-client-protocol to 1.2.0 and fix duplicate user messages
- `bfbe9a5` fixed editor tree and tabs switches

## v0.0.22 - 2026-07-14

### Highlights
- Added support for file upload via drag-drop and paste in the terminal.
- Added files search with keyboard navigation improvements and race-condition fixes.
- Added VS Code Dark+/Light+, GitHub Default Dark/Light, and IntelliJ IDEA Darcula/Light editor themes.
- Fixed backend terminal character corruption by buffering incomplete UTF-8 bytes at read boundaries.
- Fixed a panic when finding local paths containing non-ASCII characters.
- Fixed layout scroll resets and jumps during panel activation and dragging.

### Commits
- `8fa09aa` feat(terminal): support file upload via drag-drop and paste
- `da7c580` fix(layout): prevent scroll resets and jumps during panel activation and dragging
- `831e490` feat: add IntelliJ IDEA Darcula and Light themes
- `e1d82ba` feat: add GitHub Default Dark and Light themes
- `302c3ea` feat: add VS Code Dark+ and Light+ themes and clean active tab styling
- `33f1398` fix: prevent panic on non-ASCII characters in find_local_paths
- `8ae7686` fix(backend): prevent terminal character corruption by buffering incomplete UTF-8 bytes at read boundaries
- `c27f0d6` feat: implement and optimize files search, fix keyboard navigation and race conditions

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

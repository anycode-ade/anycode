# Workspace Layout Refactor Plan

## Summary

The current Anycode shell is built around a fixed layout:

- left panel for `files | search | changes`
- center panel for the editor
- right panel for ACP
- bottom panel for terminals
- one global toolbar outside the layout

ACP already has a better internal model in [`anycode/components/agent/AcpDialog.tsx`](../anycode/components/agent/AcpDialog.tsx): it uses a split tree and allows multiple panes. The next step is to promote that idea to the whole application and make the entire shell pane-based.

The target UX is:

- the app starts with a single pane
- each pane can display one content type
- the user can split any pane horizontally or vertically
- the user can replace a pane's content at any time
- toolbar becomes a regular pane type and can live on any side
- layout is restored between sessions

## Goals

- Replace the fixed shell layout with a unified tiled workspace.
- Reuse one split-tree model for all pane types.
- Make `editor`, `files`, `search`, `changes`, `terminal`, `agent`, and `toolbar` first-class pane kinds.
- Keep the current editor, git, search, terminal, and ACP logic reusable with minimal behavior regressions.
- Preserve keyboard-driven workflows through an explicit `activePaneId`.
- Persist layout and pane state in local storage.

## Non-Goals

- No drag-and-drop pane rearranging in the first version.
- No floating windows in the first version.
- No collaborative shared layouts.
- No full ACP-within-ACP nested tiling in the first migration if it complicates the model too much.

## Current Constraints

The current frontend shell in [`anycode/App.tsx`](../anycode/App.tsx) is tightly coupled to:

- `leftPanelVisible`
- `rightPanelVisible`
- `bottomPanelVisible`
- `centerPanelVisible`
- `leftPanelMode`

That structure makes new layouts expensive because content is bound to positions instead of being modeled as reusable pane content.

At the same time, ACP already contains reusable layout primitives:

- split node vs pane node
- `activePaneId`
- split operations
- close pane operations
- session assignment to panes

Those primitives should be extracted into a shared workspace layer.

## Target Architecture

### Core Model

Introduce a single workspace tree:

```ts
type WorkspaceNode = WorkspaceSplitNode | WorkspacePaneNode;

type WorkspaceSplitNode = {
  id: string;
  type: 'split';
  direction: 'row' | 'column';
  children: [WorkspaceNode, WorkspaceNode];
};

type WorkspacePaneKind =
  | 'editor'
  | 'files'
  | 'search'
  | 'changes'
  | 'terminal'
  | 'agent'
  | 'toolbar';

type WorkspacePaneNode = {
  id: string;
  type: 'pane';
  kind: WorkspacePaneKind;
  state: WorkspacePaneState;
};
```

Pane-local state should be discriminated by `kind`:

```ts
type WorkspacePaneState =
  | EditorPaneState
  | FilesPaneState
  | SearchPaneState
  | ChangesPaneState
  | TerminalPaneState
  | AgentPaneState
  | ToolbarPaneState;
```

### Workspace Controller

Add a shared controller hook, for example:

```ts
function useWorkspaceLayout(...)
```

It should own:

- `layout`
- `activePaneId`
- `splitPane(paneId, direction, nextPane)`
- `closePane(paneId)`
- `replacePaneKind(paneId, kind, state?)`
- `focusPane(paneId)`
- `updatePaneState(paneId, updater)`
- `findPane(paneId)`
- `serializeLayout()`
- `restoreLayout()`

This hook should contain the generic tree logic that currently lives inside ACP.

## Pane Types

### `editor`

Purpose:

- Display an editor instance for a file.
- Support opening files from tree, search, git changes, and agent messages.

Open design question:

- Should each editor pane have its own active file, or should all editor panes share one global tab set?

Recommended MVP:

- Keep one global list of open files.
- Each editor pane stores its own `activeFileId`.
- If a pane has no file selected, it renders an empty editor state.

Suggested state:

```ts
type EditorPaneState = {
  activeFileId: string | null;
  diffEnabled?: boolean;
};
```

### `files`

Purpose:

- Display the project file tree.

Recommended behavior:

- Multiple files panes are allowed, even if most users only need one.
- Selection can remain global if that simplifies tree/watcher integration.

Suggested state:

```ts
type FilesPaneState = {
  rootPath?: string;
};
```

### `search`

Purpose:

- Display workspace search UI and results.

Recommended behavior:

- Search panes should own their local query text and result list.
- Clicking a result should open the file in the active editor pane or create one if needed.

Suggested state:

```ts
type SearchPaneState = {
  query: string;
};
```

### `changes`

Purpose:

- Show git changes and git actions.

Recommended behavior:

- Can reuse existing git hook and panel component.
- Clicking a changed file should open diff in an editor pane.

Suggested state:

```ts
type ChangesPaneState = {
  showUntracked?: boolean;
};
```

### `terminal`

Purpose:

- Show one terminal session or terminal tabs.

Open design question:

- Should each terminal pane contain one terminal session or keep the current tab-strip model inside the pane?

Recommended MVP:

- Keep the current terminal tabs implementation.
- A terminal pane hosts the existing tabs UI and terminal content.
- Later, add an option for one-session-per-pane if needed.

Suggested state:

```ts
type TerminalPaneState = {
  selectedTerminalId?: string | null;
};
```

### `agent`

Purpose:

- Show ACP sessions and interaction UI.

Open design question:

- Should ACP keep its own internal pane layout after the shell becomes pane-based?

Recommended MVP:

- Simplify `agent` pane to one ACP session view per workspace pane.
- Move session switching into pane controls.
- Keep ACP settings outside the internal split tree.

Reason:

- Nested tiling inside a tiled shell increases complexity a lot.
- Global workspace panes are enough to show multiple agents side by side.

Suggested state:

```ts
type AgentPaneState = {
  sessionId: string | null;
};
```

If preserving ACP internal multipane behavior is important, keep that as a second-phase enhancement rather than part of the migration.

### `toolbar`

Purpose:

- Provide global workspace actions from a movable pane.

Recommended behavior:

- The toolbar is a regular pane type.
- It auto-switches between vertical and horizontal layouts based on pane dimensions.
- It dispatches workspace actions instead of mutating old visibility flags.

Suggested state:

```ts
type ToolbarPaneState = {
  mode?: 'auto' | 'horizontal' | 'vertical';
  compact?: boolean;
};
```

Toolbar actions should include:

- split active pane horizontally
- split active pane vertically
- close active pane
- change active pane kind
- create editor pane
- create terminal pane
- create agent pane
- toggle diff mode if it remains global

## Layout Behavior Rules

The workspace needs simple rules to stay understandable.

Recommended rules:

- The app starts with one `editor` pane and one `toolbar` pane preset, or one `toolbar` pane that lets the user choose what to open next.
- Every pane is focusable and updates `activePaneId`.
- Keyboard actions operate on `activePaneId`.
- Replacing a pane kind resets incompatible pane-local state.
- Closing the last pane recreates one fallback pane instead of leaving an empty workspace.
- Pane minimum sizes should stay conservative to avoid unusable narrow panes.

Recommended fallback initial layout:

```text
row
├─ toolbar
└─ editor
```

Alternative ultra-minimal layout:

```text
editor
```

The first option is easier to discover. The second is cleaner but needs stronger empty-state actions.

## Opening Logic

The app currently assumes a fixed editor target. That must be replaced with explicit routing rules.

Recommended rules:

- If the active pane is an `editor`, open files there.
- If the active pane is not an `editor`, find the nearest or last-focused editor pane.
- If no editor pane exists, create one and open the file there.
- Search result clicks, tree clicks, git diff clicks, and ACP file links should all use the same helper.

Add a helper such as:

```ts
openFileInWorkspace(path, options?)
```

This helper should centralize pane targeting.

## Persistence

The current app already persists visibility flags and terminal state. Replace that with workspace persistence.

Persist:

- workspace layout tree
- active pane id
- pane-local states
- last-focused editor pane id

Keep existing persistence where still useful:

- open files
- terminal sessions
- agent sessions
- ACP permission mode
- diff mode if still global

Storage changes:

- deprecate `leftPanelVisible`, `rightPanelVisible`, `bottomPanelVisible`, `centerPanelVisible`, `leftPanelMode`
- add `workspaceLayout`
- add `workspaceActivePaneId`

Migration behavior:

- if new workspace storage is absent, build an initial layout from the old flags once
- after migration, only write the new structure

## Refactor Strategy

### Phase 1: Extract Shared Layout Engine

Create a reusable workspace module, for example:

- `anycode/workspace/types.ts`
- `anycode/workspace/layout.ts`
- `anycode/workspace/useWorkspaceLayout.ts`
- `anycode/workspace/WorkspaceView.tsx`

Move from ACP:

- split tree types
- `createPaneNode`
- `splitPane`
- `removePane`
- `getFirstPaneId`
- `focus` helpers
- session assignment pattern where still useful

Result:

- ACP no longer owns generic split logic.

### Phase 2: Introduce Pane Renderers

Create renderer components:

- `WorkspaceEditorPane`
- `WorkspaceFilesPane`
- `WorkspaceSearchPane`
- `WorkspaceChangesPane`
- `WorkspaceTerminalPane`
- `WorkspaceAgentPane`
- `WorkspaceToolbarPane`

Each renderer receives:

- pane state
- active/focused state
- workspace actions
- existing domain hooks and handlers

Result:

- `App.tsx` stops containing giant inline panel branches.

### Phase 3: Replace Fixed App Layout

In [`anycode/App.tsx`](../anycode/App.tsx):

- remove nested fixed `Allotment` structure for left/center/right/bottom shell
- render one `WorkspaceView`
- remove old visibility state
- remove `leftPanelMode`
- convert toolbar from global footer/header chrome into a pane renderer

Result:

- Shell layout is fully driven by workspace tree.

### Phase 4: Migrate ACP

Decide one of two paths.

Path A, recommended:

- `agent` pane owns one ACP session
- ACP internal split UI is removed
- split controls move to global workspace toolbar or pane header

Path B, more expensive:

- `agent` pane embeds current multipane ACP layout
- workspace panes may contain nested ACP panes

Recommendation:

- Use Path A first.
- Path B only if users strongly need ACP-only internal sublayout after the global tiling lands.

### Phase 5: Persistence and Hotkeys

Update storage helpers and keyboard handling:

- split active pane
- close active pane
- cycle pane type
- route open actions to the proper editor pane

Add migration code for older local storage keys.

### Phase 6: Polish

- better empty states
- pane headers
- context menu for changing pane type
- presets
- optional duplication limits for some pane kinds

## Suggested New Modules

Suggested file structure:

```text
anycode/
├── workspace/
│   ├── layout.ts
│   ├── types.ts
│   ├── storage.ts
│   ├── useWorkspaceLayout.ts
│   ├── WorkspaceView.tsx
│   ├── WorkspacePaneFrame.tsx
│   └── panes/
│       ├── WorkspaceEditorPane.tsx
│       ├── WorkspaceFilesPane.tsx
│       ├── WorkspaceSearchPane.tsx
│       ├── WorkspaceChangesPane.tsx
│       ├── WorkspaceTerminalPane.tsx
│       ├── WorkspaceAgentPane.tsx
│       └── WorkspaceToolbarPane.tsx
```

## App State Ownership

The refactor will go smoother if state ownership stays clear.

Recommended ownership:

- `App.tsx`
  - socket connection
  - global hooks for files, git, search, terminals, editors, agents
  - workspace controller
- workspace layer
  - layout tree
  - active pane tracking
  - pane state updates
  - pane kind changes
- domain hooks
  - business logic for editors, terminals, git, search, ACP

This keeps the refactor mostly at the composition layer instead of rewriting each feature module.

## Editor Strategy

This is the highest-risk part because the app today assumes one visible editor area.

Recommended MVP:

- keep editor models and open files in the existing editor hook
- allow multiple `AnycodeEditorReact` mounts backed by different `activeFileId`s
- pane-local state chooses which file a pane shows
- if the same file is shown in two panes, allow it unless rendering or synchronization issues appear

Possible follow-up if needed:

- add true split-editor semantics
- add pane-local cursor/view state persistence

## Terminal Strategy

Recommended MVP:

- keep the current terminal sessions data model
- mount the existing tabs-and-content UI inside a `terminal` pane
- later, if users want true terminal-per-pane behavior, split tabs into separate pane types or add "detach to pane"

This avoids breaking terminal lifecycle code early in the refactor.

## Agent Strategy

Recommended MVP:

- treat each workspace `agent` pane as one ACP session surface
- session picker belongs in the pane header
- creating a new agent can either:
  - attach to the active `agent` pane
  - or create a new `agent` pane if the active pane is not an agent pane

This aligns ACP with the global tiling model and removes nested workspace semantics.

## Toolbar Strategy

The toolbar should stop being a visibility toggle strip for fixed areas and become a command surface for the pane system.

Recommended controls:

- split horizontal
- split vertical
- close pane
- choose pane kind
- quick-create editor
- quick-create terminal
- quick-create agent
- quick-open search

Orientation logic:

- use `ResizeObserver` or pane container dimensions
- if width > height, prefer horizontal
- if height >= width, prefer vertical
- allow manual override through `ToolbarPaneState.mode`

## UX Details

Recommended pane frame elements:

- title
- pane kind icon
- focus style
- kind switcher
- split actions
- close action

Recommended empty pane behavior:

- show large buttons for selecting pane kind
- optionally suggest the most common kinds: `editor`, `terminal`, `agent`, `files`

Recommended discovery behavior:

- initial layout should not be visually empty
- at least one obvious command surface should be present on first launch

## Risks

### 1. Editor assumptions are more global than they look

The editor hook may assume one active editor target. If so, file opening and diagnostics mapping will need careful review.

Mitigation:

- introduce a workspace file-open router early
- keep open-files storage global
- make pane-local file selection additive rather than invasive

### 2. Nested ACP layout may fight the new workspace model

Keeping ACP multipane layout inside a global tiled workspace may create confusing focus and shortcut behavior.

Mitigation:

- flatten ACP to one session per pane for the first release

### 3. Search may currently behave like a singleton

If search state is global today, multiple search panes will not be truly independent.

Mitigation:

- either accept one global search state in MVP
- or scope search results to pane state in phase 2

### 4. Too much freedom can create a messy UI

Fully free pane creation can lead to unusable layouts.

Mitigation:

- enforce minimum sizes
- add clear empty states
- ship sensible defaults
- optionally add "reset layout"

## Testing Plan

Manual verification checklist:

- split any pane horizontally
- split any pane vertically
- close panes until one remains
- change pane kind without reloading
- restore layout after refresh
- open file from file tree into correct editor pane
- open search result into correct editor pane
- open diff from changes pane into correct editor pane
- open file links from ACP into correct editor pane
- create multiple terminal panes without losing terminal sessions
- create multiple agent panes and interact with separate sessions
- move toolbar to a vertical narrow pane and verify orientation switch
- move toolbar to a horizontal wide pane and verify orientation switch

Regression checklist:

- reconnect terminals after socket reconnect
- reconnect ACP sessions after socket reconnect
- diagnostics still reach visible editors
- git status updates still refresh
- search cancel and search end still behave correctly

## Implementation Order

Recommended order of work:

1. Extract workspace tree utilities from ACP.
2. Create generic workspace types and controller hook.
3. Render editor pane and files pane through the new workspace shell.
4. Add search and changes panes.
5. Add terminal pane.
6. Flatten ACP into agent pane.
7. Convert toolbar into pane type.
8. Add persistence and migration from old local storage keys.
9. Remove dead visibility and fixed-layout code from `App.tsx`.
10. Polish UX and add layout reset.

## Recommendation

The safest path is not to "make ACP panels available everywhere" by stretching ACP itself. The better design is to extract ACP's split-tree ideas into a shared workspace system and let ACP become one pane type inside it.

That gives the app one layout model instead of two competing ones:

- one workspace tree
- one active pane concept
- one routing path for open actions
- one persistence model

This is the cleanest way to support user-defined layouts, movable toolbar placement, and future pane types without the shell collapsing into special-case code.

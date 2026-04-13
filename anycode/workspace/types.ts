export type WorkspaceSplitDirection = 'row' | 'column';

export type WorkspacePaneKind =
    | 'empty'
    | 'editor'
    | 'files'
    | 'search'
    | 'changes'
    | 'terminal'
    | 'agent'
    | 'toolbar';

export type EmptyPaneState = Record<string, never>;

export type EditorPaneState = {
    activeFileId: string | null;
};

export type FilesPaneState = {
    rootPath?: string;
};

export type SearchPaneState = {
    query?: string;
};

export type ChangesPaneState = {
    showUntracked?: boolean;
};

export type TerminalPaneState = {
    selectedTerminalId?: string | null;
};

export type AgentPaneState = {
    sessionId: string | null;
};

export type ToolbarPaneState = {
    mode?: 'auto' | 'horizontal' | 'vertical';
    compact?: boolean;
};

export type WorkspacePaneStateByKind = {
    empty: EmptyPaneState;
    editor: EditorPaneState;
    files: FilesPaneState;
    search: SearchPaneState;
    changes: ChangesPaneState;
    terminal: TerminalPaneState;
    agent: AgentPaneState;
    toolbar: ToolbarPaneState;
};

export type WorkspacePaneState = WorkspacePaneStateByKind[WorkspacePaneKind];

export type WorkspacePaneNodeByKind<K extends WorkspacePaneKind> = {
    id: string;
    type: 'pane';
    kind: K;
    state: WorkspacePaneStateByKind[K];
};

export type WorkspacePaneNode = {
    [K in WorkspacePaneKind]: WorkspacePaneNodeByKind<K>;
}[WorkspacePaneKind];

export type WorkspaceSplitNode = {
    id: string;
    type: 'split';
    direction: WorkspaceSplitDirection;
    sizes?: [number, number];
    children: [WorkspaceNode, WorkspaceNode];
};

export type WorkspaceNode = WorkspacePaneNode | WorkspaceSplitNode;

export type WorkspaceLayoutState = {
    layout: WorkspaceNode;
    activePaneId: string;
    lastFocusedEditorPaneId: string | null;
    lastFocusedAgentPaneId: string | null;
};

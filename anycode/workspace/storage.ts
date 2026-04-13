import {
    loadBottomVisible,
    loadCenterPaneVisible,
    loadItem,
    loadLeftPanelVisible,
    loadRightPanelVisible,
    saveItem,
} from '../storage';
import { createInitialWorkspaceState, createPaneNode } from './layout';
import type { WorkspaceLayoutState, WorkspaceNode } from './types';

const WORKSPACE_LAYOUT_STORAGE_KEY = 'workspaceLayoutState';

const buildLegacyWorkspaceState = (): WorkspaceLayoutState => {
    const leftVisible = loadLeftPanelVisible();
    const rightVisible = loadRightPanelVisible();
    const bottomVisible = loadBottomVisible();
    const centerVisible = loadCenterPaneVisible();

    const panes = {
        toolbar: createPaneNode('toolbar'),
        files: createPaneNode('files'),
        editor: createPaneNode('editor'),
        agent: createPaneNode('agent'),
        terminal: createPaneNode('terminal'),
    };

    let main: WorkspaceNode = centerVisible
        ? panes.editor
        : rightVisible
            ? panes.agent
            : leftVisible
                ? panes.files
                : bottomVisible
                    ? panes.terminal
                    : panes.editor;

    if (leftVisible && main.id !== panes.files.id) {
        main = {
            id: `split-left-${Math.random().toString(36).slice(2, 10)}`,
            type: 'split',
            direction: 'row',
            children: [panes.files, main],
        };
    }

    if (rightVisible && main.id !== panes.agent.id) {
        main = {
            id: `split-right-${Math.random().toString(36).slice(2, 10)}`,
            type: 'split',
            direction: 'row',
            children: [main, panes.agent],
        };
    }

    if (bottomVisible && main.id !== panes.terminal.id) {
        main = {
            id: `split-root-${Math.random().toString(36).slice(2, 10)}`,
            type: 'split',
            direction: 'column',
            children: [main, panes.terminal],
        };
    }

    const layout = {
        id: `split-toolbar-${Math.random().toString(36).slice(2, 10)}`,
        type: 'split' as const,
        direction: 'row' as const,
        children: [panes.toolbar, main] as [WorkspaceNode, WorkspaceNode],
    };

    return {
        layout,
        activePaneId: centerVisible ? panes.editor.id : getFallbackActivePaneId(panes, { leftVisible, rightVisible, bottomVisible }),
        lastFocusedEditorPaneId: centerVisible ? panes.editor.id : null,
        lastFocusedAgentPaneId: rightVisible ? panes.agent.id : null,
    };
};

const getFallbackActivePaneId = (
    panes: Record<'toolbar' | 'files' | 'editor' | 'agent' | 'terminal', { id: string }>,
    visibility: { leftVisible: boolean; rightVisible: boolean; bottomVisible: boolean },
): string => {
    if (visibility.rightVisible) return panes.agent.id;
    if (visibility.leftVisible) return panes.files.id;
    if (visibility.bottomVisible) return panes.terminal.id;
    return panes.editor.id;
};

export const loadWorkspaceLayoutState = (): WorkspaceLayoutState => (
    loadItem<WorkspaceLayoutState>(WORKSPACE_LAYOUT_STORAGE_KEY) ?? buildLegacyWorkspaceState() ?? createInitialWorkspaceState()
);

export const saveWorkspaceLayoutState = (state: WorkspaceLayoutState): void => {
    saveItem(WORKSPACE_LAYOUT_STORAGE_KEY, state);
};

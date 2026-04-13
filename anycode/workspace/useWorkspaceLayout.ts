import { useCallback, useMemo, useRef, useState } from 'react';
import {
    collectPanes,
    createInitialWorkspaceState,
    createPaneNode,
    findFirstPaneByKind,
    findPane,
    getFirstPaneId,
    removePaneNode,
    replacePaneKindNode,
    splitPaneNode,
    swapPaneWithSiblingNode,
    toggleParentSplitDirectionForPaneNode,
    updateSplitNodeSizes,
    updatePaneNodeState,
} from './layout';
import { loadWorkspaceLayoutState, saveWorkspaceLayoutState } from './storage';
import type {
    WorkspaceLayoutState,
    WorkspacePaneKind,
    WorkspacePaneNode,
    WorkspacePaneStateByKind,
    WorkspaceSplitDirection,
} from './types';

export const useWorkspaceLayout = () => {
    const initialState = loadWorkspaceLayoutState() ?? createInitialWorkspaceState();
    const [state, setState] = useState<WorkspaceLayoutState>(initialState);
    const stateRef = useRef<WorkspaceLayoutState>(initialState);

    const persist = useCallback((nextState: WorkspaceLayoutState) => {
        stateRef.current = nextState;
        setState(nextState);
        saveWorkspaceLayoutState(nextState);
    }, []);

    const focusPane = useCallback((paneId: string) => {
        const currentState = stateRef.current;
        const pane = findPane(currentState.layout, paneId);
        if (!pane) return;

        persist({
            ...currentState,
            activePaneId: paneId,
            lastFocusedEditorPaneId: pane.kind === 'editor' ? paneId : currentState.lastFocusedEditorPaneId,
            lastFocusedAgentPaneId: pane.kind === 'agent' ? paneId : currentState.lastFocusedAgentPaneId,
        });
    }, [persist]);

    const splitPane = useCallback(<K extends WorkspacePaneKind>(
        paneId: string,
        direction: WorkspaceSplitDirection,
        kind: K,
        paneState?: Partial<WorkspacePaneStateByKind[K]>,
    ) => {
        const currentState = stateRef.current;
        const nextPane = createPaneNode(kind, paneState) as WorkspacePaneNode;
        const nextLayout = splitPaneNode(currentState.layout, paneId, direction, nextPane);

        persist({
            layout: nextLayout,
            activePaneId: nextPane.id,
            lastFocusedEditorPaneId: kind === 'editor' ? nextPane.id : currentState.lastFocusedEditorPaneId,
            lastFocusedAgentPaneId: kind === 'agent' ? nextPane.id : currentState.lastFocusedAgentPaneId,
        });

        return nextPane.id;
    }, [persist]);

    const closePane = useCallback((paneId: string) => {
        const currentState = stateRef.current;
        const nextLayout = removePaneNode(currentState.layout, paneId);
        if (!nextLayout) {
            const fallback = createInitialWorkspaceState();
            persist(fallback);
            return;
        }

        const nextActivePaneId = currentState.activePaneId === paneId ? getFirstPaneId(nextLayout) : currentState.activePaneId;
        const nextActivePane = findPane(nextLayout, nextActivePaneId);
        const lastFocusedEditorPaneId = currentState.lastFocusedEditorPaneId === paneId
            ? findFirstPaneByKind(nextLayout, 'editor')?.id ?? null
            : currentState.lastFocusedEditorPaneId;

        persist({
            layout: nextLayout,
            activePaneId: nextActivePane?.id ?? getFirstPaneId(nextLayout),
            lastFocusedEditorPaneId: nextActivePane?.kind === 'editor'
                ? nextActivePane.id
                : lastFocusedEditorPaneId,
            lastFocusedAgentPaneId: nextActivePane?.kind === 'agent'
                ? nextActivePane.id
                : currentState.lastFocusedAgentPaneId === paneId
                    ? findFirstPaneByKind(nextLayout, 'agent')?.id ?? null
                    : currentState.lastFocusedAgentPaneId,
        });
    }, [persist]);

    const replacePaneKind = useCallback(<K extends WorkspacePaneKind>(
        paneId: string,
        kind: K,
        paneState?: Partial<WorkspacePaneStateByKind[K]>,
    ) => {
        const currentState = stateRef.current;
        const nextLayout = replacePaneKindNode(currentState.layout, paneId, kind, paneState);
        persist({
            layout: nextLayout,
            activePaneId: paneId,
            lastFocusedEditorPaneId: kind === 'editor' ? paneId : currentState.lastFocusedEditorPaneId,
            lastFocusedAgentPaneId: kind === 'agent' ? paneId : currentState.lastFocusedAgentPaneId,
        });
    }, [persist]);

    const updatePaneState = useCallback((paneId: string, updater: (pane: WorkspacePaneNode) => WorkspacePaneNode) => {
        const currentState = stateRef.current;
        const nextLayout = updatePaneNodeState(currentState.layout, paneId, updater);
        persist({
            ...currentState,
            layout: nextLayout,
        });
    }, [persist]);

    const swapPaneWithSibling = useCallback((paneId: string) => {
        const currentState = stateRef.current;
        const nextLayout = swapPaneWithSiblingNode(currentState.layout, paneId);
        if (nextLayout === currentState.layout) return;

        persist({
            ...currentState,
            layout: nextLayout,
        });
    }, [persist]);

    const toggleParentSplitDirectionForPane = useCallback((paneId: string) => {
        const currentState = stateRef.current;
        const nextLayout = toggleParentSplitDirectionForPaneNode(currentState.layout, paneId);
        if (nextLayout === currentState.layout) return;

        persist({
            ...currentState,
            layout: nextLayout,
        });
    }, [persist]);

    const updateSplitSizes = useCallback((splitId: string, sizes: [number, number]) => {
        const currentState = stateRef.current;
        const nextLayout = updateSplitNodeSizes(currentState.layout, splitId, sizes);
        if (nextLayout === currentState.layout) return;

        const nextState: WorkspaceLayoutState = {
            ...currentState,
            layout: nextLayout,
        };

        // Persist split sizes without triggering React re-render on drag end.
        stateRef.current = nextState;
        saveWorkspaceLayoutState(nextState);
    }, []);

    const panes = useMemo(() => collectPanes(state.layout), [state.layout]);

    return {
        layout: state.layout,
        activePaneId: state.activePaneId,
        lastFocusedEditorPaneId: state.lastFocusedEditorPaneId,
        lastFocusedAgentPaneId: state.lastFocusedAgentPaneId,
        panes,
        findPane: (paneId: string) => findPane(stateRef.current.layout, paneId),
        focusPane,
        splitPane,
        closePane,
        swapPaneWithSibling,
        toggleParentSplitDirectionForPane,
        updateSplitSizes,
        replacePaneKind,
        updatePaneState,
    };
};

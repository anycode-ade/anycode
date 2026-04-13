import {
    type WorkspaceLayoutState,
    type WorkspaceNode,
    type WorkspacePaneKind,
    type WorkspacePaneNode,
    type WorkspacePaneNodeByKind,
    type WorkspacePaneStateByKind,
    type WorkspaceSplitDirection,
} from './types';

const createId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
const swapSplitSizes = (sizes?: [number, number]): [number, number] | undefined => {
    if (!sizes) return undefined;
    const [first, second] = sizes;
    return [second, first];
};

const keepSplitSizes = (sizes?: [number, number]): [number, number] | undefined => {
    if (!sizes) return undefined;
    const [first, second] = sizes;
    return [first, second];
};

export const createDefaultPaneState = <K extends WorkspacePaneKind>(
    kind: K,
    state?: Partial<WorkspacePaneStateByKind[K]>,
): WorkspacePaneStateByKind[K] => {
    const baseState = (() => {
        switch (kind) {
            case 'empty':
                return {};
            case 'editor':
                return { activeFileId: null };
            case 'files':
                return {};
            case 'search':
                return { query: '' };
            case 'changes':
                return { showUntracked: true };
            case 'terminal':
                return { selectedTerminalId: null };
            case 'agent':
                return { sessionId: null };
            case 'toolbar':
                return { mode: 'auto', compact: false };
        }
    })();

    return { ...baseState, ...state } as WorkspacePaneStateByKind[K];
};

export const createPaneNode = <K extends WorkspacePaneKind>(
    kind: K,
    state?: Partial<WorkspacePaneStateByKind[K]>,
): WorkspacePaneNodeByKind<K> => ({
    id: createId('pane'),
    type: 'pane',
    kind,
    state: createDefaultPaneState(kind, state),
});

export const createInitialWorkspaceState = (): WorkspaceLayoutState => {
    const toolbarPane = createPaneNode('toolbar');
    const editorPane = createPaneNode('editor');

    return {
        layout: {
            id: createId('split'),
            type: 'split',
            direction: 'row',
            children: [toolbarPane, editorPane],
        },
        activePaneId: editorPane.id,
        lastFocusedEditorPaneId: editorPane.id,
        lastFocusedAgentPaneId: null,
    };
};

export const getFirstPaneId = (node: WorkspaceNode): string => (
    node.type === 'pane' ? node.id : getFirstPaneId(node.children[0])
);

export const countPanes = (node: WorkspaceNode): number => (
    node.type === 'pane'
        ? 1
        : countPanes(node.children[0]) + countPanes(node.children[1])
);

export const findPane = (node: WorkspaceNode, paneId: string): WorkspacePaneNode | null => {
    if (node.type === 'pane') {
        return node.id === paneId ? node : null;
    }

    return findPane(node.children[0], paneId) ?? findPane(node.children[1], paneId);
};

export const findParentSplitId = (node: WorkspaceNode, paneId: string): string | null => {
    if (node.type === 'pane') {
        return null;
    }

    const [left, right] = node.children;
    if (left.type === 'pane' && left.id === paneId) {
        return node.id;
    }
    if (right.type === 'pane' && right.id === paneId) {
        return node.id;
    }

    return findParentSplitId(left, paneId) ?? findParentSplitId(right, paneId);
};

export const findParentSplitIdByNodeId = (node: WorkspaceNode, nodeId: string): string | null => {
    if (node.type === 'pane') {
        return null;
    }

    const [left, right] = node.children;
    if (left.id === nodeId || right.id === nodeId) {
        return node.id;
    }

    return findParentSplitIdByNodeId(left, nodeId) ?? findParentSplitIdByNodeId(right, nodeId);
};

export const findFirstPaneByKind = (node: WorkspaceNode, kind: WorkspacePaneKind): WorkspacePaneNode | null => {
    if (node.type === 'pane') {
        return node.kind === kind ? node : null;
    }

    return findFirstPaneByKind(node.children[0], kind) ?? findFirstPaneByKind(node.children[1], kind);
};

export const collectPanes = (node: WorkspaceNode, panes: WorkspacePaneNode[] = []): WorkspacePaneNode[] => {
    if (node.type === 'pane') {
        panes.push(node);
        return panes;
    }

    collectPanes(node.children[0], panes);
    collectPanes(node.children[1], panes);
    return panes;
};

export const splitPaneNode = (
    node: WorkspaceNode,
    paneId: string,
    direction: WorkspaceSplitDirection,
    nextPane: WorkspacePaneNode,
): WorkspaceNode => {
    if (node.type === 'pane') {
        if (node.id !== paneId) {
            return node;
        }

        return {
            id: createId('split'),
            type: 'split',
            direction,
            children: [node, nextPane],
        };
    }

    return {
        ...node,
        children: [
            splitPaneNode(node.children[0], paneId, direction, nextPane),
            splitPaneNode(node.children[1], paneId, direction, nextPane),
        ],
    };
};

export const removePaneNode = (node: WorkspaceNode, paneId: string): WorkspaceNode | null => {
    if (node.type === 'pane') {
        return node.id === paneId ? null : node;
    }

    const left = removePaneNode(node.children[0], paneId);
    const right = removePaneNode(node.children[1], paneId);

    if (!left && !right) return null;
    if (!left) return right;
    if (!right) return left;

    return {
        ...node,
        children: [left, right],
    };
};

export const getSiblingPaneId = (node: WorkspaceNode, paneId: string): string | null => {
    if (node.type === 'pane') {
        return null;
    }

    const [left, right] = node.children;
    if (left.type === 'pane' && left.id === paneId) {
        return getFirstPaneId(right);
    }
    if (right.type === 'pane' && right.id === paneId) {
        return getFirstPaneId(left);
    }

    const leftResult = getSiblingPaneId(left, paneId);
    if (leftResult) return leftResult;

    return getSiblingPaneId(right, paneId);
};

export const swapPaneWithSiblingNode = (node: WorkspaceNode, paneId: string): WorkspaceNode => {
    if (node.type === 'pane') {
        return node;
    }

    const [left, right] = node.children;
    const swappedSizes = swapSplitSizes(node.sizes);

    if (left.type === 'pane' && left.id === paneId) {
        return {
            ...node,
            sizes: swappedSizes,
            children: [right, left],
        };
    }

    if (right.type === 'pane' && right.id === paneId) {
        return {
            ...node,
            sizes: swappedSizes,
            children: [right, left],
        };
    }

    const nextLeft = swapPaneWithSiblingNode(left, paneId);
    const nextRight = swapPaneWithSiblingNode(right, paneId);

    if (nextLeft === left && nextRight === right) {
        return node;
    }

    return {
        ...node,
        children: [nextLeft, nextRight],
    };
};

export const toggleParentSplitDirectionForPaneNode = (node: WorkspaceNode, paneId: string): WorkspaceNode => {
    if (node.type === 'pane') {
        return node;
    }

    const [left, right] = node.children;
    const isDirectChild = (left.type === 'pane' && left.id === paneId)
        || (right.type === 'pane' && right.id === paneId);

    if (isDirectChild) {
        return {
            ...node,
            direction: node.direction === 'row' ? 'column' : 'row',
            sizes: keepSplitSizes(node.sizes),
        };
    }

    const nextLeft = toggleParentSplitDirectionForPaneNode(left, paneId);
    const nextRight = toggleParentSplitDirectionForPaneNode(right, paneId);
    if (nextLeft === left && nextRight === right) {
        return node;
    }

    return {
        ...node,
        children: [nextLeft, nextRight],
    };
};

export const replacePaneKindNode = <K extends WorkspacePaneKind>(
    node: WorkspaceNode,
    paneId: string,
    kind: K,
    state?: Partial<WorkspacePaneStateByKind[K]>,
): WorkspaceNode => {
    if (node.type === 'pane') {
        return node.id === paneId
            ? {
                id: node.id,
                type: 'pane',
                kind,
                state: createDefaultPaneState(kind, state),
            } as WorkspacePaneNode
            : node;
    }

    return {
        ...node,
        children: [
            replacePaneKindNode(node.children[0], paneId, kind, state),
            replacePaneKindNode(node.children[1], paneId, kind, state),
        ],
    };
};

export const updatePaneNodeState = (
    node: WorkspaceNode,
    paneId: string,
    updater: (pane: WorkspacePaneNode) => WorkspacePaneNode,
): WorkspaceNode => {
    if (node.type === 'pane') {
        return node.id === paneId ? updater(node) : node;
    }

    return {
        ...node,
        children: [
            updatePaneNodeState(node.children[0], paneId, updater),
            updatePaneNodeState(node.children[1], paneId, updater),
        ],
    };
};

export const updateSplitNodeSizes = (
    node: WorkspaceNode,
    splitId: string,
    sizes: [number, number],
): WorkspaceNode => {
    if (node.type === 'pane') {
        return node;
    }

    if (node.id === splitId) {
        return {
            ...node,
            sizes,
        };
    }

    const nextLeft = updateSplitNodeSizes(node.children[0], splitId, sizes);
    const nextRight = updateSplitNodeSizes(node.children[1], splitId, sizes);

    if (nextLeft === node.children[0] && nextRight === node.children[1]) {
        return node;
    }

    return {
        ...node,
        children: [nextLeft, nextRight],
    };
};

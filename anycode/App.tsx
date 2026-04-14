import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnycodeEditorReact } from 'anycode-react';
import {
  Mosaic, MosaicWindow, MosaicNode, MosaicPath,
  ExpandButton, RemoveButton, MosaicContext, MosaicWindowContext
} from 'react-mosaic-component';
import 'react-mosaic-component/react-mosaic-component.css';
import {
    TreeNodeComponent,
    TerminalComponent,
    ChangesPanel,
} from './components';
import { AcpAgentsList } from './components/agent/AcpAgentsList';
import { AcpSessionView } from './components/agent/AcpSessionView';
import Search from './components/Search';
import { Icons } from './components/Icons';
import {
    getAllAgents,
    getDefaultAgent,
    getDefaultAgentId,
    ensureDefaultAgents,
    updateAgents,
} from './agents';
import { AcpAgent, type SearchMatch } from './types';
import './App.css';
import {
    loadDiffEnabled,
    loadAcpPermissionMode,
    saveAcpPermissionMode,
    saveItem,
    loadItem,
} from './storage';
import { useSocket } from './hooks/useSocket';
import { useGit } from './hooks/useGit';
import { useSearch } from './hooks/useSearch';
import { useFileTree } from './hooks/useFileTree';
import { useTerminals } from './hooks/useTerminals';
import { useEditors } from './hooks/useEditors';
import { useAgents } from './hooks/useAgents';
import { type AcpPermissionMode } from './types';

// Pane type identifiers
type PaneType = 'fileTree' | 'search' | 'changes' | 'editor' | 'terminal' | 'agent' | 'toolbar' | 'empty';
type PaneId = string;

const PANE_TITLES: Record<PaneType, string> = {
    fileTree: 'Files',
    search: 'Search',
    changes: 'Changes',
    editor: 'Editor',
    terminal: 'Terminal',
    agent: 'Agent',
    toolbar: 'Toolbar',
    empty: 'Empty',
};

const AVAILABLE_PANES: Array<{ type: Exclude<PaneType, 'empty'>; label: string }> = [
    { type: 'fileTree', label: 'File Tree' },
    { type: 'search', label: 'Search' },
    { type: 'changes', label: 'Changes' },
    { type: 'editor', label: 'Editor' },
    { type: 'terminal', label: 'Terminal' },
    { type: 'agent', label: 'Agent' },
    { type: 'toolbar', label: 'Toolbar' },
];

const DEFAULT_LAYOUT: MosaicNode<PaneId> = {
    type: 'split',
    direction: 'column',
    splitPercentages: [68, 24, 8],
    children: [
        {
            type: 'split',
            direction: 'row',
            splitPercentages: [20, 80],
            children: [
                'fileTree:1',
                {
                    type: 'split',
                    direction: 'row',
                    splitPercentages: [60, 40],
                    children: ['editor:1', 'agent:1'],
                },
            ],
        },
        'terminal:1',
        'toolbar:1',
    ],
};

function isPaneType(value: string): value is PaneType {
    return value in PANE_TITLES;
}

function getPaneTypeFromId(id: PaneId): PaneType {
    const [rawType] = id.split(':');
    return isPaneType(rawType) ? rawType : 'editor';
}

function getMaxPaneIndex(node: MosaicNode<PaneId> | null): number {
    if (!node) return 0;
    if (typeof node === 'string') {
        const [, rawIndex] = node.split(':');
        const parsed = Number(rawIndex);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    }
    if ('children' in node) {
        return node.children.reduce((max, child) => Math.max(max, getMaxPaneIndex(child)), 0);
    }
    if ('tabs' in node) {
        return node.tabs.reduce((max, child) => Math.max(max, getMaxPaneIndex(child)), 0);
    }
    return 0;
}

function getNodeAtPath(node: MosaicNode<PaneId> | null, path: MosaicPath): MosaicNode<PaneId> | null {
    if (!node) return null;
    let current: MosaicNode<PaneId> | null = node;
    for (const index of path) {
        if (!current || typeof current === 'string') return null;
        if ('children' in current) {
            current = current.children[index] ?? null;
            continue;
        }
        if ('tabs' in current) {
            current = current.tabs[index] ?? null;
            continue;
        }
        return null;
    }
    return current;
}

function getLeafPaneIds(node: MosaicNode<PaneId> | null): PaneId[] {
    if (!node) return [];
    if (typeof node === 'string') return [node];
    if ('children' in node) {
        return node.children.flatMap((child) => getLeafPaneIds(child));
    }
    if ('tabs' in node) {
        return node.tabs.flatMap((child) => getLeafPaneIds(child));
    }
    return [];
}

function getFirstPaneIdByType(node: MosaicNode<PaneId> | null, paneType: PaneType): PaneId | null {
    const leaves = getLeafPaneIds(node);
    const match = leaves.find((id) => getPaneTypeFromId(id) === paneType);
    return match ?? null;
}

function loadLayout(): MosaicNode<PaneId> | null {
    const stored = loadItem<MosaicNode<PaneId>>('mosaicLayout');
    return stored ?? null;
}

function saveLayout(layout: MosaicNode<PaneId> | null): void {
    saveItem('mosaicLayout', layout);
}

const OPEN_FILES_STORAGE_KEY = 'openFileIds';
const ACTIVE_FILE_STORAGE_KEY = 'activeFileId';

function ensureToolbarPane(layout: MosaicNode<PaneId> | null): MosaicNode<PaneId> | null {
    if (!layout) return layout;
    if (getFirstPaneIdByType(layout, 'toolbar')) return layout;

    const toolbarId = `toolbar:${getMaxPaneIndex(layout) + 1}`;
    if (typeof layout !== 'string' && 'children' in layout && layout.direction === 'column') {
        const childCount = layout.children.length;
        const existingPercentages = layout.splitPercentages?.length === childCount
            ? layout.splitPercentages
            : Array(childCount).fill(100 / childCount);
        const scaledPercentages = existingPercentages.map((value) => value * 0.9);
        return {
            ...layout,
            children: [...layout.children, toolbarId],
            splitPercentages: [...scaledPercentages, 10],
        };
    }

    return {
        type: 'split',
        direction: 'column',
        children: [layout, toolbarId],
        splitPercentages: [90, 10],
    };
}

type ToolbarPaneContentProps = {
    editors: ReturnType<typeof useEditors>;
    terminals: ReturnType<typeof useTerminals>;
    agents: ReturnType<typeof useAgents>;
    focusedEditorPaneId: PaneId | null;
    focusedAgentPaneId: PaneId | null;
    focusedTerminalPaneId: PaneId | null;
    editorPaneFileIds: Record<PaneId, string>;
    terminalPaneTerminalIds: Record<PaneId, string>;
    agentPaneSessionIds: Record<PaneId, string>;
    setFocusedEditorPaneId: React.Dispatch<React.SetStateAction<PaneId | null>>;
    setTerminalPaneTerminalIds: React.Dispatch<React.SetStateAction<Record<PaneId, string>>>;
    setAgentPaneSessionIds: React.Dispatch<React.SetStateAction<Record<PaneId, string>>>;
    setEditorPaneFileIds: React.Dispatch<React.SetStateAction<Record<PaneId, string>>>;
    getTargetEditorPaneId: () => PaneId | null;
    bindTerminalToTargetPane: (terminalId: string) => void;
    bindAgentToTargetPane: (agentId: string) => void;
    createPaneId: (paneType: PaneType) => PaneId;
};

const ToolbarPaneContentInner: React.FC<ToolbarPaneContentProps> = ({
    editors,
    terminals,
    agents,
    focusedEditorPaneId,
    focusedAgentPaneId,
    focusedTerminalPaneId,
    editorPaneFileIds,
    terminalPaneTerminalIds,
    agentPaneSessionIds,
    setFocusedEditorPaneId,
    setTerminalPaneTerminalIds,
    setAgentPaneSessionIds,
    setEditorPaneFileIds,
    getTargetEditorPaneId,
    bindTerminalToTargetPane,
    bindAgentToTargetPane,
    createPaneId,
}) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [isVertical, setIsVertical] = useState(false);
    const rootCtx = React.useContext(MosaicContext);
    const windowCtx = React.useContext(MosaicWindowContext);
    const sessionsArray = useMemo(() => Array.from(agents.acpSessions.values()), [agents.acpSessions]);

    useEffect(() => {
        const node = containerRef.current;
        if (!node) return;

        const updateOrientation = () => {
            const next = node.clientHeight > node.clientWidth;
            setIsVertical((prev) => (prev === next ? prev : next));
        };
        updateOrientation();

        const observer = new ResizeObserver(() => updateOrientation());
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const node = containerRef.current;
        if (!node) return;
        const mosaicWindow = node.closest('.mosaic-window');
        if (!mosaicWindow) return;

        mosaicWindow.classList.toggle('toolbar-pane-vertical', isVertical);
        mosaicWindow.classList.toggle('toolbar-pane-horizontal', !isVertical);

        return () => {
            mosaicWindow.classList.remove('toolbar-pane-vertical');
            mosaicWindow.classList.remove('toolbar-pane-horizontal');
        };
    }, [isVertical]);

    const activeFileId = focusedEditorPaneId
        ? (editorPaneFileIds[focusedEditorPaneId] ?? editors.activeFileId)
        : editors.activeFileId;
    const activeAgentId = focusedAgentPaneId
        ? (agentPaneSessionIds[focusedAgentPaneId] ?? agents.selectedAgentId)
        : agents.selectedAgentId;
    const selectedTerminalId = terminals.terminals[terminals.terminalSelected]?.id ?? null;
    const activeTerminalId = focusedTerminalPaneId
        ? (terminalPaneTerminalIds[focusedTerminalPaneId] ?? selectedTerminalId)
        : selectedTerminalId;

    const splitToolbarPane = useCallback(() => {
        const path = windowCtx.mosaicWindowActions.getPath();
        const root = rootCtx.mosaicActions.getRoot() as MosaicNode<PaneId> | null;
        const currentNode = getNodeAtPath(root, path);
        if (!currentNode) return;

        rootCtx.mosaicActions.replaceWith(path, {
            type: 'split',
            direction: 'row',
            children: [currentNode, createPaneId('empty')],
            splitPercentages: [50, 50],
        } as MosaicNode<PaneId>);
    }, [windowCtx, rootCtx, createPaneId]);

    const closeToolbarPane = useCallback(() => {
        const path = windowCtx.mosaicWindowActions.getPath();
        if (path.length === 0) return;
        rootCtx.mosaicActions.remove(path);
    }, [windowCtx, rootCtx]);

    return (
        <div
            ref={containerRef}
            className={`toolbar toolbar-pane ${isVertical ? 'toolbar-vertical' : 'toolbar-horizontal'}`}
        >
            <div className="toolbar-scroll-content">
                <div className="toolbar-tabs">
                    {editors.files.map((file) => (
                        <div
                            key={file.id}
                            className={`tab ${activeFileId === file.id ? 'active' : ''}`}
                            onClick={() => {
                                editors.setActiveFileId(file.id);
                                const targetPaneId = getTargetEditorPaneId();
                                if (!targetPaneId) return;
                                setEditorPaneFileIds((prev) => {
                                    if (prev[targetPaneId] === file.id) return prev;
                                    return { ...prev, [targetPaneId]: file.id };
                                });
                                setFocusedEditorPaneId(targetPaneId);
                            }}
                        >
                            <span className="tab-filename"> {file.name} </span>
                            <button className="tab-close-button" onClick={(e) => { e.stopPropagation(); editors.closeFile(file.id); }}>×</button>
                        </div>
                    ))}
                </div>

                <div className="toolbar-terminals">
                    {terminals.terminals.map((term, index) => (
                        <div
                            key={term.id}
                            className={`tab ${activeTerminalId === term.id ? 'active' : ''}`}
                            onClick={() => bindTerminalToTargetPane(term.id)}
                        >
                            <span className="tab-filename">{term.name}</span>
                            <button
                                className="tab-close-button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setTerminalPaneTerminalIds((prev) => {
                                        const next = { ...prev };
                                        for (const [mapPaneId, mapTerminalId] of Object.entries(next)) {
                                            if (mapTerminalId === term.id) {
                                                delete next[mapPaneId];
                                            }
                                        }
                                        return next;
                                    });
                                    terminals.closeTerminal(index);
                                }}
                            >
                                ×
                            </button>
                        </div>
                    ))}
                </div>

                <div className="acp-agents-container app-toolbar-agents">
                    <AcpAgentsList
                        agents={sessionsArray}
                        selectedAgentId={activeAgentId}
                        onSelectAgent={bindAgentToTargetPane}
                        onCloseAgent={(agentId) => {
                            agents.closeAgent(agentId);
                            setAgentPaneSessionIds((prev) => {
                                const next = { ...prev };
                                for (const [mapPaneId, mapSessionId] of Object.entries(next)) {
                                    if (mapSessionId === agentId) {
                                        delete next[mapPaneId];
                                    }
                                }
                                return next;
                            });
                        }}
                    />
                </div>
            </div>

            <div className="toolbar-pane-right-controls">
                {windowCtx.mosaicWindowActions.connectDragSource(
                    <button
                        type="button"
                        className={`toolbar-pane-control drag ${isVertical ? 'vertical' : 'horizontal'}`}
                        title="Drag toolbar pane"
                    >
                        <svg className="toolbar-pane-drag-icon" viewBox="0 0 20 20" aria-hidden="true">
                            <path d="M10 2v16M2 10h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                            <path d="M10 1l2.6 2.6H7.4L10 1zM10 19l-2.6-2.6h5.2L10 19zM1 10l2.6-2.6v5.2L1 10zM19 10l-2.6 2.6V7.4L19 10z" fill="currentColor" />
                        </svg>
                    </button>
                )}
                <button
                    type="button"
                    className="toolbar-pane-control split"
                    title="Split toolbar pane"
                    onClick={splitToolbarPane}
                />
                <button
                    type="button"
                    className="toolbar-pane-control close"
                    title="Close toolbar pane"
                    onClick={closeToolbarPane}
                />
            </div>
        </div>
    );
};

const ToolbarPaneContent = React.memo(ToolbarPaneContentInner, (prev, next) => {
    return (
        prev.focusedEditorPaneId === next.focusedEditorPaneId &&
        prev.focusedAgentPaneId === next.focusedAgentPaneId &&
        prev.focusedTerminalPaneId === next.focusedTerminalPaneId &&
        prev.editorPaneFileIds === next.editorPaneFileIds &&
        prev.terminalPaneTerminalIds === next.terminalPaneTerminalIds &&
        prev.agentPaneSessionIds === next.agentPaneSessionIds &&
        prev.getTargetEditorPaneId === next.getTargetEditorPaneId &&
        prev.bindTerminalToTargetPane === next.bindTerminalToTargetPane &&
        prev.bindAgentToTargetPane === next.bindAgentToTargetPane &&
        prev.createPaneId === next.createPaneId &&
        prev.editors.files === next.editors.files &&
        prev.editors.activeFileId === next.editors.activeFileId &&
        prev.terminals.terminals === next.terminals.terminals &&
        prev.terminals.terminalSelected === next.terminals.terminalSelected &&
        prev.agents.selectedAgentId === next.agents.selectedAgentId &&
        prev.agents.acpSessions === next.agents.acpSessions
    );
});

const App: React.FC = () => {
    const initialLayout = useMemo(
        () => ensureToolbarPane(loadLayout() ?? DEFAULT_LAYOUT),
        [],
    );
    const [mosaicValue, setMosaicValue] = useState<MosaicNode<PaneId> | null>(initialLayout);
    const nextPaneIdRef = useRef<number>(getMaxPaneIndex(initialLayout) + 1);
    const createPaneId = useCallback((paneType: PaneType = 'editor'): PaneId => {
        return `${paneType}:${nextPaneIdRef.current++}`;
    }, []);
    const [focusedEditorPaneId, setFocusedEditorPaneId] = useState<PaneId | null>(
        () => getFirstPaneIdByType(initialLayout, 'editor'),
    );
    const [focusedTerminalPaneId, setFocusedTerminalPaneId] = useState<PaneId | null>(
        () => getFirstPaneIdByType(initialLayout, 'terminal'),
    );
    const [focusedAgentPaneId, setFocusedAgentPaneId] = useState<PaneId | null>(
        () => getFirstPaneIdByType(initialLayout, 'agent'),
    );
    const [editorPaneFileIds, setEditorPaneFileIds] = useState<Record<PaneId, string>>({});
    const [terminalPaneTerminalIds, setTerminalPaneTerminalIds] = useState<Record<PaneId, string>>({});
    const [agentPaneSessionIds, setAgentPaneSessionIds] = useState<Record<PaneId, string>>({});

    const [diffEnabled, setDiffEnabled] = useState<boolean>(loadDiffEnabled());
    const [permissionMode, setPermissionMode] = useState<AcpPermissionMode>(loadAcpPermissionMode());
    const restoredOpenFilesRef = useRef(false);
    const restoreBootstrappedRef = useRef(false);

    const { wsRef, isConnected } = useSocket({});

    const fileTree = useFileTree();
    const editors = useEditors({
        wsRef,
        isConnected,
        diffEnabled,
        onFileClosed: (fileId: string) => {
            const node = fileTree.findNodeByPath(fileTree.fileTree, fileId);
            if (node) fileTree.clearFileSelection();
        },
    });

    const terminals = useTerminals({ wsRef, isConnected, bottomPanelVisible: true });
    const git = useGit({ wsRef, isConnected });
    const search = useSearch({ wsRef, isConnected });
    const wasConnectedRef = useRef<boolean>(false);
    const agents = useAgents({
        wsRef,
        isConnected,
        followEnabled: false,
        openFile: editors.openFile,
        openFileDiff: editors.openFileDiff,
        onAgentStarted: () => {
            setDiffEnabled(true);
        },
    });

    const openFolder = useMemo(() => {
        return (path: string) => {
            if (!wsRef.current || !isConnected) return;
            wsRef.current.emit('dir:list', { path }, fileTree.handleOpenFolderResponse);
        };
    }, [wsRef, isConnected, fileTree.handleOpenFolderResponse]);

    useEffect(() => {
        const ws = wsRef.current;
        if (!ws || !isConnected) return;

        ws.on('lsp:diagnostics', editors.handleDiagnostics);
        ws.on('watcher:edits', editors.handleWatcherEdits);
        ws.on('watcher:create', fileTree.handleWatcherCreate);
        ws.on('watcher:remove', fileTree.handleWatcherRemove);
        ws.on('git:status-update', git.handleGitStatusUpdate);
        ws.on('acp:message', agents.handleAcpMessage);
        ws.on('acp:history', agents.handleAcpHistory);
        ws.on('search:result', search.handleSearchResult);
        ws.on('search:end', search.handleSearchEnd);

        return () => {
            ws.off('lsp:diagnostics', editors.handleDiagnostics);
            ws.off('watcher:edits', editors.handleWatcherEdits);
            ws.off('watcher:create', fileTree.handleWatcherCreate);
            ws.off('watcher:remove', fileTree.handleWatcherRemove);
            ws.off('git:status-update', git.handleGitStatusUpdate);
            ws.off('acp:message', agents.handleAcpMessage);
            ws.off('acp:history', agents.handleAcpHistory);
            ws.off('search:result', search.handleSearchResult);
            ws.off('search:end', search.handleSearchEnd);
        };
    }, [
        wsRef,
        isConnected,
        editors.handleDiagnostics,
        editors.handleWatcherEdits,
        fileTree.handleWatcherCreate,
        fileTree.handleWatcherRemove,
        git.handleGitStatusUpdate,
        agents.handleAcpMessage,
        agents.handleAcpHistory,
        search.handleSearchResult,
        search.handleSearchEnd,
    ]);

    useEffect(() => {
        if (isConnected && !wasConnectedRef.current) {
            openFolder('.');
            terminals.reconnectTerminals();
            agents.reconnectToAcpAgents();
            git.fetchGitStatus();
        }
        wasConnectedRef.current = isConnected;
    }, [isConnected, openFolder, terminals.reconnectTerminals, agents.reconnectToAcpAgents, git.fetchGitStatus]);

    useEffect(() => {
        return () => {
            editors.flushAllPendingChanges();
        };
    }, [editors.flushAllPendingChanges]);

    useEffect(() => {
        if (!editors.activeFileId) return;
        const file = editors.files.find((f) => f.id === editors.activeFileId);
        if (!file) return;

        const node = fileTree.findNodeByPath(fileTree.fileTree, file.id);
        if (node && !node.isSelected) {
            fileTree.selectNode(node.id);
        }
    }, [editors.activeFileId, editors.files, fileTree.fileTree, fileTree.findNodeByPath, fileTree.selectNode]);

    useEffect(() => {
        if (!restoreBootstrappedRef.current) return;
        saveItem(OPEN_FILES_STORAGE_KEY, editors.files.map((file) => file.id));
    }, [editors.files]);

    useEffect(() => {
        if (!restoreBootstrappedRef.current) return;
        saveItem(ACTIVE_FILE_STORAGE_KEY, editors.activeFileId);
    }, [editors.activeFileId]);

    useEffect(() => {
        if (!isConnected || restoredOpenFilesRef.current) return;
        restoredOpenFilesRef.current = true;

        const savedFiles = loadItem<string[]>(OPEN_FILES_STORAGE_KEY) ?? [];
        if (savedFiles.length === 0) {
            restoreBootstrappedRef.current = true;
            return;
        }

        const openFileAsync = (fileId: string) => new Promise<void>((resolve) => {
            editors.openFile(fileId, undefined, undefined, () => resolve());
        });

        const restoreOpenFiles = async () => {
            for (const fileId of savedFiles) {
                await openFileAsync(fileId);
            }

            const savedActiveFileId = loadItem<string | null>(ACTIVE_FILE_STORAGE_KEY);
            if (savedActiveFileId) {
                await openFileAsync(savedActiveFileId);
            }
            restoreBootstrappedRef.current = true;
        };

        restoreOpenFiles().catch((error) => {
            console.error('Failed to restore open files', error);
            restoreBootstrappedRef.current = true;
        });
    }, [isConnected, editors.openFile]);

    useEffect(() => {
        const existingEditorPaneIds = new Set(
            getLeafPaneIds(mosaicValue).filter((paneId) => getPaneTypeFromId(paneId) === 'editor'),
        );
        const existingTerminalPaneIds = new Set(
            getLeafPaneIds(mosaicValue).filter((paneId) => getPaneTypeFromId(paneId) === 'terminal'),
        );
        const existingAgentPaneIds = new Set(
            getLeafPaneIds(mosaicValue).filter((paneId) => getPaneTypeFromId(paneId) === 'agent'),
        );
        const existingFileIds = new Set(editors.files.map((file) => file.id));
        const existingTerminalIds = new Set(terminals.terminals.map((terminal) => terminal.id));
        const existingSessionIds = new Set(Array.from(agents.acpSessions.keys()));

        setEditorPaneFileIds((prev) => {
            const next: Record<PaneId, string> = {};
            for (const [paneId, fileId] of Object.entries(prev)) {
                if (existingEditorPaneIds.has(paneId) && existingFileIds.has(fileId)) {
                    next[paneId] = fileId;
                }
            }
            return next;
        });
        const fallbackTerminalId = terminals.terminals[terminals.terminalSelected]?.id
            ?? terminals.terminals[0]?.id
            ?? null;
        setTerminalPaneTerminalIds((prev) => {
            const next: Record<PaneId, string> = {};
            for (const paneId of existingTerminalPaneIds) {
                const mappedTerminalId = prev[paneId];
                if (mappedTerminalId && existingTerminalIds.has(mappedTerminalId)) {
                    next[paneId] = mappedTerminalId;
                    continue;
                }
                if (fallbackTerminalId && existingTerminalIds.has(fallbackTerminalId)) {
                    next[paneId] = fallbackTerminalId;
                }
            }
            return next;
        });
        setAgentPaneSessionIds((prev) => {
            const next: Record<PaneId, string> = {};
            for (const [paneId, sessionId] of Object.entries(prev)) {
                if (existingAgentPaneIds.has(paneId) && existingSessionIds.has(sessionId)) {
                    next[paneId] = sessionId;
                }
            }
            return next;
        });

        if (!focusedEditorPaneId || !existingEditorPaneIds.has(focusedEditorPaneId)) {
            setFocusedEditorPaneId(getFirstPaneIdByType(mosaicValue, 'editor'));
        }
        if (!focusedTerminalPaneId || !existingTerminalPaneIds.has(focusedTerminalPaneId)) {
            setFocusedTerminalPaneId(getFirstPaneIdByType(mosaicValue, 'terminal'));
        }
        if (!focusedAgentPaneId || !existingAgentPaneIds.has(focusedAgentPaneId)) {
            setFocusedAgentPaneId(getFirstPaneIdByType(mosaicValue, 'agent'));
        }
    }, [
        mosaicValue,
        editors.files,
        terminals.terminals,
        terminals.terminalSelected,
        focusedEditorPaneId,
        focusedTerminalPaneId,
        focusedAgentPaneId,
        agents.acpSessions,
    ]);

    // Persist layout on change
    useEffect(() => {
        saveLayout(mosaicValue);
    }, [mosaicValue]);

    useEffect(() => {
        saveItem('terminalSelected', terminals.terminalSelected);
    }, [terminals.terminalSelected]);

    useEffect(() => {
        saveItem('diffEnabled', diffEnabled);
    }, [diffEnabled]);

    useEffect(() => {
        saveAcpPermissionMode(permissionMode);
    }, [permissionMode]);

    useEffect(() => {
        if (!isConnected || !wsRef.current) return;
        wsRef.current.emit('acp:set_permission_mode', { mode: permissionMode });
    }, [isConnected, permissionMode, wsRef]);

    useEffect(() => {
        saveItem('terminals', terminals.terminals);
    }, [terminals.terminals]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.metaKey && e.key === 'f') {
                e.preventDefault();
            }

            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                if (editors.activeFileId) {
                    editors.saveFile(editors.activeFileId);
                }
            }

            if (e.ctrlKey && e.key === '-') {
                e.preventDefault();
                editors.undoCursor();
            } else if (e.ctrlKey && e.key === '_') {
                e.preventDefault();
                editors.redoCursor();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [editors.activeFileId, editors.saveFile, editors.undoCursor, editors.redoCursor]);

    const handleSearch = ({ pattern }: { id: string; pattern: string }) => {
        search.startSearch(pattern);
    };

    const getTargetEditorPaneId = useCallback((): PaneId | null => {
        if (focusedEditorPaneId && getPaneTypeFromId(focusedEditorPaneId) === 'editor') {
            return focusedEditorPaneId;
        }
        return getFirstPaneIdByType(mosaicValue, 'editor');
    }, [focusedEditorPaneId, mosaicValue]);

    const getTargetAgentPaneId = useCallback((): PaneId | null => {
        if (focusedAgentPaneId && getPaneTypeFromId(focusedAgentPaneId) === 'agent') {
            return focusedAgentPaneId;
        }
        return getFirstPaneIdByType(mosaicValue, 'agent');
    }, [focusedAgentPaneId, mosaicValue]);

    const getTargetTerminalPaneId = useCallback((): PaneId | null => {
        if (focusedTerminalPaneId && getPaneTypeFromId(focusedTerminalPaneId) === 'terminal') {
            return focusedTerminalPaneId;
        }
        return getFirstPaneIdByType(mosaicValue, 'terminal');
    }, [focusedTerminalPaneId, mosaicValue]);

    const bindFileToTargetEditorPane = useCallback((fileId: string) => {
        const targetPaneId = getTargetEditorPaneId();
        if (!targetPaneId) return;
        setEditorPaneFileIds((prev) => {
            if (prev[targetPaneId] === fileId) return prev;
            return { ...prev, [targetPaneId]: fileId };
        });
        setFocusedEditorPaneId(targetPaneId);
    }, [getTargetEditorPaneId]);

    const openFileInEditorPane = useCallback((filePath: string, line?: number, column?: number) => {
        editors.openFile(filePath, line, column);
        bindFileToTargetEditorPane(filePath);
    }, [editors, bindFileToTargetEditorPane]);

    const openFileDiffInEditorPane = useCallback((filePath: string, line?: number, column?: number) => {
        editors.openFileDiff(filePath, line, column);
        bindFileToTargetEditorPane(filePath);
    }, [editors, bindFileToTargetEditorPane]);

    const bindAgentToTargetPane = useCallback((agentId: string) => {
        const targetPaneId = getTargetAgentPaneId();
        if (!targetPaneId) return;
        setAgentPaneSessionIds((prev) => {
            if (prev[targetPaneId] === agentId) return prev;
            return { ...prev, [targetPaneId]: agentId };
        });
        setFocusedAgentPaneId(targetPaneId);
        agents.setSelectedAgentId(agentId);
    }, [getTargetAgentPaneId, agents]);

    const bindTerminalToTargetPane = useCallback((terminalId: string) => {
        const targetPaneId = getTargetTerminalPaneId();
        if (!targetPaneId) return;
        setTerminalPaneTerminalIds((prev) => {
            if (prev[targetPaneId] === terminalId) return prev;
            return { ...prev, [targetPaneId]: terminalId };
        });
        setFocusedTerminalPaneId(targetPaneId);
        const selectedIndex = terminals.terminals.findIndex((term) => term.id === terminalId);
        if (selectedIndex >= 0 && selectedIndex !== terminals.terminalSelected) {
            terminals.setTerminalSelected(selectedIndex);
        }
    }, [getTargetTerminalPaneId, terminals]);

    const handleSearchResultClick = (filePath: string, match: SearchMatch) => {
        openFileInEditorPane(filePath, match.line, match.column);
    };

    const toggleDiffMode = useCallback(() => {
        const newDiffEnabled = !diffEnabled;
        setDiffEnabled(newDiffEnabled);
        editors.setDiffForAllEditors(newDiffEnabled);
    }, [diffEnabled, editors]);

    const sessionsArray = useMemo(() => Array.from(agents.acpSessions.values()), [agents.acpSessions]);
    const availableAgents = useMemo<AcpAgent[]>(() => getAllAgents(), [agents.agentsVersion]);
    const defaultAgent = useMemo(() => getDefaultAgent(), [agents.agentsVersion]);
    const settingsAgents = useMemo<AcpAgent[]>(() => (
        agents.isAgentSettingsOpen ? getAllAgents() : []
    ), [agents.isAgentSettingsOpen, agents.agentsVersion]);
    const settingsDefaultAgentId = useMemo(
        () => (agents.isAgentSettingsOpen ? getDefaultAgentId() : null),
        [agents.isAgentSettingsOpen, agents.agentsVersion],
    );
    const handleAddAgent = useCallback(() => {
        if (!defaultAgent) return;
        return agents.startAgent(defaultAgent);
    }, [agents.startAgent, defaultAgent]);
    const handleStartSpecificAgent = useCallback((agent: AcpAgent) => {
        return agents.startAgent(agent);
    }, [agents.startAgent]);
    const handleOpenAgentSettings = useCallback(() => {
        ensureDefaultAgents();
        agents.setIsAgentSettingsOpen(true);
    }, [agents.setIsAgentSettingsOpen]);
    const handleCloseAgentSettings = useCallback(() => {
        agents.setIsAgentSettingsOpen(false);
    }, [agents.setIsAgentSettingsOpen]);
    const handleResumeSettingsSession = useCallback((agent: AcpAgent, sessionId: string) => {
        agents.setIsAgentSettingsOpen(false);
        agents.resumeSession(agent, sessionId);
    }, [agents.resumeSession, agents.setIsAgentSettingsOpen]);

    const handleSaveAgents = useCallback((agentList: AcpAgent[], defaultAgentId: string | null, nextPermissionMode: AcpPermissionMode) => {
        updateAgents(agentList, defaultAgentId);
        setPermissionMode(nextPermissionMode);
        agents.setAgentsVersion((prev) => prev + 1);
    }, [agents.setAgentsVersion]);

    const handleMosaicChange = useCallback((newNode: MosaicNode<PaneId> | null) => {
        setMosaicValue(newNode);
    }, []);

    // Reset layout to default
    const handleResetLayout = useCallback(() => {
        setMosaicValue(DEFAULT_LAYOUT);
    }, []);

    // Pane icon lookup
    const getPaneIcon = useCallback((id: PaneId): React.ReactNode => {
        switch (getPaneTypeFromId(id)) {
            case 'fileTree': return <Icons.Tree />;
            case 'search': return <Icons.Search />;
            case 'changes': return <Icons.Git />;
            case 'editor': return <Icons.EditorOpened />;
            case 'terminal': return <Icons.BottomPanelOpened />;
            case 'agent': return <Icons.RightPanelOpened />;
            case 'toolbar': return <Icons.LeftPanelOpened />;
            default: return null;
        }
    }, []);

    const EmptyAgentPane: React.FC<{ paneId: PaneId }> = ({ paneId }) => {
        const runningSessions = Array.from(agents.acpSessions.values());

        const bindSessionToPane = (sessionId: string) => {
            setFocusedAgentPaneId(paneId);
            setAgentPaneSessionIds((prev) => {
                if (prev[paneId] === sessionId) return prev;
                return { ...prev, [paneId]: sessionId };
            });
            agents.setSelectedAgentId(sessionId);
        };

        const startAgentInPane = (agent: AcpAgent) => {
            const startedAgentId = handleStartSpecificAgent(agent);
            if (!startedAgentId) return;
            setFocusedAgentPaneId(paneId);
            setAgentPaneSessionIds((prev) => {
                if (prev[paneId] === startedAgentId) return prev;
                return { ...prev, [paneId]: startedAgentId };
            });
            agents.setSelectedAgentId(startedAgentId);
        };

        return (
            <div className="empty-pane empty-agent-pane">
                <div className="empty-pane-title">Agent Pane</div>
                <div className="empty-agent-section">
                    <div className="empty-agent-section-title">Running agents</div>
                    <ul className="empty-pane-list empty-agent-list">
                        {runningSessions.length === 0 ? (
                            <li className="empty-agent-empty">No running agents</li>
                        ) : (
                            runningSessions.map((session) => (
                                <li key={session.agentId}>
                                    <button
                                        type="button"
                                        className="empty-pane-item-btn"
                                        onClick={() => bindSessionToPane(session.agentId)}
                                    >
                                        {session.agentName || session.agentId}
                                    </button>
                                </li>
                            ))
                        )}
                    </ul>
                </div>

                <div className="empty-agent-section">
                    <div className="empty-agent-section-title">Start new agent</div>
                    <ul className="empty-pane-list empty-agent-list">
                        {availableAgents.length === 0 ? (
                            <li className="empty-agent-empty">No configured agents</li>
                        ) : (
                            availableAgents.map((agent) => (
                                <li key={agent.id}>
                                    <button
                                        type="button"
                                        className="empty-pane-item-btn"
                                        onClick={() => startAgentInPane(agent)}
                                    >
                                        {agent.name}
                                    </button>
                                </li>
                            ))
                        )}
                    </ul>
                </div>
            </div>
        );
    };

    // Render content for a given pane
    const renderPaneContent = useCallback((paneType: PaneType, paneId: PaneId): React.ReactNode => {
        switch (paneType) {
            case 'fileTree':
                return (
                    <div className="file-system-panel">
                        <div className="file-system-content">
                            {fileTree.fileTree.length === 0 ? (
                                <p className="file-system-empty"> </p>
                            ) : (
                                <div className="file-tree">
                                    {fileTree.fileTree.map((node) => (
                                        <TreeNodeComponent
                                            key={node.id}
                                            node={node}
                                            onToggle={fileTree.toggleNode}
                                            onSelect={fileTree.selectNode}
                                            onOpenFile={openFileInEditorPane}
                                            onLoadFolder={openFolder}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                );

            case 'search':
                return (
                    <Search
                        id="search-pane"
                        onEnter={handleSearch}
                        onCancel={search.cancelSearch}
                        results={search.searchResults}
                        searchEnded={search.searchEnded}
                        onMatchClick={handleSearchResultClick}
                    />
                );

            case 'changes':
                return (
                    <ChangesPanel
                        files={git.changedFiles}
                        branch={git.gitBranch}
                        onFileClick={openFileDiffInEditorPane}
                        onRefresh={git.fetchGitStatus}
                        onCommit={git.commit}
                        onPush={git.push}
                        onPull={git.pull}
                        onRevert={git.revert}
                    />
                );

            case 'editor': {
                const paneFileId = editorPaneFileIds[paneId] ?? editors.activeFileId;
                const paneFile = paneFileId ? editors.files.find((file) => file.id === paneFileId) : null;
                return (
                    <div
                        className="editor-container"
                        onMouseDown={() => {
                            setFocusedEditorPaneId(paneId);
                            if (paneFile?.id) editors.setActiveFileId(paneFile.id);
                        }}
                    >
                        {paneFile && editors.editorStates.has(paneFile.id) ? (
                            <AnycodeEditorReact
                                key={`${paneId}:${paneFile.id}`}
                                id={paneFile.id}
                                editorState={editors.editorStates.get(paneFile.id)!}
                            />
                        ) : (
                            <div className="no-editor"></div>
                        )}
                    </div>
                );
            }

            case 'terminal':
                const selectedTerminalId = terminals.terminals[terminals.terminalSelected]?.id ?? null;
                const paneTerminalId = terminalPaneTerminalIds[paneId] ?? selectedTerminalId;
                return (
                    <div
                        className="terminal-panel"
                        onMouseDown={() => {
                            setFocusedTerminalPaneId(paneId);
                            if (!paneTerminalId) return;
                            const terminalIndex = terminals.terminals.findIndex((term) => term.id === paneTerminalId);
                            if (terminalIndex >= 0 && terminalIndex !== terminals.terminalSelected) {
                                terminals.setTerminalSelected(terminalIndex);
                            }
                        }}
                    >
                        <div className="terminal-pane-content">
                            {terminals.terminals.map((term, index) => (
                                <div
                                    key={term.id}
                                    className="terminal-container"
                                    style={{
                                        visibility: term.id === paneTerminalId ? 'visible' : 'hidden',
                                        opacity: term.id === paneTerminalId ? 1 : 0,
                                        pointerEvents: term.id === paneTerminalId ? 'auto' : 'none',
                                        height: '100%',
                                        position: term.id === paneTerminalId ? 'relative' : 'absolute',
                                        width: '100%',
                                        top: 0,
                                        left: 0,
                                    }}
                                >
                                    <TerminalComponent
                                        name={term.name}
                                        onData={terminals.handleTerminalData}
                                        onMessage={terminals.handleTerminalDataCallback}
                                        onResize={terminals.handleTerminalResize}
                                        rows={term.rows}
                                        cols={term.cols}
                                        isConnected={isConnected}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                );

            case 'toolbar':
                return (
                    <ToolbarPaneContent
                        editors={editors}
                        terminals={terminals}
                        agents={agents}
                        focusedEditorPaneId={focusedEditorPaneId}
                        focusedAgentPaneId={focusedAgentPaneId}
                        focusedTerminalPaneId={focusedTerminalPaneId}
                        editorPaneFileIds={editorPaneFileIds}
                        terminalPaneTerminalIds={terminalPaneTerminalIds}
                        agentPaneSessionIds={agentPaneSessionIds}
                        setFocusedEditorPaneId={setFocusedEditorPaneId}
                        setTerminalPaneTerminalIds={setTerminalPaneTerminalIds}
                        setAgentPaneSessionIds={setAgentPaneSessionIds}
                        setEditorPaneFileIds={setEditorPaneFileIds}
                        getTargetEditorPaneId={getTargetEditorPaneId}
                        bindTerminalToTargetPane={bindTerminalToTargetPane}
                        bindAgentToTargetPane={bindAgentToTargetPane}
                        createPaneId={createPaneId}
                    />
                );

            case 'agent':
                const paneAgentId = agentPaneSessionIds[paneId] ?? null;
                if (!paneAgentId) {
                    return <EmptyAgentPane paneId={paneId} />;
                }
                const paneSession = agents.acpSessions.get(paneAgentId) ?? null;
                if (!paneSession) {
                    return <EmptyAgentPane paneId={paneId} />;
                }
                return (
                    <AcpSessionView
                        key={`acp-pane-${paneId}-${paneSession.agentId}`}
                        agentId={paneSession.agentId}
                        title={paneSession.agentName || paneSession.agentId}
                        isActivePane={focusedAgentPaneId === paneId}
                        isConnected={paneSession.isActive && isConnected}
                        isProcessing={paneSession.isProcessing || false}
                        messages={paneSession.messages}
                        modelSelector={paneSession.modelSelector}
                        reasoningSelector={paneSession.reasoningSelector}
                        contextUsage={paneSession.contextUsage}
                        onFocusPane={() => {
                            setFocusedAgentPaneId(paneId);
                            agents.setSelectedAgentId(paneSession.agentId);
                        }}
                        onSendPrompt={agents.sendPrompt}
                        onCancelPrompt={agents.cancelPrompt}
                        onPermissionResponse={agents.sendPermissionResponse}
                        onUndoPrompt={agents.undoPrompt}
                        onCloseAgent={(agentId) => {
                            agents.closeAgent(agentId);
                            setAgentPaneSessionIds((prev) => {
                                const next = { ...prev };
                                for (const [mapPaneId, mapAgentId] of Object.entries(next)) {
                                    if (mapAgentId === agentId) {
                                        delete next[mapPaneId];
                                    }
                                }
                                return next;
                            });
                        }}
                        onSelectModel={agents.setSessionModel}
                        onSelectReasoning={agents.setSessionReasoning}
                        onOpenFile={openFileInEditorPane}
                        onOpenFileDiff={openFileDiffInEditorPane}
                    />
                );

            case 'empty':
                return (
                    <div className="empty-pane">
                        <div className="empty-pane-title">Available panes</div>
                        <ul className="empty-pane-list">
                            {AVAILABLE_PANES.map((pane) => (
                                <li key={pane.type}>{pane.label}</li>
                            ))}
                        </ul>
                    </div>
                );

            default:
                return <div className="no-editor">Unknown pane: {paneType}</div>;
        }
    }, [
        fileTree, editors, terminals, git, search, agents,
        openFolder, handleSearch, handleSearchResultClick, isConnected,
        sessionsArray, availableAgents, handleAddAgent, handleStartSpecificAgent,
        handleOpenAgentSettings, handleCloseAgentSettings, handleResumeSettingsSession,
        settingsAgents, settingsDefaultAgentId, permissionMode, handleSaveAgents,
        diffEnabled, toggleDiffMode, openFileInEditorPane, openFileDiffInEditorPane,
        editorPaneFileIds, terminalPaneTerminalIds, agentPaneSessionIds,
        focusedEditorPaneId, focusedTerminalPaneId, focusedAgentPaneId,
        getTargetEditorPaneId, bindTerminalToTargetPane, bindAgentToTargetPane,
    ]);

    // Custom toolbar controls with SVG icons
    const SplitRightButton: React.FC<{ paneType: PaneType }> = ({ paneType }) => {
        const rootCtx = React.useContext(MosaicContext);
        const windowCtx = React.useContext(MosaicWindowContext);

        const onClick = useCallback(() => {
            const path = windowCtx.mosaicWindowActions.getPath();
            const root = rootCtx.mosaicActions.getRoot() as MosaicNode<PaneId> | null;
            const currentNode = getNodeAtPath(root, path);
            if (!currentNode) return;

            rootCtx.mosaicActions.replaceWith(path, {
                type: 'split',
                direction: 'row',
                children: [currentNode, createPaneId('empty')],
                splitPercentages: [50, 50],
            } as MosaicNode<PaneId>);
        }, [rootCtx, windowCtx, createPaneId]);

        return (
            <button
                className="mosaic-default-control split-button"
                onClick={onClick}
                title={`Split ${PANE_TITLES[paneType]} Right`}
                type="button"
            >
                Split
            </button>
        );
    };

    const EmptyPaneSelector: React.FC<{ path: MosaicPath }> = ({ path }) => {
        const rootCtx = React.useContext(MosaicContext);
        const handleSelect = useCallback((paneType: Exclude<PaneType, 'empty'>) => {
            const paneId = createPaneId(paneType);
            rootCtx.mosaicActions.replaceWith(path, paneId);
            if (paneType === 'editor') {
                setFocusedEditorPaneId(paneId);
                if (editors.activeFileId) {
                    setEditorPaneFileIds((prev) => {
                        if (prev[paneId] === editors.activeFileId) return prev;
                        return { ...prev, [paneId]: editors.activeFileId! };
                    });
                }
            }
            if (paneType === 'agent') {
                setFocusedAgentPaneId(paneId);
            }
            if (paneType === 'terminal') {
                const newTerminal = terminals.addTerminal();
                setFocusedTerminalPaneId(paneId);
                setTerminalPaneTerminalIds((prev) => {
                    if (prev[paneId] === newTerminal.id) return prev;
                    return { ...prev, [paneId]: newTerminal.id };
                });
            }
        }, [
            path,
            rootCtx,
            createPaneId,
            editors.activeFileId,
            terminals.addTerminal,
            terminals.terminals,
            terminals.terminalSelected,
        ]);

        return (
            <div className="empty-pane">
                <div className="empty-pane-title">Available panes</div>
                <ul className="empty-pane-list">
                    {AVAILABLE_PANES.map((pane) => (
                        <li key={pane.type}>
                            <button
                                type="button"
                                className="empty-pane-item-btn"
                                onClick={() => handleSelect(pane.type)}
                            >
                                {pane.label}
                            </button>
                        </li>
                    ))}
                </ul>
            </div>
        );
    };

    // Mosaic tile renderer
    const renderTile = useCallback((id: PaneId, path: MosaicPath) => {
        const paneType = getPaneTypeFromId(id);
        const isToolbarPane = paneType === 'toolbar';
        const toolbarControls = isToolbarPane ? [] : [
            <SplitRightButton key="split" paneType={paneType} />,
            <ExpandButton key="expand" />,
            <RemoveButton key="remove" />,
        ];

        return (
            <MosaicWindow<PaneId>
                path={path}
                className={isToolbarPane ? 'toolbar-pane-window' : undefined}
                title={isToolbarPane ? '' : PANE_TITLES[paneType]}
                createNode={() => createPaneId(paneType)}
                toolbarControls={toolbarControls}
                draggable={true}
            >
                <div
                    className="pane-root"
                    onMouseDown={() => {
                        if (paneType === 'editor') setFocusedEditorPaneId(id);
                        if (paneType === 'terminal') setFocusedTerminalPaneId(id);
                        if (paneType === 'agent') setFocusedAgentPaneId(id);
                    }}
                >
                    {paneType === 'empty'
                        ? <EmptyPaneSelector path={path} />
                        : renderPaneContent(paneType, id)}
                </div>
            </MosaicWindow>
        );
    }, [renderPaneContent, createPaneId]);

    return (
        <div className="app-container">
            <div className="main-content">
                <Mosaic<PaneId>
                    renderTile={renderTile}
                    value={mosaicValue}
                    onChange={handleMosaicChange}
                    resize={{ minimumPaneSizePercentage: 0.1 }}
                    createNode={() => createPaneId('editor')}
                    className="anycode-mosaic"
                />
            </div>
        </div>
    );
};

export default App;

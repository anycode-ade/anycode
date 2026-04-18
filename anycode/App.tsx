import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type IDockviewPanelProps } from 'dockview';
import 'dockview/dist/styles/dockview.css';
import {
    Layout,
    createDefaultLayout,
    createDockviewReadyHandler,
    createHeaderActions,
    PANE_IDS,
    type PaneType,
    type ContextProviderDescriptor,
} from './components/layout/Layout';
import {
    AgentPanelContext,
    ChangesPanelContext,
    EditorPanelContext,
    FileTreePanelContext,
    SearchPanelContext,
    TerminalPanelContext,
    ToolbarPanelContext,
    type AgentPanelContextValue,
    type ChangesPanelContextValue,
    type EditorPanelContextValue,
    type FileTreePanelContextValue,
    type SearchPanelContextValue,
    type TerminalPanelContextValue,
    type ToolbarPanelContextValue,
} from './components/layout/contexts';
import {
    AgentPanel,
    ChangesPanel,
    EditorPanel,
    EmptyPanel,
    FileTreePanel,
    SearchPanel,
    TerminalPanel,
    ToolbarPanel,
} from './components/layout/panels';
import {
    getAllAgents,
} from './agents';
import { AcpAgent, type AcpPermissionMode, type SearchMatch } from './types';
import './App.css';
import './components/layout/Layout.css';
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

const OPEN_FILES_STORAGE_KEY = 'openFileIds';
const ACTIVE_FILE_STORAGE_KEY = 'activeFileId';
const DOCKVIEW_LAYOUT_STORAGE_KEY = 'dockviewLayout:v2';
const TERMINAL_PANE_BINDINGS_STORAGE_KEY = 'terminalPaneTerminalIds:v1';
const AGENT_PANE_BINDINGS_STORAGE_KEY = 'agentPaneSessionIds:v1';

const App: React.FC = () => {
    const [diffEnabled, setDiffEnabled] = useState<boolean>(loadDiffEnabled());
    const [permissionMode, setPermissionMode] = useState<AcpPermissionMode>(loadAcpPermissionMode());
    const restoredOpenFilesRef = useRef(false);
    const restoreBootstrappedRef = useRef(false);

    const { wsRef, isConnected, connectionError } = useSocket({});

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

    const [agentPaneSessionIds, setAgentPaneSessionIds] = useState<Record<string, string>>(
        () => loadItem<Record<string, string>>(AGENT_PANE_BINDINGS_STORAGE_KEY) ?? {},
    );
    const [focusedAgentPaneId, setFocusedAgentPaneId] = useState<string | null>(null);
    const [terminalPaneTerminalIds, setTerminalPaneTerminalIds] = useState<Record<string, string>>(
        () => loadItem<Record<string, string>>(TERMINAL_PANE_BINDINGS_STORAGE_KEY) ?? {},
    );
    const [focusedTerminalPaneId, setFocusedTerminalPaneId] = useState<string | null>(null);
    const splitPanelCounterRef = useRef<number>(1);

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
        if (!isConnected) return;
        if (fileTree.fileTree.length > 0) return;

        const intervalId = setInterval(() => {
            if (fileTree.fileTree.length === 0) {
                openFolder('.');
            }
        }, 1500);

        openFolder('.');
        return () => clearInterval(intervalId);
    }, [isConnected, fileTree.fileTree.length, openFolder]);

    useEffect(() => {
        return () => {
            editors.flushAllPendingChanges();
        };
    }, [editors.flushAllPendingChanges]);

    useEffect(() => {
        if (!editors.activeFileId) return;
        const node = fileTree.findNodeByPath(fileTree.fileTree, editors.activeFileId);
        if (node && !node.isSelected) {
            fileTree.selectNode(node.id);
        }
    }, [editors.activeFileId, fileTree.fileTree, fileTree.findNodeByPath, fileTree.selectNode]);

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

    const openFileInEditorPane = useCallback((filePath: string, line?: number, column?: number) => {
        editors.openFile(filePath, line, column);
    }, [editors]);

    const openFileDiffInEditorPane = useCallback((filePath: string, line?: number, column?: number) => {
        editors.openFileDiff(filePath, line, column);
    }, [editors]);

    const bindTerminalToPane = useCallback((paneId: string, terminalId: string) => {
        setTerminalPaneTerminalIds((prev) => ({ ...prev, [paneId]: terminalId }));
        setFocusedTerminalPaneId(paneId);
        const selectedIndex = terminals.terminals.findIndex((term) => term.id === terminalId);
        if (selectedIndex >= 0 && selectedIndex !== terminals.terminalSelected) {
            terminals.setTerminalSelected(selectedIndex);
        }
    }, [terminals]);

    const bindTerminalToFocusedPane = useCallback((terminalId: string) => {
        const targetPaneId = focusedTerminalPaneId ?? PANE_IDS.terminal;
        bindTerminalToPane(targetPaneId, terminalId);
    }, [focusedTerminalPaneId, bindTerminalToPane]);

    const bindAgentToPane = useCallback((paneId: string, agentId: string) => {
        setAgentPaneSessionIds((prev) => ({ ...prev, [paneId]: agentId }));
        setFocusedAgentPaneId(paneId);
        agents.setSelectedAgentId(agentId);
    }, [agents]);

    const bindAgentToFocusedPane = useCallback((agentId: string) => {
        if (!focusedAgentPaneId) return;
        bindAgentToPane(focusedAgentPaneId, agentId);
    }, [focusedAgentPaneId, bindAgentToPane]);

    const handleSearchResultClick = (filePath: string, match: SearchMatch) => {
        openFileInEditorPane(filePath, match.line, match.column);
    };

    const sessionsArray = useMemo(() => Array.from(agents.acpSessions.values()), [agents.acpSessions]);
    const availableAgents = useMemo<AcpAgent[]>(() => getAllAgents(), [agents.agentsVersion]);

    const focusedAgentId = useMemo(() => {
        if (!focusedAgentPaneId) return null;
        const paneAgentId = agentPaneSessionIds[focusedAgentPaneId] ?? null;
        if (!paneAgentId) return null;
        return agents.acpSessions.has(paneAgentId) ? paneAgentId : null;
    }, [focusedAgentPaneId, agentPaneSessionIds, agents.acpSessions]);

    useEffect(() => {
        const existingTerminalIds = new Set(terminals.terminals.map((terminal) => terminal.id));
        setTerminalPaneTerminalIds((prev) => {
            let changed = false;
            const next: Record<string, string> = {};
            for (const [paneId, terminalId] of Object.entries(prev)) {
                if (existingTerminalIds.has(terminalId)) {
                    next[paneId] = terminalId;
                } else {
                    changed = true;
                }
            }
            return changed ? next : prev;
        });
    }, [terminals.terminals]);

    useEffect(() => {
        saveItem(TERMINAL_PANE_BINDINGS_STORAGE_KEY, terminalPaneTerminalIds);
    }, [terminalPaneTerminalIds]);

    useEffect(() => {
        saveItem(AGENT_PANE_BINDINGS_STORAGE_KEY, agentPaneSessionIds);
    }, [agentPaneSessionIds]);

    const handleStartSpecificAgentInPane = useCallback((paneId: string, agent: AcpAgent) => {
        const startedAgentId = agents.startAgent(agent);
        if (startedAgentId) {
            bindAgentToPane(paneId, startedAgentId);
        }
        return startedAgentId ?? undefined;
    }, [agents, bindAgentToPane]);

    const handleCloseAgentEverywhere = useCallback((agentId: string) => {
        agents.closeAgent(agentId);
        setAgentPaneSessionIds((prev) => {
            const next: Record<string, string> = {};
            for (const [paneId, paneAgentId] of Object.entries(prev)) {
                if (paneAgentId !== agentId) {
                    next[paneId] = paneAgentId;
                }
            }
            return next;
        });
    }, [agents]);

    const getNextEmptyPanelId = useCallback((kind: 'split' | 'tab') => (
        `pane:empty:${kind}:${splitPanelCounterRef.current++}`
    ), []);

    const dockviewApiRef = useRef<any>(null);
    const dockviewDisposerRef = useRef<{ dispose: () => void } | null>(null);

    useEffect(() => {
        return () => {
            dockviewDisposerRef.current?.dispose();
            dockviewDisposerRef.current = null;
        };
    }, []);

    const handleDockviewReady = useMemo(() => createDockviewReadyHandler({
        createDefaultLayout,
        loadSavedLayout: () => loadItem<any>(DOCKVIEW_LAYOUT_STORAGE_KEY),
        saveLayout: (layout) => saveItem(DOCKVIEW_LAYOUT_STORAGE_KEY, layout),
        terminals: terminals.terminals,
        terminalSelected: terminals.terminalSelected,
        setTerminalPaneTerminalIds,
        setFocusedTerminalPaneId,
        dockviewApiRef,
        dockviewDisposerRef,
    }), [terminals.terminals, terminals.terminalSelected]);

    const dockviewComponents = useMemo(() => ({
        fileTree: FileTreePanel,
        search: SearchPanel,
        changes: ChangesPanel,
        editor: EditorPanel,
        terminal: TerminalPanel,
        toolbar: ToolbarPanel,
        agent: AgentPanel,
        empty: EmptyPanel,
    } satisfies Record<PaneType, React.FC<IDockviewPanelProps>>), []);

    const fileTreePanelContextValue = useMemo<FileTreePanelContextValue>(() => ({
        fileTree,
        openFolder,
        openFileInEditorPane,
    }), [fileTree, openFolder, openFileInEditorPane]);
    const searchPanelContextValue = useMemo<SearchPanelContextValue>(() => ({
        search,
        onSearch: handleSearch,
        onMatchClick: handleSearchResultClick,
    }), [search, handleSearch, handleSearchResultClick]);
    const changesPanelContextValue = useMemo<ChangesPanelContextValue>(() => ({
        git,
        openFileDiffInEditorPane,
    }), [git, openFileDiffInEditorPane]);
    const editorPanelContextValue = useMemo<EditorPanelContextValue>(() => ({
        editors,
    }), [editors]);
    const terminalPanelContextValue = useMemo<TerminalPanelContextValue>(() => ({
        terminals,
        isConnected,
        terminalPaneTerminalIds,
        focusedTerminalPaneId,
        bindTerminalToPane,
        setFocusedTerminalPaneId,
    }), [
        terminals,
        isConnected,
        terminalPaneTerminalIds,
        focusedTerminalPaneId,
        bindTerminalToPane,
        setFocusedTerminalPaneId,
    ]);
    const agentPanelContextValue = useMemo<AgentPanelContextValue>(() => ({
        agents,
        agentPaneSessionIds,
        focusedAgentPaneId,
        isConnected,
        availableAgents,
        bindAgentToPane,
        handleStartSpecificAgentInPane,
        handleCloseAgentEverywhere,
        openFileInEditorPane,
        openFileDiffInEditorPane,
        setFocusedAgentPaneId,
    }), [
        agents,
        agentPaneSessionIds,
        focusedAgentPaneId,
        isConnected,
        availableAgents,
        bindAgentToPane,
        handleStartSpecificAgentInPane,
        handleCloseAgentEverywhere,
        openFileInEditorPane,
        openFileDiffInEditorPane,
        setFocusedAgentPaneId,
    ]);
    const focusedTerminalId = useMemo(() => {
        if (!focusedTerminalPaneId) return null;
        const paneTerminalId = terminalPaneTerminalIds[focusedTerminalPaneId] ?? null;
        if (!paneTerminalId) return null;
        return terminals.terminals.some((term) => term.id === paneTerminalId) ? paneTerminalId : null;
    }, [focusedTerminalPaneId, terminalPaneTerminalIds, terminals.terminals]);

    const toolbarPanelContextValue = useMemo<ToolbarPanelContextValue>(() => ({
        editors,
        terminals,
        sessionsArray,
        focusedAgentId,
        focusedTerminalId,
        bindTerminalToFocusedPane,
        bindAgentToFocusedPane,
        handleCloseAgentEverywhere,
    }), [
        editors,
        terminals,
        sessionsArray,
        focusedAgentId,
        focusedTerminalId,
        bindTerminalToFocusedPane,
        bindAgentToFocusedPane,
        handleCloseAgentEverywhere,
    ]);
    const panelContextProviders = useMemo<ContextProviderDescriptor[]>(() => ([
        { context: FileTreePanelContext, value: fileTreePanelContextValue },
        { context: SearchPanelContext, value: searchPanelContextValue },
        { context: ChangesPanelContext, value: changesPanelContextValue },
        { context: EditorPanelContext, value: editorPanelContextValue },
        { context: TerminalPanelContext, value: terminalPanelContextValue },
        { context: AgentPanelContext, value: agentPanelContextValue },
        { context: ToolbarPanelContext, value: toolbarPanelContextValue },
    ]), [
        fileTreePanelContextValue,
        searchPanelContextValue,
        changesPanelContextValue,
        editorPanelContextValue,
        terminalPanelContextValue,
        agentPanelContextValue,
        toolbarPanelContextValue,
    ]);
    const HeaderActions = useMemo(() => createHeaderActions({
        getNextEmptyPanelId,
    }), [getNextEmptyPanelId]);

    return (
        <Layout
            providers={panelContextProviders}
            dockviewComponents={dockviewComponents}
            HeaderActions={HeaderActions}
            onDockviewReady={handleDockviewReady}
        />
    );
};

export default App;

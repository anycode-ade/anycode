import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnycodeEditorReact } from 'anycode-react';
import { DockviewReact, type IDockviewHeaderActionsProps, type IDockviewPanelProps } from 'dockview';
import 'dockview/dist/styles/dockview.css';
import {
    TreeNodeComponent,
    TerminalComponent,
    ChangesPanel,
} from './components';
import { AcpAgentsList } from './components/agent/AcpAgentsList';
import { AcpSessionView } from './components/agent/AcpSessionView';
import Search from './components/Search';
import {
    getAllAgents,
} from './agents';
import { AcpAgent, type SearchMatch, type AcpSession } from './types';
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
import { type AcpPermissionMode } from './types';

type PaneType = 'fileTree' | 'search' | 'changes' | 'editor' | 'terminal' | 'agent' | 'toolbar' | 'empty';
type RealPaneType = Exclude<PaneType, 'empty'>;

const PANE_IDS: Record<RealPaneType, string> = {
    fileTree: 'pane:fileTree',
    search: 'pane:search',
    changes: 'pane:changes',
    editor: 'pane:editor',
    terminal: 'pane:terminal',
    agent: 'pane:agent',
    toolbar: 'pane:toolbar',
};

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
const AVAILABLE_PANES: Array<{ type: RealPaneType; label: string }> = [
    { type: 'fileTree', label: 'File Tree' },
    { type: 'search', label: 'Search' },
    { type: 'changes', label: 'Changes' },
    { type: 'editor', label: 'Editor' },
    { type: 'terminal', label: 'Terminal' },
    { type: 'agent', label: 'Agent' },
    { type: 'toolbar', label: 'Toolbar' },
];

const OPEN_FILES_STORAGE_KEY = 'openFileIds';
const ACTIVE_FILE_STORAGE_KEY = 'activeFileId';
const DOCKVIEW_LAYOUT_STORAGE_KEY = 'dockviewLayout:v2';
const TERMINAL_PANE_BINDINGS_STORAGE_KEY = 'terminalPaneTerminalIds:v1';
const AGENT_PANE_BINDINGS_STORAGE_KEY = 'agentPaneSessionIds:v1';
const PANEL_CONSTRAINTS = { minimumWidth: 0, minimumHeight: 0 } as const;
const TOOLBAR_PANEL_HEIGHT = 35;
const TOOLBAR_PANEL_CONSTRAINTS = {
    minimumWidth: 0,
    minimumHeight: TOOLBAR_PANEL_HEIGHT,
    maximumHeight: TOOLBAR_PANEL_HEIGHT,
} as const;

type FileTreePanelContextValue = {
    fileTree: ReturnType<typeof useFileTree>;
    openFolder: (path: string) => void;
    openFileInEditorPane: (filePath: string, line?: number, column?: number) => void;
};

const FileTreePanelContext = React.createContext<FileTreePanelContextValue | null>(null);
type SearchPanelContextValue = {
    search: ReturnType<typeof useSearch>;
    onSearch: ({ pattern }: { id: string; pattern: string }) => void;
    onMatchClick: (filePath: string, match: SearchMatch) => void;
};
const SearchPanelContext = React.createContext<SearchPanelContextValue | null>(null);

type ChangesPanelContextValue = {
    git: ReturnType<typeof useGit>;
    openFileDiffInEditorPane: (filePath: string, line?: number, column?: number) => void;
};
const ChangesPanelContext = React.createContext<ChangesPanelContextValue | null>(null);

type EditorPanelContextValue = {
    editors: ReturnType<typeof useEditors>;
};

const EditorPanelContext = React.createContext<EditorPanelContextValue | null>(null);
type TerminalPanelContextValue = {
    terminals: ReturnType<typeof useTerminals>;
    isConnected: boolean;
    terminalPaneTerminalIds: Record<string, string>;
    focusedTerminalPaneId: string | null;
    bindTerminalToPane: (paneId: string, terminalId: string) => void;
    setFocusedTerminalPaneId: React.Dispatch<React.SetStateAction<string | null>>;
};
type AgentPanelContextValue = {
    agents: ReturnType<typeof useAgents>;
    agentPaneSessionIds: Record<string, string>;
    focusedAgentPaneId: string | null;
    isConnected: boolean;
    availableAgents: AcpAgent[];
    bindAgentToPane: (paneId: string, agentId: string) => void;
    handleStartSpecificAgentInPane: (paneId: string, agent: AcpAgent) => string | undefined;
    handleCloseAgentEverywhere: (agentId: string) => void;
    openFileInEditorPane: (filePath: string, line?: number, column?: number) => void;
    openFileDiffInEditorPane: (filePath: string, line?: number, column?: number) => void;
    setFocusedAgentPaneId: React.Dispatch<React.SetStateAction<string | null>>;
};
type ToolbarPanelContextValue = {
    editors: ReturnType<typeof useEditors>;
    terminals: ReturnType<typeof useTerminals>;
    sessionsArray: AcpSession[];
    focusedAgentId: string | null;
    focusedTerminalId: string | null;
    bindTerminalToFocusedPane: (terminalId: string) => void;
    bindAgentToFocusedPane: (agentId: string) => void;
    handleCloseAgentEverywhere: (agentId: string) => void;
};

const TerminalPanelContext = React.createContext<TerminalPanelContextValue | null>(null);
const AgentPanelContext = React.createContext<AgentPanelContextValue | null>(null);
const ToolbarPanelContext = React.createContext<ToolbarPanelContextValue | null>(null);

const FileTreeDockPanel: React.FC<IDockviewPanelProps> = () => {
    const ctx = React.useContext(FileTreePanelContext);
    if (!ctx) return null;

    return (
        <div className="file-system-panel">
            <div className="file-system-content">
                {ctx.fileTree.fileTree.length === 0 ? (
                    <p className="file-system-empty">No files loaded yet</p>
                ) : (
                    <div className="file-tree">
                        {ctx.fileTree.fileTree.map((node) => (
                            <TreeNodeComponent
                                key={node.id}
                                node={node}
                                onToggle={ctx.fileTree.toggleNode}
                                onSelect={ctx.fileTree.selectNode}
                                onOpenFile={ctx.openFileInEditorPane}
                                onLoadFolder={ctx.openFolder}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

const SearchDockPanel: React.FC<IDockviewPanelProps> = () => {
    const ctx = React.useContext(SearchPanelContext);
    if (!ctx) return null;

    return (
        <Search
            id="search-pane"
            onEnter={ctx.onSearch}
            onCancel={ctx.search.cancelSearch}
            results={ctx.search.searchResults}
            searchEnded={ctx.search.searchEnded}
            onMatchClick={ctx.onMatchClick}
        />
    );
};

const ChangesDockPanel: React.FC<IDockviewPanelProps> = () => {
    const ctx = React.useContext(ChangesPanelContext);
    if (!ctx) return null;

    return (
        <ChangesPanel
            files={ctx.git.changedFiles}
            branch={ctx.git.gitBranch}
            onFileClick={ctx.openFileDiffInEditorPane}
            onRefresh={ctx.git.fetchGitStatus}
            onCommit={ctx.git.commit}
            onPush={ctx.git.push}
            onPull={ctx.git.pull}
            onRevert={ctx.git.revert}
        />
    );
};

const EditorDockPanel: React.FC<IDockviewPanelProps> = () => {
    const ctx = React.useContext(EditorPanelContext);
    if (!ctx) return null;

    const paneFileId = ctx.editors.activeFileId;
    const paneFile = paneFileId ? ctx.editors.files.find((file) => file.id === paneFileId) : null;

    return (
        <div className="editor-container">
            {paneFile && ctx.editors.editorStates.has(paneFile.id) ? (
                <AnycodeEditorReact
                    key={`editor:${paneFile.id}`}
                    id={paneFile.id}
                    editorState={ctx.editors.editorStates.get(paneFile.id)!}
                />
            ) : (
                <div className="no-editor"></div>
            )}
        </div>
    );
};

const TerminalDockPanel: React.FC<IDockviewPanelProps> = ({ api }) => {
    const ctx = React.useContext(TerminalPanelContext);
    if (!ctx) return null;
    const paneId = api.id;

    const paneTerminalId = ctx.terminalPaneTerminalIds[paneId] ?? null;
    const paneHasBoundTerminal = paneTerminalId
        ? ctx.terminals.terminals.some((term) => term.id === paneTerminalId)
        : false;
    useEffect(() => {
        if (paneHasBoundTerminal) return;

        const fallbackTerminalId =
            ctx.terminals.terminals[ctx.terminals.terminalSelected]?.id
            ?? ctx.terminals.terminals[0]?.id
            ?? null;

        if (fallbackTerminalId) {
            ctx.bindTerminalToPane(paneId, fallbackTerminalId);
            return;
        }

        const newTerminal = ctx.terminals.addTerminal();
        ctx.bindTerminalToPane(paneId, newTerminal.id);
    }, [paneHasBoundTerminal, paneId, ctx.terminals, ctx.bindTerminalToPane]);

    return (
        <div
            className="terminal-panel"
            onMouseDown={() => {
                ctx.setFocusedTerminalPaneId(paneId);
            }}
        >
            <div className="terminal-pane-content">
                {ctx.terminals.terminals.map((term) => (
                    <div
                        key={term.id}
                        className="terminal-container"
                        style={{
                            visibility: term.id === paneTerminalId && paneHasBoundTerminal ? 'visible' : 'hidden',
                            opacity: term.id === paneTerminalId && paneHasBoundTerminal ? 1 : 0,
                            pointerEvents: term.id === paneTerminalId && paneHasBoundTerminal ? 'auto' : 'none',
                            height: '100%',
                            position: term.id === paneTerminalId ? 'relative' : 'absolute',
                            width: '100%',
                            top: 0,
                            left: 0,
                        }}
                    >
                        <TerminalComponent
                            name={term.name}
                            onData={ctx.terminals.handleTerminalData}
                            onMessage={ctx.terminals.handleTerminalDataCallback}
                            onResize={ctx.terminals.handleTerminalResize}
                            rows={term.rows}
                            cols={term.cols}
                            isConnected={ctx.isConnected}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
};

const ToolbarDockPanel: React.FC<IDockviewPanelProps> = () => {
    const ctx = React.useContext(ToolbarPanelContext);
    if (!ctx) return null;

    return (
        <div className="toolbar toolbar-horizontal">
            <div className="toolbar-scroll-content">
                <div className="toolbar-tabs">
                    {ctx.editors.files.map((file) => (
                        <div
                            key={file.id}
                            className={`tab ${ctx.editors.activeFileId === file.id ? 'active' : ''}`}
                            onClick={() => ctx.editors.setActiveFileId(file.id)}
                        >
                            <span className="tab-filename"> {file.name} </span>
                            <button className="tab-close-button" onClick={(e) => { e.stopPropagation(); ctx.editors.closeFile(file.id); }}>×</button>
                        </div>
                    ))}
                </div>

                <div className="toolbar-terminals">
                    {ctx.terminals.terminals.map((term, index) => (
                        <div
                            key={term.id}
                            className={`tab ${ctx.focusedTerminalId === term.id ? 'active' : ''}`}
                            onClick={() => ctx.bindTerminalToFocusedPane(term.id)}
                        >
                            <span className="tab-filename">{term.name}</span>
                            <button
                                className="tab-close-button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    ctx.terminals.closeTerminal(index);
                                }}
                            >
                                ×
                            </button>
                        </div>
                    ))}
                    <button
                        type="button"
                        className="terminal-toolbar-add-btn"
                        title="New terminal"
                        onClick={() => {
                            const newTerminal = ctx.terminals.addTerminal();
                            ctx.bindTerminalToFocusedPane(newTerminal.id);
                        }}
                    >
                        +
                    </button>
                </div>

                <div className="acp-agents-container app-toolbar-agents">
                    <AcpAgentsList
                        agents={ctx.sessionsArray}
                        selectedAgentId={ctx.focusedAgentId}
                        onSelectAgent={ctx.bindAgentToFocusedPane}
                        onCloseAgent={ctx.handleCloseAgentEverywhere}
                    />
                </div>
            </div>
        </div>
    );
};

const EmptyAgentDockPane: React.FC<{ paneId: string }> = ({ paneId }) => {
    const ctx = React.useContext(AgentPanelContext);
    if (!ctx) return null;

    const runningSessions = Array.from(ctx.agents.acpSessions.values());

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
                                    onClick={() => ctx.bindAgentToPane(paneId, session.agentId)}
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
                    {ctx.availableAgents.length === 0 ? (
                        <li className="empty-agent-empty">No configured agents</li>
                    ) : (
                        ctx.availableAgents.map((agent) => (
                            <li key={agent.id}>
                                <button
                                    type="button"
                                    className="empty-pane-item-btn"
                                    onClick={() => ctx.handleStartSpecificAgentInPane(paneId, agent)}
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

const AgentDockPanel: React.FC<IDockviewPanelProps> = ({ api }) => {
    const ctx = React.useContext(AgentPanelContext);
    if (!ctx) return null;
    const paneId = api.id;
    const paneAgentId = ctx.agentPaneSessionIds[paneId] ?? null;

    if (!paneAgentId) {
        return <EmptyAgentDockPane paneId={paneId} />;
    }

    const paneSession = ctx.agents.acpSessions.get(paneAgentId) ?? null;
    if (!paneSession) {
        return <EmptyAgentDockPane paneId={paneId} />;
    }

    return (
        <AcpSessionView
            key={`acp-pane-${paneSession.agentId}`}
            agentId={paneSession.agentId}
            title={paneSession.agentName || paneSession.agentId}
            isActivePane={true}
            isConnected={paneSession.isActive && ctx.isConnected}
            isProcessing={paneSession.isProcessing || false}
            messages={paneSession.messages}
            modelSelector={paneSession.modelSelector}
            reasoningSelector={paneSession.reasoningSelector}
            contextUsage={paneSession.contextUsage}
            onFocusPane={() => {
                ctx.setFocusedAgentPaneId(paneId);
                ctx.agents.setSelectedAgentId(paneSession.agentId);
            }}
            onSendPrompt={ctx.agents.sendPrompt}
            onCancelPrompt={ctx.agents.cancelPrompt}
            onPermissionResponse={ctx.agents.sendPermissionResponse}
            onUndoPrompt={ctx.agents.undoPrompt}
            onCloseAgent={ctx.handleCloseAgentEverywhere}
            onSelectModel={ctx.agents.setSessionModel}
            onSelectReasoning={ctx.agents.setSessionReasoning}
            onOpenFile={ctx.openFileInEditorPane}
            onOpenFileDiff={ctx.openFileDiffInEditorPane}
        />
    );
};

const EmptyDockPanel: React.FC<IDockviewPanelProps> = ({ api, containerApi }) => {
    const replaceWithPane = (paneType: RealPaneType) => {
        const currentPanel = containerApi.getPanel(api.id);
        if (!currentPanel) return;

        containerApi.addPanel({
            id: `pane:${paneType}:split:${Date.now()}`,
            title: PANE_TITLES[paneType],
            component: paneType,
            params: { paneType },
            ...(paneType === 'toolbar' ? TOOLBAR_PANEL_CONSTRAINTS : PANEL_CONSTRAINTS),
            position: {
                referencePanel: currentPanel,
                direction: 'within',
            },
        });
        currentPanel.api.close();
    };

    return (
        <div className="empty-pane">
            <div className="empty-pane-title">Select Pane Type</div>
            <ul className="empty-pane-list">
                {AVAILABLE_PANES.map((pane) => (
                    <li key={pane.type}>
                        <button
                            type="button"
                            className="empty-pane-item-btn"
                            onClick={() => replaceWithPane(pane.type)}
                        >
                            {pane.label}
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
};

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
        return startedAgentId;
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

    const createDefaultLayout = useCallback((api: any) => {
        const fileTreePanel = api.addPanel({
            id: PANE_IDS.fileTree,
            title: PANE_TITLES.fileTree,
            component: 'fileTree',
            params: { paneType: 'fileTree' },
            ...PANEL_CONSTRAINTS,
        });

        api.addPanel({
            id: PANE_IDS.search,
            title: PANE_TITLES.search,
            component: 'search',
            params: { paneType: 'search' },
            inactive: true,
            ...PANEL_CONSTRAINTS,
            position: {
                referencePanel: fileTreePanel,
                direction: 'within',
            },
        });

        api.addPanel({
            id: PANE_IDS.changes,
            title: PANE_TITLES.changes,
            component: 'changes',
            params: { paneType: 'changes' },
            inactive: true,
            ...PANEL_CONSTRAINTS,
            position: {
                referencePanel: fileTreePanel,
                direction: 'within',
            },
        });

        const editorPanel = api.addPanel({
            id: PANE_IDS.editor,
            title: PANE_TITLES.editor,
            component: 'editor',
            params: { paneType: 'editor' },
            ...PANEL_CONSTRAINTS,
            position: {
                referencePanel: fileTreePanel,
                direction: 'right',
            },
        });

        api.addPanel({
            id: PANE_IDS.agent,
            title: PANE_TITLES.agent,
            component: 'agent',
            params: { paneType: 'agent' },
            ...PANEL_CONSTRAINTS,
            position: {
                referencePanel: editorPanel,
                direction: 'right',
            },
        });

        const terminalPanel = api.addPanel({
            id: PANE_IDS.terminal,
            title: PANE_TITLES.terminal,
            component: 'terminal',
            params: { paneType: 'terminal' },
            ...PANEL_CONSTRAINTS,
            position: {
                referencePanel: editorPanel,
                direction: 'below',
            },
        });

        const toolbarPanel = api.addPanel({
            id: PANE_IDS.toolbar,
            title: PANE_TITLES.toolbar,
            component: 'toolbar',
            params: { paneType: 'toolbar' },
            ...TOOLBAR_PANEL_CONSTRAINTS,
            position: {
                referencePanel: terminalPanel,
                direction: 'below',
            },
        });

        fileTreePanel.group?.api.setSize({ width: 280 });
        terminalPanel.group?.api.setSize({ height: 220 });
        toolbarPanel.group?.api.setSize({ height: TOOLBAR_PANEL_HEIGHT });
        toolbarPanel.api?.setConstraints?.(TOOLBAR_PANEL_CONSTRAINTS);
        toolbarPanel.group?.api?.setConstraints?.(TOOLBAR_PANEL_CONSTRAINTS);
    }, []);

    const createEmptySplitPanel = useCallback((containerApi: any, referencePanel: any, direction: 'right' | 'below') => {
        const panelId = `pane:empty:split:${splitPanelCounterRef.current++}`;
        return containerApi.addPanel({
            id: panelId,
            title: PANE_TITLES.empty,
            component: 'empty',
            params: { paneType: 'empty' },
            ...PANEL_CONSTRAINTS,
            position: {
                referencePanel,
                direction,
            },
        });
    }, []);
    const createEmptyTabPanel = useCallback((containerApi: any, referencePanel: any) => {
        const panelId = `pane:empty:tab:${splitPanelCounterRef.current++}`;
        return containerApi.addPanel({
            id: panelId,
            title: PANE_TITLES.empty,
            component: 'empty',
            params: { paneType: 'empty' },
            ...PANEL_CONSTRAINTS,
            position: {
                referencePanel,
                direction: 'within',
            },
        });
    }, []);

    const dockviewApiRef = useRef<any>(null);
    const dockviewDisposerRef = useRef<{ dispose: () => void } | null>(null);

    useEffect(() => {
        return () => {
            dockviewDisposerRef.current?.dispose();
            dockviewDisposerRef.current = null;
        };
    }, []);

    const handleDockviewReady = useCallback((event: { api: any }) => {
        dockviewApiRef.current = event.api;
        const applyPanelConstraints = () =>
            [...event.api.groups, ...event.api.panels].forEach((item: any) => item.api?.setConstraints?.(PANEL_CONSTRAINTS));
        const applyToolbarConstraints = () => {
            const toolbarPanels = event.api.panels.filter((panel: any) => panel?.id?.startsWith('pane:toolbar'));
            toolbarPanels.forEach((toolbarPanel: any) => {
                toolbarPanel.api?.setConstraints?.(TOOLBAR_PANEL_CONSTRAINTS);
                toolbarPanel.group?.api?.setConstraints?.(TOOLBAR_PANEL_CONSTRAINTS);
            });
        };
        const applyToolbarSizeOnce = () => {
            const toolbarPanels = event.api.panels.filter((panel: any) => panel?.id?.startsWith('pane:toolbar'));
            toolbarPanels.forEach((toolbarPanel: any) => {
                toolbarPanel.group?.api?.setSize?.({ height: TOOLBAR_PANEL_HEIGHT });
            });
        };

        const savedLayout = loadItem<any>(DOCKVIEW_LAYOUT_STORAGE_KEY);
        if (savedLayout) {
            try {
                event.api.fromJSON(savedLayout);
            } catch (error) {
                console.warn('Failed to restore dockview layout, fallback to default', error);
                event.api.clear();
                createDefaultLayout(event.api);
            }
        } else {
            createDefaultLayout(event.api);
        }
        applyPanelConstraints();
        applyToolbarConstraints();
        applyToolbarSizeOnce();

        const fileTreePanel = event.api.getPanel(PANE_IDS.fileTree);
        fileTreePanel?.api.setActive();
        fileTreePanel?.group?.api.setSize({ width: 280 });

        const terminalPanel = event.api.getPanel(PANE_IDS.terminal);
        terminalPanel?.group?.api.setSize({ height: 220 });
        const initialTerminalId =
            terminals.terminals[terminals.terminalSelected]?.id
            ?? terminals.terminals[0]?.id
            ?? null;
        if (terminalPanel && initialTerminalId) {
            setTerminalPaneTerminalIds((prev) => {
                const existingTerminalId = prev[terminalPanel.id];
                if (existingTerminalId && terminals.terminals.some((term) => term.id === existingTerminalId)) {
                    return prev;
                }
                if (existingTerminalId === initialTerminalId) return prev;
                return { ...prev, [terminalPanel.id]: initialTerminalId };
            });
            setFocusedTerminalPaneId((prev) => prev ?? terminalPanel.id);
        }

        dockviewDisposerRef.current?.dispose();
        const onDidLayoutChange = event.api.onDidLayoutChange(() => {
            applyPanelConstraints();
            applyToolbarConstraints();
            saveItem(DOCKVIEW_LAYOUT_STORAGE_KEY, event.api.toJSON());
        });
        const onDidAddGroup = event.api.onDidAddGroup((group: any) => {
            group.api?.setConstraints?.(PANEL_CONSTRAINTS);
            applyToolbarConstraints();
        });
        const onDidAddPanel = event.api.onDidAddPanel((panel: any) => {
            panel.api?.setConstraints?.(PANEL_CONSTRAINTS);
            if (panel?.id?.startsWith('pane:toolbar')) {
                panel.api?.setConstraints?.(TOOLBAR_PANEL_CONSTRAINTS);
                panel.group?.api?.setConstraints?.(TOOLBAR_PANEL_CONSTRAINTS);
                panel.group?.api?.setSize?.({ height: TOOLBAR_PANEL_HEIGHT });
            }
        });
        dockviewDisposerRef.current = {
            dispose: () => {
                onDidLayoutChange.dispose();
                onDidAddGroup.dispose();
                onDidAddPanel.dispose();
            },
        };

        saveItem(DOCKVIEW_LAYOUT_STORAGE_KEY, event.api.toJSON());
    }, [createDefaultLayout, terminals.terminals, terminals.terminalSelected]);

    const dockviewComponents = useMemo(() => ({
        fileTree: FileTreeDockPanel,
        search: SearchDockPanel,
        changes: ChangesDockPanel,
        editor: EditorDockPanel,
        terminal: TerminalDockPanel,
        toolbar: ToolbarDockPanel,
        agent: AgentDockPanel,
        empty: EmptyDockPanel,
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
    const HeaderActions: React.FC<IDockviewHeaderActionsProps> = useCallback(({ activePanel, containerApi }) => {
        if (!activePanel) return null;

        const addTab = () => {
            createEmptyTabPanel(containerApi, activePanel);
        };

        const splitHorizontal = () => {
            createEmptySplitPanel(containerApi, activePanel, 'below');
        };

        const splitVertical = () => {
            createEmptySplitPanel(containerApi, activePanel, 'right');
        };

        return (
            <div className="dockview-header-actions">
                <button
                    type="button"
                    className="dockview-header-action"
                    title="Add tab"
                    onClick={addTab}
                >
                    +
                </button>
                <button
                    type="button"
                    className="dockview-header-action"
                    title="Split horizontal"
                    onClick={splitHorizontal}
                >
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                        <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
                        <path d="M3.5 8h9" stroke="currentColor" strokeWidth="1.2" />
                    </svg>
                </button>
                <button
                    type="button"
                    className="dockview-header-action"
                    title="Split vertical"
                    onClick={splitVertical}
                >
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                        <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
                        <path d="M8 3.5v9" stroke="currentColor" strokeWidth="1.2" />
                    </svg>
                </button>
                <button
                    type="button"
                    className="dockview-header-action close"
                    title="Close panel"
                    onClick={() => activePanel.api.close()}
                >
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                </button>
            </div>
        );
    }, [createEmptySplitPanel, createEmptyTabPanel]);

    return (
        <div className="app-container">
            <FileTreePanelContext.Provider value={fileTreePanelContextValue}>
                <SearchPanelContext.Provider value={searchPanelContextValue}>
                    <ChangesPanelContext.Provider value={changesPanelContextValue}>
                        <EditorPanelContext.Provider value={editorPanelContextValue}>
                            <TerminalPanelContext.Provider value={terminalPanelContextValue}>
                                <AgentPanelContext.Provider value={agentPanelContextValue}>
                                    <ToolbarPanelContext.Provider value={toolbarPanelContextValue}>
                                        <div className="main-content layout dockview-theme-dark anycode-dockview-theme">
                                            <DockviewReact
                                                className="anycode-dockview"
                                                components={dockviewComponents}
                                                rightHeaderActionsComponent={HeaderActions}
                                                onReady={handleDockviewReady}
                                            />
                                        </div>
                                    </ToolbarPanelContext.Provider>
                                </AgentPanelContext.Provider>
                            </TerminalPanelContext.Provider>
                        </EditorPanelContext.Provider>
                    </ChangesPanelContext.Provider>
                </SearchPanelContext.Provider>
            </FileTreePanelContext.Provider>
        </div>
    );
};

export default App;

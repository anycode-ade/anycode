import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnycodeEditorReact } from 'anycode-react';
import 'allotment/dist/style.css';
import {
    TreeNodeComponent,
    TerminalComponent,
    ChangesPanel,
    AcpSettings,
} from './components';
import Search from './components/Search';
import {
    getAllAgents,
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
} from './storage';
import { useSocket } from './hooks/useSocket';
import { useGit } from './hooks/useGit';
import { useSearch } from './hooks/useSearch';
import { useFileTree } from './hooks/useFileTree';
import { useTerminals } from './hooks/useTerminals';
import { useEditors } from './hooks/useEditors';
import { useAgents } from './hooks/useAgents';
import { type AcpPermissionMode } from './types';
import { WorkspaceView } from './workspace/WorkspaceView';
import { WorkspaceToolbarPane } from './workspace/panes/WorkspaceToolbarPane';
import { EmptyAgentPane } from './workspace/panes/EmptyAgentPane';
import { WorkspaceEmptyPane } from './workspace/panes/WorkspaceEmptyPane';
import { useWorkspaceLayout } from './workspace/useWorkspaceLayout';
import type { WorkspacePaneKind, WorkspacePaneNode, WorkspacePaneNodeByKind } from './workspace/types';
import { findFirstPaneByKind, findParentSplitIdByNodeId } from './workspace/layout';
import { AcpSessionView } from './components/agent/AcpSessionView';

const SWAP_PREVIOUS_PANE_GRACE_MS = 220;

const App: React.FC = () => {
    const workspace = useWorkspaceLayout();
    const lastNonToolbarPaneIdRef = useRef<string | null>(null);
    const previousPaneIdRef = useRef<string | null>(null);
    const trackedActivePaneIdRef = useRef<string | null>(workspace.activePaneId);
    const lastPaneChangeAtRef = useRef<number>(Date.now());
    const [activeSplitId, setActiveSplitId] = useState<string | null>(null);
    const [diffEnabled, setDiffEnabled] = useState<boolean>(loadDiffEnabled());
    const [permissionMode, setPermissionMode] = useState<AcpPermissionMode>(loadAcpPermissionMode());

    const { wsRef, isConnected } = useSocket({});
    const fileTree = useFileTree();
    const hasTerminalPane = useMemo(
        () => workspace.panes.some((pane) => pane.kind === 'terminal'),
        [workspace.panes],
    );

    const editors = useEditors({
        wsRef,
        isConnected,
        diffEnabled,
        onFileClosed: () => {
            fileTree.clearFileSelection();
        },
    });
    const terminals = useTerminals({ wsRef, isConnected, bottomPanelVisible: hasTerminalPane });
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

    const focusWorkspacePane = useCallback((paneId: string) => {
        const pane = workspace.findPane(paneId);
        if (!pane) return;

        setActiveSplitId(null);
        workspace.focusPane(paneId);

        if (pane.kind !== 'toolbar') {
            lastNonToolbarPaneIdRef.current = paneId;
        }

        if (pane.kind === 'editor' && pane.state.activeFileId) {
            editors.setActiveFileId(pane.state.activeFileId);
        }

        if (pane.kind === 'agent' && pane.state.sessionId) {
            agents.setSelectedAgentId(pane.state.sessionId);
        }
    }, [agents, editors, workspace]);

    useEffect(() => {
        if (trackedActivePaneIdRef.current === workspace.activePaneId) return;

        previousPaneIdRef.current = trackedActivePaneIdRef.current;
        trackedActivePaneIdRef.current = workspace.activePaneId;
        lastPaneChangeAtRef.current = Date.now();
    }, [workspace.activePaneId]);

    const resolveActionTargetPaneId = useCallback(() => {
        const activePane = workspace.findPane(workspace.activePaneId);
        if (activePane && activePane.kind !== 'toolbar') {
            return activePane.id;
        }

        const lastNonToolbarPaneId = lastNonToolbarPaneIdRef.current;
        if (lastNonToolbarPaneId) {
            const lastPane = workspace.findPane(lastNonToolbarPaneId);
            if (lastPane && lastPane.kind !== 'toolbar') {
                return lastPane.id;
            }
        }

        const fallbackPane = workspace.panes.find((pane) => pane.kind !== 'toolbar');
        return fallbackPane?.id ?? workspace.activePaneId;
    }, [workspace]);

    const resolveTargetPane = useCallback(() => {
        const activePane = workspace.findPane(workspace.activePaneId);
        if (!activePane) {
            return workspace.activePaneId;
        }

        const elapsedSincePaneChange = Date.now() - lastPaneChangeAtRef.current;
        const previousPaneId = previousPaneIdRef.current;

        if (
            activePane.kind === 'toolbar'
            && elapsedSincePaneChange <= SWAP_PREVIOUS_PANE_GRACE_MS
            && previousPaneId
        ) {
            const previousPane = workspace.findPane(previousPaneId);
            if (previousPane) {
                return previousPane.id;
            }
        }

        return activePane.id;
    }, [workspace]);

    useEffect(() => {
        const activePane = workspace.findPane(workspace.activePaneId);
        if (!activePane || activePane.kind !== 'editor') return;

        const paneFileId = activePane.state.activeFileId ?? null;
        const nextFileId = editors.activeFileId ?? null;
        if (paneFileId === nextFileId) return;

        workspace.updatePaneState(activePane.id, (pane) => (
            pane.kind !== 'editor'
                ? pane
                : {
                    ...pane,
                    state: {
                        ...pane.state,
                        activeFileId: nextFileId,
                    },
                }
        ));
    }, [editors.activeFileId, workspace]);

    const updateEditorPaneFile = useCallback((paneId: string, fileId: string | null) => {
        workspace.updatePaneState(paneId, (pane) => (
            pane.kind !== 'editor'
                ? pane
                : {
                    ...pane,
                    state: {
                        ...pane.state,
                        activeFileId: fileId,
                    },
                }
        ));
    }, [workspace]);

    const resolveEditorPaneId = useCallback(() => {
        const activePane = workspace.findPane(workspace.activePaneId);
        if (activePane?.kind === 'editor') {
            return activePane.id;
        }

        if (workspace.lastFocusedEditorPaneId) {
            const lastFocused = workspace.findPane(workspace.lastFocusedEditorPaneId);
            if (lastFocused?.kind === 'editor') {
                return lastFocused.id;
            }
        }

        return findFirstPaneByKind(workspace.layout, 'editor')?.id ?? null;
    }, [workspace]);

    const resolveCurrentAgentPaneId = useCallback(() => {
        const activePane = workspace.findPane(workspace.activePaneId);
        if (activePane?.kind === 'agent') {
            return activePane.id;
        }

        if (workspace.lastFocusedAgentPaneId) {
            const lastFocused = workspace.findPane(workspace.lastFocusedAgentPaneId);
            if (lastFocused?.kind === 'agent') {
                return lastFocused.id;
            }
        }

        return findFirstPaneByKind(workspace.layout, 'agent')?.id ?? null;
    }, [workspace]);

    const getDefaultPaneState = useCallback((kind: WorkspacePaneKind) => {
        switch (kind) {
            case 'empty':
                return {};
            case 'editor':
                return { activeFileId: editors.activeFileId ?? null };
            case 'terminal':
                return { selectedTerminalId: terminals.terminals[terminals.terminalSelected]?.id ?? null };
            case 'agent':
                return { sessionId: agents.selectedAgentId ?? null };
            case 'toolbar':
                return { mode: 'auto' as const, compact: false };
            case 'search':
                return { query: '' };
            case 'changes':
                return { showUntracked: true };
            case 'files':
            default:
                return {};
        }
    }, [agents.selectedAgentId, editors.activeFileId, terminals.terminalSelected, terminals.terminals]);

    const openFileInWorkspace = useCallback((path: string, line?: number, column?: number) => {
        let paneId = resolveEditorPaneId();
        if (!paneId) {
            workspace.splitPane(
                workspace.activePaneId,
                'row',
                'editor',
                { activeFileId: path },
            );
            editors.openFile(path, line, column);
            return;
        }

        updateEditorPaneFile(paneId, path);
        focusWorkspacePane(paneId);
        editors.openFile(path, line, column);
    }, [editors, focusWorkspacePane, resolveEditorPaneId, updateEditorPaneFile, workspace]);

    const openFileDiffInWorkspace = useCallback((path: string, line?: number, column?: number) => {
        let paneId = resolveEditorPaneId();
        if (!paneId) {
            workspace.splitPane(
                workspace.activePaneId,
                'row',
                'editor',
                { activeFileId: path },
            );
            editors.openFileDiff(path, line, column);
            return;
        }

        updateEditorPaneFile(paneId, path);
        focusWorkspacePane(paneId);
        editors.openFileDiff(path, line, column);
    }, [editors, focusWorkspacePane, resolveEditorPaneId, updateEditorPaneFile, workspace]);

    const toggleDiffMode = useCallback(() => {
        const newDiffEnabled = !diffEnabled;
        setDiffEnabled(newDiffEnabled);
        editors.setDiffForAllEditors(newDiffEnabled);
    }, [diffEnabled, editors]);

    const handleSearch = ({ pattern }: { id: string; pattern: string }) => {
        search.startSearch(pattern);
    };

    const handleSearchResultClick = (filePath: string, match: SearchMatch) => {
        openFileInWorkspace(filePath, match.line, match.column);
    };

    const sessionsArray = useMemo(() => Array.from(agents.acpSessions.values()), [agents.acpSessions]);
    const availableAgents = useMemo<AcpAgent[]>(() => getAllAgents(), [agents.agentsVersion]);
    const settingsAgents = useMemo<AcpAgent[]>(() => (
        agents.isAgentSettingsOpen ? getAllAgents() : []
    ), [agents.isAgentSettingsOpen, agents.agentsVersion]);
    const settingsDefaultAgentId = useMemo(
        () => (agents.isAgentSettingsOpen ? getDefaultAgentId() : null),
        [agents.isAgentSettingsOpen, agents.agentsVersion],
    );

    const handleStartSpecificAgent = useCallback((agent: AcpAgent) => {
        return agents.startAgent(agent);
    }, [agents.startAgent]);

    const assignAgentSessionToPane = useCallback((paneId: string, agentId: string) => {
        workspace.updatePaneState(paneId, (currentPane) => (
            currentPane.kind !== 'agent'
                ? currentPane
                : {
                    ...currentPane,
                    state: {
                        ...currentPane.state,
                        sessionId: agentId,
                    },
                }
        ));
        agents.setSelectedAgentId(agentId);
        focusWorkspacePane(paneId);
    }, [agents, focusWorkspacePane, workspace]);

    const startAgentInPane = useCallback((paneId: string, agent: AcpAgent) => {
        const agentId = handleStartSpecificAgent(agent);
        if (!agentId) {
            return null;
        }

        workspace.updatePaneState(paneId, (currentPane) => (
            currentPane.kind !== 'agent'
                ? currentPane
                : {
                    ...currentPane,
                    state: {
                        ...currentPane.state,
                        sessionId: agentId,
                    },
                }
        ));

        return agentId;
    }, [handleStartSpecificAgent, workspace]);

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

    const renderFileTreePanel = useCallback(() => (
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
                                onOpenFile={openFileInWorkspace}
                                onLoadFolder={openFolder}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    ), [fileTree.fileTree, fileTree.selectNode, fileTree.toggleNode, openFileInWorkspace, openFolder]);

    const renderEditorPane = useCallback((pane: WorkspacePaneNodeByKind<'editor'>) => {
        const fileId = pane.state.activeFileId;
        const editorState = fileId ? editors.editorStates.get(fileId) : null;

        return (
            <div className="editor-container">
                {fileId && editorState ? (
                    <AnycodeEditorReact
                        key={`${pane.id}:${fileId}`}
                        id={fileId}
                        editorState={editorState}
                    />
                ) : (
                    <div className="no-editor">Open a file into this pane.</div>
                )}
            </div>
        );
    }, [editors.editorStates]);

    const renderTerminalPane = useCallback((pane: WorkspacePaneNodeByKind<'terminal'>) => {
        const fallbackTerminalId = terminals.terminals[terminals.terminalSelected]?.id
            ?? terminals.terminals[0]?.id
            ?? null;
        const activeTerminalId = pane.state.selectedTerminalId ?? fallbackTerminalId;

        return (
            <div className="terminal-panel">
                <div className="terminal-content">
                    {terminals.terminals.map((term) => {
                        const isActive = term.id === activeTerminalId;
                        return (
                            <div
                                key={term.id}
                                className="terminal-container"
                                style={{
                                    visibility: isActive ? 'visible' : 'hidden',
                                    opacity: isActive ? 1 : 0,
                                    pointerEvents: isActive ? 'auto' : 'none',
                                    height: '100%',
                                    position: isActive ? 'relative' : 'absolute',
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
                        );
                    })}
                </div>
            </div>
        );
    }, [isConnected, terminals]);

    const renderSearchPane = useCallback((pane: WorkspacePaneNodeByKind<'search'>) => (
        <Search
            id={pane.id}
            onEnter={handleSearch}
            onCancel={search.cancelSearch}
            results={search.searchResults}
            searchEnded={search.searchEnded}
            onMatchClick={handleSearchResultClick}
        />
    ), [handleSearch, handleSearchResultClick, search.cancelSearch, search.searchEnded, search.searchResults]);

    const renderChangesPane = useCallback(() => (
        <ChangesPanel
            files={git.changedFiles}
            branch={git.gitBranch}
            onFileClick={openFileDiffInWorkspace}
            onRefresh={git.fetchGitStatus}
            onCommit={git.commit}
            onPush={git.push}
            onPull={git.pull}
            onRevert={git.revert}
        />
    ), [git.changedFiles, git.commit, git.fetchGitStatus, git.gitBranch, git.pull, git.push, git.revert, openFileDiffInWorkspace]);

    const renderAgentPane = useCallback((pane: WorkspacePaneNodeByKind<'agent'>) => {
        if (agents.isAgentSettingsOpen) {
            return (
                <div className="workspace-agent-pane">
                    <AcpSettings
                        agents={settingsAgents}
                        defaultAgentId={settingsDefaultAgentId}
                        permissionMode={permissionMode}
                        onSave={handleSaveAgents}
                        onClose={handleCloseAgentSettings}
                        onLoadSessions={agents.fetchAvailableSessions}
                        onResumeSession={(agent, sessionId) => handleResumeSettingsSession(agent, sessionId)}
                    />
                </div>
            );
        }

        const session = sessionsArray.find((item) => item.agentId === pane.state.sessionId) ?? null;
        if (!session) {
            return (
                <div className="workspace-agent-pane">
                    <EmptyAgentPane
                        availableAgents={availableAgents}
                        onStartAgent={(agent) => startAgentInPane(pane.id, agent)}
                        onAssignSession={(agentId) => assignAgentSessionToPane(pane.id, agentId)}
                        onFocus={() => focusWorkspacePane(pane.id)}
                    />
                </div>
            );
        }

        return (
            <div className="workspace-agent-pane" onMouseDown={() => focusWorkspacePane(pane.id)}>
                <AcpSessionView
                    agentId={session.agentId}
                    title={session.agentName || session.agentId}
                    isConnected={session.isActive && isConnected}
                    isProcessing={session.isProcessing || false}
                    messages={session.messages}
                    modelSelector={session.modelSelector}
                    reasoningSelector={session.reasoningSelector}
                    contextUsage={session.contextUsage}
                    onFocusPane={() => focusWorkspacePane(pane.id)}
                    onSendPrompt={agents.sendPrompt}
                    onCancelPrompt={agents.cancelPrompt}
                    onPermissionResponse={agents.sendPermissionResponse}
                    onUndoPrompt={agents.undoPrompt}
                    onCloseAgent={agents.closeAgent}
                    onSelectModel={agents.setSessionModel}
                    onSelectReasoning={agents.setSessionReasoning}
                    onOpenFile={openFileInWorkspace}
                    onOpenFileDiff={openFileDiffInWorkspace}
                />
            </div>
        );
    }, [
        agents,
        assignAgentSessionToPane,
        availableAgents,
        focusWorkspacePane,
        handleCloseAgentSettings,
        handleResumeSettingsSession,
        handleSaveAgents,
        isConnected,
        openFileDiffInWorkspace,
        openFileInWorkspace,
        permissionMode,
        sessionsArray,
        settingsAgents,
        settingsDefaultAgentId,
        startAgentInPane,
    ]);

    const renderToolbarPane = useCallback((pane: WorkspacePaneNodeByKind<'toolbar'>) => (
        <WorkspaceToolbarPane
            state={pane.state}
            files={editors.files}
            terminals={terminals.terminals}
            agents={sessionsArray}
            selectedAgentId={agents.selectedAgentId}
            activeFileId={editors.activeFileId}
            activeTerminalIndex={terminals.terminalSelected}
            onSelectFile={(fileId) => {
                const editorPaneId = resolveEditorPaneId();
                if (!editorPaneId) {
                    workspace.splitPane(
                        workspace.activePaneId,
                        'row',
                        'editor',
                        { activeFileId: fileId },
                    );
                    editors.setActiveFileId(fileId);
                    return;
                }
                updateEditorPaneFile(editorPaneId, fileId);
                focusWorkspacePane(editorPaneId);
                editors.setActiveFileId(fileId);
            }}
            onCloseFile={editors.closeFile}
            onSelectTerminal={(index) => {
                terminals.setTerminalSelected(index);

                const targetPaneId = resolveActionTargetPaneId();
                const targetPane = workspace.findPane(targetPaneId);
                if (!targetPane || targetPane.kind === 'toolbar') return;

                const terminalId = terminals.terminals[index]?.id ?? null;
                if (targetPane.kind === 'terminal') {
                    workspace.updatePaneState(targetPane.id, (currentPane) => (
                        currentPane.kind !== 'terminal'
                            ? currentPane
                            : {
                                ...currentPane,
                                state: {
                                    ...currentPane.state,
                                    selectedTerminalId: terminalId,
                                },
                            }
                    ));
                    return;
                }

                workspace.replacePaneKind(targetPane.id, 'terminal', { selectedTerminalId: terminalId });
            }}
            onCloseTerminal={terminals.closeTerminal}
            onSelectAgent={(agentId) => {
                const targetPaneId = resolveCurrentAgentPaneId();
                if (targetPaneId) {
                    workspace.updatePaneState(targetPaneId, (currentPane) => (
                        currentPane.kind !== 'agent'
                            ? currentPane
                            : {
                                ...currentPane,
                                state: {
                                    ...currentPane.state,
                                    sessionId: agentId,
                                },
                            }
                    ));
                }

                agents.setSelectedAgentId(agentId);
            }}
            onCloseAgent={agents.closeAgent}
            onSplitActivePane={(direction) => {
                const targetPaneId = resolveTargetPane();
                workspace.splitPane(targetPaneId, direction, 'empty', {});
            }}
            onCloseActivePane={() => {
                workspace.closePane(resolveActionTargetPaneId());
            }}
            onClearActivePane={() => {
                const targetPaneId = resolveActionTargetPaneId();
                const targetPane = workspace.findPane(targetPaneId);
                if (!targetPane || targetPane.kind === 'toolbar') return;
                workspace.replacePaneKind(targetPaneId, 'empty', {});
            }}
            onSwapActivePane={() => {
                const targetPaneId = resolveTargetPane();
                workspace.swapPaneWithSibling(targetPaneId);
            }}
            onToggleActivePaneSplitDirection={() => {
                const targetPaneId = resolveTargetPane();
                const targetPane = workspace.findPane(targetPaneId);
                if (!targetPane) return;
                workspace.toggleParentSplitDirectionForPane(targetPane.id);
            }}
            onActivateParentPane={() => {
                const targetPaneId = resolveActionTargetPaneId();
                const fromNodeId = activeSplitId ?? targetPaneId;
                const parentId = findParentSplitIdByNodeId(workspace.layout, fromNodeId);
                if (!parentId) return;
                setActiveSplitId(parentId);
            }}
            onToggleDiff={toggleDiffMode}
            diffEnabled={diffEnabled}
        />
    ), [
        activeSplitId,
        agents,
        diffEnabled,
        editors,
        focusWorkspacePane,
        resolveActionTargetPaneId,
        resolveCurrentAgentPaneId,
        resolveEditorPaneId,
        resolveTargetPane,
        sessionsArray,
        terminals,
        toggleDiffMode,
        updateEditorPaneFile,
        workspace,
    ]);

    const renderEmptyPane = useCallback((pane: WorkspacePaneNodeByKind<'empty'>) => (
        <WorkspaceEmptyPane
            onSplit={(direction) => {
                workspace.splitPane(pane.id, direction, 'empty', {});
            }}
            onSwap={() => {
                workspace.swapPaneWithSibling(pane.id);
            }}
            onToggleSplitDirection={() => {
                workspace.toggleParentSplitDirectionForPane(pane.id);
            }}
            onActivateParentPane={() => {
                const fromNodeId = activeSplitId ?? pane.id;
                const parentId = findParentSplitIdByNodeId(workspace.layout, fromNodeId);
                if (!parentId) return;
                setActiveSplitId(parentId);
            }}
            onClose={() => {
                workspace.closePane(pane.id);
            }}
            onSelectKind={(kind) => {
                let paneState: unknown;
                if (kind === 'agent') {
                    paneState = { sessionId: null };
                } else if (kind === 'terminal') {
                    const nextTerminalId = terminals.addTerminal();
                    paneState = { selectedTerminalId: nextTerminalId };
                } else {
                    paneState = getDefaultPaneState(kind);
                }

                workspace.replacePaneKind(
                    pane.id,
                    kind,
                    paneState as never,
                );
            }}
        />
    ), [activeSplitId, getDefaultPaneState, terminals, workspace]);

    const renderPaneContent = useCallback((pane: WorkspacePaneNode) => {
        switch (pane.kind) {
            case 'files':
                return renderFileTreePanel();
            case 'search':
                return renderSearchPane(pane);
            case 'changes':
                return renderChangesPane();
            case 'terminal':
                return renderTerminalPane(pane);
            case 'agent':
                return renderAgentPane(pane);
            case 'toolbar':
                return renderToolbarPane(pane);
            case 'empty':
                return renderEmptyPane(pane);
            case 'editor':
            default:
                return renderEditorPane(pane);
        }
    }, [
        renderAgentPane,
        renderChangesPane,
        renderEditorPane,
        renderEmptyPane,
        renderFileTreePanel,
        renderSearchPane,
        renderTerminalPane,
        renderToolbarPane,
    ]);

    return (
        <div className={`app-container ${hasTerminalPane ? 'terminal-visible' : ''}`}>
            <div className="main-content">
                <WorkspaceView
                    layout={workspace.layout}
                    activePaneId={workspace.activePaneId}
                    activeSplitId={activeSplitId}
                    onFocusPane={focusWorkspacePane}
                    onResizeSplit={workspace.updateSplitSizes}
                    renderPaneContent={renderPaneContent}
                />
            </div>
        </div>
    );
};

export default App;

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnycodeEditorReact } from 'anycode-react';
import 'dockview/dist/styles/dockview.css';
import {
    TreeNodeComponent,
    Terminal,
    ChangesPanel,
} from './components';
import Search from './components/Search';
import { Layout, type PanelId } from './components/layout/Layout';
import { AcpSettings } from './components/agent/AcpSettings';
import { AcpSession } from './components/agent/AcpSession';
import { AcpEmptyPane } from './components/agent/AcpEmptyPane';
import { TerminalEmptyPane } from './components/terminal/TerminalEmptyPane';
import { Toolbar } from './components/toolbar/Toolbar';
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
    // loadFollowEnabled,
    loadAcpPermissionMode,
    loadItem,
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

const App: React.FC = () => {
    const [terminalSelectedByPane, setTerminalSelectedByPane] = useState<Record<string, number | null>>(() => (
        loadItem<Record<string, number | null>>('terminalSelectedByPane') ?? { terminal: null }
    ));
    const [agentSelectedByPane, setAgentSelectedByPane] = useState<Record<string, string | null>>(() => (
        loadItem<Record<string, string | null>>('agentSelectedByPane') ?? { agent: null }
    ));
    const [activeTerminalPaneId, setActiveTerminalPaneId] = useState<string>('terminal');
    const [activeAgentPaneId, setActiveAgentPaneId] = useState<string>('agent');

    const [diffEnabled, setDiffEnabled] = useState<boolean>(loadDiffEnabled());
    // const [followEnabled, setFollowEnabled] = useState<boolean>(loadFollowEnabled());
    const [permissionMode, setPermissionMode] = useState<AcpPermissionMode>(loadAcpPermissionMode());

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

    const terminals = useTerminals({ wsRef, isConnected });
    const git = useGit({ wsRef, isConnected });
    const search = useSearch({ wsRef, isConnected });
    const wasConnectedRef = useRef<boolean>(false);
    const agents = useAgents({
        wsRef,
        isConnected,
        // followEnabled,
        followEnabled: false,
        openFile: editors.openFile,
        openFileDiff: editors.openFileDiff,
        onAgentStarted: () => {
            setDiffEnabled(true);
            // setFollowEnabled(true);
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
        saveItem('terminalSelectedByPane', terminalSelectedByPane);
    }, [terminalSelectedByPane]);

    useEffect(() => {
        saveItem('agentSelectedByPane', agentSelectedByPane);
    }, [agentSelectedByPane]);

    useEffect(() => {
        saveItem('diffEnabled', diffEnabled);
    }, [diffEnabled]);

    // useEffect(() => {
    //     saveItem('followEnabled', followEnabled);
    // }, [followEnabled]);

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
        const lastIndex = terminals.terminals.length - 1;
        setTerminalSelectedByPane((prev) => {
            const next: Record<string, number | null> = {};
            const source = Object.keys(prev).length > 0 ? prev : { terminal: null };
            Object.entries(source).forEach(([paneKey, selected]) => {
                if (selected === null || lastIndex < 0) {
                    next[paneKey] = null;
                    return;
                }
                next[paneKey] = Math.min(Math.max(selected, 0), lastIndex);
            });
            return next;
        });
    }, [terminals.terminals.length]);

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

    const handleSearchResultClick = (filePath: string, match: SearchMatch) => {
        editors.openFile(filePath, match.line, match.column);
    };

    // const toggleFollowMode = useCallback(() => {
    //     setFollowEnabled((prev) => !prev);
    // }, []);

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

    useEffect(() => {
        const validAgentIds = new Set(sessionsArray.map((session) => session.agentId));
        setAgentSelectedByPane((prev) => {
            if (Object.keys(prev).length === 0) {
                return prev;
            }

            const next: Record<string, string | null> = {};
            Object.entries(prev).forEach(([paneKey, selectedAgentId]) => {
                next[paneKey] = selectedAgentId && validAgentIds.has(selectedAgentId)
                    ? selectedAgentId
                    : null;
            });
            return next;
        });
    }, [sessionsArray]);
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

    const handleAgentToolbarSelect = useCallback((agentId: string) => {
        const paneKey = activeAgentPaneId || 'agent';
        setAgentSelectedByPane((prev) => ({
            ...prev,
            [paneKey]: agentId,
        }));
        agents.setSelectedAgentId(agentId);
    }, [activeAgentPaneId, agents.setSelectedAgentId]);

    const handleAgentToolbarAdd = useCallback(() => {
        const paneKey = activeAgentPaneId || 'agent';
        const startedAgentId = handleAddAgent();
        if (startedAgentId) {
            setAgentSelectedByPane((prev) => ({
                ...prev,
                [paneKey]: startedAgentId,
            }));
            agents.setSelectedAgentId(startedAgentId);
        }
    }, [activeAgentPaneId, handleAddAgent, agents.setSelectedAgentId]);

    const handleSaveAgents = useCallback((agentList: AcpAgent[], defaultAgentId: string | null, nextPermissionMode: AcpPermissionMode) => {
        updateAgents(agentList, defaultAgentId);
        setPermissionMode(nextPermissionMode);
        agents.setAgentsVersion((prev) => prev + 1);
    }, [agents.setAgentsVersion]);

    const fileTreePanel = (
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
                                onOpenFile={editors.openFile}
                                onLoadFolder={openFolder}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );

    const searchPanel = (
        <Search
            id="search"
            onEnter={handleSearch}
            onCancel={search.cancelSearch}
            results={search.searchResults}
            searchEnded={search.searchEnded}
            onMatchClick={handleSearchResultClick}
        />
    );

    const changesPanel = (
        <ChangesPanel
            files={git.changedFiles}
            branch={git.gitBranch}
            onFileClick={editors.openFileDiff}
            onRefresh={git.fetchGitStatus}
            onCommit={git.commit}
            onPush={git.push}
            onPull={git.pull}
            onRevert={git.revert}
        />
    );

    const renderEditorPanel = useCallback((panelKey: string) => {
        const paneFileId = editors.getActiveFileIdForPane(panelKey);
        const paneFile = paneFileId ? editors.files.find((file) => file.id === paneFileId) : null;
        const editorState = paneFile ? editors.editorStates.get(paneFile.id) : null;

        return (
            <div
                className="editor-container"
                onMouseDown={() => editors.setActiveEditorPaneId(panelKey)}
            >
                {paneFile && editorState ? (
                    <AnycodeEditorReact
                        key={`${panelKey}:${paneFile.id}`}
                        id={paneFile.id}
                        editorState={editorState}
                    />
                ) : (
                    <div className="no-editor"></div>
                )}
            </div>
        );
    }, [editors]);

    const getSelectedTerminalIndex = useCallback((paneKey: string): number | null => {
        const selected = Object.hasOwn(terminalSelectedByPane, paneKey) ? terminalSelectedByPane[paneKey] : null;
        if (selected === null || terminals.terminals.length === 0) {
            return null;
        }
        const lastIndex = terminals.terminals.length - 1;
        return Math.min(Math.max(selected, 0), lastIndex);
    }, [terminalSelectedByPane, terminals.terminals.length]);

    const setSelectedTerminalForPane = useCallback((paneKey: string, index: number | null) => {
        const nextIndex = index === null ? null : Math.max(0, index);
        setTerminalSelectedByPane((prev) => ({
            ...prev,
            [paneKey]: nextIndex,
        }));
    }, []);

    const handleTerminalTabSelect = useCallback((index: number) => {
        const paneKey = activeTerminalPaneId || 'terminal';
        setSelectedTerminalForPane(paneKey, index);
    }, [activeTerminalPaneId, setSelectedTerminalForPane]);

    const handleTerminalTabClose = useCallback((index: number) => {
        terminals.closeTerminal(index);
        setTerminalSelectedByPane((prev) => {
            const next: Record<string, number | null> = {};
            Object.entries(prev).forEach(([paneKey, selected]) => {
                if (selected === null) {
                    next[paneKey] = null;
                    return;
                }
                if (selected > index) {
                    next[paneKey] = selected - 1;
                    return;
                }
                if (selected === index) {
                    next[paneKey] = null;
                    return;
                }
                next[paneKey] = selected;
            });
            return next;
        });
    }, [terminals.closeTerminal]);

    const handleAddTerminalFromToolbar = useCallback(() => {
        terminals.addTerminal();
        const paneKey = activeTerminalPaneId || 'terminal';
        setSelectedTerminalForPane(paneKey, terminals.terminals.length);
    }, [activeTerminalPaneId, terminals, setSelectedTerminalForPane]);

    const renderTerminalPanel = useCallback((panelKey: string) => {
        const selectedIndex = getSelectedTerminalIndex(panelKey);
        if (selectedIndex === null) {
            return (
                <div className="terminal-panel terminal-panel-empty">
                    <TerminalEmptyPane
                        terminals={terminals.terminals}
                        onSelectTerminal={(index) => {
                            setSelectedTerminalForPane(panelKey, index);
                        }}
                        onCloseTerminal={handleTerminalTabClose}
                        onCreateTerminal={handleAddTerminalFromToolbar}
                    />
                </div>
            );
        }

        const selectedTerminal = terminals.terminals[selectedIndex];
        if (!selectedTerminal) {
            return null;
        }

        return (
            <div className="terminal-panel">
                <div className="terminal-content">
                    <div className="terminal-container">
                        <Terminal
                            key={`${panelKey}-${selectedTerminal.id}`}
                            name={selectedTerminal.name}
                            onData={terminals.handleTerminalData}
                            onMessage={terminals.handleTerminalDataCallback}
                            onResize={terminals.handleTerminalResize}
                            rows={selectedTerminal.rows}
                            cols={selectedTerminal.cols}
                            isConnected={isConnected}
                        />
                    </div>
                </div>
            </div>
        );
    }, [
        getSelectedTerminalIndex,
        handleAddTerminalFromToolbar,
        isConnected,
        setSelectedTerminalForPane,
        terminals.terminals,
        terminals.handleTerminalData,
        terminals.handleTerminalDataCallback,
        terminals.handleTerminalResize,
    ]);

    const getSelectedAgentIdForPane = useCallback((paneKey: string): string | null => {
        if (Object.hasOwn(agentSelectedByPane, paneKey)) {
            return agentSelectedByPane[paneKey] ?? null;
        }
        if (paneKey === 'agent') {
            return agents.selectedAgentId ?? null;
        }
        return null;
    }, [agentSelectedByPane, agents.selectedAgentId]);

    const renderAgentPanel = useCallback((panelKey: string) => {
        const selectedAgentId = getSelectedAgentIdForPane(panelKey);
        const selectedSession = selectedAgentId ? agents.acpSessions.get(selectedAgentId) ?? null : null;
        const handleSelectAgentForPane = (agentId: string) => {
            setAgentSelectedByPane((prev) => {
                if (prev[panelKey] === agentId) {
                    return prev;
                }
                return {
                    ...prev,
                    [panelKey]: agentId,
                };
            });
            if (agents.selectedAgentId !== agentId) {
                agents.setSelectedAgentId(agentId);
            }
        };

        if (agents.isAgentSettingsOpen && panelKey === activeAgentPaneId) {
            return (
                <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
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

        if (!selectedSession) {
            return (
                <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                        <AcpEmptyPane
                            agents={sessionsArray}
                            availableAgents={availableAgents}
                            onSelectAgent={handleSelectAgentForPane}
                            onCloseAgent={agents.closeAgent}
                            onStartAgent={handleStartSpecificAgent}
                            onOpenSettings={handleOpenAgentSettings}
                        />
                    </div>
                </div>
            );
        }

        return (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <div style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                    <AcpSession
                        agentId={selectedSession.agentId}
                        title={selectedSession.agentName || selectedSession.agentId}
                        isConnected={selectedSession.isActive && isConnected}
                        isProcessing={selectedSession.isProcessing || false}
                        messages={selectedSession.messages}
                        modelSelector={selectedSession.modelSelector}
                        reasoningSelector={selectedSession.reasoningSelector}
                        contextUsage={selectedSession.contextUsage}
                        onFocusPane={() => {
                            // if (activeAgentPaneId === panelKey && agents.selectedAgentId === selectedSession.agentId) {
                            //     return;
                            // }
                            // handleSelectAgentForPane(selectedSession.agentId);
                        }}
                        onSendPrompt={agents.sendPrompt}
                        onCancelPrompt={agents.cancelPrompt}
                        onPermissionResponse={agents.sendPermissionResponse}
                        onUndoPrompt={agents.undoPrompt}
                        onCloseAgent={agents.closeAgent}
                        onSelectModel={agents.setSessionModel}
                        onSelectReasoning={agents.setSessionReasoning}
                        onOpenFile={editors.openFile}
                        onOpenFileDiff={editors.openFileDiff}
                    />
                </div>
            </div>
        );
    }, [
        activeAgentPaneId,
        agents.acpSessions,
        agents.cancelPrompt,
        agents.closeAgent,
        agents.fetchAvailableSessions,
        agents.isAgentSettingsOpen,
        agents.sendPermissionResponse,
        agents.sendPrompt,
        agents.setSelectedAgentId,
        agents.setSessionModel,
        agents.setSessionReasoning,
        agents.undoPrompt,
        availableAgents,
        editors.openFile,
        editors.openFileDiff,
        getSelectedAgentIdForPane,
        handleCloseAgentSettings,
        handleOpenAgentSettings,
        handleResumeSettingsSession,
        handleSaveAgents,
        handleStartSpecificAgent,
        isConnected,
        permissionMode,
        sessionsArray,
        settingsAgents,
        settingsDefaultAgentId,
    ]);

    const toolbar = (
        <Toolbar
            files={editors.files}
            activeFileId={editors.activeFileId}
            terminals={terminals.terminals}
            activeTerminalIndex={getSelectedTerminalIndex(activeTerminalPaneId || 'terminal')}
            agentSessions={sessionsArray}
            activeAgentId={getSelectedAgentIdForPane(activeAgentPaneId || 'agent')}
            onSelectFile={editors.setActiveFileId}
            onCloseFile={editors.closeFile}
            onSelectTerminal={handleTerminalTabSelect}
            onCloseTerminal={handleTerminalTabClose}
            onSelectAgent={handleAgentToolbarSelect}
            onCloseAgent={agents.closeAgent}
            onAddAgent={handleAgentToolbarAdd}
        />
    );

    const dockPanels = useMemo(() => ({
        files: fileTreePanel,
        search: searchPanel,
        changes: changesPanel,
        editor: <div className="editor-container" />,
        agent: <div className="acp-panel" />,
        terminal: <div className="terminal-panel" />,
        toolbar,
    }), [fileTreePanel, searchPanel, changesPanel, toolbar]);

    const handlePanelAdded = useCallback((panelId: PanelId, panelKey: string) => {
        if (panelId === 'changes') {
            git.fetchGitStatus();
            return;
        }
        if (panelId === 'editor') {
            editors.registerEditorPane(panelKey);
            editors.setActiveEditorPaneId(panelKey);
            return;
        }
        if (panelId === 'agent') {
            setActiveAgentPaneId(panelKey);
            setAgentSelectedByPane((prev) => ({
                ...prev,
                [panelKey]: prev[panelKey] ?? null,
            }));
            return;
        }
        if (panelId === 'terminal') {
            setActiveTerminalPaneId(panelKey);
            setTerminalSelectedByPane((prev) => ({
                ...prev,
                [panelKey]: prev[panelKey] ?? null,
            }));
        }
    }, [editors, git.fetchGitStatus]);

    const handlePanelRemoved = useCallback((panelId: PanelId, panelKey: string) => {
        if (panelId === 'editor') {
            editors.unregisterEditorPane(panelKey);
            return;
        }
        if (panelId === 'agent') {
            setAgentSelectedByPane((prev) => {
                const next = { ...prev };
                delete next[panelKey];
                return Object.keys(next).length > 0 ? next : { agent: null };
            });
            if (activeAgentPaneId === panelKey) {
                setActiveAgentPaneId('agent');
            }
            return;
        }
        if (panelId === 'terminal') {
            setTerminalSelectedByPane((prev) => {
                const next = { ...prev };
                delete next[panelKey];
                return Object.keys(next).length > 0 ? next : { terminal: null };
            });
            if (activeTerminalPaneId === panelKey) {
                setActiveTerminalPaneId('terminal');
            }
        }
    }, [activeAgentPaneId, activeTerminalPaneId, editors]);

    const handlePanelActivated = useCallback((panelId: PanelId, panelKey: string) => {
        if (panelId === 'editor') {
            editors.setActiveEditorPaneId(panelKey);

            const paneFileId = editors.getActiveFileIdForPane(panelKey);
            if (!paneFileId) {
                return;
            }

            const editorState = editors.getEditorState(paneFileId);
            if (editorState) {
                editorState.restoreScroll();
                editorState.renderCursorOrSelection();
            }
            return;
        }
        if (panelId === 'agent') {
            setActiveAgentPaneId(panelKey);
            return;
        }
        if (panelId === 'terminal') {
            setActiveTerminalPaneId(panelKey);
        }
    }, [editors]);

    return (
        <div className="app-container toolbar-header-compact">
            <div className="main-content" style={{ flex: 1, display: 'flex' }}>
                <Layout
                    panels={dockPanels}
                    panelContentOverrides={{ editor: renderEditorPanel, terminal: renderTerminalPanel, agent: renderAgentPanel }}
                    onPanelAdded={handlePanelAdded}
                    onPanelRemoved={handlePanelRemoved}
                    onPanelActivated={handlePanelActivated}
                />
            </div>
        </div>
    );
};

export default App;

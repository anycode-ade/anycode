import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import 'dockview/dist/styles/dockview.css';
import { ChangesPanel } from './components';
import Search from './components/Search';
import { Layout, type PanelId } from './components/layout/Layout';
import { Toolbar } from './components/toolbar/Toolbar';
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
    // loadFollowEnabled,
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
import { useTerminalPanes } from './features/terminal/useTerminalPanes';
import { useAgentPanes } from './features/agents/useAgentPanes';
import { FilesPanel } from './features/files/FilesPanel';
import { EditorPanel } from './features/editor/EditorPanel';
import { TerminalPanel } from './features/terminal/TerminalPanel';
import { AgentPanel } from './features/agents/AgentPanel';

const App: React.FC = () => {
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
    const terminalPanes = useTerminalPanes({
        terminals: terminals.terminals,
        addTerminal: terminals.addTerminal,
        closeTerminal: terminals.closeTerminal,
    });
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

        const events = [
            ['lsp:diagnostics', editors.handleDiagnostics],
            ['watcher:edits', editors.handleWatcherEdits],
            ['watcher:create', fileTree.handleWatcherCreate],
            ['watcher:remove', fileTree.handleWatcherRemove],
            ['git:status-update', git.handleGitStatusUpdate],
            ['acp:message', agents.handleAcpMessage],
            ['acp:history', agents.handleAcpHistory],
            ['search:result', search.handleSearchResult],
            ['search:end', search.handleSearchEnd],
        ] as const;

        events.forEach(([event, handler]) => ws.on(event, handler));
        return () => {
            events.forEach(([event, handler]) => ws.off(event, handler));
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
    const settingsAgents = useMemo<AcpAgent[]>(() => (
        agents.isAgentSettingsOpen ? getAllAgents() : []
    ), [agents.isAgentSettingsOpen, agents.agentsVersion]);
    const settingsDefaultAgentId = useMemo(
        () => (agents.isAgentSettingsOpen ? getDefaultAgentId() : null),
        [agents.isAgentSettingsOpen, agents.agentsVersion],
    );

    const agentPanes = useAgentPanes({
        sessions: sessionsArray,
        selectedAgentId: agents.selectedAgentId,
        setSelectedAgentId: agents.setSelectedAgentId,
    });

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

    const handleTerminalTabSelect = useCallback((index: number) => {
        terminalPanes.selectTab(index);
    }, [terminalPanes]);

    const renderPanel = (panelId: PanelId, panelKey: string) => {
        switch (panelId) {
            case 'files':
                return (
                    <FilesPanel
                        fileTree={fileTree.fileTree}
                        onToggle={fileTree.toggleNode}
                        onSelect={fileTree.selectNode}
                        onOpenFile={editors.openFile}
                        onLoadFolder={openFolder}
                    />
                );
            case 'search':
                return (
                    <Search
                        id="search"
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
                        onFileClick={editors.openFileDiff}
                        onRefresh={git.fetchGitStatus}
                        onCommit={git.commit}
                        onPush={git.push}
                        onPull={git.pull}
                        onRevert={git.revert}
                    />
                );
            case 'editor':
                return <EditorPanel panelKey={panelKey} editors={editors} />;
            case 'terminal':
                return (
                    <TerminalPanel
                        panelKey={panelKey}
                        isConnected={isConnected}
                        terminals={terminals.terminals}
                        terminalPanes={terminalPanes}
                        onTerminalData={terminals.handleTerminalData}
                        onTerminalMessage={terminals.handleTerminalDataCallback}
                        onTerminalResize={terminals.handleTerminalResize}
                        onIsTerminalClosing={terminals.isTerminalClosing}
                    />
                );
            case 'agent':
                return (
                    <AgentPanel
                        panelKey={panelKey}
                        isConnected={isConnected}
                        agentPanes={agentPanes}
                        agents={agents}
                        sessions={sessionsArray}
                        availableAgents={availableAgents}
                        settingsAgents={settingsAgents}
                        settingsDefaultAgentId={settingsDefaultAgentId}
                        permissionMode={permissionMode}
                        onSaveAgents={handleSaveAgents}
                        onCloseSettings={handleCloseAgentSettings}
                        onResumeSettingsSession={handleResumeSettingsSession}
                        onStartSpecificAgent={handleStartSpecificAgent}
                        onOpenSettings={handleOpenAgentSettings}
                        onOpenFile={editors.openFile}
                        onOpenFileDiff={editors.openFileDiff}
                    />
                );
            case 'toolbar':
                return (
                    <Toolbar
                        files={editors.files}
                        activeFileId={editors.activeFileId}
                        terminals={terminals.terminals}
                        activeTerminalIndex={terminalPanes.getSelectedIndex(terminalPanes.activePaneId || 'terminal')}
                        agentSessions={sessionsArray}
                        activeAgentId={agentPanes.getSelectedId(agentPanes.activePaneId || 'agent')}
                        onSelectFile={editors.setActiveFileId}
                        onCloseFile={editors.closeFile}
                        onSelectTerminal={handleTerminalTabSelect}
                        onCloseTerminal={terminalPanes.closeTab}
                        onSelectAgent={agentPanes.selectFromToolbar}
                        onCloseAgent={agents.closeAgent}
                    />
                );
            default:
                return null;
        }
    };

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
            agentPanes.registerPane(panelKey);
            return;
        }
        if (panelId === 'terminal') {
            terminalPanes.registerPane(panelKey);
        }
    }, [agentPanes, editors, git.fetchGitStatus, terminalPanes]);

    const handlePanelRemoved = useCallback((panelId: PanelId, panelKey: string) => {
        if (panelId === 'editor') {
            editors.unregisterEditorPane(panelKey);
            return;
        }
        if (panelId === 'agent') {
            agentPanes.unregisterPane(panelKey);
            return;
        }
        if (panelId === 'terminal') {
            terminalPanes.unregisterPane(panelKey);
        }
    }, [agentPanes, editors, terminalPanes]);

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
            agentPanes.setActivePaneId(panelKey);
            return;
        }
        if (panelId === 'terminal') {
            terminalPanes.setActivePaneId(panelKey);
        }
    }, [agentPanes, editors, terminalPanes]);

    return (
        <div className="app-container toolbar-header-compact">
            <div className="main-content" style={{ flex: 1, display: 'flex' }}>
                <Layout
                    renderPanel={renderPanel}
                    onPanelAdded={handlePanelAdded}
                    onPanelRemoved={handlePanelRemoved}
                    onPanelActivated={handlePanelActivated}
                />
            </div>
        </div>
    );
};

export default App;

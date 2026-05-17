import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import 'dockview/dist/styles/dockview.css';
import { ChangesPanel } from './components';
import Search from './components/Search';
import { Layout, type LayoutActions, type PanelId } from './components/layout/Layout';
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
import { useLayout } from './hooks/useLayout';
import { type AcpPermissionMode } from './types';
import { useTerminalPanes } from './features/terminal/useTerminalPanes';
import { useAgentPanes } from './features/agents/useAgentPanes';
import { FilesPanel } from './features/files/FilesPanel';
import { EditorPanel } from './features/editor/EditorPanel';
import { TerminalPanel } from './features/terminal/TerminalPanel';
import { AgentPanel } from './features/agents/AgentPanel';
import { BrowserPanel } from './features/browser/BrowserPanel';
import {
    DEFAULT_DIFF_VIEW_MODE,
    getNextDiffMode,
    type DiffMode,
} from './types/diffMode';

const App: React.FC = () => {
    const [diffEnabled, setDiffEnabled] = useState<boolean>(loadDiffEnabled());
    const [editorDiffModeByPane, setEditorDiffModeByPane] = useState<Record<string, DiffMode>>({});
    const layoutActionsRef = useRef<LayoutActions | null>(null);
    // const [followEnabled, setFollowEnabled] = useState<boolean>(loadFollowEnabled());
    const [permissionMode, setPermissionMode] = useState<AcpPermissionMode>(loadAcpPermissionMode());

    const { wsRef, isConnected } = useSocket({});

    const fileTree = useFileTree();
    const editors = useEditors({
        wsRef,
        isConnected,
        diffEnabled,
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
            ['changes:update', git.handleGitStatusUpdate],
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
            git.fetchBranches();
        }
        wasConnectedRef.current = isConnected;
    }, [isConnected, openFolder, terminals.reconnectTerminals, agents.reconnectToAcpAgents, git.fetchGitStatus, git.fetchBranches]);

    useEffect(() => {
        return () => {
            editors.flushAllPendingChanges();
        };
    }, [editors.flushAllPendingChanges]);

    useEffect(() => {
        if (!editors.activeFileId) {
            return;
        }

        fileTree.setActiveNode(editors.activeFileId);
    }, [editors.activeFileId, fileTree.setActiveNode]);

    useEffect(() => {
        if (!editors.activeFileId) {
            return;
        }

        const node = fileTree.findNodeByPath(fileTree.fileTree, editors.activeFileId);
        if (!node || node.isSelected) {
            return;
        }

        fileTree.selectNode(node.id);
    }, [editors.activeFileId, fileTree.fileTree, fileTree.findNodeByPath, fileTree.selectNode]);

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

    const handleSearch = ({ pattern }: { id: string; pattern: string }) => {
        if (!isConnected) return;
        search.startSearch(pattern);
    };

    const resolveEditorPaneId = useCallback(() => {
        return layoutActionsRef.current?.ensureEditorPanel(editors.activeEditorPaneId);
    }, [editors]);

    const handleOpenFile = useCallback((path: string, line?: number, column?: number) => {
        const paneId = resolveEditorPaneId();
        if (!paneId) return;
        editors.openFile(path, line, column, paneId);
    }, [editors, resolveEditorPaneId]);

    const handleOpenFileDiff = useCallback((path: string, line?: number, column?: number) => {
        const paneId = resolveEditorPaneId();
        if (!paneId) return;
        const mode = editorDiffModeByPane[paneId] ?? (diffEnabled ? 'combine' : DEFAULT_DIFF_VIEW_MODE);
        editors.openFile(path, line, column, paneId, { originalContentMode: mode });
    }, [diffEnabled, editorDiffModeByPane, editors, resolveEditorPaneId]);

    const handleSelectFile = useCallback((fileId: string) => {
        const paneId = resolveEditorPaneId();
        if (!paneId) return;
        editors.setActiveFileId(fileId, paneId);
    }, [editors, resolveEditorPaneId]);

    const handleSearchResultClick = (filePath: string, match: SearchMatch) => {
        handleOpenFile(filePath, match.line, match.column);
    };

    const getEditorDiffMode = useCallback((panelKey: string): DiffMode => {
        return editorDiffModeByPane[panelKey] ?? (diffEnabled ? 'combine' : DEFAULT_DIFF_VIEW_MODE);
    }, [diffEnabled, editorDiffModeByPane]);

    const isEditorDiffEnabled = useCallback((panelKey: string) => {
        return getEditorDiffMode(panelKey) !== 'plain';
    }, [getEditorDiffMode]);

    const applyDiffModeToPaneEditor = useCallback((panelKey: string, mode: DiffMode) => {
        const fileId = editors.getActiveFileIdForPane(panelKey);
        if (!fileId) {
            return false;
        }

        const editor = editors.getEditorState(fileId);
        if (!editor) {
            return false;
        }

        editor.setDiffEnabled(mode !== 'plain');
        editor.setFocusedDiffMode(mode === 'diff', 3);
        return true;
    }, [editors]);

    const handleCycleEditorDiffMode = useCallback((panelKey: string) => {
        const currentMode = getEditorDiffMode(panelKey);
        const nextMode = getNextDiffMode(currentMode);

        if (!applyDiffModeToPaneEditor(panelKey, nextMode)) {
            return;
        }

        setEditorDiffModeByPane((prev) => ({ ...prev, [panelKey]: nextMode }));

        if (panelKey === editors.activeEditorPaneId) {
            setDiffEnabled(nextMode !== 'plain');
        }
    }, [applyDiffModeToPaneEditor, editors.activeEditorPaneId, getEditorDiffMode]);

    useEffect(() => {
        const paneId = editors.activeEditorPaneId;
        if (!paneId) {
            return;
        }
        const mode = getEditorDiffMode(paneId);
        applyDiffModeToPaneEditor(paneId, mode);
    }, [applyDiffModeToPaneEditor, editors.activeEditorPaneId, editors.activeFileId, getEditorDiffMode]);

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

    const layout = useLayout({
        activeEditorPaneId: editors.activeEditorPaneId,
        activeTerminalPaneId: terminalPanes.activePaneId,
        activeAgentPaneId: agentPanes.activePaneId,
        onFocusEditorPane: editors.focusEditorInPane,
        onActivateTerminalPane: terminalPanes.setActivePaneId,
        onActivateAgentPane: agentPanes.setActivePaneId,
    });

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const activePaneId = editors.activeEditorPaneId;
            if (activePaneId && editors.handleReferencesPeekKeyDown(activePaneId, e)) {
                return;
            }

            if (e.metaKey && e.key === 'f') {
                e.preventDefault();
            }

            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
                e.preventDefault();
                const selectedText = editors.getActiveEditorSelectedText().trim();
                layoutActionsRef.current?.ensurePanel('search');
                if (selectedText) {
                    search.setSearchInput(selectedText);
                    search.startSearch(selectedText);
                }
                layout.requestPanelFocus('search');
                return;
            }

            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                if (editors.activeFileId) {
                    editors.saveFile(editors.activeFileId);
                }
            }

            if (layout.handleCtrlFocusShortcut(e)) {
                return;
            }

            if (e.ctrlKey && e.key === '-') {
                e.preventDefault();
                editors.undoCursor();
            } else if (e.ctrlKey && e.key === '_') {
                e.preventDefault();
                editors.redoCursor();
            }
        };

        document.addEventListener('keydown', handleKeyDown, true);
        return () => {
            document.removeEventListener('keydown', handleKeyDown, true);
        };
    }, [
        editors.activeEditorPaneId,
        editors.activeFileId,
        editors.handleReferencesPeekKeyDown,
        editors.getActiveEditorSelectedText,
        editors.redoCursor,
        editors.saveFile,
        editors.undoCursor,
        layout,
        search,
    ]);

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
                        activeNodeId={fileTree.activeNodeId}
                        focusRequestToken={layout.getFocusRequestToken('files')}
                        onActivateNode={fileTree.setActiveNode}
                        onToggle={fileTree.toggleNode}
                        onSelect={fileTree.selectNode}
                        onOpenFile={handleOpenFile}
                        onLoadFolder={openFolder}
                        onFocusEditor={() => editors.focusEditorInPane(editors.activeEditorPaneId)}
                        onNavigateByKey={fileTree.navigateByKey}
                    />
                );
            case 'search':
                return (
                    <Search
                        id="search"
                        focusRequestToken={layout.getFocusRequestToken('search')}
                        inputValue={search.searchInput}
                        onInputValueChange={search.setSearchInput}
                        onEnter={handleSearch}
                        onInputChange={search.cancelSearch}
                        onCancel={search.cancelSearch}
                        onClear={search.clearResults}
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
                        branches={git.branches}
                        isSwitchingBranch={git.isSwitchingBranch}
                        onFileClick={handleOpenFileDiff}
                        onRefresh={git.fetchGitStatus}
                        onBranchChange={git.checkoutBranch}
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
                        focusRequestToken={layout.getFocusRequestToken('terminal', panelKey)}
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
                        focusRequestToken={layout.getFocusRequestToken('agent', panelKey)}
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
                        onOpenFile={handleOpenFile}
                        onOpenFileDiff={handleOpenFileDiff}
                    />
                );
            case 'browser':
                return <BrowserPanel panelKey={panelKey} />;
            case 'toolbar':
                return (
                    <Toolbar
                        files={editors.files}
                        activeFileId={editors.activeFileId}
                        terminals={terminals.terminals}
                        activeTerminalIndex={terminalPanes.getSelectedIndex(terminalPanes.activePaneId || 'terminal')}
                        agentSessions={sessionsArray}
                        activeAgentId={agentPanes.getSelectedId(agentPanes.activePaneId || 'agent')}
                        onSelectFile={handleSelectFile}
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
        layout.handlePanelAdded(panelId, panelKey);

        if (panelId === 'changes') {
            git.fetchGitStatus();
            git.fetchBranches();
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
    }, [agentPanes, editors, git.fetchGitStatus, git.fetchBranches, layout, terminalPanes]);

    const handlePanelRemoved = useCallback((panelId: PanelId, panelKey: string) => {
        layout.handlePanelRemoved(panelId, panelKey);

        if (panelId === 'editor') {
            editors.unregisterEditorPane(panelKey);
            setEditorDiffModeByPane((prev) => {
                if (!Object.hasOwn(prev, panelKey)) {
                    return prev;
                }
                const next = { ...prev };
                delete next[panelKey];
                return next;
            });
            return;
        }
        if (panelId === 'agent') {
            agentPanes.unregisterPane(panelKey);
            return;
        }
        if (panelId === 'terminal') {
            terminalPanes.unregisterPane(panelKey);
        }
    }, [agentPanes, editors, layout, terminalPanes]);

    const handlePanelActivated = useCallback((panelId: PanelId, panelKey: string) => {
        layout.handlePanelActivated(panelId, panelKey);

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
    }, [agentPanes, editors, layout, terminalPanes]);

    return (
        <div className="app-container toolbar-header-compact">
            <div className="main-content" style={{ flex: 1, display: 'flex' }}>
                <Layout
                    renderPanel={renderPanel}
                    onPanelAdded={handlePanelAdded}
                    onPanelRemoved={handlePanelRemoved}
                    onPanelActivated={handlePanelActivated}
                    onCycleEditorDiffMode={handleCycleEditorDiffMode}
                    isEditorDiffEnabled={isEditorDiffEnabled}
                    getEditorDiffMode={getEditorDiffMode}
                    onActionsReady={(actions) => {
                        layoutActionsRef.current = actions;
                    }}
                />
            </div>
        </div>
    );
};

export default App;

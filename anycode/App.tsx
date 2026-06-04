import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import 'dockview/dist/styles/dockview.css';
import { ChangesPanel, type ChangedFile, SettingsPanel } from './components';
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
import { useTheme } from './hooks/useTheme';
import { useEvent } from './hooks/useEvent';
import { useTerminalPanes } from './features/terminal/useTerminalPanes';
import { useAgentPanes } from './features/agents/useAgentPanes';
import { FilesPanel } from './features/files/FilesPanel';
import { EditorPanel } from './features/editor/EditorPanel';
import { TerminalPanel } from './features/terminal/TerminalPanel';
import { AgentPanel } from './features/agents/AgentPanel';
import { BrowserPanel } from './features/browser/BrowserPanel';
import { type DiffMode } from './types/diffMode';
import { normalizePath } from './utils';

const App: React.FC = () => {
    const { wsRef, isConnected } = useSocket({});

    const fileTree = useFileTree({ wsRef, isConnected });
    const editors = useEditors({ wsRef, isConnected });
    const terminals = useTerminals({ wsRef, isConnected });
    const terminalPanes = useTerminalPanes({
        terminals: terminals.terminals,
        addTerminal: terminals.addTerminal,
        closeTerminal: terminals.closeTerminal,
    });
    const git = useGit({ wsRef, isConnected });
    const search = useSearch({ wsRef, isConnected });
    const wasConnectedRef = useRef<boolean>(false);
    const agents = useAgents({ wsRef, isConnected });
    const { currentThemeId, handleThemeChange } = useTheme({ wsRef, isConnected });
    const layoutActionsRef = useRef<LayoutActions | null>(null);

    useEffect(() => {
        const ws = wsRef.current;
        if (!ws || !isConnected) return;

        const events = [
            ['lsp:diagnostics', editors.handleDiagnostics],
            ['watcher:edits', editors.handleWatcherEdits],
            ['watcher:create', fileTree.handleWatcherCreate],
            ['watcher:remove', fileTree.handleWatcherRemove],
            ['git:update', git.handleGitStatusUpdate],
            ['git:update', editors.handleGitUpdate],
            ['acp:message', agents.handleAcpMessage],
            ['acp:history', agents.handleAcpHistory],
            ['search:results', search.handleSearchResults],
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
        editors.handleGitUpdate,
        fileTree.handleWatcherCreate,
        fileTree.handleWatcherRemove,
        git.handleGitStatusUpdate,
        agents.handleAcpMessage,
        agents.handleAcpHistory,
        search.handleSearchResults,
        search.handleSearchEnd,
    ]);

    useEffect(() => {
        if (isConnected && !wasConnectedRef.current) {
            fileTree.openFolder('.');
            terminals.reconnectTerminals();
            agents.reconnectToAcpAgents();
            git.fetchGitStatus();
            git.fetchBranches();
        }
        wasConnectedRef.current = isConnected;
    }, [isConnected, fileTree.openFolder, terminals.reconnectTerminals,
        agents.reconnectToAcpAgents, git.fetchGitStatus, git.fetchBranches]);

    useEffect(() => {
        return () => {
            editors.flushAllPendingChanges();
        };
    }, [editors.flushAllPendingChanges]);

    useEffect(() => {
        fileTree.setActiveNode(editors.activeFileId);
    }, [editors.activeFileId, fileTree.setActiveNode]);

    useEffect(() => {
        if (!editors.activeFileId) {
            fileTree.clearFileSelection();
            return;
        }

        const node = fileTree.findNodeByPath(fileTree.fileTree, editors.activeFileId);
        if (!node) {
            fileTree.clearFileSelection();
            return;
        }

        if (node.isSelected) {
            return;
        }

        fileTree.selectNode(node.id);
    }, [editors.activeFileId, fileTree.fileTree,
        fileTree.findNodeByPath, fileTree.selectNode, fileTree.clearFileSelection]);

    useEffect(() => {
        saveItem('terminals', terminals.terminals);
    }, [terminals.terminals]);

    const handleSearch = ({ pattern }: { id: string; pattern: string }) => {
        if (!isConnected) return;
        search.startSearch(pattern);
    };

    const resolveEditorPaneId = useEvent(() => {
        return layoutActionsRef.current?.ensureEditorPanel(editors.activeEditorPaneId);
    });

    const handleOpenFile = useEvent((
        path: string, line?: number, column?: number, mode?: DiffMode,
    ) => {
        const paneId = resolveEditorPaneId();
        if (!paneId) return;
        editors.openFile(path, line, column, paneId, mode);
    });

    const handleSelectFile = useEvent((fileId: string) => {
        const paneId = resolveEditorPaneId();
        if (!paneId) return;
        editors.setActiveFileId(fileId, paneId);
    });

    const handleSearchResultClick = (filePath: string, match: SearchMatch) => {
        handleOpenFile(filePath, match.line, match.column);
    };

    const handleOpenFileDiff = useEvent((
        path: string, line?: number, column?: number,
    ) => {
        const paneId = editors.activeEditorPaneId;
        const mode = editors.getEditorDiffMode(paneId);
        handleOpenFile(path, line, column, mode);
    });

    const activeChangedFile = useMemo<ChangedFile | null>(() => {
        if (!editors.activeFileId) {
            return null;
        }
        const normalizedActivePath = normalizePath(editors.activeFileId).replace(/^\.\/+/, '');
        return git.changedFiles.find((file) => normalizePath(file.path).replace(/^\.\/+/, '') === normalizedActivePath) ?? null;
    }, [editors.activeFileId, git.changedFiles]);

    const isEditorDiffEnabled = useCallback((panelKey: string) => {
        return editors.getEditorDiffMode(panelKey) !== 'plain';
    }, [editors]);

    const handleCycleEditorDiffMode = useCallback((panelKey: string) => {
        const changed = editors.cycleEditorDiffMode(panelKey);
        if (changed) {
            editors.focusEditorInPane(panelKey);
        }
    }, [editors]);

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

    const handleGlobalKeyDown = useEvent((e: KeyboardEvent) => {
            const target = e.target;
            if (target instanceof Element) {
                const isFilesTreeFocused = target.closest('.file-tree') !== null;
                if (isFilesTreeFocused) {
                    return;
                }
            }
    
            const activePaneId = editors.activeEditorPaneId;
            if (activePaneId && editors.handleReferencesPeekKeyDown(activePaneId, e)) {
                return;
            }
    
            if (e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
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
    });

    useEffect(() => {
        document.addEventListener('keydown', handleGlobalKeyDown, true);
        return () => {
            document.removeEventListener('keydown', handleGlobalKeyDown, true);
        };
    }, [handleGlobalKeyDown]);

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

    const handleSaveAgents = useCallback((agentList: AcpAgent[], defaultAgentId: string | null) => {
        updateAgents(agentList, defaultAgentId);
        agents.setAgentsVersion((prev) => prev + 1);
    }, [agents.setAgentsVersion]);

    const activeTerminalId = useMemo(() => {
        const paneId = terminalPanes.activePaneId || 'terminal';
        return terminalPanes.getSelectedId(paneId);
    }, [terminalPanes]);

    const handleTerminalTabSelect = useCallback((terminalId: string) => {
        terminalPanes.selectTab(terminalId);
    }, [terminalPanes]);

    const handleTerminalTabClose = useCallback((terminalId: string) => {
        terminalPanes.closeTab(terminalId);
    }, [terminalPanes]);

    const activeToolbarAgentId = (
        agentPanes.getSelectedId(agentPanes.activePaneId || 'agent')
        ?? agents.selectedAgentId
    );

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
                        onLoadFolder={fileTree.openFolder}
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
                        active={activeChangedFile}
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
                        onStage={git.stage}
                        onUnstage={git.unstage}
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
                        activeTerminalId={activeTerminalId}
                        agentSessions={sessionsArray}
                        activeAgentId={activeToolbarAgentId}
                        onSelectFile={handleSelectFile}
                        onCloseFile={editors.closeFile}
                        onSelectTerminal={handleTerminalTabSelect}
                        onCloseTerminal={handleTerminalTabClose}
                        onSelectAgent={agentPanes.selectFromToolbar}
                        onCloseAgent={agents.closeAgent}
                    />
                );
            case 'settings':
                return (
                    <SettingsPanel
                        wsRef={wsRef}
                        isConnected={isConnected}
                        currentThemeId={currentThemeId}
                        onThemeChange={handleThemeChange}
                    />
                );
            default:
                return null;
        }
    };

    const handlePanelAdded = useEvent((panelId: PanelId, panelKey: string) => {
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
    });

    const handlePanelRemoved = useEvent((panelId: PanelId, panelKey: string) => {
        layout.handlePanelRemoved(panelId, panelKey);

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
    });

    const handlePanelActivated = useEvent((panelId: PanelId, panelKey: string) => {
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
    });

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
                    getEditorDiffMode={editors.getEditorDiffMode}
                    onActionsReady={(actions) => {
                        layoutActionsRef.current = actions;
                    }}
                />
            </div>
        </div>
    );
};

export default App;

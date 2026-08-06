import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import 'dockview-react/dist/styles/dockview.css';
import { ChangesPanel, HistoryPanel, type ChangedFile, SettingsPanel } from './components';
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
import { useGit, type GitHistoryFile } from './hooks/useGit';
import { useSearch } from './hooks/useSearch';
import { useFileTree } from './hooks/useFileTree';
import { useTerminals } from './hooks/useTerminals';
import { getHistoricalFileId, useEditors } from './hooks/useEditors';
import { useAgents } from './hooks/useAgents';
import { useLayout } from './hooks/useLayout';
import { useTheme } from './hooks/useTheme';
import { useEvent } from './hooks/useEvent';
import { useTerminalPanes } from './features/terminal/useTerminalPanes';
import { useAgentPanes } from './features/agents/useAgentPanes';
import { FilesPanel } from './features/files/FilesPanel';
import { EditorPanel } from './features/editor/EditorPanel';
import type { MultibufferFile } from './features/editor/MultibufferPanel';
import { TerminalPanel } from './features/terminal/TerminalPanel';
import { AgentPanel } from './features/agents/AgentPanel';
import { BrowserPanel } from './features/browser/BrowserPanel';
import { type DiffMode } from './types/diffMode';
import { normalizePath } from './utils';
import { useSettings } from './hooks/useSettings';

const App: React.FC = () => {
    const { wsRef, isConnected, connectionStatus, connectToBackend } = useSocket({});
    const [showConnectionBanner, setShowConnectionBanner] = React.useState(false);
    const settings = useSettings();

    const [fileIconsStyle, setFileIconsStyle] = React.useState<'colored' | 'monochrome' | 'disabled'>(() => {
        if (typeof window === 'undefined') return 'colored';
        return (localStorage.getItem('fileIconsStyle') as any) || 'colored';
    });

    const [fileIconsOpacity, setFileIconsOpacity] = React.useState<number>(() => {
        if (typeof window === 'undefined') return 0.85;
        const saved = localStorage.getItem('fileIconsOpacity');
        return saved !== null ? parseFloat(saved) : 0.85;
    });

    const fileTree = useFileTree({ wsRef, isConnected });
    const editors = useEditors({ wsRef, isConnected });
    const terminals = useTerminals({ wsRef, isConnected });
    const  terminalPanes = useTerminalPanes({
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
    const [multibufferPaneId, setMultibufferPaneId] = React.useState<string | null>(null);
    const [multibufferFiles, setMultibufferFiles] = React.useState<MultibufferFile[]>([]);
    const [multibufferTitle, setMultibufferTitle] = React.useState('Review changes');

    useEffect(() => {
        if (connectionStatus === 'connected') {
            setShowConnectionBanner(false);
            return;
        }

        const timeout = window.setTimeout(() => {
            setShowConnectionBanner(true);
        }, 750);

        return () => window.clearTimeout(timeout);
    }, [connectionStatus]);

    const handleWatcherRemove = useEvent((data: { path: string; isFile: boolean }) => {
        fileTree.handleWatcherRemove(data);
        if (data.isFile) editors.closeFile(data.path);
        else editors.closeFilesUnderPath(data.path);
    });

    const handleFileRenamed = useEvent((data: { old: string; new: string }) => {
        fileTree.handleFileRenamed(data);
        editors.renameFilesUnderPath(data.old, data.new);
    });

    useEffect(() => {
        const ws = wsRef.current;
        if (!ws || !isConnected) return;

        const events = [
            ['lsp:diagnostics', editors.handleDiagnostics],
            ['watcher:edits', editors.handleWatcherEdits],
            ['watcher:create', fileTree.handleWatcherCreate],
            ['watcher:remove', handleWatcherRemove],
            ['file:renamed', handleFileRenamed],
            ['git:update', git.handleGitStatusUpdate],
            ['git:history-search:results', git.handleHistorySearchResults],
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
        handleWatcherRemove,
        handleFileRenamed,
        git.handleGitStatusUpdate,
        git.handleHistorySearchResults,
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
        const keepPreviousEditor = layoutActionsRef.current
            ?.isEditorPanelVisible(editors.activeEditorPaneId) ?? false;
        const paneId = resolveEditorPaneId();
        if (!paneId) return;
        editors.openFile(path, line, column, paneId, mode, keepPreviousEditor);
    });

    const handleOpenMultibuffer = useEvent(() => {
        if (git.changedFiles.length === 0) return;

        const paneId = layoutActionsRef.current?.ensureEditorPanel(editors.activeEditorPaneId);
        if (!paneId) return;

        editors.setActiveEditorPaneId(paneId);
        setMultibufferFiles(git.changedFiles.map((file) => ({
            id: file.path,
            path: file.path,
            added: file.added,
            removed: file.removed,
            status: file.status,
        })));
        setMultibufferTitle('Review changes');
        setMultibufferPaneId(paneId);
        for (const file of git.changedFiles) {
            if (file.status !== 'deleted') {
                editors.openFile(file.path, undefined, undefined, paneId, 'diff', true);
            }
        }
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

    const handleOpenHistoryDiff = useEvent(async (hash: string, file: GitHistoryFile) => {
        const content = await git.fetchHistoryFileContent(hash, file);
        if (!content) return;
        if (content.old_binary || content.new_binary || content.old_content === null || content.new_content === null) {
            window.alert(`Cannot display a text diff for binary file "${file.path}".`);
            return;
        }
        editors.openHistoricalDiff(
            hash,
            file.path,
            content.old_content,
            content.new_content,
            editors.activeEditorPaneId,
        );
    });

    const handleOpenHistoryMultibuffer = useEvent(async (hash: string, files: GitHistoryFile[]) => {
        const paneId = layoutActionsRef.current?.ensureEditorPanel(editors.activeEditorPaneId);
        if (!paneId || files.length === 0) return;

        const contents = await Promise.all(files.map(async (file) => {
            if (file.binary) return null;
            const content = await git.fetchHistoryFileContent(hash, file);
            if (!content || content.old_binary || content.new_binary) return null;
            return { file, content };
        }));
        const textFiles = contents.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
        if (textFiles.length === 0) {
            window.alert('This commit has no text diffs to review.');
            return;
        }

        editors.setActiveEditorPaneId(paneId);
        for (const { file, content } of textFiles) {
            editors.openHistoricalDiff(
                hash,
                file.path,
                content.old_content ?? '',
                content.new_content ?? '',
                paneId,
            );
        }
        setMultibufferFiles(textFiles.map(({ file }) => ({
            id: getHistoricalFileId(hash, file.path),
            path: file.path,
            added: file.added,
            removed: file.removed,
            status: file.status,
        })));
        setMultibufferTitle(`Review ${hash.slice(0, 7)}`);
        setMultibufferPaneId(paneId);
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

    const handleFileIconsStyleChange = useCallback((style: 'colored' | 'monochrome' | 'disabled') => {
        localStorage.setItem('fileIconsStyle', style);
        setFileIconsStyle(style);
    }, []);

    const handleFileIconsOpacityChange = useCallback((opacity: number) => {
        localStorage.setItem('fileIconsOpacity', opacity.toString());
        setFileIconsOpacity(opacity);
    }, []);

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
                        fileIconsStyle={fileIconsStyle}
                        onDeleteNode={fileTree.deleteNode}
                        onRenameNode={fileTree.renameNodeOnDisk}
                        onCreateNode={fileTree.createNodeOnDisk}
                    />
                );
            case 'search':
                return (
                    <Search
                        id="search"
                        wsRef={wsRef}
                        isConnected={isConnected}
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
                        onFileClick={handleOpenFile}
                        fileIconsStyle={fileIconsStyle}
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
                        onOpenMultibuffer={handleOpenMultibuffer}
                        fileIconsStyle={fileIconsStyle}
                    />
                );
            case 'history':
                return (
                    <HistoryPanel
                        branch={git.gitBranch}
                        commits={git.historyCommits}
                        filesByCommit={git.historyFiles}
                        hasMore={git.historyHasMore}
                        loading={git.isHistoryLoading}
                        loaded={git.isHistoryLoaded}
                        filesLoading={git.historyFilesLoading}
                        historyPath={git.historyPath}
                        activeFilePath={editors.activeFile?.source?.type === 'filesystem' ? editors.activeFile.source.path : null}
                        onRefresh={git.refreshHistory}
                        onLoadMore={git.loadMoreHistory}
                        onSearch={git.searchHistory}
                        onClearSearch={git.clearHistorySearch}
                        onCancelSearch={git.cancelHistorySearch}
                        onCommitExpand={git.fetchHistoryFiles}
                        onFileClick={handleOpenHistoryDiff}
                        onReviewCommit={handleOpenHistoryMultibuffer}
                        onShowRepository={git.showRepositoryHistory}
                        onShowFile={git.showFileHistory}
                        fileIconsStyle={fileIconsStyle}
                    />
                );
            case 'editor':
                return (
                    <EditorPanel
                        panelKey={panelKey}
                        editors={editors}
                        multibufferOpen={multibufferPaneId === panelKey}
                        multibufferFiles={multibufferFiles}
                        multibufferTitle={multibufferTitle}
                        onCloseMultibuffer={() => setMultibufferPaneId(null)}
                    />
                );
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
                        onUploadFile={terminals.uploadFile}
                        fontConfig={settings.fontSettings.terminal}
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
                        fileIconsStyle={fileIconsStyle}
                        showConnectionStatus={showConnectionBanner}
                        connectionStatus={connectionStatus}
                        onReconnect={connectToBackend}
                    />
                );
            case 'settings':
                return (
                    <SettingsPanel
                        wsRef={wsRef}
                        isConnected={isConnected}
                        currentThemeId={currentThemeId}
                        onThemeChange={handleThemeChange}
                        fileIconsStyle={fileIconsStyle}
                        onFileIconsStyleChange={handleFileIconsStyleChange}
                        fileIconsOpacity={fileIconsOpacity}
                        onFileIconsOpacityChange={handleFileIconsOpacityChange}
                        fontSettings={settings.fontSettings}
                        onFontSettingsChange={settings.updateFontSettings}
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
        if (panelId === 'history') {
            git.fetchGitStatus();
            git.fetchHistory(true);
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

    const canResetPanel = useCallback((panelKey: string, panelId: PanelId) => {
        if (panelId === 'terminal') {
            return terminalPanes.getSelectedId(panelKey) !== null;
        }
        if (panelId === 'agent') {
            return agentPanes.getSelectedId(panelKey) !== null;
        }
        return false;
    }, [terminalPanes, agentPanes]);

    const handleResetPanel = useCallback((panelKey: string, panelId: PanelId) => {
        if (panelId === 'terminal') {
            terminalPanes.setSelectedForPane(panelKey, null);
        } else if (panelId === 'agent') {
            agentPanes.selectForPane(panelKey, null);
        }
    }, [terminalPanes, agentPanes]);

    return (
        <div
            className="app-container toolbar-header-compact"
            style={{ '--file-icon-opacity': fileIconsOpacity } as React.CSSProperties}
        >
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
                    canResetPanel={canResetPanel}
                    onResetPanel={handleResetPanel}
                />
            </div>
        </div>
    );
};

export default App;

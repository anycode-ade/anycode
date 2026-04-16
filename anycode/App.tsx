import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnycodeEditorReact } from 'anycode-react';
import 'dockview/dist/styles/dockview.css';
import {
    TreeNodeComponent,
    TerminalComponent,
    TerminalTabs,
    AcpDialog,
    ChangesPanel,
} from './components';
import Search from './components/Search';
import { Icons } from './components/Icons';
import { Split, Layout, type PanelId } from './components/layout/Layout';
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
    loadBottomVisible,
    loadCenterPaneVisible,
    loadDiffEnabled,
    // loadFollowEnabled,
    loadLeftPanelVisible,
    loadRightPanelVisible,
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
    const [leftPanelVisible, setLeftPanelVisible] = useState<boolean>(loadItem<boolean>('filesPanelVisible') ?? loadLeftPanelVisible());
    const [searchPanelVisible, setSearchPanelVisible] = useState<boolean>(loadItem<boolean>('searchPanelVisible') ?? false);
    const [changesPanelVisible, setChangesPanelVisible] = useState<boolean>(loadItem<boolean>('changesPanelVisible') ?? false);
    const [bottomPanelVisible, setBottomPanelVisible] = useState<boolean>(loadBottomVisible());
    const [rightPanelVisible, setRightPanelVisible] = useState<boolean>(loadRightPanelVisible());
    const [centerPanelVisible, setCenterPanelVisible] = useState<boolean>(loadCenterPaneVisible());
    const [toolbarHeaderVisible, setToolbarHeaderVisible] = useState<boolean>(loadItem<boolean>('toolbarHeaderVisible') ?? false);

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

    const terminals = useTerminals({ wsRef, isConnected, bottomPanelVisible });
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
            setRightPanelVisible(true);
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
        saveItem('bottomPanelVisible', bottomPanelVisible);
    }, [bottomPanelVisible]);

    useEffect(() => {
        saveItem('leftPanelVisible', leftPanelVisible);
        saveItem('filesPanelVisible', leftPanelVisible);
    }, [leftPanelVisible]);

    useEffect(() => {
        saveItem('searchPanelVisible', searchPanelVisible);
    }, [searchPanelVisible]);

    useEffect(() => {
        saveItem('changesPanelVisible', changesPanelVisible);
    }, [changesPanelVisible]);

    useEffect(() => {
        saveItem('rightPanelVisible', rightPanelVisible);
    }, [rightPanelVisible]);

    useEffect(() => {
        saveItem('centerPanelVisible', centerPanelVisible);
    }, [centerPanelVisible]);

    useEffect(() => {
        saveItem('toolbarHeaderVisible', toolbarHeaderVisible);
    }, [toolbarHeaderVisible]);

    useEffect(() => {
        saveItem('terminalSelected', terminals.terminalSelected);
    }, [terminals.terminalSelected]);

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

            if (e.ctrlKey && e.key === '1') setLeftPanelVisible((prev) => !prev);
            if (e.ctrlKey && e.key === '2') setBottomPanelVisible((prev) => !prev);
            if (e.ctrlKey && e.key === '3') setCenterPanelVisible((prev) => !prev);
            if (e.ctrlKey && e.key === '4') setRightPanelVisible((prev) => !prev);

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

    const toggleDiffMode = useCallback(() => {
        const newDiffEnabled = !diffEnabled;
        setDiffEnabled(newDiffEnabled);
        editors.setDiffForAllEditors(newDiffEnabled);
    }, [diffEnabled, editors]);

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
                        key={panelKey}
                        id={paneFile.id}
                        editorState={editorState}
                    />
                ) : (
                    <div className="no-editor"></div>
                )}
            </div>
        );
    }, [editors]);

    const acpPanel = (
        <AcpDialog
            key={`acp-${agents.agentsVersion}`}
            agents={sessionsArray}
            availableAgents={availableAgents}
            selectedAgentId={agents.selectedAgentId}
            onSelectAgent={agents.setSelectedAgentId}
            onCloseAgent={agents.closeAgent}
            onAddAgent={handleAddAgent}
            onStartAgent={handleStartSpecificAgent}
            onOpenSettings={handleOpenAgentSettings}
            isOpen={true}
            onSendPrompt={agents.sendPrompt}
            onCancelPrompt={agents.cancelPrompt}
            onUndoPrompt={agents.undoPrompt}
            isConnected={isConnected}
            onSelectModel={agents.setSessionModel}
            onSelectReasoning={agents.setSessionReasoning}
            showSettings={agents.isAgentSettingsOpen}
            settingsAgents={settingsAgents}
            settingsDefaultAgentId={settingsDefaultAgentId}
            settingsPermissionMode={permissionMode}
            onSaveSettings={handleSaveAgents}
            onCloseSettings={handleCloseAgentSettings}
            onLoadSettingsSessions={agents.fetchAvailableSessions}
            onResumeSettingsSession={handleResumeSettingsSession}
            diffEnabled={diffEnabled}
            onToggleDiff={toggleDiffMode}
            // followEnabled={followEnabled}
            // onToggleFollow={toggleFollowMode}
            onPermissionResponse={agents.sendPermissionResponse}
            onOpenFile={editors.openFile}
            onOpenFileDiff={editors.openFileDiff}
        />
    );

    const terminalTabsPanel = (
        <TerminalTabs
            terminals={terminals.terminals}
            terminalSelected={terminals.terminalSelected}
            onSelectTerminal={terminals.setTerminalSelected}
            onCloseTerminal={terminals.closeTerminal}
            onAddTerminal={terminals.addTerminal}
        />
    );

    const terminalContentPanel = (
        <div className="terminal-content">
            {terminals.terminals.map((term, index) => (
                <div
                    key={term.id}
                    className="terminal-container"
                    style={{
                        visibility: index === terminals.terminalSelected ? 'visible' : 'hidden',
                        opacity: index === terminals.terminalSelected ? 1 : 0,
                        pointerEvents: index === terminals.terminalSelected ? 'auto' : 'none',
                        height: '100%',
                        position: index === terminals.terminalSelected ? 'relative' : 'absolute',
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
    );

    const terminalPanel = (
        <div className="terminal-panel">
            <Split
                direction="row"
                className="app-layout-split"
                panes={[
                    {
                        id: 'terminal-tabs',
                        content: terminalTabsPanel,
                        size: 180,
                    },
                    {
                        id: 'terminal-content',
                        content: terminalContentPanel,
                    },
                ]}
            />
        </div>
    );

    const toolbar = (
        <div className="toolbar">
            <div className="toolbar-buttons">
                <button
                    onClick={() => setLeftPanelVisible(!leftPanelVisible)}
                    className={`toggle-tree-btn ${leftPanelVisible ? 'active' : ''}`}
                    title={leftPanelVisible ? 'Hide Files Panel' : 'Show Files Panel'}
                >
                    {leftPanelVisible ? <Icons.LeftPanelOpened /> : <Icons.LeftPanelClosed />}
                </button>

                <button
                    onClick={() => setSearchPanelVisible(!searchPanelVisible)}
                    className={`toggle-mode-btn ${searchPanelVisible ? 'active' : ''}`}
                    title={searchPanelVisible ? 'Hide Search Panel' : 'Show Search Panel'}
                >
                    <Icons.Search />
                </button>

                <button
                    onClick={() => {
                        if (!changesPanelVisible) {
                            git.fetchGitStatus();
                        }
                        setChangesPanelVisible(!changesPanelVisible);
                    }}
                    className={`toggle-mode-btn ${changesPanelVisible ? 'active' : ''}`}
                    title={changesPanelVisible ? 'Hide Changes Panel' : 'Show Changes Panel'}
                >
                    <Icons.Git />
                </button>

                <button
                    onClick={() => setBottomPanelVisible(!bottomPanelVisible)}
                    className={`terminal-toggle-btn ${bottomPanelVisible ? 'active' : ''}`}
                    title={bottomPanelVisible ? 'Hide Terminal' : 'Show Terminal'}
                >
                    {bottomPanelVisible ? <Icons.BottomPanelOpened /> : <Icons.BottomPanelClosed />}
                </button>

                <button
                    onClick={() => setCenterPanelVisible(!centerPanelVisible)}
                    className={`editor-toggle-btn ${centerPanelVisible ? 'active' : ''}`}
                    title={centerPanelVisible ? 'Hide Editor' : 'Show Editor'}
                >
                    {centerPanelVisible ? <Icons.EditorOpened /> : <Icons.EditorClosed />}
                </button>

                <button
                    onClick={() => setRightPanelVisible(!rightPanelVisible)}
                    className={`acp-toggle-btn ${rightPanelVisible ? 'active' : ''}`}
                    title={rightPanelVisible ? 'Hide AI Agent' : 'Show AI Agent'}
                >
                    {rightPanelVisible ? <Icons.RightPanelOpened /> : <Icons.RightPanelClosed />}
                </button>

                <button
                    onClick={() => setToolbarHeaderVisible((prev) => !prev)}
                    className={`toggle-mode-btn ${toolbarHeaderVisible ? 'active' : ''}`}
                    title={toolbarHeaderVisible ? 'Hide Anycode Header' : 'Show Anycode Header'}
                >
                    <Icons.ChevronUpDown />
                </button>
            </div>

            <div className="toolbar-tabs">
                {editors.files.map((file) => (
                    <div
                        key={file.id}
                        className={`tab ${editors.activeFileId === file.id ? 'active' : ''}`}
                        onClick={() => editors.setActiveFileId(file.id)}
                    >
                        <span className="tab-filename"> {file.name} </span>
                        <button className="tab-close-button" onClick={(e) => { e.stopPropagation(); editors.closeFile(file.id); }}> × </button>
                    </div>
                ))}
            </div>
        </div>
    );

    const dockPanels = useMemo(() => ({
        files: fileTreePanel,
        search: searchPanel,
        changes: changesPanel,
        editor: <div className="editor-container" />,
        agent: acpPanel,
        terminal: terminalPanel,
        toolbar,
    }), [fileTreePanel, searchPanel, changesPanel, acpPanel, terminalPanel, toolbar]);

    const dockVisibility = useMemo(() => ({
        files: leftPanelVisible,
        search: searchPanelVisible,
        changes: changesPanelVisible,
        editor: centerPanelVisible,
        agent: rightPanelVisible,
        terminal: bottomPanelVisible,
        toolbar: true,
    }), [
        leftPanelVisible,
        searchPanelVisible,
        changesPanelVisible,
        centerPanelVisible,
        rightPanelVisible,
        bottomPanelVisible,
    ]);

    const handleDockPanelVisibilityChange = useCallback((id: PanelId, visible: boolean) => {
        if (id === 'files') setLeftPanelVisible(visible);
        if (id === 'search') setSearchPanelVisible(visible);
        if (id === 'changes') setChangesPanelVisible(visible);
        if (id === 'editor') setCenterPanelVisible(visible);
        if (id === 'agent') setRightPanelVisible(visible);
        if (id === 'terminal') setBottomPanelVisible(visible);
    }, []);

    return (
        <div className={`app-container ${toolbarHeaderVisible ? 'toolbar-header-visible' : 'toolbar-header-compact'}`}>
            <div className="main-content" style={{ flex: 1, display: 'flex' }}>
                <Layout
                    panels={dockPanels}
                    visibility={dockVisibility}
                    toolbarHeaderVisible={toolbarHeaderVisible}
                    onPanelVisibilityChange={handleDockPanelVisibilityChange}
                    panelContentOverrides={{ editor: renderEditorPanel }}
                    onPanelAdded={(panelId, panelKey) => {
                        if (panelId !== 'editor') return;
                        editors.registerEditorPane(panelKey);
                    }}
                    onPanelRemoved={(panelId, panelKey) => {
                        if (panelId !== 'editor') return;
                        editors.unregisterEditorPane(panelKey);
                    }}
                    onPanelActivated={(panelId, panelKey) => {
                        if (panelId !== 'editor') return;
                        editors.setActiveEditorPaneId(panelKey);
                    }}
                />
            </div>
        </div>
    );
};

export default App;

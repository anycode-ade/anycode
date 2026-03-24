import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnycodeEditorReact } from 'anycode-react';
import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import {
    TreeNodeComponent,
    TerminalComponent,
    TerminalTabs,
    AcpDialog,
    ChangesPanel,
} from './components';
import Search from './components/Search';
import { Icons } from './components/Icons';
import {
    getAllAgents,
    getDefaultAgent,
    getDefaultAgentId,
    ensureDefaultAgents,
    updateAgents,
} from './agents';
import { AcpAgent, type AcpMessage, type AcpToolCall, type SearchMatch } from './types';
import './App.css';
import {
    loadBottomVisible,
    loadCenterPaneVisible,
    loadDiffEnabled,
    loadFollowEnabled,
    loadLeftPanelVisible,
    loadRightPanelVisible,
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

const App: React.FC = () => {
    const [leftPanelVisible, setLeftPanelVisible] = useState<boolean>(loadLeftPanelVisible());
    const [bottomPanelVisible, setBottomPanelVisible] = useState<boolean>(loadBottomVisible());
    const [rightPanelVisible, setRightPanelVisible] = useState<boolean>(loadRightPanelVisible());
    const [centerPanelVisible, setCenterPanelVisible] = useState<boolean>(loadCenterPaneVisible());

    const [leftPanelMode, setLeftPanelMode] = useState<'files' | 'changes' | 'search'>('files');
    const [diffEnabled, setDiffEnabled] = useState<boolean>(loadDiffEnabled());
    const [followEnabled, setFollowEnabled] = useState<boolean>(loadFollowEnabled());
    const [permissionMode, setPermissionMode] = useState<AcpPermissionMode>(loadAcpPermissionMode());

    const { wsRef, isConnected } = useSocket({});

    const fileTree = useFileTree();
    const emptyToolCalls = useMemo<AcpToolCall[]>(() => [], []);
    const emptyMessages = useMemo<AcpMessage[]>(() => [], []);

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
        followEnabled,
        openFile: editors.openFile,
        openChangedFileWithDiff: editors.openChangedFileWithDiff,
        onAgentStarted: () => {
            setRightPanelVisible(true);
            setDiffEnabled(true);
            setFollowEnabled(true);
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
    }, [leftPanelVisible]);

    useEffect(() => {
        saveItem('rightPanelVisible', rightPanelVisible);
    }, [rightPanelVisible]);

    useEffect(() => {
        saveItem('centerPanelVisible', centerPanelVisible);
    }, [centerPanelVisible]);

    useEffect(() => {
        saveItem('terminalSelected', terminals.terminalSelected);
    }, [terminals.terminalSelected]);

    useEffect(() => {
        saveItem('diffEnabled', diffEnabled);
    }, [diffEnabled]);

    useEffect(() => {
        saveItem('followEnabled', followEnabled);
    }, [followEnabled]);

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

    const handleLeftPanelVisibleChange = (index: number, visible: boolean) => {
        if (index === 0) setLeftPanelVisible(visible);
    };

    const handleBottomPanelVisibleChange = (index: number, visible: boolean) => {
        if (index === 1) setBottomPanelVisible(visible);
    };

    const handleRightPanelVisibleChange = (index: number, visible: boolean) => {
        if (index === 0) setCenterPanelVisible(visible);
        if (index === 1) setRightPanelVisible(visible);
    };

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

    const toggleFollowMode = useCallback(() => {
        setFollowEnabled((prev) => !prev);
    }, []);

    const sessionsArray = useMemo(() => Array.from(agents.acpSessions.values()), [agents.acpSessions]);
    const currentSession = useMemo(
        () => (agents.selectedAgentId ? agents.acpSessions.get(agents.selectedAgentId) ?? null : null),
        [agents.acpSessions, agents.selectedAgentId],
    );
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
        agents.startAgent(defaultAgent);
    }, [agents.startAgent, defaultAgent]);
    const handleOpenAgentSettings = useCallback(() => {
        ensureDefaultAgents();
        agents.setIsAgentSettingsOpen(true);
    }, [agents.setIsAgentSettingsOpen]);
    const handleCloseAgentPanel = useCallback(() => {
        setRightPanelVisible(false);
    }, []);
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

    const leftPanelModeButtons = (() => {
        switch (leftPanelMode) {
            case 'files':
                return (
                    <>
                        <button onClick={() => setLeftPanelMode('search')} className="toggle-mode-btn" title="Search"><Icons.Search /></button>
                        <button onClick={() => { setLeftPanelMode('changes'); git.fetchGitStatus(); }} className="toggle-mode-btn" title="Changes"><Icons.Git /></button>
                    </>
                );
            case 'search':
                return (
                    <>
                        <button onClick={() => setLeftPanelMode('files')} className="toggle-mode-btn" title="Files"><Icons.Tree /></button>
                        <button onClick={() => { setLeftPanelMode('changes'); git.fetchGitStatus(); }} className="toggle-mode-btn" title="Changes"><Icons.Git /></button>
                    </>
                );
            case 'changes':
                return (
                    <>
                        <button onClick={() => setLeftPanelMode('search')} className="toggle-mode-btn" title="Search"><Icons.Search /></button>
                        <button onClick={() => setLeftPanelMode('files')} className="toggle-mode-btn" title="Files"><Icons.Tree /></button>
                    </>
                );
            default:
                return null;
        }
    })();

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

    const leftPanel = (() => {
        switch (leftPanelMode) {
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
                        onFileClick={editors.openChangedFileWithDiff}
                        onRefresh={git.fetchGitStatus}
                        onCommit={git.commit}
                        onPush={git.push}
                        onPull={git.pull}
                        onRevert={git.revert}
                    />
                );
            case 'files':
            default:
                return fileTreePanel;
        }
    })();

    const editorPanel = (
        <div className="editor-container">
            {editors.activeFile && editors.editorStates.has(editors.activeFile.id) ? (
                <AnycodeEditorReact
                    key={editors.activeFile.id}
                    id={editors.activeFile.id}
                    editorState={editors.editorStates.get(editors.activeFile.id)!}
                />
            ) : (
                <div className="no-editor"></div>
            )}
        </div>
    );

    const acpPanel = (
        <AcpDialog
            key={`acp-${agents.agentsVersion}`}
            agents={sessionsArray}
            selectedAgentId={agents.selectedAgentId}
            onSelectAgent={agents.setSelectedAgentId}
            onCloseAgent={agents.closeAgent}
            onAddAgent={handleAddAgent}
            onOpenSettings={handleOpenAgentSettings}
            agentId={currentSession?.agentId || defaultAgent?.id || 'gemini'}
            isOpen={true}
            onClose={handleCloseAgentPanel}
            onSendPrompt={agents.sendPrompt}
            onCancelPrompt={agents.cancelPrompt}
            onUndoPrompt={agents.undoPrompt}
            messages={currentSession?.messages || emptyMessages}
            toolCalls={emptyToolCalls}
            isConnected={currentSession ? (currentSession.isActive && isConnected) : false}
            isProcessing={currentSession?.isProcessing || false}
            modelSelector={currentSession?.modelSelector}
            reasoningSelector={currentSession?.reasoningSelector}
            contextUsage={currentSession?.contextUsage}
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
            followEnabled={followEnabled}
            onToggleFollow={toggleFollowMode}
            onPermissionResponse={agents.sendPermissionResponse}
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
            <Allotment vertical={false} separator={false} defaultSizes={[20, 80]}>
                <Allotment.Pane snap minSize={100}>
                    {terminalTabsPanel}
                </Allotment.Pane>
                <Allotment.Pane>
                    {terminalContentPanel}
                </Allotment.Pane>
            </Allotment>
        </div>
    );

    const toolbar = (
        <div className="toolbar">
            <div className="toolbar-buttons">
                <button
                    onClick={() => setLeftPanelVisible(!leftPanelVisible)}
                    className={`toggle-tree-btn ${leftPanelVisible ? 'active' : ''}`}
                    title={leftPanelVisible ? 'Hide File Tree' : 'Show File Tree'}
                >
                    {leftPanelVisible ? <Icons.LeftPanelOpened /> : <Icons.LeftPanelClosed />}
                </button>

                {leftPanelVisible && leftPanelModeButtons}

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

    return (
        <div className={`app-container ${bottomPanelVisible ? 'terminal-visible' : ''}`}>
            <div className="main-content" style={{ flex: 1, display: 'flex' }}>
                <Allotment vertical={true} defaultSizes={[70, 30]} separator={true} onVisibleChange={handleBottomPanelVisibleChange}>
                    <Allotment.Pane>
                        <Allotment vertical={false} defaultSizes={[20, 80]} separator={false} onVisibleChange={handleLeftPanelVisibleChange}>
                            <Allotment.Pane snap visible={leftPanelVisible}>
                                {leftPanel}
                            </Allotment.Pane>
                            <Allotment.Pane snap>
                                <Allotment vertical={false} defaultSizes={[60, 40]} separator={false} onVisibleChange={handleRightPanelVisibleChange}>
                                    <Allotment.Pane snap visible={centerPanelVisible}>
                                        {editorPanel}
                                    </Allotment.Pane>
                                    <Allotment.Pane snap visible={rightPanelVisible} minSize={100}>
                                        {acpPanel}
                                    </Allotment.Pane>
                                </Allotment>
                            </Allotment.Pane>
                        </Allotment>
                    </Allotment.Pane>
                    <Allotment.Pane snap visible={bottomPanelVisible}>
                        {terminalPanel}
                    </Allotment.Pane>
                </Allotment>
            </div>

            {toolbar}
        </div>
    );
};

export default App;

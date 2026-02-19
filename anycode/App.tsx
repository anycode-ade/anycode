import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { AnycodeEditorReact, AnycodeEditor } from 'anycode-react';
import type { Change, Position, Edit } from '../anycode-base/src/code';
import { WatcherCreate, WatcherEdits, WatcherRemove,
    type CursorHistory, type Terminal, type AcpSession,
    type AcpMessage, type AcpPromptStateMessage, type AcpToolCallMessage, type AcpToolResultMessage,
    type AcpOpenFileMessage, type SearchResult, type SearchEnd, type SearchMatch,
    type PendingBatch
} from './types';
import { loadTerminals, loadTerminalSelected, loadBottomVisible, 
    loadLeftPanelVisible, loadRightPanelVisible, loadCenterPaneVisible,
    loadDiffEnabled, loadFollowEnabled,
    loadItem, saveItem,
} from './storage';
import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import { TreeNodeComponent, TreeNode, FileState, TerminalComponent, 
    TerminalTabs, AcpDialog, ChangesPanel, ChangedFile
} from './components';
import Search from './components/Search';
import { Icons } from './components/Icons';
import { getAllAgents, getDefaultAgent, updateAgents, getDefaultAgentId,
    ensureDefaultAgents 
} from './agents';
import { AcpAgent } from './types';
import { DEFAULT_FILE, DEFAULT_FILE_CONTENT, BACKEND_URL, BATCH_DELAY_MS } from './constants';
import './App.css';
import { 
    Completion, CompletionRequest, Diagnostic, DiagnosticResponse, 
    DefinitionRequest, DefinitionResponse 
} from '../anycode-base/src/lsp';
import { normalizePath, getFileName, getParentPath, joinPath,
    getLanguageFromFileName 
} from './utils';

const App: React.FC = () => {
    console.log('App rendered');
    
    const [files, setFiles] = useState<FileState[]>([]);
    const filesRef = useRef<FileState[]>([]);
    const savedFileContentsRef = useRef<Map<string, string>>(new Map());
    const [activeFileId, setActiveFileId] = useState<string | null>(null);
    const [editorStates, setEditorStates] = useState<Map<string, AnycodeEditor>>(new Map());
    const editorRefs = useRef<Map<string, AnycodeEditor>>(new Map());
    const diagnosticsRef = useRef<Map<string, Diagnostic[]>>(new Map());
    const pendingPositions = useRef<Map<string, { line: number; column: number }>>(new Map());
    const cursorHistory = useRef<CursorHistory>({ undoStack: [], redoStack: [] });
    const activeFile = files.find(f => f.id === activeFileId);
    
    const [fileTree, setFileTree] = useState<TreeNode[]>([]);
    const [isConnected, setIsConnected] = useState<boolean>(true);
    const [connectionError, setConnectionError] = useState<string | null>(null);

    const [leftPanelVisible, setLeftPanelVisible] = useState<boolean>(loadLeftPanelVisible());
    const [bottomPanelVisible, setBottomPanelVisible] = useState<boolean>(loadBottomVisible());
    const [rightPanelVisible, setRightPanelVisible] = useState<boolean>(loadRightPanelVisible());
    const [centerPanelVisible, setCenterPanelVisible] = useState<boolean>(loadCenterPaneVisible());
    
    const [searchActive, setSearchActive] = useState<boolean>(false);
    const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
    const [searchEnded, setSearchEnded] = useState<boolean>(true);
    const [diffEnabled, setDiffEnabled] = useState<boolean>(loadDiffEnabled());
    const [followEnabled, setFollowEnabled] = useState<boolean>(loadFollowEnabled());
    const followEnabledRef = useRef<boolean>(true);
    const pendingOpenFilesRef = useRef<Set<string>>(new Set());
    // Store original content (for git diff) to apply once editor is initialized
    const pendingOriginalContentRef = useRef<Map<string, string>>(new Map());

    // Git integration state
    const [changedFiles, setChangedFiles] = useState<ChangedFile[]>([]);
    const [gitBranch, setGitBranch] = useState<string>('');
    const [leftPanelMode, setLeftPanelMode] = useState<'files' | 'changes' | 'search'>('files');

    const [terminals, setTerminals] = useState<Terminal[]>(loadTerminals);
    const [terminalSelected, setTerminalSelected] = useState<number>(loadTerminalSelected());
    const terminalCounterRef = useRef<number>(1);
    const newTerminalsRef = useRef<Set<string>>(new Set());
    const terminalListenersRef = useRef<Map<string, Set<(data: string) => void>>>(new Map());

    const [acpSessions, setAcpSessions] = useState<Map<string, AcpSession>>(new Map());
    const selectedAgentIdRef = useRef<string | null>(null);
    const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
    const agentCounterRef = useRef<Map<string, number>>(new Map());
    const acpSessionsRef = useRef<Map<string, AcpSession>>(new Map());
    const [isAgentSettingsOpen, setIsAgentSettingsOpen] = useState<boolean>(false);
    const [agentsVersion, setAgentsVersion] = useState<number>(0);

    const wsRef = useRef<Socket | null>(null);
    const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reconnectAttemptsRef = useRef<number>(0);
    const reconnectDelay = 1000;

    // Batching for file changes
    const pendingChangesRef = useRef<Map<string, PendingBatch>>(new Map());

    const handleLeftPanelVisibleChange = (index: number, visible: boolean) => {
        console.log('handleLeftPanelVisibleChange', index, visible);
        if (index === 0) {
            setLeftPanelVisible(visible);
        }
    };

    const handleBottomPanelVisibleChange = (index: number, visible: boolean) => {
        console.log('handleTerminalPanelVisibleChange', index, visible);
        if (index === 1) {
            setBottomPanelVisible(visible);
        }
    };

    const handleRightPanelVisibleChange = (index: number, visible: boolean) => {
        console.log('handleRightPanelVisibleChange', index, visible);
        if (index === 0) {
            setCenterPanelVisible(visible);
        }
        if (index === 1) {
            setRightPanelVisible(visible);
        }
    };

    const createEditor = async (
        content: string,
        language: string,
        filename: string,
        initialPosition?: { line: number; column: number },
        errors?: { line: number; message: string }[],
        history?: { changes: Change[], index: number },
    ): Promise<AnycodeEditor> => {
        const options: any = {};
        if (initialPosition) {
            options.line = initialPosition.line;
            options.column = initialPosition.column;
        }

        const editor = new AnycodeEditor(content, filename, language, options);
        await editor.init();
        if (history) {
            editor.setHistory(history.changes, history.index);
        }
        editor.setDiffEnabled(diffEnabled);
        editor.setOnChange((change: Change) => handleChange(filename, change));
        editor.setOnCursorChange((newState: any, oldState: any) => handleCursorChange(filename, newState, oldState));
        editor.setCompletionProvider(handleCompletion);
        editor.setGoToDefinitionProvider(handleGoToDefinition);
        editor.setErrors(errors || []);
        
        return editor;
    };

    const initializeEditors = async () => {
        try {
            const newEditorStates = new Map<string, AnycodeEditor>();
            
            for (const file of files) {
                if (!editorStates.has(file.id)) {
                    // create editor if it doesn't exist
                    const content = savedFileContentsRef.current.get(file.id);
                    if (content === undefined) continue;

                    const pendingPosition = pendingPositions.current.get(file.id);
                    const pendingDiagnostics = diagnosticsRef.current.get(file.id);
                    const errors = pendingDiagnostics ? pendingDiagnostics
                        .map(d => ({ line: d.range.start.line, message: d.message })) : undefined;

                    const editor = await createEditor(content, file.language, file.id, pendingPosition, errors, file.history);
                    newEditorStates.set(file.id, editor);
                    savedFileContentsRef.current.set(file.id, content);
                    editorRefs.current.set(file.id, editor);
                    
                    if (pendingPosition) pendingPositions.current.delete(file.id);

                    // Check for pending original content (git diff)
                    const pendingDiff = pendingOriginalContentRef.current.get(file.id);
                    if (pendingDiff !== undefined) {
                        editor.setOriginalCode(pendingDiff);
                        editor.setDiffEnabled(true);
                        pendingOriginalContentRef.current.delete(file.id);
                    }
                } else {
                    // if editor already exists, just use it
                    const existing = editorStates.get(file.id)!;
                    newEditorStates.set(file.id, existing);
                    editorRefs.current.set(file.id, existing);
                }
            }
            setEditorStates(newEditorStates);
        } catch (error) {
            console.error('Error initializing editors:', error);
        }
    };

    useEffect(() => {
        if (files.length > 0) {
            initializeEditors();
        }
    }, [files]);

    // hotkey handler
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.metaKey && e.key === "f") {
                e.preventDefault();
            }

            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                if (activeFileId) {
                    saveFile(activeFileId);
                }
            }
            if (e.ctrlKey && e.key === "1") setLeftPanelVisible(prev => !prev)
            if (e.ctrlKey && e.key === "2") setBottomPanelVisible(prev => !prev)
            if (e.ctrlKey && e.key === "3") setCenterPanelVisible(prev => !prev)
            if (e.ctrlKey && e.key === "4") setRightPanelVisible(prev => !prev)
            
            if (e.ctrlKey && e.key === "-") {
                e.preventDefault();
                undoCursor();
            } else if (e.ctrlKey && e.key === "_") {
                e.preventDefault();
                redoCursor();
            }
        };

        document.addEventListener('keydown', handleKeyDown);

        // ensure active file is selection in the tree
        const file = files.find(f => f.id === activeFileId);
        if (file) {
            const node = findNodeByPath(fileTree, file.id);
            if (node) {
                selectNode(node.id);
            }
        }

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        }
    }, [activeFileId]);

    const flushChanges = (filename: string) => {
        const batch = pendingChangesRef.current.get(filename);
        if (!batch || batch.changes.length === 0) return;

        // Merge all edits from batched changes
        const allEdits = batch.changes.flatMap(c => c.edits);

        // Send all batched edits in one message
        if (wsRef.current && isConnected) {
            wsRef.current.emit("file:change", {
                file: filename,
                edits: allEdits
            });
        }

        // Clear the batch
        batch.changes = [];
        batch.timerId = null;
    };

    const handleChange = (filename: string, change: Change) => {
        console.log('handleChange', filename, change);

        // Handle undo/redo immediately (flush pending changes first)
        if (change.isUndo || change.isRedo) {
            flushChanges(filename);
            if (wsRef.current && isConnected) {
                wsRef.current.emit("file:change", { file: filename, ...change });
            }
        } else {
            // Batch regular edits
            let batch = pendingChangesRef.current.get(filename);
            if (!batch) {
                batch = { changes: [], timerId: null };
                pendingChangesRef.current.set(filename, batch);
            }

            // Add change to batch
            batch.changes.push(change);

            // Clear old timer
            if (batch.timerId) {
                clearTimeout(batch.timerId);
            }

            // Set new timer to flush changes
            batch.timerId = setTimeout(() => {
                flushChanges(filename);
            }, BATCH_DELAY_MS);
        }

        const file = files.find(f => f.id === filename);
        if (!file) return;

        const editor = editorRefs.current.get(file.id);
        if (!editor) return;

        let oldcontent = savedFileContentsRef.current.get(file.id);
        if (!oldcontent) return;


    };

    const handleCursorChange = (filename: string, newCursor: Position, oldCursor: Position) => {
        console.log('handleCursorChange:', {filename, newCursor, oldCursor});

        if (newCursor.line === oldCursor.line && newCursor.column === oldCursor.column) {
            console.log('handleCursorChange - not changed:', {filename, newCursor, oldCursor});
        } else {
            const cursorPos = { file: activeFileId || '', cursor: oldCursor };
            console.log('handleCursorChange - saving position:', cursorPos);
            cursorHistory.current.undoStack.push(cursorPos);
            cursorHistory.current.redoStack = [];
        }
    };

    const closeFile = (fileId: string) => {
        // Flush any pending changes before closing
        flushChanges(fileId);

        if (wsRef.current && isConnected) {
            wsRef.current.emit("file:close", { file: fileId });
        }

        // find file before deleting to unselect it in the tree
        const fileToClose = files.find(f => f.id === fileId);
        
        setFiles(prev => {
            const newFiles = prev.filter(file => file.id !== fileId);
            if (activeFileId === fileId) {
                if (newFiles.length > 0)  setActiveFileId(newFiles[0].id);
                else setActiveFileId(null);
            }
            
            return newFiles;
        });
        
        setEditorStates(prev => {
            const newStates = new Map(prev);
            newStates.delete(fileId);
            return newStates;
        });
        editorRefs.current.delete(fileId);
        
        savedFileContentsRef.current.delete(fileId);
        
        // Unselect the closed file in the tree
        if (fileToClose) {
            const nodeId = findNodeByPath(fileTree, fileToClose.id);
            if (nodeId) {
                // Unselect the file, setting isSelected: false for all nodes
                setFileTree(prevTree => {
                    const clearSelection = (nodes: TreeNode[]): TreeNode[] => {
                        return nodes.map(node => {
                            const updatedChildren = node.children ? clearSelection(node.children) : undefined;
                            return { ...node, isSelected: false, children: updatedChildren };
                        });
                    };
                    return clearSelection(prevTree);
                });
            }
        }
    };

    const saveFile = (fileId: string) => {
        // Flush any pending changes before saving
        flushChanges(fileId);

        const editor = editorRefs.current.get(fileId);
        if (!editor) return;

        const content = editor.getText();

        const oldContent = savedFileContentsRef.current.get(fileId);
        let isChanged = oldContent !== content;

        if (!isChanged) { return; }

        // send file to backend with ack
        if (wsRef.current && isConnected) {
            wsRef.current.emit('file:save', { path: fileId }, (response: any) => { 
                handleSaveFileResponse(fileId, content, response); 
            });
        }
    };

    const handleSaveFileResponse = (fileId: string, content: string, response: any) => {
        if (response.success) {
            console.log('File saved successfully:', fileId);
            savedFileContentsRef.current.set(fileId, content);
        } else {
            console.error('Failed to save file:', response.error);
        }
    };

    const attemptReconnect = () => {
        reconnectAttemptsRef.current++;
        console.log(`Attempting to reconnect... (${reconnectAttemptsRef.current} attempts)`);
        
        reconnectTimeoutRef.current = setTimeout(() => {
            connectToBackend();
        }, reconnectDelay);
    };

    const connectToBackend = () => {
        try {
            // Clear any existing reconnect timeout
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
            }

            const ws = io(BACKEND_URL, { transports: ['websocket'] });
            wsRef.current = ws;

            ws.on('connect', handleSocketConnect);
            ws.on('disconnect', handleSocketDisconnect);
            ws.on('connect_error', handleSocketConnectError);
            ws.on('error', handleSocketError);
            ws.on("lsp:diagnostics", handleDiagnostics);
            ws.on("watcher:edits", handleWatcherEdits);
            ws.on("watcher:create", handleWatcherCreate);
            ws.on("watcher:remove", handleWatcherRemove);
            ws.on("git:status-update", handleGitStatusUpdate);
            ws.on("acp:message", handleAcpMessage);
            ws.on("acp:history", handleAcpHistory);
            ws.on("search:result", handleSearchResult);
            ws.on("search:end", handleSearchEnd);
        } catch (error) {
            console.error('Failed to connect to backend:', error);
            setConnectionError('Failed to connect to backend');
        }
    };

    const handleSocketConnect = () => {
        console.log('Connected to backend');
        setIsConnected(true);
        setConnectionError(null);
        reconnectAttemptsRef.current = 0;
        openFolder('.');

        terminals.forEach(term => {
            console.log('App: Initializing terminal:', term.name);
            initializeTerminal(term);
            reattachTerminalListener(term.name);
        });

        reconnectToAcpAgents();

        // Fetch git status on connect
        wsRef.current?.emit('git:status', {}, (response: any) => {
            if (response.success) {
                console.log('Git status:', response);
                setChangedFiles(response.files || []);
                setGitBranch(response.branch || '');
            } else {
                console.log('Git status failed:', response.error);
                setChangedFiles([]);
                setGitBranch('');
            }
        });
    };

    const handleSocketDisconnect = (reason: string) => {
        console.log('Disconnected from backend', reason);
        setIsConnected(false);
        attemptReconnect();
    };

    const handleSocketConnectError = (error: Error) => {
        console.error('Socket connect error:', error);
        setIsConnected(false);
        setConnectionError('Failed to connect to backend');
    };

    const handleSocketError = (data: { message: string }) => {
        console.error('Backend error:', data);
        setConnectionError(data.message);
    };


    const handleDiagnostics = (diagnosticsResponse: DiagnosticResponse) => {
        console.log("lsp:diagnostics", diagnosticsResponse);

        // Store per-file diagnostics and update editor visuals if editor exists
        const uri = diagnosticsResponse.uri || '';
        const diags = diagnosticsResponse.diagnostics || [];

        // Try to map URI to an opened file id (relative path). Use suffix match.
        let targetFileId: string | null = null;
        const openFiles = filesRef.current || [];
        for (const f of openFiles) {
            if (uri.endsWith('/' + f.id) || uri.endsWith(f.id) || uri.includes(f.id)) {
                targetFileId = f.id;
                break;
            }
        }

        if (!targetFileId) {
            targetFileId = uri.replace('file://', '');
        }

        diagnosticsRef.current.set(targetFileId, diags);

        // Apply immediately to editor via stable refs to avoid React re-render
        const editorImmediate = editorRefs.current.get(targetFileId!);
        if (editorImmediate) {
            const errorsImmediate = diags.map(d => ({ line: d.range.start.line, message: d.message }));
            editorImmediate.setErrors(errorsImmediate);
        }
    };

    const disconnectFromBackend = () => {
        // Flush all pending changes before disconnecting
        pendingChangesRef.current.forEach((batch, filename) => {
            if (batch.timerId) {
                clearTimeout(batch.timerId);
            }
        });
        pendingChangesRef.current.clear();

        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
        }
        reconnectAttemptsRef.current = 0;
        if (wsRef.current) {
            wsRef.current.disconnect();
            wsRef.current = null;
        }
        setIsConnected(false);
    };

    const initializeTerminal = (terminal: Terminal) => {
        if (!wsRef.current) return;

        const isNewTerminal = newTerminalsRef.current.has(terminal.id);
        const event = isNewTerminal ? 'terminal:start' : 'terminal:reconnect';

        console.log(`Initializing terminal ${terminal.name} with ${event}`);

        wsRef.current.emit(event, {
            name: terminal.name,
            session: terminal.session,
            cols: terminal.cols,
            rows: terminal.rows
        });
    };

    const handleTerminalData = useCallback((name: string, data: string) => {
        const terminal = terminals.find(t => t.name === name);
        if (!terminal) return;

        if (wsRef.current && isConnected) {
            wsRef.current.emit('terminal:input', {
                name: terminal.name,
                session: terminal.session,
                input: data
            });
        }
    }, [isConnected, terminals]);

    const handleTerminalResize = useCallback((name: string, cols: number, rows: number) => {
        if (!bottomPanelVisible) return;

        const terminal = terminals.find(t => t.name === name);
        if (!terminal) return;

        if (wsRef.current && isConnected) {
            wsRef.current.emit('terminal:resize', {
                name: terminal.name,
                session: terminal.session,
                cols, rows
            });
        }
    }, [isConnected, terminals]);

    const attachTerminalListener = useCallback((name: string, callback: (data: string) => void) => {
        if (!wsRef.current) return;
        const channel = `terminal:data:${name}`;
        wsRef.current.on(channel, callback);
    }, []);

    const detachTerminalListener = useCallback((name: string, callback: (data: string) => void) => {
        if (!wsRef.current) return;
        const channel = `terminal:data:${name}`;
        wsRef.current.off(channel, callback);
    }, []);

    const reattachTerminalListener = useCallback((name: string) => {
        if (!wsRef.current) return;
        const callbacks = terminalListenersRef.current.get(name);
        if (!callbacks) return;

        callbacks.forEach(callback => {
            detachTerminalListener(name, callback);
            attachTerminalListener(name, callback);
        });
    }, [attachTerminalListener, detachTerminalListener]);

    const handleTerminalDataCallback = useCallback((name: string, callback: (data: string) => void) => {
        if (!terminalListenersRef.current.has(name)) {
            terminalListenersRef.current.set(name, new Set());
        }

        const callbacks = terminalListenersRef.current.get(name)!;
        callbacks.add(callback);

        attachTerminalListener(name, callback);

        return () => {
            callbacks.delete(callback);
            detachTerminalListener(name, callback);

            if (callbacks.size === 0) {
                terminalListenersRef.current.delete(name);
            }
        };
    }, [attachTerminalListener, detachTerminalListener]);

    const addTerminal = useCallback(() => {
        // Find unique ID first
        let nextid = terminalCounterRef.current + 1;
        while (terminals.find(t => t.id === String(nextid))) {
          nextid += 1;
        }
        terminalCounterRef.current = nextid;
    
        const id = String(nextid);
        const name = String(nextid);
        const session = 'anycode';
        const cols = 60, rows = 20;
        const newTerminal: Terminal = { id, name, session, cols, rows };
        newTerminalsRef.current.add(id);
        setTerminals(prev => [...prev, newTerminal]);
        setTerminalSelected(terminals.length);

        if (bottomPanelVisible && wsRef.current && isConnected) 
            initializeTerminal(newTerminal);
    }, [terminals, bottomPanelVisible, isConnected]);

    const closeTerminal = useCallback((index: number) => {
        const terminalToRemove = terminals[index];
        newTerminalsRef.current.delete(terminalToRemove.id);
        setTerminals(prev => prev.filter((_, i) => i !== index));

        // Adjust selected terminal index
        if (terminalSelected >= terminals.length - 1) {
            setTerminalSelected(Math.max(0, terminals.length - 2));
        }

        // Clean up terminal on backend
        if (wsRef.current && isConnected) {
            wsRef.current.emit('terminal:close', {
                name: terminalToRemove.name, 
                session: terminalToRemove.session
            });
        }
    }, [terminals, terminalSelected, isConnected]);

    const openTab = (file: FileState) => {
        console.log('Opening file from tree:', file.id);
        setActiveFileId(file.id);
    };

    const closeTab = (file: FileState) => {
        closeFile(file.id);
    };

    const openFolder = (path: string) => {
        if (wsRef.current && isConnected) {
            wsRef.current.emit('dir:list', { path }, handleOpenFolderResponse);
        }
    };

    const handleOpenFolderResponse = (response: any) => {
        if (response.error) {
            console.error('Failed to open folder:', response.error);
            return;
        }
        
        // console.log('Received directory via ack:', response);
        
        if (response.relative_path === '.') {
            let children = convertToTree(response.files, response.dirs, '.');
            const rootNode = {
                id: '.',
                name: response.name || 'Root',
                type: 'directory' as const,
                path: '.',
                children: children,
                isExpanded: true,
                isSelected: false,
                isLoading: false,
                hasLoaded: true
            };
            setFileTree([rootNode]);
        } else {
            setFileTree(prev => {
                const updateNode = (nodes: TreeNode[]): TreeNode[] => {
                    return nodes.map(node => {
                        if (node.id === response.relative_path) {
                            return {
                                ...node,
                                children: convertToTree(response.files, response.dirs, response.relative_path),
                                isExpanded: true,
                                isLoading: false,
                                hasLoaded: true
                            };
                        }
                        if (node.children) {
                            return {
                                ...node,
                                children: updateNode(node.children)
                            };
                        }
                        return node;
                    });
                };
                return updateNode(prev);
            });
        }
    };

    const openFile = (path: string) => {
        console.log('Open file:', path);

        // Use filesRef.current to get the latest state (avoid stale closure)
        const existingFile = filesRef.current.find(file => file.id === path);

        if (existingFile) {
            console.log('File already open, switching to:', existingFile.name);
            if (existingFile.id !== activeFileId) {
                setActiveFileId(existingFile.id);
            }
            return;
        }

        if (pendingOpenFilesRef.current.has(path)) {
            console.log('File already pending open:', path);
            return;
        }

        if (wsRef.current && isConnected) {
            pendingOpenFilesRef.current.add(path);
            wsRef.current.emit('file:open', { path }, (response: any) => {
                pendingOpenFilesRef.current.delete(path);
                if (response.success) {
                    handleOpenFileResponse(path, response.content, response.history)
                } else {
                    console.error('Failed to open file:', response.error);
                }
            });
        }
    };

    // Git integration functions
    const fetchGitStatus = useCallback(() => {
        if (wsRef.current && isConnected) {
            wsRef.current.emit('git:status', {}, (response: any) => {
                if (response.success) {
                    console.log('Git status:', response);
                    setChangedFiles(response.files || []);
                    setGitBranch(response.branch || '');
                } else {
                    console.log('Git status failed:', response.error);
                    setChangedFiles([]);
                    setGitBranch('');
                }
            });
        }
    }, [isConnected]);

    // Handle git status updates pushed from backend
    const handleGitStatusUpdate = (data: { files: ChangedFile[]; branch: string }) => {
        console.log('git:status-update', data);
        setChangedFiles(data.files || []);
        setGitBranch(data.branch || '');
    };

    const handleOpenChangedFile = useCallback((path: string) => {
        // Open file directly (openFile is now defined above)
        openFile(path);
        
        // Then get the original content from git and enable diff
        if (wsRef.current && isConnected) {
            wsRef.current.emit('git:file-original', { path }, (response: any) => {
                if (response.success) {
                    console.log('Git file original received:', path, 
                        response.is_new ? '(new file)' : `${response.content.length} bytes`);
                    
                    const content = response.content;
                    
                    // Store in ref so initializeEditors can pick it up if editor creates later
                    pendingOriginalContentRef.current.set(path, content);
                    
                    // If editor already exists, apply immediately
                    const editor = editorRefs.current.get(path);
                    if (editor) {
                        editor.setOriginalCode(content);
                        editor.setDiffEnabled(true);
                    }
                }
            });
        }
    }, [isConnected]);

    const handleGitCommit = useCallback((filesToCommit: string[], message: string) => {
        console.log('handleGitCommit', filesToCommit, message);
        if (wsRef.current && isConnected) {
            wsRef.current.emit('git:commit', { files: filesToCommit, message }, (response: any) => {
                if (response.success) {
                    console.log('Commit successful');
                    fetchGitStatus();
                } else {
                    alert('Commit failed: ' + response.error);
                    console.error('Commit failed:', response.error);
                }
            });
        }
    }, [isConnected, fetchGitStatus]);

    const handleGitPush = useCallback(() => {
        console.log('handleGitPush');
        if (wsRef.current && isConnected) {
            wsRef.current.emit('git:push', {}, (response: any) => {
                if (response.success) {
                    console.log('Push successful');
                    fetchGitStatus();
                } else {
                    alert('Push failed: ' + response.error);
                    console.error('Push failed:', response.error);
                }
            });
        }
    }, [isConnected, fetchGitStatus]);

    const handleGitPull = useCallback(() => {
        console.log('handleGitPull');
        if (wsRef.current && isConnected) {
            wsRef.current.emit('git:pull', {}, (response: any) => {
                if (response.success) {
                    console.log('Pull response:', response);
                    const status = response.status;
                    
                    if (status === 'up_to_date') {
                        alert('Already up to date');
                    } else if (status === 'fast_forward') {
                        alert('Fast-forwarded');
                    } else if (status === 'merged') {
                        alert('Merged successfully');
                    } else if (status === 'conflict') {
                        const files = response.files || [];
                        alert(`Merge conflicts in:\n${files.join('\n')}\n\nResolve conflicts and commit.`);
                    }
                    
                    fetchGitStatus();
                } else {
                    alert('Pull failed: ' + response.error);
                    console.error('Pull failed:', response.error);
                }
            });
        }
    }, [isConnected, fetchGitStatus]);

    const handleGitRevert = useCallback((path: string) => {
        console.log('handleGitRevert', path);
        if (wsRef.current && isConnected) {
            wsRef.current.emit('git:revert', { path }, (response: any) => {
                if (response.success) {
                    console.log('Revert successful');
                    fetchGitStatus();
                } else {
                    alert('Revert failed: ' + response.error);
                    console.error('Revert failed:', response.error);
                }
            });
        }
    }, [isConnected, fetchGitStatus]);


    const handleOpenFileResponse = (path: string, content: string, history: { changes: Change[], index: number }) => {
        const fileName = getFileName(path);
        const language = getLanguageFromFileName(fileName);
        savedFileContentsRef.current.set(path, content);
        const newFile: FileState = { id: path, name: fileName, language, history };
        setFiles(prev => {
            // Check if file already exists to prevent duplicates
            if (prev.some(f => f.id === path)) {
                return prev;
            }
            return [...prev, newFile];
        });
        setActiveFileId(newFile.id);
    };

    const convertToTree = (files: string[], dirs: string[], basePath: string): TreeNode[] => {
        const treeNodes: TreeNode[] = [];
        
        // Add directories first
        dirs.forEach(dirName => {
            const dirPath = basePath === '.' ? dirName : joinPath(basePath, dirName);
            treeNodes.push({
                id: dirPath,
                name: dirName,
                type: 'directory',
                path: dirPath,
                children: [],
                isExpanded: false,
                isSelected: false,
                isLoading: false,
                hasLoaded: false
            });
        });
        
        // Add files
        files.forEach(fileName => {
            const filePath = basePath === '.' ? fileName : joinPath(basePath, fileName);
            treeNodes.push({
                id: filePath,
                name: fileName,
                type: 'file',
                path: filePath,
                isExpanded: false,
                isSelected: false,
                isLoading: false,
                hasLoaded: false
            });
        });
        
        return treeNodes;
    };

    const toggleNode = (nodeId: string) => {
        setFileTree(prevTree => {
            const updateNode = (nodes: TreeNode[]): TreeNode[] => {
                return nodes.map(node => {
                    if (node.id === nodeId) {
                        return { ...node, isExpanded: !node.isExpanded };
                    }
                    if (node.children) {
                        return { ...node, children: updateNode(node.children) };
                    }
                    return node;
                });
            };
            return updateNode(prevTree);
        });
    };

    const findNodeByPath = (nodes: TreeNode[], filePath: string): TreeNode | null => {
        for (const node of nodes) {
            if (node.path === filePath && node.type === 'file') {
                return node;
            }
            if (node.children) {
                const found = findNodeByPath(node.children, filePath);
                if (found) return found;
            }
        }
        return null;
    };

    const selectNode = (nodeId: string) => {
        setFileTree(prevTree => {
            const updateNode = (nodes: TreeNode[]): TreeNode[] => {
                return nodes.map(node => {
                    const updatedChildren = node.children ? updateNode(node.children) : undefined;
                    
                    if (node.id === nodeId) {
                        return { ...node, isSelected: true, children: updatedChildren };
                    }
                    return { ...node, isSelected: false, children: updatedChildren };
                });
            };
            return updateNode(prevTree);
        });
    };

    const handleCompletion = (completionRequest: CompletionRequest): Promise<Completion[]> => {
        return new Promise((resolve, reject) => {
            console.log('handleCompletion', completionRequest);
        
            wsRef.current?.emit("lsp:completion", completionRequest, (response:any) => {
                console.log("lsp response", response);

                if (response.error) {
                    console.error('Failed to get completion:', response.error);
                    reject([]);
                    return;
                }

                resolve(response || []);
            });
        });
    };

    const handleGoToDefinition = (definitionRequest: DefinitionRequest): Promise<DefinitionResponse> => {
        return new Promise((resolve, reject) => {
            console.log('handleGoToDefinition', definitionRequest);
            
            if (activeFileId) {
                const editor = editorRefs.current.get(activeFileId);
                if (editor) {
                    const cursorPos = { file: activeFileId, cursor: editor.getCursor() };
                    cursorHistory.current.undoStack.push(cursorPos);
                    cursorHistory.current.redoStack = [];
                }
            }
            
            if (!wsRef.current) {
                console.error('WebSocket not connected');
                reject(new Error('WebSocket not connected'));
                return;
            }

            wsRef.current.emit("lsp:definition", definitionRequest, (response: any) => {
                console.log("definition response", response);

                if (response.error) {
                    console.error('Failed to get definition:', response.error);
                    reject(new Error(response.error));
                    return;
                }

                if (response && response.length > 0) {
                    const definition = response[0];
                    const uri = definition.uri;
                    const range = definition.range;
                    const line = range.start.line; const column = range.start.character;
                    
                    const filePath = uri.replace('file://', '');
                    const fileName = getFileName(filePath);

                    pendingPositions.current.set(filePath, { line, column });
                    
                    const existingFile = filesRef.current.find(f => f.id === filePath || f.name === fileName);
                    if (existingFile) {
                        setActiveFileId(existingFile.id);
                        const editor = editorRefs.current.get(existingFile.id);
                        if (editor) {
                            editor.requestFocus(line, column);
                        }
                    } else {                    
                        console.log('Opening new file:', filePath);
                        openFile(filePath);
                    }
                    
                    resolve(definition);
                } else {
                    reject(new Error('No definition found'));
                }
            });
        });
    };

    const undoCursor = () => {
        console.log("undoCursor");

        if (cursorHistory.current.undoStack.length === 0) {
            console.log('No positions to undo');
            return;
        }
        
        if (activeFileId) {
            const editor = editorRefs.current.get(activeFileId);
            if (editor) {
                const cursorPos = { file: activeFileId, cursor: editor.getCursor() };
                cursorHistory.current.redoStack.push(cursorPos);
            }
        }

        var prevPosition = cursorHistory.current.undoStack.pop();
        console.log("undoCursor", prevPosition);
        
        if (prevPosition && prevPosition.file) {
            const filePath = prevPosition.file;
            const fileName = getFileName(filePath);
            const { line, column } = prevPosition.cursor;

            pendingPositions.current.set(filePath, { line, column });

            const existingFile = filesRef.current.find(f => f.id === filePath || f.name === fileName);
            if (existingFile) {
                setActiveFileId(existingFile.id);
                const editor = editorRefs.current.get(existingFile.id);
                if (editor) {
                    editor.requestFocus(line, column, true);
                }
            } else {
                openFile(filePath);
            }
        }
    };

    const redoCursor = () => {
        console.log("redoCursor");

        if (cursorHistory.current.redoStack.length === 0) {
            console.log('No positions to redo');
            return;
        }

        if (activeFileId) {
            const editor = editorRefs.current.get(activeFileId);
            if (editor) {
                const cursorPos = { file: activeFileId, cursor: editor.getCursor() };
                cursorHistory.current.undoStack.push(cursorPos);
            }
        }

        const nextPosition = cursorHistory.current.redoStack.pop();        
        if (nextPosition && nextPosition.file) {
            const filePath = nextPosition.file;
            const fileName = getFileName(filePath);
            const { line, column } = nextPosition.cursor;

            pendingPositions.current.set(filePath, { line, column });

            const existingFile = filesRef.current.find(f => f.id === filePath || f.name === fileName);
            if (existingFile) {
                setActiveFileId(existingFile.id);
                const editor = editorRefs.current.get(existingFile.id);
                if (editor) {
                    editor.requestFocus(line, column, true);
                }
            } else {
                openFile(filePath);
            }
        }
    };

    const handleWatcherEdits = (watcherEdits: WatcherEdits) => {
        console.log('watcher:edits', watcherEdits);
        const { file, edits } = watcherEdits;

        const editor = editorRefs.current.get(file);
        if (!editor) {
            console.log('watcher:edits - editor not found for file:', file);
            console.log('watcher:edits - available editors:', Array.from(editorRefs.current.keys()));
            return;
        }

        editor.applyChange({ edits });
    }

    const handleWatcherCreate = (watcherCreate: WatcherCreate) => {
        console.log('watcher:create', watcherCreate);
        const { path, isFile } = watcherCreate;

        // Extract parent path and filename
        const fileName = getFileName(path);
        const parentPath = getParentPath(path);

        setFileTree(prevTree => {
            const addNode = (nodes: TreeNode[]): TreeNode[] => {
                return nodes.map(node => {
                    // Find parent directory and add child
                    if (node.type === 'directory' && node.path === parentPath && node.children) {
                        // Check if node already exists
                        const exists = node.children.some(child => child.path === path);
                        if (exists) return node;

                        const newNode: TreeNode = {
                            id: path,
                            name: fileName,
                            type: isFile ? 'file' : 'directory',
                            path: path,
                            children: isFile ? undefined : [],
                            isExpanded: false,
                            isSelected: false,
                            isLoading: false,
                            hasLoaded: !isFile
                        };

                        return {
                            ...node,
                            children: [...node.children, newNode].sort((a, b) => {
                                // Directories first, then files, alphabetically
                                if (a.type !== b.type) {
                                    return a.type === 'directory' ? -1 : 1;
                                }
                                return a.name.localeCompare(b.name);
                            })
                        };
                    }

                    if (node.children) {
                        return { ...node, children: addNode(node.children) };
                    }
                    return node;
                });
            };
            return addNode(prevTree);
        });
    };

    const handleWatcherRemove = (watcherRemove: WatcherRemove) => {
        console.log('watcher:remove', watcherRemove);
        const { path, isFile } = watcherRemove;

        setFileTree(prevTree => {
            const removeNode = (nodes: TreeNode[]): TreeNode[] => {
                return nodes
                    .filter(node => node.path !== path)
                    .map(node => {
                        if (node.children) {
                            return { ...node, children: removeNode(node.children) };
                        }
                        return node;
                    });
            };
            return removeNode(prevTree);
        });
    };

    const handleAcpMessage = (data: { agent_id: string; item: AcpMessage }) => {
        console.log('acp:message', data);
        
        // Handle prompt_state messages
        if (data.item.role === 'prompt_state') {
            const promptState = data.item as AcpPromptStateMessage;
            setAcpSessions(prev => {
                const newSessions = new Map(prev);
                const existing = newSessions.get(data.agent_id);
                if (!existing) {
                    newSessions.set(data.agent_id, {
                        agentId: data.agent_id,
                        agentName: '',
                        messages: [],
                        isActive: true,
                        isProcessing: promptState.is_processing,
                    });
                } else {
                    newSessions.set(data.agent_id, {
                        ...existing,
                        isProcessing: promptState.is_processing,
                    });
                }
                return newSessions;
            });
            return;
        }
        
        // Handle open_file messages for follow mode (not stored in session)
        if (data.item.role === 'open_file' && followEnabledRef.current) {
            const openFileMsg = data.item as AcpOpenFileMessage;
            if (openFileMsg.line !== undefined) {
                pendingPositions.current.set(openFileMsg.path, { line: openFileMsg.line, column: 0 });
            }
            openFile(openFileMsg.path);
            return;
        }

        // Handle tool_call, tool_result, tool_update, and permission_request messages
        if (data.item.role === 'tool_call' || data.item.role === 'tool_result' || data.item.role === 'tool_update' || data.item.role === 'permission_request') {
            // Follow mode: open file when tool_result arrives (file is guaranteed to exist at this point)
            if (data.item.role === 'tool_result' && followEnabledRef.current) {
                const toolResult = data.item as AcpToolResultMessage;
                // Find the matching tool_call in session history to get locations
                const session = acpSessionsRef.current.get(data.agent_id);
                if (session) {
                    const matchingToolCall = session.messages.find(
                        m => m.role === 'tool_call' && (m as AcpToolCallMessage).id === toolResult.id
                    ) as AcpToolCallMessage | undefined;
                    if (matchingToolCall?.locations && matchingToolCall.locations.length > 0) {
                        const loc = matchingToolCall.locations[0];
                        const filePath = loc.path;
                        if (loc.line !== undefined) {
                            pendingPositions.current.set(filePath, { line: loc.line, column: 0 });
                        }
                        handleOpenChangedFile(filePath);
                    }
                }
            }

            setAcpSessions(prev => {
                const newSessions = new Map(prev);
                const existing = newSessions.get(data.agent_id);
                if (!existing) {
                    newSessions.set(data.agent_id, {
                        agentId: data.agent_id,
                        agentName: '',
                        messages: [data.item],
                        isActive: true,
                    });
                } else {
                    newSessions.set(data.agent_id, {
                        ...existing,
                        messages: [...existing.messages, data.item],
                    });
                }
                return newSessions;
            });
            return;
        }
        
        // Handle error messages separately
        if (data.item.role === 'error') {
            setAcpSessions(prev => {
                const newSessions = new Map(prev);
                const existing = newSessions.get(data.agent_id);
                if (!existing) {
                    newSessions.set(data.agent_id, {
                        agentId: data.agent_id,
                        agentName: '',
                        messages: [data.item],
                        isActive: true,
                    });
                } else {
                    newSessions.set(data.agent_id, {
                        ...existing,
                        messages: [...existing.messages, data.item],
                    });
                }
                return newSessions;
            });
            return;
        }

        if (data.item.role !== 'user' && data.item.role !== 'assistant' && data.item.role !== 'thought') {
            return;
        }

        const message = data.item;
        const isChunk = message.is_chunk || false;
        
        setAcpSessions(prev => {
            const newSessions = new Map(prev);
            const existing = newSessions.get(data.agent_id);
            if (!existing) {
                newSessions.set(data.agent_id, {
                    agentId: data.agent_id,
                    agentName: '',
                    messages: [message],
                    isActive: true,
                });
            } else {
                // If it's a chunk and last message is from assistant or thought, update it
                if (isChunk && existing.messages.length > 0) {
                    const lastMessage = existing.messages[existing.messages.length - 1];
                    if (lastMessage.role === 'assistant' || lastMessage.role === 'thought') {
                        // Update last message by appending chunk content
                        const updatedMessages = [...existing.messages];
                        updatedMessages[updatedMessages.length - 1] = {
                            ...lastMessage,
                            content: lastMessage.content + message.content,
                        };
                        newSessions.set(data.agent_id, {
                            ...existing,
                            messages: updatedMessages,
                        });
                        return newSessions;
                    }
                }
                
                const messageToAdd = isChunk && (message.role === 'thought' || message.role === 'assistant') 
                    ? { ...message, is_chunk: undefined } 
                    : message;
                
                newSessions.set(data.agent_id, {
                    ...existing,
                    messages: [...existing.messages, messageToAdd],
                });
            }
            return newSessions;
        });
    };

    const handleAcpHistory = (data: { agent_id: string; history: AcpMessage[] }) => {
        console.log('acp:history', data);
        
        setAcpSessions(prev => {
            const newSessions = new Map(prev);
            const existing = newSessions.get(data.agent_id);
            if (!existing) {
                newSessions.set(data.agent_id, {
                    agentId: data.agent_id,
                    agentName: '',
                    messages: data.history,
                    isActive: true,
                });
            } else {
                newSessions.set(data.agent_id, {
                    ...existing,
                    messages: data.history,
                });
            }
            return newSessions;
        });
    };

    const generateAgentId = (baseAgentId: string): string => {
        // Check if base agent ID already exists in sessions
        const existingSessions = acpSessionsRef.current;
        let uniqueId = baseAgentId;
        let counter = 1;
        
        // Find the highest counter for this base agent ID
        const currentCounter = agentCounterRef.current.get(baseAgentId) || 0;
        counter = currentCounter;
        
        // Check if base ID exists, if not use it, otherwise increment
        if (existingSessions.has(baseAgentId)) {
            counter++;
            uniqueId = `${baseAgentId}-${counter}`;
            // Make sure this ID doesn't exist either
            while (existingSessions.has(uniqueId)) {
                counter++;
                uniqueId = `${baseAgentId}-${counter}`;
            }
        }
        
        // Update counter for this base agent ID
        agentCounterRef.current.set(baseAgentId, counter);
        
        return uniqueId;
    };

    const startAgent = (agent: AcpAgent | undefined) => {
        if (!agent) return;

        if (!wsRef.current || !isConnected) return;

        const { id, name, command, args } = agent;

        const aid = generateAgentId(id);

        wsRef.current.emit('acp:start', {
            agent_id: aid, agent_name: name, command, args,
        }, (response: any) => {
            if (response.success) {
                setAcpSessions(prev => {
                    const newSessions = new Map(prev);
                    newSessions.set(aid, {
                        agentId: aid, agentName: name, messages: [], isActive: true,
                    });
                    return newSessions;
                });
                setSelectedAgentId(aid);
                setRightPanelVisible(true);
                setDiffEnabled(true);
                setFollowEnabled(true);
            } else {
                console.error('Failed to start agent ', aid, ':', response.error);
                alert('Failed to start agent ' + aid + ': ' + response.error);
            }
        });
    };

    const sendPrompt = (agentId: string, prompt: string) => {
        if (!wsRef.current || !isConnected) return;

        wsRef.current.emit('acp:prompt', { agent_id: agentId, prompt }, (response: any) => {
            if (response.success) {

            } else {
                console.error('Failed to send prompt:', response.error);
                alert('Failed to send prompt: ' + response.error);
                // Clear processing state on error
                setAcpSessions(prev => {
                    const newSessions = new Map(prev);
                    const existing = newSessions.get(agentId);
                    if (!existing) return newSessions;
                    newSessions.set(agentId, { ...existing, isProcessing: false });
                    return newSessions;
                });
            }
        });
    };

    const undoPrompt = (agentId: string, checkpointId?: string, prompt?: string) => {
        if (!wsRef.current || !isConnected) return;

        wsRef.current.emit('acp:undo', { agent_id: agentId, checkpoint_id: checkpointId, prompt }, (response: any) => {
            if (!response.success) {
                console.error('Failed to undo prompt:', response.error);
                alert('Failed to undo prompt: ' + response.error);
            }
        });
    };

    const sendPermissionResponse = (agentId: string, permissionId: string, optionId: string) => {
        if (!wsRef.current || !isConnected) return;

        wsRef.current.emit('acp:permission_response', {
            agent_id: agentId,
            permission_id: permissionId,
            option_id: optionId,
        }, (response: any) => {
            if (!response.success) {
                console.error('Failed to send permission response:', response.error);
            }
        });
    };

    const cancelPrompt = (agentId: string) => {
        if (!wsRef.current || !isConnected) return;

        wsRef.current.emit('acp:cancel', {
            agent_id: agentId,
        }, (response: any) => {
            if (response.success) {
                // Clear processing state
                setAcpSessions(prev => {
                    const newSessions = new Map(prev);
                    const existing = newSessions.get(agentId);
                    if (!existing) return newSessions;
                    newSessions.set(agentId, { ...existing, isProcessing: false });
                    return newSessions;
                });
            } else {
                console.error('Failed to cancel prompt:', response.error);
            }
        });
    };

    const stopAgent = (agentId: string) => {
        if (!wsRef.current || !isConnected) return;

        wsRef.current.emit('acp:stop', {
            agent_id: agentId,
        }, (response: any) => {
            if (response.success) {
                setAcpSessions(prev => {
                    const newSessions = new Map(prev);
                    const existing = newSessions.get(agentId);
                    if (!existing) return newSessions;
                    newSessions.set(agentId, { ...existing, isActive: false });
                    return newSessions;
                });
            }
        });
    };

    const closeAgent = (agentId: string) => {
        const wasSelected = selectedAgentId === agentId;
        
        // First stop the agent if it's active, then remove from sessions
        const session = acpSessionsRef.current.get(agentId);
        if (session && session.isActive && wsRef.current && isConnected) {
            // Stop agent and remove after successful stop
            wsRef.current.emit('acp:stop', {
                agent_id: agentId,
            }, (response: any) => {
                if (response.success) {
                    removeAgentFromSessions(agentId, wasSelected);
                } else {
                    console.error('Failed to stop agent:', response.error);
                    // Remove anyway
                    removeAgentFromSessions(agentId, wasSelected);
                }
            });
        } else {
            // Agent is not active, just remove
            removeAgentFromSessions(agentId, wasSelected);
        }
    };

    const removeAgentFromSessions = (agentId: string, wasSelected: boolean) => {
        setAcpSessions(prev => {
            const newSessions = new Map(prev);
            const sessionToRemove = newSessions.get(agentId);
            newSessions.delete(agentId);
            
            // Decrement counter for base agent ID if needed
            if (sessionToRemove) {
                const baseAgentId = agentId.split('-')[0];
                const currentCounter = agentCounterRef.current.get(baseAgentId) || 0;
                if (currentCounter > 0) {
                    agentCounterRef.current.set(baseAgentId, currentCounter - 1);
                }
            }
            
            // If closed agent was selected, select another one or clear selection
            if (wasSelected) {
                const remainingSessions = Array.from(newSessions.values());
                if (remainingSessions.length > 0) {
                    setSelectedAgentId(remainingSessions[0].agentId);
                } else {
                    setSelectedAgentId(null);
                }
            }
            return newSessions;
        });
    };

    const closeAcpDialog = () => {
        setRightPanelVisible(false);
    };

    const reconnectToAcpAgents = () => {
        if (!wsRef.current || !isConnected) return;

        console.log('Reconnecting to ACP agents...');
        
        // Call backend reconnect handler to restore subscriptions
        wsRef.current.emit('acp:reconnect', {}, (response: any) => {
            if (response.success) {
                console.log('ACP reconnect successful, active agents:', response.agents);
                
                // Restore all active agents from backend
                const activeAgents = response.agents || [];
                setAcpSessions(prev => {
                    const newSessions = new Map(prev);
                    activeAgents.forEach((agent: any) => {
                        const existing = newSessions.get(agent.id);
                        if (existing) {
                            newSessions.set(agent.id, { ...existing, isActive: true });
                        } else {
                            newSessions.set(agent.id, {
                                agentId: agent.id,
                                agentName: agent.name,
                                messages: [],
                                isActive: true,
                            });
                        }
                        
                        // Update counter for base agent ID
                        const baseAgentId = agent.id.split('-')[0];
                        const match = agent.id.match(/-(\d+)$/);
                        if (match) {
                            const counter = parseInt(match[1], 10);
                            const currentCounter = agentCounterRef.current.get(baseAgentId) || 0;
                            agentCounterRef.current.set(baseAgentId, Math.max(currentCounter, counter));
                        } else {
                            // Base agent ID, ensure counter is at least 1
                            const currentCounter = agentCounterRef.current.get(baseAgentId) || 0;
                            if (currentCounter === 0) {
                                agentCounterRef.current.set(baseAgentId, 1);
                            }
                        }
                    });
                    // Mark non-active sessions as inactive
                    newSessions.forEach((session, agentId) => {
                        if (!activeAgents.find((a: any) => a.id === agentId)) {
                            newSessions.set(agentId, { ...session, isActive: false });
                        }
                    });
                    return newSessions;
                });
                // Select first agent if none selected
                if (!selectedAgentId && activeAgents.length > 0) {
                    setSelectedAgentId(activeAgents[0].id);
                }
            } else {
                console.error('ACP reconnect failed:', response.error);
            }
        });
    };

    const handleSearch = ({ id, pattern }: { id: string; pattern: string }) => {
        if (!pattern) return;
        // console.log(`Start searching: ${pattern}`);
        if (wsRef.current && isConnected) {
            wsRef.current.emit("search:start", { pattern });
            setSearchResults([]);
            setSearchEnded(false);
        }
    };

    const handleSearchResult = (message: SearchResult) => {
        // console.debug('search:result', message);
        setSearchResults((prevResults) => {
            const resultsMap = new Map(prevResults.map((result) => [result.file_path, result]));
            resultsMap.set(message.file_path, message); // Replace or add the new message
            return Array.from(resultsMap.values()); // Convert back to an array
        });
    };

    const handleSearchEnd = (result: SearchEnd) => {
        // console.debug("search:end ", result);
        setSearchEnded(true);
    };

    const handleSearchCancel = () => {
        console.log("Cancel search");
        if (wsRef.current && isConnected) {
            wsRef.current.emit("search:cancel");
            setSearchEnded(true);
        }
    };

    const handleSearchResultClick = (filePath: string, match: SearchMatch) => {
        console.log('Search result clicked:', filePath, match);
        
        // Check if file is already open
        const existingFile = files.find(f => f.id === filePath);
        
        if (existingFile) {
            // File is already open, just switch to it and set cursor position
            setActiveFileId(existingFile.id);
            const editor = editorRefs.current.get(existingFile.id);
            if (editor) {
                editor.requestFocus(match.line, match.column, true);
            } else {
                // Editor not ready yet, save position for later
                pendingPositions.current.set(existingFile.id, { line: match.line, column: match.column });
            }
        } else {
            // File is not open, open it first
            pendingPositions.current.set(filePath, { line: match.line, column: match.column });
            openFile(filePath);
        }
    };

    // Sync selectedAgentId with acpSessions
    useEffect(() => {
        if (selectedAgentId && !acpSessions.has(selectedAgentId)) {
            // Selected agent was removed, select another one or clear
            const remainingSessions = Array.from(acpSessions.values());
            if (remainingSessions.length > 0) {
                setSelectedAgentId(remainingSessions[0].agentId);
            } else {
                setSelectedAgentId(null);
            }
        } else if (!selectedAgentId && acpSessions.size > 0) {
            // No agent selected but there are sessions, select first one
            const firstSession = Array.from(acpSessions.values())[0];
            setSelectedAgentId(firstSession.agentId);
        }

    }, [acpSessions, selectedAgentId]);

    useEffect(() => {
        const file = files.find(f => f.id === activeFileId);
        if (file) {
            const node = findNodeByPath(fileTree, file.id);
            if (node && !node.isSelected) {
                selectNode(node.id);
            }
        }
    }, [fileTree])

    useEffect(() => { if (isConnected && wsRef.current) openFolder('.') }, [isConnected]);

    useEffect(() => { filesRef.current = files; }, [files]);
    useEffect(() => { acpSessionsRef.current = acpSessions; }, [acpSessions]);
    useEffect(() => { selectedAgentIdRef.current = selectedAgentId; }, [selectedAgentId]);
    useEffect(() => { followEnabledRef.current = followEnabled; }, [followEnabled]);
    
    useEffect(() => { saveItem('bottomPanelVisible', bottomPanelVisible) }, [bottomPanelVisible]);
    useEffect(() => { saveItem('leftPanelVisible', leftPanelVisible) }, [leftPanelVisible]);
    useEffect(() => { saveItem('rightPanelVisible', rightPanelVisible) }, [rightPanelVisible]);
    useEffect(() => { saveItem('centerPanelVisible', centerPanelVisible) }, [centerPanelVisible]);
    useEffect(() => { saveItem('terminalSelected', terminalSelected) }, [terminalSelected]);
    useEffect(() => { saveItem('diffEnabled', diffEnabled) }, [diffEnabled]);
    useEffect(() => { saveItem('followEnabled', followEnabled) }, [followEnabled]);
    useEffect(() => { saveItem('terminals', terminals) }, [terminals]);

    // Connect to backend on component mount
    useEffect(() => {
        connectToBackend();
        
        // Create a default file if no files exist
        if (files.length === 0) {
            setFiles([DEFAULT_FILE]);
            setActiveFileId(DEFAULT_FILE.id);
            const currentPos = { file: DEFAULT_FILE.id, cursor: { line: 0, column: 0 } };
            cursorHistory.current.undoStack.push(currentPos);
            savedFileContentsRef.current.set(DEFAULT_FILE.id, DEFAULT_FILE_CONTENT);
        }
        
        return () => {
            disconnectFromBackend();
        };
    }, []);

    // Layout components
    const fileTreePanel = (
        <div className="file-system-panel">
            <div className="file-system-content">
                {fileTree.length === 0 ? (
                    <p className="file-system-empty"> </p>
                ) : (
                    <div className="file-tree">
                        {fileTree.map(node => (
                            <TreeNodeComponent 
                                key={node.id} 
                                node={node} 
                                onToggle={toggleNode}
                                onSelect={selectNode}
                                onOpenFile={openFile}
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
                        onCancel={handleSearchCancel}
                        results={searchResults}
                        searchEnded={searchEnded}
                        onMatchClick={handleSearchResultClick}
                    />
                );
            case 'changes':
                return (
                    <ChangesPanel
                        files={changedFiles}
                        branch={gitBranch}
                        onFileClick={handleOpenChangedFile}
                        onRefresh={fetchGitStatus}
                        onCommit={handleGitCommit}
                        onPush={handleGitPush}
                        onPull={handleGitPull}
                        onRevert={handleGitRevert}
                    />
                );
            case 'files':
            default:
                return fileTreePanel;
        }
    })();

    const editorPanel = (
        <div className="editor-container">
            {activeFile && editorStates.has(activeFile.id) ? (
                <AnycodeEditorReact
                    key={activeFile.id}
                    id={activeFile.id}
                    editorState={editorStates.get(activeFile.id)!}
                />
            ) : (
                <div className="no-editor">
                </div>
            )}
        </div>
    );

    const handleSaveAgents = (agents: AcpAgent[], defaultAgentId: string | null) => {
        updateAgents(agents, defaultAgentId);
        setAgentsVersion(prev => prev + 1); // Force re-render
    };

    const toggleDiffMode = () => {
        const newDiffEnabled = !diffEnabled;
        setDiffEnabled(newDiffEnabled);
        // Update all open editors
        editorRefs.current.forEach((editor) => {
            editor.setDiffEnabled(newDiffEnabled);
        });
    };

    const toggleFollowMode = () => {
        setFollowEnabled(prev => !prev);
    };

    const acpPanel = (() => {
        const sessionsArray = Array.from(acpSessions.values());
        const currentSession = selectedAgentId ? acpSessions.get(selectedAgentId) : null;
        const defaultAgent = getDefaultAgent();
        
        return (
            <AcpDialog
                agents={sessionsArray}
                selectedAgentId={selectedAgentId}
                onSelectAgent={setSelectedAgentId}
                onCloseAgent={closeAgent}
                onAddAgent={() => startAgent(defaultAgent)}
                onOpenSettings={() => {
                    ensureDefaultAgents();
                    setIsAgentSettingsOpen(true);
                }}
                agentId={currentSession?.agentId || defaultAgent?.id || 'gemini'}
                isOpen={true}
                onClose={closeAcpDialog}
                onSendPrompt={sendPrompt}
                onCancelPrompt={cancelPrompt}
                onPermissionResponse={sendPermissionResponse}
                onUndoPrompt={undoPrompt}
                messages={currentSession?.messages || []}
                toolCalls={[]}
                isConnected={currentSession ? (currentSession.isActive && isConnected) : false}
                isProcessing={currentSession?.isProcessing || false}
                showSettings={isAgentSettingsOpen}
                settingsAgents={isAgentSettingsOpen ? getAllAgents() : []}
                settingsDefaultAgentId={isAgentSettingsOpen ? getDefaultAgentId() : null}
                onSaveSettings={handleSaveAgents}
                onCloseSettings={() => setIsAgentSettingsOpen(false)}
                diffEnabled={diffEnabled}
                onToggleDiff={toggleDiffMode}
                followEnabled={followEnabled}
                onToggleFollow={toggleFollowMode}
            />
        );
    })();


    const terminalTabsPanel = (
        <TerminalTabs
            terminals={terminals}
            terminalSelected={terminalSelected}
            onSelectTerminal={setTerminalSelected}
            onCloseTerminal={closeTerminal}
            onAddTerminal={addTerminal}
        />
    );

    const terminalContentPanel = (
        <div className="terminal-content">
            {terminals.map((term, index) => (
                <div
                    key={term.id}
                    className="terminal-container"
                    style={{
                        visibility: index === terminalSelected ? "visible" : "hidden",
                        opacity: index === terminalSelected ? 1 : 0,
                        pointerEvents: index === terminalSelected ? "auto" : "none",
                        height: '100%',
                        position: index === terminalSelected ? 'relative' : 'absolute',
                        width: '100%',
                        top: 0,
                        left: 0
                    }}
                >
                    <TerminalComponent
                        name={term.name}
                        onData={handleTerminalData}
                        onMessage={handleTerminalDataCallback}
                        onResize={handleTerminalResize}
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

    let leftPanelModeButtons;
    switch (leftPanelMode) {
        case 'files':
            leftPanelModeButtons = <>
                <button onClick={() => setLeftPanelMode('search')} className="toggle-mode-btn" title="Search"><Icons.Search /></button>
                <button onClick={() => { setLeftPanelMode('changes'); fetchGitStatus(); }} className="toggle-mode-btn" title="Changes"><Icons.Git /></button>
            </>;
            break;
        case 'search':
            leftPanelModeButtons = <>
                <button onClick={() => setLeftPanelMode('files')} className="toggle-mode-btn" title="Files"><Icons.Tree /></button>
                <button onClick={() => { setLeftPanelMode('changes'); fetchGitStatus(); }} className="toggle-mode-btn" title="Changes"><Icons.Git /></button>
            </>;
            break;
        case 'changes':
            leftPanelModeButtons = <>
                <button onClick={() => setLeftPanelMode('search')} className="toggle-mode-btn" title="Search"><Icons.Search /></button>
                <button onClick={() => setLeftPanelMode('files')} className="toggle-mode-btn" title="Files"><Icons.Tree /></button>
            </>;
            break;
    }

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
                {files.map(file => (
                    <div
                        key={file.id}
                        className={`tab ${activeFileId === file.id ? 'active' : ''}`}
                        onClick={() => openTab(file)}
                    >
                        <span className="tab-filename"> {file.name} </span>
                        <button className="tab-close-button" onClick={(e) => { e.stopPropagation(); closeTab(file); }}> × </button>
                    </div>
                ))}                    
            </div>
        </div>
    );

    return (
        <div className={`app-container ${bottomPanelVisible ? 'terminal-visible' : ''}`}>

            <div className="main-content" style={{ flex: 1, display: 'flex' }}>
                <Allotment vertical={true} defaultSizes={[70, 30]} separator={true} onVisibleChange={handleBottomPanelVisibleChange}>
                    <Allotment.Pane >
                        <Allotment vertical={false} defaultSizes={[20,80]} separator={false} onVisibleChange={handleLeftPanelVisibleChange}>
                            <Allotment.Pane snap visible={leftPanelVisible}>
                                {leftPanel}
                            </Allotment.Pane>
                            <Allotment.Pane snap>
                                <Allotment vertical={false} defaultSizes={[60,40]} separator={false} onVisibleChange={handleRightPanelVisibleChange}>
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

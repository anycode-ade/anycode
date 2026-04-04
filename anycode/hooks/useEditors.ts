import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { AnycodeEditor } from 'anycode-react';
import type { Change, Position } from '../../anycode-base/src/code';
import {
    type CursorHistory,
    type FileState,
    type PendingBatch,
    type WatcherEdits,
} from '../types';
import { BATCH_DELAY_MS, DEFAULT_FILE, DEFAULT_FILE_CONTENT } from '../constants';
import { getFileName, getLanguageFromFileName } from '../utils';
import {
    Completion,
    CompletionRequest,
    DefinitionRequest,
    DefinitionResponse,
    Diagnostic,
    DiagnosticResponse,
} from '../../anycode-base/src/lsp';

type UseEditorsParams = {
    wsRef: React.RefObject<Socket | null>;
    isConnected: boolean;
    diffEnabled: boolean;
    onFileClosed?: (fileId: string) => void;
};

export const useEditors = ({ wsRef, isConnected, diffEnabled, onFileClosed }: UseEditorsParams) => {
    const [files, setFiles] = useState<FileState[]>([]);
    const filesRef = useRef<FileState[]>([]);
    const [activeFileId, setActiveFileId] = useState<string | null>(null);
    const activeFileIdRef = useRef<string | null>(null);

    const [editorStates, setEditorStates] = useState<Map<string, AnycodeEditor>>(new Map());
    const editorStatesRef = useRef<Map<string, AnycodeEditor>>(new Map());
    const editorRefs = useRef<Map<string, AnycodeEditor>>(new Map());
    const defaultFileInitializedRef = useRef(false);

    const savedFileContentsRef = useRef<Map<string, string>>(new Map());
    const diagnosticsRef = useRef<Map<string, Diagnostic[]>>(new Map());
    const pendingPositions = useRef<Map<string, { line: number; column: number }>>(new Map());
    const cursorHistory = useRef<CursorHistory>({ undoStack: [], redoStack: [] });
    const pendingOpenFilesRef = useRef<Set<string>>(new Set());
    const pendingOriginalContentRef = useRef<Map<string, string>>(new Map());
    const pendingChangesRef = useRef<Map<string, PendingBatch>>(new Map());

    const activeFile = files.find((f) => f.id === activeFileId);

    useEffect(() => { filesRef.current = files; }, [files]);
    useEffect(() => { activeFileIdRef.current = activeFileId; }, [activeFileId]);
    useEffect(() => { editorStatesRef.current = editorStates; }, [editorStates]);

    const flushChanges = useCallback((filename: string) => {
        const batch = pendingChangesRef.current.get(filename);
        if (!batch || batch.changes.length === 0) return;

        const allEdits = batch.changes.flatMap((c) => c.edits);
        if (wsRef.current && isConnected) {
            wsRef.current.emit('file:change', {
                file: filename,
                edits: allEdits,
            });
        }

        batch.changes = [];
        batch.timerId = null;
    }, [wsRef, isConnected]);

    const handleChange = useCallback((filename: string, change: Change) => {
        if (change.isUndo || change.isRedo) {
            flushChanges(filename);
            if (wsRef.current && isConnected) {
                wsRef.current.emit('file:change', { file: filename, ...change });
            }
        } else {
            let batch = pendingChangesRef.current.get(filename);
            if (!batch) {
                batch = { changes: [], timerId: null };
                pendingChangesRef.current.set(filename, batch);
            }

            batch.changes.push(change);

            if (batch.timerId) {
                clearTimeout(batch.timerId);
            }

            batch.timerId = setTimeout(() => {
                flushChanges(filename);
            }, BATCH_DELAY_MS);
        }

        const file = filesRef.current.find((f) => f.id === filename);
        if (!file) return;

        const editor = editorRefs.current.get(file.id);
        if (!editor) return;

        const oldContent = savedFileContentsRef.current.get(file.id);
        if (!oldContent) return;

    }, [flushChanges, wsRef, isConnected]);

    const handleCursorChange = useCallback((filename: string, newCursor: Position, oldCursor: Position) => {
        if (newCursor.line === oldCursor.line && newCursor.column === oldCursor.column) return;

        cursorHistory.current.undoStack.push({ file: filename, cursor: oldCursor });
        cursorHistory.current.redoStack = [];
    }, []);

    const handleCompletion = useCallback((completionRequest: CompletionRequest): Promise<Completion[]> => {
        return new Promise((resolve, reject) => {
            wsRef.current?.emit('lsp:completion', completionRequest, (response: any) => {
                if (response.error) {
                    reject([]);
                    return;
                }
                resolve(response || []);
            });
        });
    }, [wsRef]);

    const openFile = useCallback((path: string, line?: number, column?: number) => {
        const existingFile = filesRef.current.find((file) => file.id === path);

        if (line !== undefined && column !== undefined) {
            pendingPositions.current.set(path, { line, column });
        }

        if (existingFile) {
            setActiveFileId(existingFile.id);
            const editor = editorRefs.current.get(existingFile.id);
            if (editor && line !== undefined && column !== undefined) {
                editor.requestFocus(line, column, true);
            }
            return;
        }

        if (pendingOpenFilesRef.current.has(path)) {
            return;
        }

        if (wsRef.current && isConnected) {
            pendingOpenFilesRef.current.add(path);
            wsRef.current.emit('file:open', { path }, (response: any) => {
                pendingOpenFilesRef.current.delete(path);
                if (response.success) {
                    const fileName = getFileName(path);
                    const language = getLanguageFromFileName(fileName);
                    savedFileContentsRef.current.set(path, response.content);
                    const newFile: FileState = { id: path, name: fileName, language, history: response.history };
                    setFiles((prev) => (prev.some((f) => f.id === path) ? prev : [...prev, newFile]));
                    setActiveFileId(newFile.id);
                }
            });
        }
    }, [wsRef, isConnected]);

    const handleGoToDefinition = useCallback((definitionRequest: DefinitionRequest): Promise<DefinitionResponse> => {
        return new Promise((resolve, reject) => {
            const currentActiveFileId = activeFileIdRef.current;
            if (currentActiveFileId) {
                const editor = editorRefs.current.get(currentActiveFileId);
                if (editor) {
                    const cursorPos = { file: currentActiveFileId, cursor: editor.getCursor() };
                    cursorHistory.current.undoStack.push(cursorPos);
                    cursorHistory.current.redoStack = [];
                }
            }

            if (!wsRef.current) {
                reject(new Error('WebSocket not connected'));
                return;
            }

            wsRef.current.emit('lsp:definition', definitionRequest, (response: any) => {
                if (response.error) {
                    reject(new Error(response.error));
                    return;
                }

                if (response && response.length > 0) {
                    const definition = response[0];
                    const uri = definition.uri;
                    const range = definition.range;
                    const line = range.start.line;
                    const column = range.start.character;
                    const filePath = uri.replace('file://', '');
                    const fileName = getFileName(filePath);

                    pendingPositions.current.set(filePath, { line, column });

                    const existingFile = filesRef.current.find((f) => f.id === filePath || f.name === fileName);
                    if (existingFile) {
                        setActiveFileId(existingFile.id);
                        const editor = editorRefs.current.get(existingFile.id);
                        if (editor) {
                            editor.requestFocus(line, column);
                        }
                    } else {
                        openFile(filePath);
                    }

                    resolve(definition);
                } else {
                    reject(new Error('No definition found'));
                }
            });
        });
    }, [wsRef, openFile]);

    const createEditor = useCallback(async (
        content: string,
        language: string,
        filename: string,
        initialPosition?: { line: number; column: number },
        errors?: { line: number; message: string }[],
        history?: { changes: Change[]; index: number },
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
    }, [diffEnabled, handleChange, handleCursorChange, handleCompletion, handleGoToDefinition]);

    const initializeEditors = useCallback(async () => {
        try {
            const newEditorStates = new Map<string, AnycodeEditor>();

            for (const file of filesRef.current) {
                if (!editorStatesRef.current.has(file.id)) {
                    const content = savedFileContentsRef.current.get(file.id);
                    if (content === undefined) continue;

                    const pendingPosition = pendingPositions.current.get(file.id);
                    const pendingDiagnostics = diagnosticsRef.current.get(file.id);
                    const errors = pendingDiagnostics
                        ? pendingDiagnostics.map((d) => ({ line: d.range.start.line, message: d.message }))
                        : undefined;

                    const editor = await createEditor(content, file.language, file.id, pendingPosition, errors, file.history);
                    newEditorStates.set(file.id, editor);
                    savedFileContentsRef.current.set(file.id, content);
                    editorRefs.current.set(file.id, editor);

                    if (pendingPosition) pendingPositions.current.delete(file.id);

                    const pendingDiff = pendingOriginalContentRef.current.get(file.id);
                    if (pendingDiff !== undefined) {
                        editor.setOriginalCode(pendingDiff);
                        editor.setDiffEnabled(true);
                        pendingOriginalContentRef.current.delete(file.id);
                    }
                } else {
                    const existing = editorStatesRef.current.get(file.id)!;
                    newEditorStates.set(file.id, existing);
                    editorRefs.current.set(file.id, existing);
                }
            }

            setEditorStates(newEditorStates);
            editorStatesRef.current = newEditorStates;
        } catch (error) {
            console.error('Error initializing editors:', error);
        }
    }, [createEditor]);

    useEffect(() => {
        if (files.length > 0) {
            initializeEditors();
        }
    }, [files, initializeEditors]);

    useEffect(() => {
        if (files.length === 0 && !defaultFileInitializedRef.current) {
            defaultFileInitializedRef.current = true;
            setFiles([DEFAULT_FILE]);
            setActiveFileId(DEFAULT_FILE.id);
            cursorHistory.current.undoStack.push({ file: DEFAULT_FILE.id, cursor: { line: 0, column: 0 } });
            savedFileContentsRef.current.set(DEFAULT_FILE.id, DEFAULT_FILE_CONTENT);
        }
    }, [files.length]);

    const closeFile = useCallback((fileId: string) => {
        flushChanges(fileId);

        if (wsRef.current && isConnected) {
            wsRef.current.emit('file:close', { file: fileId });
        }

        setFiles((prev) => {
            const newFiles = prev.filter((file) => file.id !== fileId);
            if (activeFileIdRef.current === fileId) {
                if (newFiles.length > 0) setActiveFileId(newFiles[0].id);
                else setActiveFileId(null);
            }
            return newFiles;
        });

        setEditorStates((prev) => {
            const newStates = new Map(prev);
            newStates.delete(fileId);
            return newStates;
        });

        editorRefs.current.delete(fileId);
        savedFileContentsRef.current.delete(fileId);
        onFileClosed?.(fileId);
    }, [flushChanges, wsRef, isConnected, onFileClosed]);

    const saveFile = useCallback((fileId: string) => {
        flushChanges(fileId);

        const editor = editorRefs.current.get(fileId);
        if (!editor) return;

        const content = editor.getText();
        const oldContent = savedFileContentsRef.current.get(fileId);
        const isChanged = oldContent !== content;

        if (!isChanged) return;

        if (wsRef.current && isConnected) {
            wsRef.current.emit('file:save', { path: fileId }, (response: any) => {
                if (response.success) {
                    savedFileContentsRef.current.set(fileId, content);
                } else {
                    console.error('Failed to save file:', response.error);
                }
            });
        }
    }, [flushChanges, wsRef, isConnected]);

    const handleDiagnostics = useCallback((diagnosticsResponse: DiagnosticResponse) => {
        const uri = diagnosticsResponse.uri || '';
        const diags = diagnosticsResponse.diagnostics || [];

        let targetFileId = '';
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

        const editorImmediate = editorRefs.current.get(targetFileId);
        if (editorImmediate) {
            const errorsImmediate = diags.map((d) => ({ line: d.range.start.line, message: d.message }));
            editorImmediate.setErrors(errorsImmediate);
        }
    }, []);

    const handleWatcherEdits = useCallback((watcherEdits: WatcherEdits) => {
        const { file, edits } = watcherEdits;
        const editor = editorRefs.current.get(file);
        if (!editor) return;

        editor.applyChange({ edits });
    }, []);

    const openChangedFileWithDiff = useCallback((path: string) => {
        openFile(path);

        if (wsRef.current && isConnected) {
            wsRef.current.emit('git:file-original', { path }, (response: any) => {
                if (!response.success) return;
                const content = response.content;
                pendingOriginalContentRef.current.set(path, content);

                const editor = editorRefs.current.get(path);
                if (editor) {
                    editor.setOriginalCode(content);
                    editor.setDiffEnabled(true);
                }
            });
        }
    }, [openFile, wsRef, isConnected]);

    const undoCursor = useCallback(() => {
        if (cursorHistory.current.undoStack.length === 0) return;

        const currentActiveFileId = activeFileIdRef.current;
        if (currentActiveFileId) {
            const editor = editorRefs.current.get(currentActiveFileId);
            if (editor) {
                cursorHistory.current.redoStack.push({ file: currentActiveFileId, cursor: editor.getCursor() });
            }
        }

        const prevPosition = cursorHistory.current.undoStack.pop();
        if (!prevPosition?.file) return;

        const { line, column } = prevPosition.cursor;
        openFile(prevPosition.file, line, column);
    }, [openFile]);

    const redoCursor = useCallback(() => {
        if (cursorHistory.current.redoStack.length === 0) return;

        const currentActiveFileId = activeFileIdRef.current;
        if (currentActiveFileId) {
            const editor = editorRefs.current.get(currentActiveFileId);
            if (editor) {
                cursorHistory.current.undoStack.push({ file: currentActiveFileId, cursor: editor.getCursor() });
            }
        }

        const nextPosition = cursorHistory.current.redoStack.pop();
        if (!nextPosition?.file) return;

        const { line, column } = nextPosition.cursor;
        openFile(nextPosition.file, line, column);
    }, [openFile]);

    const setDiffForAllEditors = useCallback((enabled: boolean) => {
        editorRefs.current.forEach((editor) => {
            editor.setDiffEnabled(enabled);
        });
    }, []);

    const flushAllPendingChanges = useCallback(() => {
        pendingChangesRef.current.forEach((batch, filename) => {
            if (batch.timerId) {
                clearTimeout(batch.timerId);
            }
            flushChanges(filename);
        });
        pendingChangesRef.current.clear();
    }, [flushChanges]);

    return {
        files,
        activeFile,
        activeFileId,
        setActiveFileId,
        editorStates,
        closeFile,
        saveFile,
        openFile,
        openChangedFileWithDiff,
        handleDiagnostics,
        handleWatcherEdits,
        undoCursor,
        redoCursor,
        setDiffForAllEditors,
        flushAllPendingChanges,
    };
};

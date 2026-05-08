import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { AnycodeEditor } from 'anycode-react';
import type { Change, Position } from '../../anycode-base/src/code';
import {
    type CursorHistory,
    type FileState,
    type PendingBatch,
    type ReferencesPeekItem,
    type ReferencesPeekPreview,
    type ReferencesPeekState,
    type WatcherEdits,
} from '../types';
import { BATCH_DELAY_MS } from '../constants';
import { getFileName, getLanguageFromFileName } from '../utils';
import { loadOpenFiles, saveOpenFiles } from '../storage';
import {
    Completion,
    CompletionRequest,
    DefinitionRequest,
    DefinitionResponse,
    Diagnostic,
    DiagnosticResponse,
    HoverRequest,
    type ReferencesRequest,
} from '../../anycode-base/src/lsp';

type UseEditorsParams = {
    wsRef: React.RefObject<Socket | null>;
    isConnected: boolean;
    diffEnabled: boolean;
    onFileClosed?: (fileId: string) => void;
};

type PendingExistingOpenRequest = {
    path: string;
    line?: number;
    column?: number;
    paneId: string;
};

const DEFAULT_EDITOR_PANE_ID = 'editor';
const persistedEditorState = loadOpenFiles();
const persistedPaneActiveFileIds = {
    [DEFAULT_EDITOR_PANE_ID]: persistedEditorState.activeFileId,
    ...persistedEditorState.paneActiveFileIds,
};

const hoverMarkedStringToText = (value: unknown): string => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
        const candidate = value as { value?: unknown; language?: unknown };
        if (typeof candidate.value === 'string') {
            return candidate.value;
        }
        if (typeof candidate.language === 'string') {
            return candidate.language;
        }
    }
    return '';
};

const normalizeHoverResponse = (response: any): string | null => {
    if (!response || response.error) return null;

    // Legacy shape used in parts of the codebase.
    if (typeof response.value === 'string') {
        return response.value;
    }

    const contents = response.contents;
    if (!contents) return null;

    if (typeof contents === 'string') {
        return contents;
    }

    if (Array.isArray(contents)) {
        const joined = contents
            .map(hoverMarkedStringToText)
            .filter(Boolean)
            .join('\n\n');
        return joined || null;
    }

    if (typeof contents === 'object') {
        const asText = hoverMarkedStringToText(contents);
        return asText || null;
    }

    return null;
};

const uriToFilePath = (uriOrPath: string): string => {
    if (!uriOrPath) return '';
    if (!uriOrPath.startsWith('file://')) {
        return uriOrPath;
    }

    const rawPath = uriOrPath.slice('file://'.length);
    try {
        return decodeURIComponent(rawPath);
    } catch {
        return rawPath;
    }
};

const createPreviewFromContent = (
    content: string,
    filePath: string,
    startLine: number,
    startColumn: number,
    endLine: number,
    endColumn: number,
): ReferencesPeekPreview => {
    const allLines = content.split('\n');

    return {
        filePath,
        lineStart: 0,
        focusLine: startLine,
        focusColumn: startColumn,
        focusEndLine: endLine,
        focusEndColumn: endColumn,
        lines: allLines,
    };
};

const getPersistedActiveFileId = (files: FileState[], activeFileId: string | null): string | null => {
    if (activeFileId && files.some((file) => file.id === activeFileId)) {
        return activeFileId;
    }
    return files[0]?.id ?? null;
};

export const useEditors = ({ wsRef, isConnected, diffEnabled, onFileClosed }: UseEditorsParams) => {
    const [files, setFiles] = useState<FileState[]>(() => persistedEditorState.files);
    const filesRef = useRef<FileState[]>(persistedEditorState.files);
    const [activeEditorPaneId, setActiveEditorPaneId] = useState<string>(DEFAULT_EDITOR_PANE_ID);
    const activeEditorPaneIdRef = useRef<string>(DEFAULT_EDITOR_PANE_ID);
    const [paneActiveFileIds, setPaneActiveFileIds] = useState<Record<string, string | null>>(() => persistedPaneActiveFileIds);
    const paneActiveFileIdsRef = useRef<Record<string, string | null>>(persistedPaneActiveFileIds);
    const activeFileId = paneActiveFileIds[activeEditorPaneId] ?? null;
    const activeFileIdRef = useRef<string | null>(persistedEditorState.activeFileId);

    const [editorStates, setEditorStates] = useState<Map<string, AnycodeEditor>>(new Map());
    const editorStatesRef = useRef<Map<string, AnycodeEditor>>(new Map());
    const editorRefs = useRef<Map<string, AnycodeEditor>>(new Map());

    const savedFileContentsRef = useRef<Map<string, string>>(new Map());
    const previewFileContentsRef = useRef<Map<string, string>>(new Map());
    const diagnosticsRef = useRef<Map<string, Diagnostic[]>>(new Map());
    const pendingPositions = useRef<Map<string, { line: number; column: number }>>(new Map());
    const cursor2FileRef = useRef(persistedEditorState.cursorByFileId);
    const cursorHistory = useRef<CursorHistory>({ undoStack: [], redoStack: [] });
    const pendingOpenFilesRef = useRef<Set<string>>(new Set());
    const pendingOriginalContentRef = useRef<Map<string, string>>(new Map());
    const pendingChangesRef = useRef<Map<string, PendingBatch>>(new Map());
    const ignoreChangeFilesRef = useRef<Set<string>>(new Set());
    const [referencesPeekByPane, setReferencesPeekByPane] = useState<Record<string, ReferencesPeekState | null>>({});
    const referencesPeekByPaneRef = useRef<Record<string, ReferencesPeekState | null>>({});
    const referencesPeekRequestTokenRef = useRef<number>(0);
    const [pendingExistingOpenRequest, setPendingExistingOpenRequest] = useState<PendingExistingOpenRequest | null>(null);
    const lastFocusedEditorPaneIdRef = useRef<string>(DEFAULT_EDITOR_PANE_ID);

    const activeFile = files.find((f) => f.id === activeFileId);
    const hasVisibleEditorPane = useCallback(() => (
        Object.keys(paneActiveFileIdsRef.current).some((id) => id !== DEFAULT_EDITOR_PANE_ID)
    ), []);

    // Choose the editor pane we should target for an open/select action.
    // The order is intentionally explicit so the UX stays predictable:
    // 1) an explicit paneId from the caller
    // 2) the visible pane that already owns the file, if the file is already open
    // 3) the last editor pane the user focused
    // 4) the only visible editor pane
    // 5) the default editor pane as a safe fallback
    const resolveTargetPaneId = useCallback((paneId?: string, fileId?: string) => {
        const paneEntries = Object.entries(paneActiveFileIdsRef.current);
        const paneIds = paneEntries.map(([id]) => id);
        const visiblePaneIds = paneIds.filter((id) => id !== DEFAULT_EDITOR_PANE_ID);
        const isKnownPane = (id: string) => Object.hasOwn(paneActiveFileIdsRef.current, id);

        if (paneId) {
            return paneId;
        }

        if (fileId) {
            for (const [candidatePaneId, activeFileIdForPane] of paneEntries) {
                if (
                    activeFileIdForPane === fileId
                    && (candidatePaneId !== DEFAULT_EDITOR_PANE_ID || visiblePaneIds.length === 0)
                ) {
                    return candidatePaneId;
                }
            }
        }

        const lastFocusedPaneId = lastFocusedEditorPaneIdRef.current;
        if (lastFocusedPaneId !== DEFAULT_EDITOR_PANE_ID && isKnownPane(lastFocusedPaneId)) {
            return lastFocusedPaneId;
        }

        if (visiblePaneIds.length === 1) {
            return visiblePaneIds[0];
        }

        return visiblePaneIds[0] ?? paneIds[0] ?? DEFAULT_EDITOR_PANE_ID;
    }, []);

    useEffect(() => { filesRef.current = files; }, [files]);
    useEffect(() => {
        saveOpenFiles({
            files,
            activeFileId: getPersistedActiveFileId(files, activeFileId),
            paneActiveFileIds,
            cursorByFileId: cursor2FileRef.current,
        });
    }, [activeFileId, files, paneActiveFileIds]);
    useEffect(() => { activeEditorPaneIdRef.current = activeEditorPaneId; }, [activeEditorPaneId]);
    useEffect(() => {
        if (activeEditorPaneId !== DEFAULT_EDITOR_PANE_ID) {
            lastFocusedEditorPaneIdRef.current = activeEditorPaneId;
        }
    }, [activeEditorPaneId]);
    useEffect(() => { paneActiveFileIdsRef.current = paneActiveFileIds; }, [paneActiveFileIds]);
    useEffect(() => { activeFileIdRef.current = activeFileId; }, [activeFileId]);
    useEffect(() => { editorStatesRef.current = editorStates; }, [editorStates]);
    useEffect(() => { referencesPeekByPaneRef.current = referencesPeekByPane; }, [referencesPeekByPane]);

    const getActiveFileIdForPane = useCallback((paneId: string): string | null => {
        return paneActiveFileIdsRef.current[paneId] ?? null;
    }, []);

    const getEditorState = useCallback((fileId: string): AnycodeEditor | null => {
        return editorRefs.current.get(fileId) ?? editorStatesRef.current.get(fileId) ?? null;
    }, []);

    const getActiveEditorSelectedText = useCallback((): string => {
        const paneId = activeEditorPaneIdRef.current;
        const fileId = getActiveFileIdForPane(paneId);
        if (!fileId) {
            return '';
        }

        const editor = getEditorState(fileId);
        if (!editor) {
            return '';
        }

        return editor.getSelectedText();
    }, [getActiveFileIdForPane, getEditorState]);

    const setActiveFileId = useCallback((fileId: string | null, paneId?: string) => {
        if (fileId && !paneId && !hasVisibleEditorPane()) {
            return;
        }

        const targetPaneId = resolveTargetPaneId(paneId, fileId ?? undefined);
        setActiveEditorPaneId(targetPaneId);
        setPaneActiveFileIds((prev) => {
            const next = { ...prev };

            if (fileId) {
                Object.keys(next).forEach((key) => {
                    if (key !== targetPaneId && next[key] === fileId) {
                        next[key] = null;
                    }
                });
            }

            next[targetPaneId] = fileId;
            return next;
        });
    }, [hasVisibleEditorPane, resolveTargetPaneId]);

    const registerEditorPane = useCallback((paneId: string) => {
        setPaneActiveFileIds((prev) => {
            if (Object.hasOwn(prev, paneId)) return prev;
            return {
                ...prev,
                [paneId]: persistedPaneActiveFileIds[paneId] ?? null,
            };
        });
    }, []);

    useLayoutEffect(() => {
        if (!pendingExistingOpenRequest) return;

        const { path, line, column, paneId } = pendingExistingOpenRequest;
        setPendingExistingOpenRequest(null);

        // Reattach the already-open file to the pane we resolved earlier.
        setActiveEditorPaneId(paneId);
        setActiveFileId(path, paneId);

        const editor = editorRefs.current.get(path);
        if (!editor) return;

        if (line !== undefined && column !== undefined) {
            editor.requestFocus(line, column, true);
        } else {
            editor.onAttach();
        }
    }, [pendingExistingOpenRequest, setActiveFileId]);

    const unregisterEditorPane = useCallback((paneId: string) => {
        setReferencesPeekByPane((prev) => {
            if (!Object.hasOwn(prev, paneId)) return prev;
            const next = { ...prev };
            delete next[paneId];
            return next;
        });

        setPaneActiveFileIds((prev) => {
            if (!Object.hasOwn(prev, paneId)) return prev;

            const next = { ...prev };
            delete next[paneId];

            const paneIds = Object.keys(next);
            if (paneIds.length === 0) {
                next[DEFAULT_EDITOR_PANE_ID] = activeFileIdRef.current ?? null;
            }

            if (activeEditorPaneIdRef.current === paneId) {
                const fallbackPaneId = Object.keys(next)[0] ?? DEFAULT_EDITOR_PANE_ID;
                setActiveEditorPaneId(fallbackPaneId);
            }

            return next;
        });
    }, []);

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
        if (ignoreChangeFilesRef.current.has(filename)) {
            return;
        }

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

        cursor2FileRef.current[filename] = { line: newCursor.line, column: newCursor.column };
        saveOpenFiles({
            files: filesRef.current,
            activeFileId: getPersistedActiveFileId(filesRef.current, activeFileIdRef.current),
            paneActiveFileIds: paneActiveFileIdsRef.current,
            cursorByFileId: cursor2FileRef.current,
        });

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

    const handleHover = useCallback((hoverRequest: HoverRequest): Promise<string | null> => {
        return new Promise((resolve) => {
            if (!wsRef.current) {
                resolve(null);
                return;
            }

            wsRef.current.emit('lsp:hover', hoverRequest, (response: any) => {
                resolve(normalizeHoverResponse(response));
            });
        });
    }, [wsRef]);

    const updateReferencesPeekForPane = useCallback((paneId: string, next: ReferencesPeekState | null) => {
        setReferencesPeekByPane((prev) => ({ ...prev, [paneId]: next }));
    }, []);

    const closeReferencesPeek = useCallback((paneId?: string) => {
        const targetPaneId = paneId ?? activeEditorPaneIdRef.current;
        if (!targetPaneId) return;
        referencesPeekRequestTokenRef.current += 1;
        previewFileContentsRef.current.clear();
        updateReferencesPeekForPane(targetPaneId, null);
    }, [updateReferencesPeekForPane]);

    const focusEditorInPane = useCallback((paneId: string) => {
        const fileId = getActiveFileIdForPane(paneId);
        if (!fileId) {
            return;
        }

        const editor = editorRefs.current.get(fileId);
        if (!editor) {
            return;
        }

        const cursor = editor.getCursor();
        setActiveEditorPaneId(paneId);
        editor.requestFocus(cursor.line, cursor.column);
    }, [getActiveFileIdForPane]);

    const getReferencesPeekForPane = useCallback((paneId: string): ReferencesPeekState | null => {
        return referencesPeekByPaneRef.current[paneId] ?? null;
    }, []);

    const resolveFileContentForPreview = useCallback(async (filePath: string): Promise<string | null> => {
        const editor = editorRefs.current.get(filePath);
        if (editor) {
            const content = editor.getText();
            previewFileContentsRef.current.set(filePath, content);
            return content;
        }

        const previewCachedContent = previewFileContentsRef.current.get(filePath);
        if (previewCachedContent !== undefined) {
            return previewCachedContent;
        }

        const savedContent = savedFileContentsRef.current.get(filePath);
        if (savedContent !== undefined) {
            previewFileContentsRef.current.set(filePath, savedContent);
            return savedContent;
        }

        if (!wsRef.current || !isConnected) {
            return null;
        }

        return new Promise((resolve) => {
            wsRef.current?.emit('file:open', { path: filePath }, (response: any) => {
                if (!response?.success || typeof response.content !== 'string') {
                    resolve(null);
                    return;
                }

                const content = response.content as string;
                previewFileContentsRef.current.set(filePath, content);
                const isOpenInEditor = filesRef.current.some((file) => file.id === filePath);

                if (!isOpenInEditor) {
                    wsRef.current?.emit('file:close', { file: filePath });
                }

                resolve(content);
            });
        });
    }, [wsRef, isConnected]);

    const loadReferencesPeekPreview = useCallback(async (
        paneId: string,
        itemIndex: number,
        requestToken: number,
        itemsOverride?: ReferencesPeekItem[],
    ) => {
        const sourceItems = itemsOverride ?? referencesPeekByPaneRef.current[paneId]?.items;
        if (!sourceItems || itemIndex < 0 || itemIndex >= sourceItems.length) {
            return;
        }

        const item = sourceItems[itemIndex];
        const filePath = uriToFilePath(item.uri || item.file);
        if (!filePath) {
            return;
        }

        const content = await resolveFileContentForPreview(filePath);
        if (!content) {
            return;
        }

        if (referencesPeekRequestTokenRef.current !== requestToken) {
            return;
        }

        const preview = createPreviewFromContent(
            content,
            filePath,
            item.range.start.line,
            item.range.start.character,
            item.range.end.line,
            item.range.end.character,
        );

        setReferencesPeekByPane((prev) => {
            const current = prev[paneId];
            if (!current) {
                return prev;
            }

            return {
                ...prev,
                [paneId]: {
                    ...current,
                    preview,
                },
            };
        });
    }, [resolveFileContentForPreview]);

    const setSelectedReferenceInPeek = useCallback((paneId: string, nextIndex: number) => {
        const current = referencesPeekByPaneRef.current[paneId];
        if (!current || current.items.length === 0) {
            return;
        }

        const boundedIndex = Math.max(0, Math.min(current.items.length - 1, nextIndex));
        if (boundedIndex === current.selectedIndex) {
            return;
        }

        const requestToken = ++referencesPeekRequestTokenRef.current;
        setReferencesPeekByPane((prev) => {
            const target = prev[paneId];
            if (!target) {
                return prev;
            }
            return {
                ...prev,
                [paneId]: {
                    ...target,
                    selectedIndex: boundedIndex,
                },
            };
        });

        loadReferencesPeekPreview(paneId, boundedIndex, requestToken).catch(() => {
            // Swallow preview load errors in lite mode.
        });
    }, [loadReferencesPeekPreview]);

    const openFile = useCallback((path: string, line?: number, column?: number, paneId?: string) => {
        if (!paneId && !hasVisibleEditorPane()) {
            return;
        }

        const existingFile = filesRef.current.find((file) => file.id === path);
        const targetPaneId = resolveTargetPaneId(paneId, existingFile?.id);
        console.log('[openFile]', { path, line, column });

        if (line !== undefined && column !== undefined) {
            pendingPositions.current.set(path, { line, column });
        }

        if (existingFile) {
            setPendingExistingOpenRequest({
                path: existingFile.id,
                line, column,
                paneId: targetPaneId,
            });

            if (savedFileContentsRef.current.has(existingFile.id)) {
                return;
            }
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
                    setFiles((prev) => {
                        const nextFile: FileState = { id: path, name: fileName, language, history: response.history };
                        return prev.some((file) => file.id === path)
                            ? prev.map((file) => (file.id === path ? { ...file, history: response.history ?? file.history } : file))
                            : [...prev, nextFile];
                    });
                    setActiveEditorPaneId(targetPaneId);
                    setActiveFileId(path, targetPaneId);
                }
            });
        }
    }, [hasVisibleEditorPane, isConnected, resolveTargetPaneId, setActiveFileId, wsRef]);

    const openReferenceFromPeek = useCallback((paneId: string, itemIndex?: number): boolean => {
        const peek = referencesPeekByPaneRef.current[paneId];
        if (!peek || peek.items.length === 0) {
            return false;
        }

        const index = itemIndex ?? peek.selectedIndex;
        const item = peek.items[index];
        if (!item) {
            return false;
        }

        const filePath = uriToFilePath(item.uri || item.file);
        if (!filePath) {
            return false;
        }

        openFile(filePath, item.range.start.line, item.range.start.character, paneId);
        return true;
    }, [openFile]);

    const openReferencesPeekForActiveCursor = useCallback(() => {
        const paneId = activeEditorPaneIdRef.current || DEFAULT_EDITOR_PANE_ID;
        const fileId = getActiveFileIdForPane(paneId);
        if (!fileId) {
            return;
        }

        const editor = editorRefs.current.get(fileId);
        if (!editor) {
            return;
        }

        const cursor = editor.getCursor();
        void openReferencesPeek({
            file: fileId,
            row: cursor.line,
            column: cursor.column,
        }, paneId);
    }, [getActiveFileIdForPane]);

    const openReferencesPeek = useCallback(async (request: ReferencesRequest, paneId?: string): Promise<void> => {
        const targetPaneId = paneId ?? activeEditorPaneIdRef.current ?? DEFAULT_EDITOR_PANE_ID;
        if (!wsRef.current || !isConnected) {
            return;
        }

        const requestToken = ++referencesPeekRequestTokenRef.current;
        updateReferencesPeekForPane(targetPaneId, {
            paneId: targetPaneId,
            loading: true,
            error: null,
            items: [],
            selectedIndex: 0,
            preview: null,
        });

        wsRef.current.emit('lsp:references', request, (response: any) => {
            if (referencesPeekRequestTokenRef.current !== requestToken) {
                return;
            }

            if (!response || response.error) {
                updateReferencesPeekForPane(targetPaneId, {
                    paneId: targetPaneId,
                    loading: false,
                    error: typeof response?.error === 'string' ? response.error : 'Failed to load references',
                    items: [],
                    selectedIndex: 0,
                    preview: null,
                });
                return;
            }

            const itemsRaw: unknown[] = Array.isArray(response.items) ? response.items : [];
            const items = itemsRaw
                .map((item): ReferencesPeekItem => item as ReferencesPeekItem)
                .filter((item: ReferencesPeekItem) => item?.range?.start && item?.range?.end)
                .sort((a: ReferencesPeekItem, b: ReferencesPeekItem) => {
                    const leftPath = uriToFilePath(a.uri || a.file);
                    const rightPath = uriToFilePath(b.uri || b.file);

                    if (leftPath !== rightPath) {
                        return leftPath.localeCompare(rightPath);
                    }
                    if (a.range.start.line !== b.range.start.line) {
                        return a.range.start.line - b.range.start.line;
                    }
                    return a.range.start.character - b.range.start.character;
                });

            const dedupedItems = items.filter((item: ReferencesPeekItem, index: number, arr: ReferencesPeekItem[]) => {
                if (index === 0) return true;
                const prev = arr[index - 1];
                return !(
                    uriToFilePath(prev.uri || prev.file) === uriToFilePath(item.uri || item.file)
                    && prev.range.start.line === item.range.start.line
                    && prev.range.start.character === item.range.start.character
                    && prev.range.end.line === item.range.end.line
                    && prev.range.end.character === item.range.end.character
                );
            });

            updateReferencesPeekForPane(targetPaneId, {
                paneId: targetPaneId,
                loading: false,
                error: null,
                items: dedupedItems,
                selectedIndex: 0,
                preview: null,
            });

            if (dedupedItems.length > 0) {
                loadReferencesPeekPreview(targetPaneId, 0, requestToken, dedupedItems).catch(() => {
                    // Swallow preview load errors in lite mode.
                });
            }
        });
    }, [
        isConnected,
        loadReferencesPeekPreview,
        updateReferencesPeekForPane,
        wsRef,
    ]);

    const handleReferencesPeekKeyDown = useCallback((paneId: string, event: KeyboardEvent) => {
        const peek = referencesPeekByPaneRef.current[paneId];
        if (!peek) return false;

        if (event.key === 'Escape') {
            event.preventDefault();
            closeReferencesPeek(paneId);
            focusEditorInPane(paneId);
            return true;
        }

        if (event.key === 'Enter') {
            event.preventDefault();
            const opened = openReferenceFromPeek(paneId);
            if (opened) {
                closeReferencesPeek(paneId);
            }
            return true;
        }

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setSelectedReferenceInPeek(paneId, peek.selectedIndex + 1);
            return true;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            setSelectedReferenceInPeek(paneId, peek.selectedIndex - 1);
            return true;
        }

        return false;
    }, [closeReferencesPeek, focusEditorInPane, openReferenceFromPeek, setSelectedReferenceInPeek]);

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
        editor.setHoverProvider(handleHover);
        editor.setGoToDefinitionProvider(handleGoToDefinition);
        editor.setReferencesPeekProvider(openReferencesPeek);
        editor.setErrors(errors || []);

        return editor;
    }, [diffEnabled, handleChange, handleCursorChange, handleCompletion, handleGoToDefinition, handleHover, openReferencesPeek]);

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
        if (!wsRef.current || !isConnected || filesRef.current.length === 0) {
            return;
        }

        Object.entries(paneActiveFileIdsRef.current).forEach(([paneId, fileId]) => {
            const shouldRestore = fileId
                && !savedFileContentsRef.current.has(fileId)
                && !pendingOpenFilesRef.current.has(fileId);

            if (shouldRestore) {
                const cursor = cursor2FileRef.current[fileId];
                openFile(fileId, cursor?.line, cursor?.column, paneId);
            }
        });
    }, [isConnected, openFile, paneActiveFileIds, wsRef]);

    const closeFile = useCallback((fileId: string) => {
        flushChanges(fileId);

        if (wsRef.current && isConnected) {
            wsRef.current.emit('file:close', { file: fileId });
        }

        setFiles((prev) => {
            const closedFileIndex = prev.findIndex((file) => file.id === fileId);
            const newFiles = prev.filter((file) => file.id !== fileId);
            const fallbackFileId = closedFileIndex > 0
                ? prev[closedFileIndex - 1]?.id ?? null
                : newFiles[0]?.id ?? null;
            setPaneActiveFileIds((prevPaneFiles) => {
                const nextPaneFiles: Record<string, string | null> = {};
                Object.entries(prevPaneFiles).forEach(([paneId, activePaneFileId]) => {
                    nextPaneFiles[paneId] = activePaneFileId === fileId ? fallbackFileId : activePaneFileId;
                });
                return nextPaneFiles;
            });
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

        ignoreChangeFilesRef.current.add(file);

        try {
            editor.applyChange({ edits });
        } finally {
            ignoreChangeFilesRef.current.delete(file);
        }
    }, []);

    const openFileDiff = useCallback((path: string, line?: number, column?: number, paneId?: string) => {
        openFile(path, line, column, paneId);

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
        activeEditorPaneId,
        getActiveFileIdForPane,
        getActiveEditorSelectedText,
        getEditorState,
        setActiveFileId,
        setActiveEditorPaneId,
        registerEditorPane,
        unregisterEditorPane,
        editorStates,
        closeFile,
        saveFile,
        openFile,
        openFileDiff,
        referencesPeekByPane,
        getReferencesPeekForPane,
        openReferencesPeekForActiveCursor,
        openReferencesPeek,
        closeReferencesPeek,
        focusEditorInPane,
        setSelectedReferenceInPeek,
        openReferenceFromPeek,
        handleReferencesPeekKeyDown,
        handleDiagnostics,
        handleWatcherEdits,
        undoCursor,
        redoCursor,
        setDiffForAllEditors,
        flushAllPendingChanges,
    };
};

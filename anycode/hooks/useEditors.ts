import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { AnycodeEditor } from 'anycode-react';
import type { Change, Position } from '../../anycode-base/src/code';
import {
    type CursorHistory,
    type FileState,
    type PendingBatch,
    type ReferencesPeekItem,
    type ReferencesPeekState,
    type WatcherEdits,
} from '../types';
import { BATCH_DELAY_MS } from '../constants';
import { getFileName, getLanguageFromFileName } from '../utils';
import { loadItem, loadOpenFiles, saveItem, saveOpenFiles } from '../storage';
import type { DiffMode } from '../types/diffMode';
import { DEFAULT_DIFF_VIEW_MODE, getNextDiffMode } from '../types/diffMode';
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
    onFileClosed?: (fileId: string) => void;
};

type History = { changes: Change[]; index: number; };

export type EditorSelectionRange = {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
};

type EditorOpenRequest = {
    path: string;
    paneId: string;
    content: string;
    originalContent: string;
    mode: DiffMode;
    line?: number;
    column?: number;
    selection?: EditorSelectionRange;
    history?: History;
};

type OpenFilesOptions = {
    paneId?: string;
    diffMode?: DiffMode;
    keepPreviousEditor?: boolean;
    activate?: boolean;
};

const DEFAULT_EDITOR_PANE_ID = 'editor';
const createGitFileId = (revision: string, path: string): string => (
    `git:${encodeURIComponent(revision)}:${encodeURIComponent(path)}`
);
export const getHistoricalFileId = createGitFileId;
const persistedEditorState = loadOpenFiles();
const persistedPaneActiveFileIds: Record<string, string | null> = {
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


const getPersistedActiveFileId = (files: FileState[], activeFileId: string | null): string | null => {
    if (activeFileId && files.some((file) => file.id === activeFileId)) {
        return activeFileId;
    }
    return files[0]?.id ?? null;
};

export const useEditors = ({ wsRef, isConnected, onFileClosed }: UseEditorsParams) => {
    const [files, setFiles] = useState<FileState[]>(() => persistedEditorState.files);
    const filesRef = useRef<FileState[]>(persistedEditorState.files);
    const isHistoricalFileId = useCallback((fileId: string): boolean => (
        filesRef.current.find((file) => file.id === fileId)?.source?.type === 'git'
    ), []);
    const [activeEditorPaneId, setActiveEditorPaneId] = useState<string>(DEFAULT_EDITOR_PANE_ID);
    const activeEditorPaneIdRef = useRef<string>(DEFAULT_EDITOR_PANE_ID);
    const activateEditorPane = useCallback((paneId: string) => {
        if (activeEditorPaneIdRef.current === paneId) return;
        activeEditorPaneIdRef.current = paneId;
        setActiveEditorPaneId(paneId);
    }, []);
    const [paneActiveFileIds, setPaneActiveFileIds] = useState<Record<string, string | null>>(() => persistedPaneActiveFileIds);
    const paneActiveFileIdsRef = useRef<Record<string, string | null>>(persistedPaneActiveFileIds);
    const registeredPaneIdsRef = useRef<Set<string>>(new Set([DEFAULT_EDITOR_PANE_ID]));
    const activeFileId = paneActiveFileIds[activeEditorPaneId] ?? null;
    const activeFileIdRef = useRef<string | null>(persistedEditorState.activeFileId);

    const [editorStates, setEditorStates] = useState<Map<string, AnycodeEditor>>(new Map());
    const editorStatesRef = useRef<Map<string, AnycodeEditor>>(new Map());
    const editorRefs = useRef<Map<string, AnycodeEditor>>(new Map());
    const initializingEditorsRef = useRef<Map<string, Promise<AnycodeEditor>>>(new Map());
    const [keepPreviousEditorByPane, setKeepPreviousEditorByPane] = useState<Record<string, boolean>>({});

    const savedFileContentsRef = useRef<Map<string, string>>(new Map());
    const previewFileContentsRef = useRef<Map<string, string>>(new Map());
    const diagnosticsRef = useRef<Map<string, Diagnostic[]>>(new Map());
    const cursor2FileRef = useRef(persistedEditorState.cursorByFileId);
    const cursorHistory = useRef<CursorHistory>({ undoStack: [], redoStack: [] });
    const pendingOpenFilesRef = useRef<Set<string>>(new Set());
    const editorOpenRequestsRef = useRef<Map<string, EditorOpenRequest>>(new Map());
    const pendingChangesRef = useRef<Map<string, PendingBatch>>(new Map());
    const ignoreChangeFilesRef = useRef<Set<string>>(new Set());
    const [referencesPeekByPane, setReferencesPeekByPane] = useState<Record<string, ReferencesPeekState | null>>({});
    const referencesPeekByPaneRef = useRef<Record<string, ReferencesPeekState | null>>({});
    const referencesPeekRequestTokenRef = useRef<number>(0);
    const lastFocusedEditorPaneIdRef = useRef<string>(DEFAULT_EDITOR_PANE_ID);
    const [editorDiffModeByPane, setEditorDiffModeByPane] = useState<Record<string, DiffMode>>(
        () => loadItem<Record<string, DiffMode>>('editorDiffModeByPane') ?? {},
    );
    const lastAppliedDiffStateRef = useRef<string | null>(null);

    const activeFile = files.find((f) => f.id === activeFileId);
    const hasVisibleEditorPane = useCallback(() => (
        Array.from(registeredPaneIdsRef.current).some((id) => id !== DEFAULT_EDITOR_PANE_ID)
    ), []);

    // Choose the editor pane we should target for an open/select action.
    // The order is intentionally explicit so the UX stays predictable:
    // 1) an explicit paneId from the caller
    // 2) the visible pane that already owns the file, if the file is already open
    // 3) the last editor pane the user focused
    // 4) the only visible editor pane
    // 5) the default editor pane as a safe fallback
    const resolveTargetPaneId = useCallback((paneId?: string, fileId?: string) => {
        const registeredPaneIds = registeredPaneIdsRef.current;
        const paneEntries = Object.entries(paneActiveFileIdsRef.current)
            .filter(([id]) => registeredPaneIds.has(id));
        const paneIds = paneEntries.map(([id]) => id);
        const visiblePaneIds = paneIds.filter((id) => id !== DEFAULT_EDITOR_PANE_ID);
        const isKnownPane = (id: string) => registeredPaneIds.has(id);

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
        const persistedFiles = files.filter((file) => file.source?.type !== 'git');
        const persistedPaneActiveFileIds = Object.fromEntries(
            Object.entries(paneActiveFileIds).map(([paneId, fileId]) => [
                paneId,
                fileId && isHistoricalFileId(fileId) ? null : fileId,
            ]),
        );
        saveOpenFiles({
            files: persistedFiles,
            activeFileId: activeFileId && isHistoricalFileId(activeFileId)
                ? null
                : getPersistedActiveFileId(persistedFiles, activeFileId),
            paneActiveFileIds: persistedPaneActiveFileIds,
            cursorByFileId: cursor2FileRef.current,
        });
    }, [activeFileId, files, isHistoricalFileId, paneActiveFileIds]);
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
    useEffect(() => { saveItem('editorDiffModeByPane', editorDiffModeByPane); }, [editorDiffModeByPane]);

    const getActiveFileIdForPane = useCallback((paneId: string): string | null => {
        return paneActiveFileIds[paneId] ?? null;
    }, [paneActiveFileIds]);

    const getPaneIdsForFile = useCallback((fileId: string): string[] => {
        return Object.entries(paneActiveFileIdsRef.current)
            .filter(([, activeFileId]) => activeFileId === fileId)
            .map(([paneId]) => paneId);
    }, []);

    const getEditorState = useCallback((fileId: string): AnycodeEditor | null => {
        return editorRefs.current.get(fileId) ?? editorStatesRef.current.get(fileId) ?? null;
    }, []);

    const getActiveEditorSelectedText = useCallback((): string => {
        const paneId = activeEditorPaneIdRef.current;
        const fileId = getActiveFileIdForPane(paneId);
        if (!fileId || isHistoricalFileId(fileId)) {
            return '';
        }

        const editor = getEditorState(fileId);
        if (!editor) {
            return '';
        }

        return editor.getSelectedText();
    }, [getActiveFileIdForPane, getEditorState, isHistoricalFileId]);

    const setActiveFileId = useCallback((fileId: string | null, paneId?: string) => {
        if (fileId && !paneId && !hasVisibleEditorPane()) {
            return;
        }

        const targetPaneId = resolveTargetPaneId(paneId, fileId ?? undefined);
        activateEditorPane(targetPaneId);
        setPaneActiveFileIds((prev) => {
            const next = { ...prev };
            let changed = false;

            if (fileId) {
                Object.keys(next).forEach((key) => {
                    if (key !== targetPaneId && next[key] === fileId) {
                        next[key] = null;
                        changed = true;
                    }
                });
            }

            if (next[targetPaneId] !== fileId) {
                next[targetPaneId] = fileId;
                changed = true;
            }

            return changed ? next : prev;
        });
    }, [activateEditorPane, hasVisibleEditorPane, resolveTargetPaneId]);

    const registerEditorPane = useCallback((paneId: string) => {
        registeredPaneIdsRef.current.add(paneId);
        setPaneActiveFileIds((prev) => {
            if (Object.hasOwn(prev, paneId)) return prev;
            return {
                ...prev,
                [paneId]: persistedPaneActiveFileIds[paneId] ?? null,
            };
        });
    }, []);

    const unregisterEditorPane = useCallback((paneId: string) => {
        registeredPaneIdsRef.current.delete(paneId);
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
                activateEditorPane(fallbackPaneId);
            }

            return next;
        });
    }, [activateEditorPane]);

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
        if (isHistoricalFileId(filename)) return;
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

    }, [flushChanges, isHistoricalFileId, wsRef, isConnected]);

    const handleCursorChange = useCallback((filename: string, newCursor: Position, oldCursor: Position) => {
        if (newCursor.line === oldCursor.line && newCursor.column === oldCursor.column) return;

        cursor2FileRef.current[filename] = { line: newCursor.line, column: newCursor.column };
        const persistedFiles = filesRef.current.filter((file) => file.source?.type !== 'git');
        const persistedPaneActiveFileIds = Object.fromEntries(
            Object.entries(paneActiveFileIdsRef.current).map(([paneId, fileId]) => [
                paneId,
                fileId && isHistoricalFileId(fileId) ? null : fileId,
            ]),
        );
        saveOpenFiles({
            files: persistedFiles,
            activeFileId: activeFileIdRef.current && isHistoricalFileId(activeFileIdRef.current)
                ? null
                : getPersistedActiveFileId(persistedFiles, activeFileIdRef.current),
            paneActiveFileIds: persistedPaneActiveFileIds,
            cursorByFileId: cursor2FileRef.current,
        });

        cursorHistory.current.undoStack.push({ file: filename, cursor: oldCursor });
        cursorHistory.current.redoStack = [];
    }, [isHistoricalFileId]);

    const handleCompletion = useCallback((completionRequest: CompletionRequest): Promise<Completion[]> => {
        return new Promise((resolve, reject) => {
            wsRef.current?.emit('lsp:completion', completionRequest, (response: any) => {
                if (response?.error) {
                    reject([]);
                    return;
                }
                const list = Array.isArray(response)
                    ? response
                    : (Array.isArray(response?.items) ? response.items : (Array.isArray(response?.completions) ? response.completions : []));
                resolve(list);
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
        activateEditorPane(paneId);
        const fileId = getActiveFileIdForPane(paneId);
        if (!fileId) return;
        const editor = editorRefs.current.get(fileId);
        if (!editor) return;
        const cursor = editor.getCursor();
        editor.requestFocus(cursor.line, cursor.column);
    }, [activateEditorPane, getActiveFileIdForPane]);

    const getReferencesPeekForPane = useCallback((paneId: string): ReferencesPeekState | null => {
        return referencesPeekByPaneRef.current[paneId] ?? null;
    }, []);

    const getFileContentForPreviewSync = useCallback((filePath: string): string | null => {
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

        return null;
    }, []);

    const resolveFileContentForPreview = useCallback(async (filePath: string): Promise<string | null> => {
        const syncContent = getFileContentForPreviewSync(filePath);
        if (syncContent !== null) {
            return syncContent;
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
    }, [getFileContentForPreviewSync, wsRef, isConnected]);

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

        setReferencesPeekByPane((prev) => {
            const current = prev[paneId];
            if (!current) {
                return prev;
            }

            return {
                ...prev,
                [paneId]: {
                    ...current,
                    preview: content,
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
        const item = current.items[boundedIndex];
        const filePath = uriToFilePath(item.uri || item.file);
        const syncContent = filePath ? getFileContentForPreviewSync(filePath) : null;

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
                    preview: syncContent,
                },
            };
        });

        if (syncContent === null) {
            loadReferencesPeekPreview(paneId, boundedIndex, requestToken).catch(() => {
                // Swallow preview load errors in lite mode.
            });
        }
    }, [loadReferencesPeekPreview, getFileContentForPreviewSync]);

    const applyEditorOpenRequest = useCallback((path: string, editorArg?: AnycodeEditor) => {
        const request = editorOpenRequestsRef.current.get(path);
        if (!request) return;

        const editor = editorArg ?? editorRefs.current.get(path);
        if (!editor) return;

        if (request.mode !== 'plain') {
            editor.setOriginalCode(request.originalContent);
        } else {
            editor.setOriginalText(request.originalContent);
        }
        editor.setDiffMode(request.mode);

        if (request.selection) {
            const { startLine, startColumn, endLine, endColumn } = request.selection;
            editor.requestFocus(startLine, startColumn, true);
            editor.setSelectionRange(startLine, startColumn, endLine, endColumn, true);
        } else if (request.line !== undefined && request.column !== undefined) {
            editor.requestFocus(request.line, request.column, true);
        } else {
            // const cursor = editor.getCursor();
            // editor.requestFocus(cursor.line, cursor.column, true);
        }
    }, []);

    const getEditorDiffMode = useCallback((paneId: string): DiffMode => {
        return editorDiffModeByPane[paneId] ?? DEFAULT_DIFF_VIEW_MODE;
    }, [editorDiffModeByPane]);

    const applyDiffModeToPaneEditor = useCallback((paneId: string, mode: DiffMode): boolean => {
        const fileId = paneActiveFileIdsRef.current[paneId];
        if (!fileId) return false;

        const editor = editorRefs.current.get(fileId);
        if (!editor) return false;

        editor.setDiffMode(mode);
        return true;
    }, []);

    const setEditorDiffMode = useCallback((paneId: string, mode: DiffMode): boolean => {
        if (!applyDiffModeToPaneEditor(paneId, mode)) {
            return false;
        }
        setEditorDiffModeByPane((prev) => ({ ...prev, [paneId]: mode }));
        return true;
    }, [applyDiffModeToPaneEditor]);

    const cycleEditorDiffMode = useCallback((paneId: string): boolean => {
        const nextMode = getNextDiffMode(getEditorDiffMode(paneId));
        return setEditorDiffMode(paneId, nextMode);
    }, [getEditorDiffMode, setEditorDiffMode]);

    const openFile = useCallback((
        path: string,
        line?: number,
        column?: number,
        paneId?: string,
        diffMode?: DiffMode,
        keepPreviousEditor = true,
        activate = true,
        onComplete?: () => void,
        selection?: EditorSelectionRange,
    ) => {
        if (!paneId && !hasVisibleEditorPane()) {
            onComplete?.();
            return;
        }

        const existingFile = filesRef.current.find((file) => file.id === path);
        const targetPaneId = resolveTargetPaneId(paneId, existingFile?.id);
        const mode = diffMode ?? getEditorDiffMode(targetPaneId);
        setKeepPreviousEditorByPane((prev) => (
            prev[targetPaneId] === keepPreviousEditor
                ? prev
                : { ...prev, [targetPaneId]: keepPreviousEditor }
        ));

        if (existingFile) {
            const editor = editorRefs.current.get(existingFile.id);
            if (editor && savedFileContentsRef.current.has(existingFile.id)) {
                const content = savedFileContentsRef.current.get(existingFile.id) ?? '';
                const existingRequest = editorOpenRequestsRef.current.get(path);
                editorOpenRequestsRef.current.set(path, {
                    path,
                    paneId: targetPaneId,
                    content,
                    originalContent: existingRequest?.originalContent ?? '',
                    mode,
                    line,
                    column,
                    selection,
                    history: existingFile.history,
                });
                if (activate) {
                    activateEditorPane(targetPaneId);
                    setActiveFileId(existingFile.id, targetPaneId);
                }
                applyEditorOpenRequest(path, editor);
                onComplete?.();
                return;
            }
        }

        if (pendingOpenFilesRef.current.has(path)) {
            onComplete?.();
            return;
        }

        if (!wsRef.current || !isConnected) {
            onComplete?.();
            return;
        }

        const oldActiveFileId = activeFileIdRef.current;
        pendingOpenFilesRef.current.add(path);
        if (activate) {
            setActiveFileId(path, targetPaneId);
        }

        wsRef.current.emit('file:open', { path }, (response: any) => {
            pendingOpenFilesRef.current.delete(path);
            if (response.success) {
                const fileName = getFileName(path);
                const language = getLanguageFromFileName(fileName);
                savedFileContentsRef.current.set(path, response.content);
                const originalContent = typeof response?.original?.content === 'string'
                    ? response.original.content
                    : '';
                editorOpenRequestsRef.current.set(path, {
                    path,
                    paneId: targetPaneId,
                    content: response.content,
                    originalContent,
                    mode,
                    line,
                    column,
                    selection,
                    history: response.history,
                });
                setFiles((prev) => {
                    const nextFile: FileState = {
                        id: path,
                        name: fileName,
                        language,
                        source: { type: 'filesystem', path },
                        history: response.history,
                    };
                    return prev.some((file) => file.id === path)
                        ? prev.map((file) => (file.id === path ? { ...file, history: response.history ?? file.history } : file))
                        : [...prev, nextFile];
                });
                if (activate) {
                    activateEditorPane(targetPaneId);
                    setActiveFileId(path, targetPaneId);
                }
                const existingEditor = editorRefs.current.get(path);
                if (existingEditor) {
                    applyEditorOpenRequest(path, existingEditor);
                }
            } else if (activate) {
                setActiveFileId(oldActiveFileId, targetPaneId);
            }
            onComplete?.();
        });
    }, [activateEditorPane, applyEditorOpenRequest, getEditorDiffMode, hasVisibleEditorPane, isConnected, resolveTargetPaneId, setActiveFileId, wsRef]);

    const openFiles = useCallback((paths: string[], options: OpenFilesOptions = {}) => {
        const {
            paneId,
            diffMode,
            keepPreviousEditor = true,
            activate = false,
        } = options;
        const lastPathIndex = paths.length - 1;

        const openNext = (index: number) => {
            if (index >= paths.length) return;
            openFile(
                paths[index],
                undefined,
                undefined,
                paneId,
                diffMode,
                keepPreviousEditor,
                activate && index === lastPathIndex,
                () => setTimeout(() => openNext(index + 1), 0),
            );
        };

        openNext(0);
    }, [openFile]);

    const openHistoricalDiff = useCallback((
        hash: string,
        path: string,
        originalContent: string,
        content: string,
        paneId?: string,
        activate = true,
    ) => {
        if (!paneId && !hasVisibleEditorPane()) return;
        const fileId = createGitFileId(hash, path);
        const existingFile = filesRef.current.find((file) => file.id === fileId);
        const targetPaneId = resolveTargetPaneId(paneId, existingFile?.id);
        const fileName = getFileName(path);
        savedFileContentsRef.current.set(fileId, content);
        editorOpenRequestsRef.current.set(fileId, {
            path: fileId,
            paneId: targetPaneId,
            content,
            originalContent,
            mode: 'diff',
        });
        setFiles((prev) => prev.some((file) => file.id === fileId)
            ? prev
            : [...prev, {
                id: fileId,
                name: `${fileName} (${hash.slice(0, 8)})`,
                language: getLanguageFromFileName(fileName),
                source: { type: 'git', revision: hash, path },
            }]);
        setEditorDiffModeByPane((prev) => ({ ...prev, [targetPaneId]: 'diff' }));
        if (activate) {
            activateEditorPane(targetPaneId);
            setActiveFileId(fileId, targetPaneId);
        }
        const editor = editorRefs.current.get(fileId);
        if (editor) applyEditorOpenRequest(fileId, editor);
    }, [activateEditorPane, applyEditorOpenRequest, hasVisibleEditorPane, resolveTargetPaneId, setActiveFileId]);

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
        if (isHistoricalFileId(request.file)) {
            return;
        }
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

        wsRef.current.emit('lsp:references', request, async (response: any) => {
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

            const firstItem = dedupedItems[0];
            const firstFilePath = firstItem ? uriToFilePath(firstItem.uri || firstItem.file) : '';
            let initialPreview = firstFilePath ? getFileContentForPreviewSync(firstFilePath) : null;

            if (firstFilePath && initialPreview === null) {
                initialPreview = await resolveFileContentForPreview(firstFilePath);
            }

            if (referencesPeekRequestTokenRef.current !== requestToken) {
                return;
            }

            updateReferencesPeekForPane(targetPaneId, {
                paneId: targetPaneId,
                loading: false,
                error: null,
                items: dedupedItems,
                selectedIndex: 0,
                preview: initialPreview,
            });
        });
    }, [
        isConnected,
        isHistoricalFileId,
        resolveFileContentForPreview,
        updateReferencesPeekForPane,
        getFileContentForPreviewSync,
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

                    const existingFile = filesRef.current.find((f) => f.id === filePath || f.name === fileName);
                    if (existingFile) {
                        setActiveFileId(existingFile.id);
                        const editor = editorRefs.current.get(existingFile.id);
                        if (editor) {
                            editor.requestFocus(line, column);
                        }
                    } else {
                        openFile(filePath, line, column);
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
        errors?: { line: number; message: string }[],
        history?: History,
        historical = false,
    ): Promise<AnycodeEditor> => {
        const editor = new AnycodeEditor(content, filename, language, {
            ignoreEdits: historical,
        });
        await editor.init();

        if (history) {
            editor.setHistory(history.changes, history.index);
        }

        editor.setOnChange((change: Change) => handleChange(filename, change));
        editor.setOnCursorChange((newState: any, oldState: any) => handleCursorChange(filename, newState, oldState));
        // Historical Git revisions are virtual editor files, not filesystem paths.
        // Do not attach LSP providers: sending their `git:<revision>:<path>` IDs to
        // the backend makes it try to open them as regular files.
        if (!historical) {
            editor.setCompletionProvider(handleCompletion);
            editor.setHoverProvider(handleHover);
            editor.setGoToDefinitionProvider(handleGoToDefinition);
            editor.setReferencesPeekProvider(openReferencesPeek);
        }
        editor.setErrors(errors || []);

        return editor;
    }, [handleChange, handleCursorChange, handleCompletion, handleGoToDefinition, handleHover, openReferencesPeek]);

    const initializeEditors = useCallback(async () => {
        try {
            const newEditorStates = new Map<string, AnycodeEditor>();

            for (const file of filesRef.current) {
                if (!editorStatesRef.current.has(file.id)) {
                    const content = savedFileContentsRef.current.get(file.id);
                    if (content === undefined) {
                        continue;
                    }

                    const pendingDiagnostics = diagnosticsRef.current.get(file.id);
                    const errors = pendingDiagnostics
                        ? pendingDiagnostics.map((d) => ({ line: d.range.start.line, message: d.message }))
                        : undefined;

                    let editorPromise = initializingEditorsRef.current.get(file.id);
                    if (!editorPromise) {
                        editorPromise = createEditor(
                            content,
                            file.language,
                            file.id,
                            errors,
                            file.history,
                            file.source?.type === 'git',
                        );
                        initializingEditorsRef.current.set(file.id, editorPromise);
                    }

                    try {
                        const editor = await editorPromise;
                        newEditorStates.set(file.id, editor);
                        savedFileContentsRef.current.set(file.id, content);
                        editorRefs.current.set(file.id, editor);
                        applyEditorOpenRequest(file.id, editor);
                        const snapshot = new Map(newEditorStates);
                        setEditorStates(snapshot);
                        editorStatesRef.current = snapshot;
                    } catch (err) {
                        console.error('Failed to initialize editor for file', file.id, err);
                    } finally {
                        initializingEditorsRef.current.delete(file.id);
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
    }, [applyEditorOpenRequest, createEditor]);

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
                const mode = getEditorDiffMode(paneId);
                openFile(fileId, cursor?.line, cursor?.column, paneId, mode);
            }
        });
    }, [getEditorDiffMode, isConnected, openFile, paneActiveFileIds, wsRef]);

    useEffect(() => {
        const paneId = activeEditorPaneIdRef.current;
        if (!paneId) return;
        const fileId = paneActiveFileIdsRef.current[paneId];
        if (!fileId) return;

        const mode = getEditorDiffMode(paneId);
        const applyKey = `${paneId}:${fileId}:${mode}`;
        if (lastAppliedDiffStateRef.current === applyKey) {
            return;
        }

        applyDiffModeToPaneEditor(paneId, mode);
        lastAppliedDiffStateRef.current = applyKey;
    }, [activeEditorPaneId, activeFileId, applyDiffModeToPaneEditor, getEditorDiffMode]);

    const closeFile = useCallback((fileId: string) => {
        const fileExists = filesRef.current.some((file) => file.id === fileId);
        if (!fileExists) return;

        flushChanges(fileId);

        if (!isHistoricalFileId(fileId) && wsRef.current && isConnected) {
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
        editorOpenRequestsRef.current.delete(fileId);
        onFileClosed?.(fileId);
    }, [flushChanges, isHistoricalFileId, wsRef, isConnected, onFileClosed]);

    const saveFile = useCallback((fileId: string) => {
        if (isHistoricalFileId(fileId)) return;
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
    }, [flushChanges, isHistoricalFileId, wsRef, isConnected]);

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

    const handleGitUpdate = useCallback((data?: any) => {
        if (!wsRef.current || !isConnected) return;

        // Only request git:file-original if it's a full status update (e.g. HEAD changed, branch changed)
        if (data && data.kind !== 'full') {
            return;
        }

        filesRef.current.forEach((file) => {
            const path = file.id;
            const editor = editorRefs.current.get(path);
            if (!editor) return;

            wsRef.current?.emit('git:file-original', { path }, (response: any) => {
                if (response && response.success && response.content !== undefined) {
                    editor.setOriginalCode(response.content);

                    const request = editorOpenRequestsRef.current.get(path);
                    if (request) {
                        request.originalContent = response.content;
                    }
                }
            });
        });
    }, [wsRef, isConnected]);

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

    const flushAllPendingChanges = useCallback(() => {
        pendingChangesRef.current.forEach((batch, filename) => {
            if (batch.timerId) {
                clearTimeout(batch.timerId);
            }
            flushChanges(filename);
        });
        pendingChangesRef.current.clear();
    }, [flushChanges]);

    const closeFilesUnderPath = useCallback((dirPath: string) => {
        const filesToClose = filesRef.current.filter((file) => file.id === dirPath || file.id.startsWith(dirPath + '/'));
        filesToClose.forEach((file) => {
            closeFile(file.id);
        });
    }, [closeFile]);

    const renameFilesUnderPath = useCallback((oldDirPath: string, newDirPath: string) => {
        const oldPrefix = oldDirPath + '/';
        const newPrefix = newDirPath + '/';

        setFiles((prev) =>
            prev.map((file) => {
                if (file.id === oldDirPath) {
                    const fileName = getFileName(newDirPath);
                    const language = getLanguageFromFileName(fileName);
                    return { ...file, id: newDirPath, name: fileName, language };
                }
                if (file.id.startsWith(oldPrefix)) {
                    const relative = file.id.substring(oldPrefix.length);
                    const nextId = newPrefix + relative;
                    const fileName = getFileName(nextId);
                    const language = getLanguageFromFileName(fileName);
                    return { ...file, id: nextId, name: fileName, language };
                }
                return file;
            })
        );

        setPaneActiveFileIds((prev) => {
            const next = { ...prev };
            Object.keys(next).forEach((paneId) => {
                const activeId = next[paneId];
                if (activeId) {
                    if (activeId === oldDirPath) {
                        next[paneId] = newDirPath;
                    } else if (activeId.startsWith(oldPrefix)) {
                        next[paneId] = newPrefix + activeId.substring(oldPrefix.length);
                    }
                }
            });
            return next;
        });

        const updateMapKeys = <T>(map: Map<string, T> | { current: Map<string, T> }) => {
            const actualMap = 'current' in map ? map.current : map;
            const keys = Array.from(actualMap.keys());
            for (const key of keys) {
                if (key === oldDirPath || key.startsWith(oldPrefix)) {
                    const nextKey = key === oldDirPath ? newDirPath : newPrefix + key.substring(oldPrefix.length);
                    const value = actualMap.get(key);
                    if (value !== undefined) {
                        actualMap.delete(key);
                        actualMap.set(nextKey, value);
                    }
                }
            }
        };

        setEditorStates((prev) => {
            const next = new Map(prev);
            const keys = Array.from(next.keys());
            for (const key of keys) {
                if (key === oldDirPath || key.startsWith(oldPrefix)) {
                    const nextKey = key === oldDirPath ? newDirPath : newPrefix + key.substring(oldPrefix.length);
                    const val = next.get(key);
                    if (val !== undefined) {
                        next.delete(key);
                        next.set(nextKey, val);
                    }
                }
            }
            return next;
        });

        updateMapKeys(editorRefs);
        updateMapKeys(savedFileContentsRef);
        updateMapKeys(editorOpenRequestsRef);
        updateMapKeys(previewFileContentsRef);
        updateMapKeys(diagnosticsRef);

        const pendingChangeKeys = Array.from(pendingChangesRef.current.keys());
        for (const key of pendingChangeKeys) {
            if (key === oldDirPath || key.startsWith(oldPrefix)) {
                const nextKey = key === oldDirPath ? newDirPath : newPrefix + key.substring(oldPrefix.length);
                const batch = pendingChangesRef.current.get(key);
                if (batch) {
                    if (batch.timerId) {
                        clearTimeout(batch.timerId);
                    }
                    batch.timerId = setTimeout(() => {
                        flushChanges(nextKey);
                    }, BATCH_DELAY_MS);
                    pendingChangesRef.current.delete(key);
                    pendingChangesRef.current.set(nextKey, batch);
                }
            }
        }

        const pendingOpenFiles = Array.from(pendingOpenFilesRef.current);
        for (const key of pendingOpenFiles) {
            if (key === oldDirPath || key.startsWith(oldPrefix)) {
                const nextKey = key === oldDirPath ? newDirPath : newPrefix + key.substring(oldPrefix.length);
                pendingOpenFilesRef.current.delete(key);
                pendingOpenFilesRef.current.add(nextKey);
            }
        }

        const cursorKeys = Object.keys(cursor2FileRef.current);
        for (const key of cursorKeys) {
            if (key === oldDirPath || key.startsWith(oldPrefix)) {
                const nextKey = key === oldDirPath ? newDirPath : newPrefix + key.substring(oldPrefix.length);
                cursor2FileRef.current[nextKey] = cursor2FileRef.current[key];
                delete cursor2FileRef.current[key];
            }
        }
    }, [flushChanges]);

    return {
        files,
        closeFilesUnderPath,
        renameFilesUnderPath,
        activeFile,
        activeFileId,
        activeEditorPaneId,
        getActiveFileIdForPane,
        getPaneIdsForFile,
        getActiveEditorSelectedText,
        getEditorState,
        setActiveFileId,
        setActiveEditorPaneId: activateEditorPane,
        registerEditorPane,
        unregisterEditorPane,
        getEditorDiffMode,
        setEditorDiffMode,
        cycleEditorDiffMode,
        editorStates,
        keepPreviousEditorByPane,
        closeFile,
        saveFile,
        openFile,
        openFiles,
        openHistoricalDiff,
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
        handleGoToDefinition,
        handleHover,
        handleWatcherEdits,
        handleGitUpdate,
        undoCursor,
        redoCursor,
        flushAllPendingChanges,
    };
};

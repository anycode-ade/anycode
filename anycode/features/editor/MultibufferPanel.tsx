import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnycodeEditorReact } from 'anycode-react';
import { AnycodeEditor, Code, MultiBufferCode, type MultiBufferEntry, type DefinitionRequest, type DefinitionResponse, type HoverRequest } from 'anycode-base';
import type { FileState } from '../../types';
import './MultibufferPanel.css';

export type MultibufferFile = {
    id: string;
    path: string;
    added?: number;
    removed?: number;
    status?: string;
};

type MultibufferPanelProps = {
    panelKey: string;
    active: boolean;
    files: MultibufferFile[];
    openFiles: FileState[];
    editorStates: ReadonlyMap<string, AnycodeEditor>;
    onClose: () => void;
    title?: string;
    ignoreEdits?: boolean;
    focusRequest?: { path: string; line?: number; column?: number; token: number };
    onActiveFileChange?: (fileId: string) => void;
    onGoToDefinition?: (request: DefinitionRequest) => Promise<DefinitionResponse>;
    onHover?: (request: HoverRequest) => Promise<string | null>;
    onLoadDeletedFile?: (path: string) => Promise<string | null>;
};

type ReadyFile = {
    file: MultibufferFile;
    fileState?: FileState;
    editor?: AnycodeEditor;
    code?: Code;
    originalCode?: Code;
};

type DeletedEntry = {
    code: Code;
    originalCode: Code;
};

const MultibufferPanel: React.FC<MultibufferPanelProps> = ({
    panelKey,
    active,
    files,
    openFiles,
    editorStates,
    onClose,
    title = 'Review changes',
    ignoreEdits = false,
    focusRequest,
    onActiveFileChange,
    onGoToDefinition,
    onHover,
    onLoadDeletedFile,
}) => {
    const [sharedEditor, setSharedEditor] = useState<AnycodeEditor | null>(null);
    const sharedEditorRef = useRef<AnycodeEditor | null>(null);
    const currentCodeRef = useRef<MultiBufferCode | null>(null);
    const originalCodeRef = useRef<MultiBufferCode | null>(null);
    const readyFilesRef = useRef<ReadyFile[]>([]);
    const editorStatesRef = useRef(editorStates);
    const onActiveFileChangeRef = useRef(onActiveFileChange);
    const loadedFileIdsRef = useRef(new Set<string>());
    const unsubscribeFileChangesRef = useRef(new Map<string, () => void>());
    const deletedEntriesRef = useRef(new Map<string, DeletedEntry>());
    const syncingRef = useRef(false);
    const generationRef = useRef(0);
    const [deletedEntriesVersion, setDeletedEntriesVersion] = useState(0);
    const fileById = useMemo(() => new Map(openFiles.map((file) => [file.id, file])), [openFiles]);
    const reviewFiles = files;
    const readyFiles = useMemo<ReadyFile[]>(() => files.flatMap((file) => {
            const fileState = fileById.get(file.id);
            const editor = editorStates.get(file.id);
            if (fileState && editor) return [{ file, fileState, editor }];

            const deletedEntry = deletedEntriesRef.current.get(file.id);
            return deletedEntry
                ? [{ file, code: deletedEntry.code, originalCode: deletedEntry.originalCode }]
                : [];
        }), [deletedEntriesVersion, editorStates, fileById, files]);

    useEffect(() => {
        const deletedFiles = files.filter((file) => file.status === 'deleted');
        const deletedIds = new Set(deletedFiles.map((file) => file.id));
        let entriesChanged = false;

        for (const fileId of deletedEntriesRef.current.keys()) {
            if (deletedIds.has(fileId)) continue;
            deletedEntriesRef.current.delete(fileId);
            entriesChanged = true;
        }

        if (entriesChanged) {
            setDeletedEntriesVersion((version) => version + 1);
        }
        if (ignoreEdits || !onLoadDeletedFile) return;

        const missingFiles = deletedFiles.filter((file) => !deletedEntriesRef.current.has(file.id));
        if (missingFiles.length === 0) return;

        let cancelled = false;
        void Promise.all(missingFiles.map(async (file) => ({
            file,
            content: await onLoadDeletedFile(file.path),
        }))).then((results) => {
            if (cancelled) return;

            let loaded = false;
            for (const { file, content } of results) {
                if (content === null || deletedEntriesRef.current.has(file.id)) continue;
                deletedEntriesRef.current.set(file.id, {
                    code: new Code('', file.path, ''),
                    originalCode: new Code(content, file.path, ''),
                });
                loaded = true;
            }
            if (loaded) {
                setDeletedEntriesVersion((version) => version + 1);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [files, ignoreEdits, onLoadDeletedFile, panelKey]);

    useEffect(() => {
        readyFilesRef.current = readyFiles;
        editorStatesRef.current = editorStates;
        onActiveFileChangeRef.current = onActiveFileChange;
    }, [editorStates, onActiveFileChange, readyFiles]);

    useEffect(() => {
        if (!sharedEditor) return;
        if (active) {
            sharedEditor.activateCursor();
        } else {
            sharedEditor.deactivateCursor();
        }
        return () => sharedEditor.deactivateCursor();
    }, [active, sharedEditor]);

    useEffect(() => {
        if (!focusRequest || !sharedEditor) return;
        const currentCode = currentCodeRef.current;
        if (!currentCode) return;

        let targetLine: number | null = null;
        if (focusRequest.line !== undefined) {
            targetLine = currentCode.getMultibufferLineForLocalLine(focusRequest.path, focusRequest.line);
        }
        if (targetLine === null) {
            targetLine = currentCode.getFirstLineForFile(focusRequest.path);
        }
        if (targetLine === null) return;

        const column = focusRequest.column ?? 0;
        sharedEditor.requestFocus(targetLine, column, true);

        const targetFile = reviewFiles.find((file) => (
            file.id === focusRequest.path
            || file.path === focusRequest.path
            || focusRequest.path.endsWith('/' + file.id)
            || focusRequest.path.endsWith('/' + file.path)
        ));
        onActiveFileChangeRef.current?.(targetFile?.id ?? focusRequest.path);
    }, [focusRequest, reviewFiles, sharedEditor]);

    useEffect(() => {
        if (sharedEditor && onGoToDefinition) {
            sharedEditor.setGoToDefinitionProvider(onGoToDefinition);
        }
        if (sharedEditor && onHover) {
            sharedEditor.setHoverProvider(onHover);
        }
    }, [onGoToDefinition, onHover, sharedEditor]);

    useEffect(() => {
        generationRef.current += 1;
        return () => {
            generationRef.current += 1;
            unsubscribeFileChangesRef.current.forEach((unsubscribe) => unsubscribe());
            unsubscribeFileChangesRef.current.clear();
            sharedEditorRef.current?.clean();
            sharedEditorRef.current = null;
            currentCodeRef.current = null;
            originalCodeRef.current = null;
            loadedFileIdsRef.current.clear();
            deletedEntriesRef.current.clear();
            setSharedEditor(null);
        };
    }, [ignoreEdits, panelKey]);

    useEffect(() => {
        const generation = generationRef.current;
        const toEntry = ({ file, fileState, editor, code, originalCode }: ReadyFile): MultiBufferEntry => {
            if (code && originalCode) {
                return {
                    id: file.id,
                    path: file.path,
                    added: file.added,
                    removed: file.removed,
                    readOnly: true,
                    code,
                    originalCode,
                };
            }

            if (!fileState || !editor) {
                throw new Error(`Multibuffer file is not ready: ${file.path}`);
            }
            const originalContent = editor.getOriginalText();
            const originalText = originalContent !== null
                ? originalContent
                : (file.status === 'added' || file.status === 'untracked' || file.status === 'renamed' ? '' : editor.getText());
            return {
                id: file.id,
                path: file.path,
                added: file.added,
                removed: file.removed,
                readOnly: file.status === 'deleted',
                code: editor.getCodeModel(),
                originalCode: editor.getOriginalCodeModel()
                    ?? new Code(originalText, file.path, fileState.language),
            };
        };

        const updateMultibufferErrors = () => {
            const editor = sharedEditorRef.current;
            const currentCode = currentCodeRef.current;
            if (!editor || !currentCode) return;

            const multibufferErrors: { line: number; message: string }[] = [];
            for (const { file, editor: fileEditor } of readyFilesRef.current) {
                if (!fileEditor) continue;
                const errorMap = fileEditor.getErrorLines();
                for (const [localLine, message] of errorMap.entries()) {
                    const mbLine = currentCode.getMultibufferLineForLocalLine(file.id, localLine);
                    if (mbLine !== null && mbLine !== undefined) {
                        multibufferErrors.push({ line: mbLine, message });
                    }
                }
            }
            editor.setErrors(multibufferErrors);
        };

        const subscribeToFile = (readyFile: ReadyFile) => {
            if (!readyFile.editor) return;
            if (unsubscribeFileChangesRef.current.has(readyFile.file.id)) return;
            const unsubscribeChange = readyFile.editor.addOnChangeListener(() => {
                const currentCode = currentCodeRef.current;
                const editor = sharedEditorRef.current;
                if (!currentCode || !editor) return;

                const pos = currentCode.getPosition(editor.offset);
                const fileId = currentCode.getFileIdAtLine(pos.line);
                const localLine = currentCode.getMultibufferLineNumber(pos.line);
                const col = pos.column;

                currentCode.notifyFileChanged(readyFile.file.id);

                if (fileId) {
                    const firstLine = currentCode.getFirstLineForFile(fileId);
                    if (firstLine !== null) {
                        const targetLine = localLine !== null ? firstLine + localLine : firstLine;
                        editor.offset = currentCode.getOffset(targetLine, col);
                    }
                }
                editor.refreshAfterExternalChange();
                updateMultibufferErrors();
            });
            const unsubscribeError = readyFile.editor.addOnErrorListener(() => {
                updateMultibufferErrors();
            });
            unsubscribeFileChangesRef.current.set(readyFile.file.id, () => {
                unsubscribeChange();
                unsubscribeError();
            });
        };

        const sync = async () => {
            if (syncingRef.current) return;
            syncingRef.current = true;

            try {
                let editor = sharedEditorRef.current;
                let currentCode = currentCodeRef.current;
                let originalCode = originalCodeRef.current;

                if (!editor || !currentCode || !originalCode) {
                    const initialFiles = readyFilesRef.current;
                    const firstReviewFileId = reviewFiles[0]?.id;
                    if (
                        !firstReviewFileId
                        || !initialFiles.some(({ file }) => file.id === firstReviewFileId)
                    ) return;

                    const entries = initialFiles.map(toEntry);
                    currentCode = new MultiBufferCode(entries);
                    originalCode = new MultiBufferCode(entries.map((entry) => ({
                        ...entry,
                        code: entry.originalCode,
                        originalCode: entry.originalCode,
                    })));
                    editor = new AnycodeEditor('', 'multibuffer', '', {
                        code: currentCode,
                        originalCode,
                        focusedDiffEnabled: true,
                        ignoreEdits,
                        codeFoldingEnabled: true,
                        scrollbarMarkersEnabled: false,
                    });

                    currentCodeRef.current = currentCode;
                    originalCodeRef.current = originalCode;
                    sharedEditorRef.current = editor;
                    currentCode.setOnFileChange(({ fileId, change }) => {
                        editorStatesRef.current.get(fileId)?.notifyExternalChange(change);
                    });
                    editor.setOnCursorChange((position) => {
                        const fileId = currentCodeRef.current?.getFileIdAtLine(position.line);
                        if (fileId) onActiveFileChangeRef.current?.(fileId);
                    });
                    initialFiles.forEach(subscribeToFile);

                    await editor.init();
                    if (generationRef.current !== generation) {
                        editor.clean();
                        return;
                    }
                    if (onGoToDefinition) {
                        editor.setGoToDefinitionProvider(onGoToDefinition);
                    }
                    editor.setDiffMode('diff');
                    setSharedEditor(editor);
                    initialFiles.forEach(({ file }) => loadedFileIdsRef.current.add(file.id));
                    updateMultibufferErrors();
                }

                const currentFileIds = new Set(readyFilesRef.current.map(({ file }) => file.id));
                const removedFileIds = [...loadedFileIdsRef.current]
                    .filter((fileId) => !currentFileIds.has(fileId));
                if (removedFileIds.length > 0) {
                    currentCode.removeEntries(removedFileIds);
                    originalCode.removeEntries(removedFileIds);
                    removedFileIds.forEach((fileId) => {
                        unsubscribeFileChangesRef.current.get(fileId)?.();
                        unsubscribeFileChangesRef.current.delete(fileId);
                        loadedFileIdsRef.current.delete(fileId);
                    });
                    editor.refreshAfterExternalChange();
                    updateMultibufferErrors();
                }

                const pendingFiles = readyFilesRef.current
                    .filter(({ file }) => !loadedFileIdsRef.current.has(file.id));
                if (pendingFiles.length > 0) {
                    for (const pendingFile of pendingFiles) {
                        const entry = toEntry(pendingFile);
                        const insertionIndex = reviewFiles.findIndex((file) => file.id === pendingFile.file.id);
                        await currentCode.addEntries([entry], insertionIndex);
                        await originalCode.addEntries([{
                            ...entry,
                            code: entry.originalCode,
                            originalCode: entry.originalCode,
                        }], insertionIndex);
                        if (generationRef.current !== generation) return;

                        subscribeToFile(pendingFile);
                        loadedFileIdsRef.current.add(pendingFile.file.id);
                    }
                    editor.refreshAfterExternalChange();
                    updateMultibufferErrors();
                }
            } finally {
                syncingRef.current = false;
            }
        };

        void sync();
    }, [ignoreEdits, panelKey, readyFiles, reviewFiles]);

    return (
        <div className="multibuffer-panel">
            <div className="multibuffer-toolbar">
                <div className="multibuffer-toolbar-title">
                    <span>{title}</span>
                    <span className="multibuffer-toolbar-count">{files.length} files</span>
                </div>
                <button
                    className="search-close-button"
                    onClick={onClose}
                    title="Close review"
                    aria-label="Close review"
                >
                    &times;
                </button>
            </div>

            <div className="multibuffer-scroll">
                {files.length === 0 ? (
                    <div className="multibuffer-empty">No changes</div>
                ) : sharedEditor ? (
                    <div className="multibuffer-editor-shell">
                        <AnycodeEditorReact
                            id={`multibuffer-${panelKey}`}
                            editorState={sharedEditor}
                        />
                    </div>
                ) : (
                    <div className="multibuffer-file-loading">
                        Loading {readyFiles.length} of {reviewFiles.length} files…
                    </div>
                )}
            </div>
        </div>
    );
};

export default MultibufferPanel;

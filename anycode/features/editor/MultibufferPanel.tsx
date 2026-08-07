import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnycodeEditorReact } from 'anycode-react';
import { AnycodeEditor, Code, MultiBufferCode, type MultiBufferEntry } from 'anycode-base';
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
    files: MultibufferFile[];
    openFiles: FileState[];
    editorStates: ReadonlyMap<string, AnycodeEditor>;
    activeFileId: string | null;
    onSelectFile: (fileId: string, paneId: string) => void;
    onClose: () => void;
    title?: string;
    ignoreEdits?: boolean;
    focusRequest?: { path: string; token: number };
};

type ReadyFile = {
    file: MultibufferFile;
    fileState: FileState;
    editor: AnycodeEditor;
};

const MultibufferPanel: React.FC<MultibufferPanelProps> = ({
    panelKey,
    files,
    openFiles,
    editorStates,
    activeFileId,
    onSelectFile,
    onClose,
    title = 'Review changes',
    ignoreEdits = false,
    focusRequest,
}) => {
    const [sharedEditor, setSharedEditor] = useState<AnycodeEditor | null>(null);
    const sharedEditorRef = useRef<AnycodeEditor | null>(null);
    const currentCodeRef = useRef<MultiBufferCode | null>(null);
    const originalCodeRef = useRef<MultiBufferCode | null>(null);
    const readyFilesRef = useRef<ReadyFile[]>([]);
    const editorStatesRef = useRef(editorStates);
    const onSelectFileRef = useRef(onSelectFile);
    const loadedFileIdsRef = useRef(new Set<string>());
    const unsubscribeFileChangesRef = useRef(new Map<string, () => void>());
    const syncingRef = useRef(false);
    const generationRef = useRef(0);
    const fileById = useMemo(() => new Map(openFiles.map((file) => [file.id, file])), [openFiles]);
    const reviewFiles = useMemo(
        () => files.filter((file) => file.status !== 'deleted'),
        [files],
    );
    const readyFiles = useMemo<ReadyFile[]>(() => files
        .filter((file) => file.status !== 'deleted')
        .flatMap((file) => {
            const fileState = fileById.get(file.id);
            const editor = editorStates.get(file.id);
            return fileState && editor ? [{ file, fileState, editor }] : [];
        }), [editorStates, fileById, files]);
    useEffect(() => {
        readyFilesRef.current = readyFiles;
        editorStatesRef.current = editorStates;
        onSelectFileRef.current = onSelectFile;
    }, [editorStates, onSelectFile, readyFiles]);

    useEffect(() => {
        if (!focusRequest || !sharedEditor) return;
        const line = currentCodeRef.current?.getFirstLineForFile(focusRequest.path);
        if (line === null || line === undefined) return;
        sharedEditor.requestFocus(line, 0, true);
        onSelectFileRef.current(focusRequest.path, panelKey);
    }, [focusRequest, panelKey, sharedEditor]);

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
            setSharedEditor(null);
        };
    }, [ignoreEdits, panelKey]);

    useEffect(() => {
        const generation = generationRef.current;
        const toEntry = ({ file, fileState, editor }: ReadyFile): MultiBufferEntry => {
            const originalContent = editor.getOriginalText();
            const originalText = originalContent !== null
                ? originalContent
                : (file.status === 'added' || file.status === 'untracked' || file.status === 'renamed' ? '' : editor.getText());
            return {
                id: file.id,
                path: file.path,
                added: file.added,
                removed: file.removed,
                code: editor.getCodeModel(),
                originalCode: editor.getOriginalCodeModel()
                    ?? new Code(originalText, file.path, fileState.language),
            };
        };

        const subscribeToFile = (readyFile: ReadyFile) => {
            if (unsubscribeFileChangesRef.current.has(readyFile.file.id)) return;
            const unsubscribe = readyFile.editor.addOnChangeListener(() => {
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
            });
            unsubscribeFileChangesRef.current.set(readyFile.file.id, unsubscribe);
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
                        if (fileId) onSelectFileRef.current(fileId, panelKey);
                    });
                    initialFiles.forEach(subscribeToFile);

                    await editor.init();
                    if (generationRef.current !== generation) {
                        editor.clean();
                        return;
                    }
                    editor.setDiffMode('diff');
                    setSharedEditor(editor);
                    initialFiles.forEach(({ file }) => loadedFileIdsRef.current.add(file.id));
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
                }

                while (generationRef.current === generation) {
                    const pendingFiles = readyFilesRef.current.filter(({ file }) => (
                        !loadedFileIdsRef.current.has(file.id)
                    ));
                    if (pendingFiles.length === 0) break;

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

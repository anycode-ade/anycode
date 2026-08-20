import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AnycodeEditorReact } from 'anycode-react';
import {
    AnycodeEditor,
    Code,
    DiffCode,
    MultiBufferCode,
    parseUnifiedDiff,
    type MultiBufferEntry,
    type ParsedDiffFile,
    type DefinitionRequest,
    type DefinitionResponse,
    type HoverRequest,
} from 'anycode-base';
import type { DockviewPanelApi } from 'dockview';
import { LayoutPanelApiContext, LayoutVersionContext } from '../../components/layout/Layout';
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
    rawDiff?: string;
    focusRequest?: { path: string; line?: number; column?: number; token: number };
    onActiveFileChange?: (fileId: string) => void;
    onOpenFile?: (path: string) => void;
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

const normalize = (p: string) => p.replace(/\\/g, '/').replace(/^\.\/+/, '');

const MultibufferPanel: React.FC<MultibufferPanelProps> = ({
    panelKey,
    active,
    files,
    openFiles,
    editorStates,
    onClose,
    title = 'Review changes',
    ignoreEdits = false,
    rawDiff,
    focusRequest,
    onActiveFileChange,
    onOpenFile,
    onGoToDefinition,
    onHover,
    onLoadDeletedFile,
}) => {
    const panel = useContext(LayoutPanelApiContext) as DockviewPanelApi | null;
    const layoutVersion = useContext(LayoutVersionContext);
    const [sharedEditor, setSharedEditor] = useState<AnycodeEditor | null>(null);
    const sharedEditorRef = useRef<AnycodeEditor | null>(null);
    const currentCodeRef = useRef<MultiBufferCode | null>(null);
    const originalCodeRef = useRef<MultiBufferCode | null>(null);
    const readyFilesRef = useRef<ReadyFile[]>([]);
    const editorStatesRef = useRef(editorStates);
    const openFilesRef = useRef(openFiles);
    const onActiveFileChangeRef = useRef(onActiveFileChange);
    const onOpenFileRef = useRef(onOpenFile);
    const loadedFileIdsRef = useRef(new Set<string>());
    const unsubscribeFileChangesRef = useRef(new Map<string, () => void>());
    const syncingRef = useRef(false);
    const generationRef = useRef(0);
    const appliedRawDiffRef = useRef<string | undefined>(undefined);
    const fileById = useMemo(() => new Map(openFiles.map((file) => [file.id, file])), [openFiles]);
    const reviewFiles = files;
    const readyFiles = useMemo<ReadyFile[]>(() => files.flatMap((file) => {
            const fileState = fileById.get(file.id);
            const editor = editorStates.get(file.id);
            if (fileState && editor) return [{ file, fileState, editor }];
            return [];
        }), [editorStates, fileById, files]);

    useEffect(() => {
        if (!panel || !sharedEditor) return;
        const disposable = panel.onDidVisibilityChange((event) => {
            if (event.isVisible) {
                sharedEditor.restoreScroll();
            }
        });
        return () => disposable.dispose();
    }, [panel, sharedEditor]);

    useEffect(() => {
        readyFilesRef.current = readyFiles;
        editorStatesRef.current = editorStates;
        openFilesRef.current = openFiles;
        onActiveFileChangeRef.current = onActiveFileChange;
        onOpenFileRef.current = onOpenFile;
    }, [editorStates, onActiveFileChange, onOpenFile, openFiles, readyFiles]);

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
            appliedRawDiffRef.current = undefined;
            setSharedEditor(null);
        };
    }, [panelKey]);

    useEffect(() => {
        const generation = generationRef.current;

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

        const materializeFile = async (fileId: string): Promise<boolean> => {
            const currentCode = currentCodeRef.current;
            if (!currentCode) return false;
            if (!currentCode.isDiffEntry(fileId)) return true;

            const targetFile = reviewFiles.find((f) => f.id === fileId || f.path === fileId || normalize(f.path) === normalize(fileId));
            const targetPath = targetFile ? targetFile.path : fileId;

            let fileState = openFilesRef.current.find((f) => f.id === targetPath || f.id === fileId || normalize(f.id) === normalize(targetPath));
            let fileEditor = editorStatesRef.current.get(targetPath) || editorStatesRef.current.get(fileId);

            if (!fileState || !fileEditor) {
                onOpenFileRef.current?.(targetPath);

                const start = Date.now();
                while (Date.now() - start < 3000) {
                    fileState = openFilesRef.current.find((f) => f.id === targetPath || f.id === fileId || normalize(f.id) === normalize(targetPath));
                    fileEditor = editorStatesRef.current.get(targetPath) || editorStatesRef.current.get(fileId);
                    if (fileState && fileEditor) break;
                    await new Promise((r) => setTimeout(r, 25));
                }
            }

            if (fileState && fileEditor) {
                const originalContent = fileEditor.getOriginalText() ?? '';
                const origCode = fileEditor.getOriginalCodeModel()
                    ?? new Code(originalContent, fileState.path, fileState.language);
                currentCode.materializeFile(fileId, fileEditor.getCodeModel(), origCode);
                subscribeToFile({ file: { id: fileId, path: fileState.path }, fileState, editor: fileEditor });
                loadedFileIdsRef.current.add(fileId);
                sharedEditorRef.current?.refreshAfterExternalChange();
                return true;
            }

            return false;
        };

        const sync = async () => {
            if (syncingRef.current) return;
            syncingRef.current = true;

            try {
                let editor = sharedEditorRef.current;
                let currentCode = currentCodeRef.current;
                let originalCode = originalCodeRef.current;

                if (!editor || !currentCode || !originalCode) {
                    if (reviewFiles.length === 0) return;

                    const parsedFiles = rawDiff ? parseUnifiedDiff(rawDiff) : [];
                    const parsedMap = new Map<string, ParsedDiffFile>();
                    for (const parsed of parsedFiles) {
                        parsedMap.set(parsed.id, parsed);
                        parsedMap.set(parsed.path, parsed);
                        parsedMap.set(normalize(parsed.path), parsed);
                    }

                    const entries: MultiBufferEntry[] = reviewFiles.map((file) => {
                        const fileState = fileById.get(file.id) || fileById.get(file.path);
                        const fileEditor = editorStates.get(file.id) || editorStates.get(file.path);
                        if (fileState && fileEditor) {
                            return {
                                kind: 'code',
                                id: file.id,
                                path: file.path,
                                added: file.added,
                                removed: file.removed,
                                readOnly: file.status === 'deleted',
                                code: fileEditor.getCodeModel(),
                                originalCode: fileEditor.getOriginalCodeModel()
                                    ?? new Code(fileEditor.getOriginalText() ?? '', file.path, fileState.language),
                            };
                        }

                        const parsed = parsedMap.get(file.id)
                            || parsedMap.get(file.path)
                            || parsedMap.get(normalize(file.path));

                        const diffCode = parsed
                            ? new DiffCode(parsed)
                            : new DiffCode({
                                id: file.id,
                                path: file.path,
                                status: (file.status as any) || 'modified',
                                added: file.added || 0,
                                removed: file.removed || 0,
                                newLines: [],
                                oldLines: [],
                                newLineNumbers: [],
                                oldLineNumbers: [],
                                diffs: new Map(),
                            });

                        return {
                            kind: 'diff',
                            id: file.id,
                            path: file.path,
                            added: file.added,
                            removed: file.removed,
                            readOnly: file.status === 'deleted',
                            diffCode,
                            originalDiffCode: diffCode.getOriginalDiffCode(),
                        };
                    });

                    currentCode = new MultiBufferCode(entries);
                    originalCode = new MultiBufferCode(entries.map((entry) => {
                        if (entry.kind === 'diff') {
                            return {
                                ...entry,
                                diffCode: entry.originalDiffCode ?? entry.diffCode.getOriginalDiffCode(),
                            };
                        }
                        return {
                            ...entry,
                            code: entry.originalCode,
                            originalCode: entry.originalCode,
                        };
                    }));

                    editor = new AnycodeEditor('', 'multibuffer', '', {
                        code: currentCode,
                        originalCode,
                        focusedDiffEnabled: true,
                        ignoreEdits,
                        codeFoldingEnabled: true,
                        scrollbarMarkersEnabled: true,
                    });

                    currentCodeRef.current = currentCode;
                    originalCodeRef.current = originalCode;
                    sharedEditorRef.current = editor;
                    appliedRawDiffRef.current = rawDiff;

                    currentCode.setOnFileChange(({ fileId, change }) => {
                        editorStatesRef.current.get(fileId)?.notifyExternalChange(change);
                    });
                    editor.setOnCursorChange((position) => {
                        const fileId = currentCodeRef.current?.getFileIdAtLine(position.line);
                        if (fileId) {
                            onActiveFileChangeRef.current?.(fileId);
                            if (currentCodeRef.current?.isDiffEntry(fileId)) {
                                void materializeFile(fileId);
                            }
                        }
                    });

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
                    readyFilesRef.current.forEach(subscribeToFile);
                    updateMultibufferErrors();
                }

                // If rawDiff updated after initial creation, update diff codes in-place
                if (rawDiff !== undefined && rawDiff !== appliedRawDiffRef.current && currentCode && originalCode && editor) {
                    const parsedFiles = parseUnifiedDiff(rawDiff);
                    for (const parsed of parsedFiles) {
                        const diffCode = new DiffCode(parsed);
                        currentCode.setDiff(parsed.id, diffCode) || currentCode.setDiff(parsed.path, diffCode);
                        const origDiffCode = diffCode.getOriginalDiffCode();
                        originalCode.setDiff(parsed.id, origDiffCode) || originalCode.setDiff(parsed.path, origDiffCode);
                    }
                    appliedRawDiffRef.current = rawDiff;
                    editor.recomputeDiffs();
                    editor.refreshAfterExternalChange();
                    updateMultibufferErrors();
                }

                // JIT Materialization: If newly opened editors arrive, materialize them into Code
                if (currentCode && editor) {
                    let materializedAny = false;
                    for (const readyFile of readyFilesRef.current) {
                        const fileId = readyFile.file.id;
                        if (readyFile.editor && readyFile.fileState && currentCode.isDiffEntry(fileId)) {
                            const originalContent = readyFile.editor.getOriginalText() ?? '';
                            const origCode = readyFile.editor.getOriginalCodeModel()
                                ?? new Code(originalContent, readyFile.file.path, readyFile.fileState.language);
                            currentCode.materializeFile(fileId, readyFile.editor.getCodeModel(), origCode);
                            subscribeToFile(readyFile);
                            loadedFileIdsRef.current.add(fileId);
                            materializedAny = true;
                        }
                    }
                    if (materializedAny) {
                        editor.refreshAfterExternalChange();
                        updateMultibufferErrors();
                    }
                }
            } finally {
                syncingRef.current = false;
            }
        };

        void sync();
    }, [ignoreEdits, panelKey, rawDiff, readyFiles, reviewFiles]);

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
                            forceUpdateTrigger={layoutVersion}
                        />
                    </div>
                ) : (
                    <div className="multibuffer-file-loading">
                        Loading review…
                    </div>
                )}
            </div>
        </div>
    );
};

export default MultibufferPanel;

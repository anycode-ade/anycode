import { useContext, useEffect, useState } from 'react';
import { AnycodeEditor, AnycodeEditorReact } from 'anycode-react';
import { LayoutVersionContext } from '../../components/layout/Layout';
import type { DefinitionRequest, DefinitionResponse, HoverRequest } from 'anycode-base';
import type { FileState, ReferencesPeekState } from '../../types';
import type { DiffMode } from '../../types/diffMode';
import { ReferencesPeek } from './ReferencesPeek';
import MultibufferPanel, { type MultibufferFile } from './MultibufferPanel';
import { getFileName, getLanguageFromFileName, toRelativeDisplayPath } from '../../utils';
import { selectionQuoteStore } from '../agents/selectionQuoteStore';

type EditorPanelProps = {
    panelKey: string;
    editors: {
        files: FileState[];
        editorStates: ReadonlyMap<string, AnycodeEditor>;
        keepPreviousEditorByPane: Readonly<Record<string, boolean>>;
        activeEditorPaneId: string;
        getActiveFileIdForPane: (paneId: string) => string | null;
        setActiveEditorPaneId: (paneId: string) => void;
        referencesPeekByPane?: Record<string, ReferencesPeekState | null>;
        getReferencesPeekForPane: (paneId: string) => ReferencesPeekState | null;
        closeReferencesPeek: (paneId?: string) => void;
        focusEditorInPane: (paneId: string) => void;
        setSelectedReferenceInPeek: (paneId: string, nextIndex: number) => void;
        openReferenceFromPeek: (paneId: string, itemIndex?: number) => void;
        handleHover?: (request: HoverRequest) => Promise<string | null>;
        handleGoToDefinition?: (request: DefinitionRequest) => Promise<DefinitionResponse>;
        getEditorDiffMode?: (paneId: string) => DiffMode;
        editorDiffModeByPane?: Readonly<Record<string, DiffMode>>;
    };
    multibufferOpen?: boolean;
    multibufferFiles?: MultibufferFile[];
    multibufferTitle?: string;
    multibufferIgnoreEdits?: boolean;
    multibufferFocusRequest?: { path: string; line?: number; column?: number; token: number };
    onCloseMultibuffer?: () => void;
    onMultibufferActiveFileChange?: (paneId: string, fileId: string) => void;
    onGoToDefinition?: (request: DefinitionRequest) => Promise<DefinitionResponse>;
    onLoadDeletedFile?: (path: string) => Promise<string | null>;
};

export const EditorPanel = ({
    panelKey,
    editors,
    multibufferOpen = false,
    multibufferFiles = [],
    multibufferTitle,
    multibufferIgnoreEdits = false,
    multibufferFocusRequest,
    onCloseMultibuffer,
    onMultibufferActiveFileChange,
    onGoToDefinition,
    onLoadDeletedFile,
}: EditorPanelProps) => {
    const layoutVersion = useContext(LayoutVersionContext);
    const paneFileId = editors.getActiveFileIdForPane(panelKey);
    const paneFile = paneFileId ? editors.files.find((file) => file.id === paneFileId) : null;
    const editorState = paneFile ? editors.editorStates.get(paneFile.id) : null;
    const referencesPeek = editors.referencesPeekByPane
        ? (editors.referencesPeekByPane[panelKey] ?? null)
        : editors.getReferencesPeekForPane(panelKey);
    const [lastReadyEditor, setLastReadyEditor] = useState<{ id: string; state: AnycodeEditor } | null>(null);
    const explicitDiffMode = editors.editorDiffModeByPane?.[panelKey];
    const diffMode = explicitDiffMode ?? (multibufferOpen ? 'diff' : (editors.getEditorDiffMode ? editors.getEditorDiffMode(panelKey) : undefined));

    useEffect(() => {
        if (!paneFileId) {
            setLastReadyEditor(null);
            return;
        }

        if (paneFile && editorState) {
            setLastReadyEditor({ id: paneFile.id, state: editorState });
        }
    }, [paneFileId, paneFile, editorState]);

    const editorForCurrentFile = lastReadyEditor?.id === paneFileId
        ? lastReadyEditor
        : null;
    const fallbackEditor = editors.keepPreviousEditorByPane[panelKey]
        ? lastReadyEditor
        : editorForCurrentFile;
    const displayedEditor = paneFile && editorState
        ? { id: paneFile.id, state: editorState }
        : fallbackEditor;

    useEffect(() => {
        if (multibufferOpen || !displayedEditor) return;
        const editor = displayedEditor.state;
        if (editors.activeEditorPaneId === panelKey) {
            editor.activateCursor();
        } else {
            editor.deactivateCursor();
        }
        return () => editor.deactivateCursor();
    }, [displayedEditor?.id, displayedEditor?.state, editors.activeEditorPaneId, multibufferOpen, panelKey]);

    const handleCheckEditorSelection = () => {
        requestAnimationFrame(() => {
            if (!displayedEditor?.state) return;
            const selectedText = displayedEditor.state.getSelectedText();
            if (selectedText && selectedText.trim().length >= 2) {
                const sorted = displayedEditor.state.selection?.sorted();
                let startRow = sorted ? sorted[0].row : displayedEditor.state.cursor.row;
                let endRow = sorted ? sorted[1].row : displayedEditor.state.cursor.row;

                if (sorted && sorted[1].row > sorted[0].row && sorted[1].column === 0) {
                    endRow = sorted[1].row - 1;
                }

                const lineRange: [number, number] | undefined = sorted
                    ? [startRow + 1, endRow + 1]
                    : undefined;
                const linesLabel = lineRange
                    ? lineRange[0] === lineRange[1]
                        ? `L${lineRange[0]}`
                        : `L${lineRange[0]}-${lineRange[1]}`
                    : '';
                const codeModel = displayedEditor.state.getCodeModel();
                const resolvedFilePath =
                    (paneFile?.source && 'path' in paneFile.source ? paneFile.source.path : undefined) ||
                    paneFile?.id ||
                    codeModel?.filename ||
                    paneFile?.name;
                const resolvedLanguage =
                    paneFile?.language ||
                    codeModel?.language ||
                    (resolvedFilePath ? getLanguageFromFileName(resolvedFilePath) : undefined);
                const fileName = paneFile?.name || (resolvedFilePath ? getFileName(resolvedFilePath) : 'file');
                const displayPath = resolvedFilePath ? toRelativeDisplayPath(resolvedFilePath) : undefined;
                selectionQuoteStore.set({
                    id: `editor:${resolvedFilePath || 'snippet'}`,
                    text: selectedText,
                    source: 'editor',
                    label: `${fileName}${linesLabel ? ` (${linesLabel})` : ''}`,
                    filePath: resolvedFilePath,
                    displayPath,
                    lineRange,
                    language: resolvedLanguage,
                });
            } else {
                if (selectionQuoteStore.get()?.id === `editor:${resolvedFilePath || 'snippet'}`) {
                    selectionQuoteStore.clear();
                }
            }
        });
    };

    if (multibufferOpen) {
        return (
            <div
                className="editor-container"
                onMouseDown={() => editors.setActiveEditorPaneId(panelKey)}
                onWheelCapture={() => editors.setActiveEditorPaneId(panelKey)}
            >
                <MultibufferPanel
                    panelKey={panelKey}
                    active={editors.activeEditorPaneId === panelKey}
                    diffMode={diffMode}
                    files={multibufferFiles}
                    openFiles={editors.files}
                    editorStates={editors.editorStates}
                    onClose={onCloseMultibuffer ?? (() => undefined)}
                    title={multibufferTitle}
                    ignoreEdits={multibufferIgnoreEdits}
                    focusRequest={multibufferFocusRequest}
                    onActiveFileChange={(fileId) => onMultibufferActiveFileChange?.(panelKey, fileId)}
                    onGoToDefinition={onGoToDefinition}
                    onHover={editors.handleHover}
                    onCompletion={editors.handleCompletion}
                    onReferencesPeek={(req) => editors.openReferencesPeek(req, panelKey)}
                    onLoadDeletedFile={onLoadDeletedFile}
                />
                {referencesPeek ? (
                    <ReferencesPeek
                        state={referencesPeek}
                        onClose={() => {
                            editors.closeReferencesPeek(panelKey);
                            editors.focusEditorInPane(panelKey);
                        }}
                        onSelectItem={(index) => editors.setSelectedReferenceInPeek(panelKey, index)}
                        onOpenItem={(index) => editors.openReferenceFromPeek(panelKey, index)}
                    />
                ) : null}
            </div>
        );
    }

    return (
        <div
            className="editor-container"
            onMouseDown={() => editors.setActiveEditorPaneId(panelKey)}
            onWheelCapture={() => editors.setActiveEditorPaneId(panelKey)}
            onMouseUp={handleCheckEditorSelection}
            onKeyUp={handleCheckEditorSelection}
        >
            {displayedEditor ? (
                <AnycodeEditorReact
                    key={panelKey}
                    id={displayedEditor.id}
                    editorState={displayedEditor.state}
                    forceUpdateTrigger={layoutVersion}
                />
            ) : (
                <div className="no-editor"></div>
            )}
            {referencesPeek ? (
                <ReferencesPeek
                    state={referencesPeek}
                    onClose={() => {
                        editors.closeReferencesPeek(panelKey);
                        editors.focusEditorInPane(panelKey);
                    }}
                    onSelectItem={(index) => editors.setSelectedReferenceInPeek(panelKey, index)}
                    onOpenItem={(index) => editors.openReferenceFromPeek(panelKey, index)}
                />
            ) : null}
        </div>
    );
};

import { useContext, useEffect, useState } from 'react';
import { AnycodeEditor, AnycodeEditorReact } from 'anycode-react';
import { LayoutVersionContext } from '../../components/layout/Layout';
import type { FileState, ReferencesPeekState } from '../../types';
import { ReferencesPeek } from './ReferencesPeek';
import MultibufferPanel, { type MultibufferFile } from './MultibufferPanel';

type EditorPanelProps = {
    panelKey: string;
    editors: {
        files: FileState[];
        editorStates: ReadonlyMap<string, AnycodeEditor>;
        keepPreviousEditorByPane: Readonly<Record<string, boolean>>;
        getActiveFileIdForPane: (paneId: string) => string | null;
        setActiveEditorPaneId: (paneId: string) => void;
        referencesPeekByPane?: Record<string, ReferencesPeekState | null>;
        getReferencesPeekForPane: (paneId: string) => ReferencesPeekState | null;
        closeReferencesPeek: (paneId?: string) => void;
        focusEditorInPane: (paneId: string) => void;
        setSelectedReferenceInPeek: (paneId: string, nextIndex: number) => void;
        openReferenceFromPeek: (paneId: string, itemIndex?: number) => void;
        setActiveFileId: (fileId: string | null, paneId?: string) => void;
    };
    multibufferOpen?: boolean;
    multibufferFiles?: MultibufferFile[];
    multibufferTitle?: string;
    multibufferIgnoreEdits?: boolean;
    multibufferFocusRequest?: { path: string; token: number };
    onCloseMultibuffer?: () => void;
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
}: EditorPanelProps) => {
    const layoutVersion = useContext(LayoutVersionContext);
    const paneFileId = editors.getActiveFileIdForPane(panelKey);
    const paneFile = paneFileId ? editors.files.find((file) => file.id === paneFileId) : null;
    const editorState = paneFile ? editors.editorStates.get(paneFile.id) : null;
    const referencesPeek = editors.referencesPeekByPane
        ? (editors.referencesPeekByPane[panelKey] ?? null)
        : editors.getReferencesPeekForPane(panelKey);
    const [lastReadyEditor, setLastReadyEditor] = useState<{ id: string; state: AnycodeEditor } | null>(null);

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

    if (multibufferOpen) {
        return (
            <div
                className="editor-container"
                onMouseDown={() => editors.setActiveEditorPaneId(panelKey)}
                onWheelCapture={() => editors.setActiveEditorPaneId(panelKey)}
            >
                <MultibufferPanel
                    panelKey={panelKey}
                    files={multibufferFiles}
                    openFiles={editors.files}
                    editorStates={editors.editorStates}
                    activeFileId={paneFileId}
                    onSelectFile={editors.setActiveFileId}
                    onClose={onCloseMultibuffer ?? (() => undefined)}
                    title={multibufferTitle}
                    ignoreEdits={multibufferIgnoreEdits}
                    focusRequest={multibufferFocusRequest}
                />
            </div>
        );
    }

    return (
        <div
            className="editor-container"
            onMouseDown={() => editors.setActiveEditorPaneId(panelKey)}
            onWheelCapture={() => editors.setActiveEditorPaneId(panelKey)}
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

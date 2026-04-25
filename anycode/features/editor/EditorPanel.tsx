import { AnycodeEditorReact } from 'anycode-react';
import type { ReferencesPeekState } from '../../types';
import { ReferencesPeek } from './ReferencesPeek';

type EditorPanelProps = {
    panelKey: string;
    editors: {
        files: Array<{ id: string }>;
        editorStates: ReadonlyMap<string, unknown>;
        getActiveFileIdForPane: (paneId: string) => string | null;
        setActiveEditorPaneId: (paneId: string) => void;
        getReferencesPeekForPane: (paneId: string) => ReferencesPeekState | null;
        closeReferencesPeek: (paneId?: string) => void;
        focusEditorInPane: (paneId: string) => void;
        setSelectedReferenceInPeek: (paneId: string, nextIndex: number) => void;
        openReferenceFromPeek: (paneId: string, itemIndex?: number) => void;
    };
};

export const EditorPanel = ({ panelKey, editors }: EditorPanelProps) => {
    const paneFileId = editors.getActiveFileIdForPane(panelKey);
    const paneFile = paneFileId ? editors.files.find((file) => file.id === paneFileId) : null;
    const editorState = paneFile ? editors.editorStates.get(paneFile.id) : null;
    const referencesPeek = editors.getReferencesPeekForPane(panelKey);

    return (
        <div
            className="editor-container"
            onMouseDown={() => editors.setActiveEditorPaneId(panelKey)}
        >
            {paneFile && editorState ? (
                <AnycodeEditorReact
                    key={`${panelKey}:${paneFile.id}`}
                    id={paneFile.id}
                    editorState={editorState as never}
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

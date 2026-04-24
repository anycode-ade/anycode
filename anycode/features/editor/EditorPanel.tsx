import { AnycodeEditorReact } from 'anycode-react';

type EditorPanelProps = {
    panelKey: string;
    editors: {
        files: Array<{ id: string }>;
        editorStates: ReadonlyMap<string, unknown>;
        getActiveFileIdForPane: (paneId: string) => string | null;
        setActiveEditorPaneId: (paneId: string) => void;
    };
};

export const EditorPanel = ({ panelKey, editors }: EditorPanelProps) => {
    const paneFileId = editors.getActiveFileIdForPane(panelKey);
    const paneFile = paneFileId ? editors.files.find((file) => file.id === paneFileId) : null;
    const editorState = paneFile ? editors.editorStates.get(paneFile.id) : null;

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
        </div>
    );
};

import React, { useEffect } from 'react';
import { AnycodeEditorReact } from 'anycode-react';
import { type IDockviewPanelProps } from 'dockview';
import { EditorPanelContext, useRequiredContext } from '../contexts';

export const EditorPanel: React.FC<IDockviewPanelProps> = ({ api }) => {
    const ctx = useRequiredContext(EditorPanelContext, 'EditorPanelContext');

    const paneFileId = ctx.editors.activeFileId;
    const paneFile = paneFileId ? ctx.editors.files.find((file) => file.id === paneFileId) : null;
    const editorState = paneFile ? ctx.editors.editorStates.get(paneFile.id) : undefined;

    useEffect(() => {
        if (!editorState) return;

        const restoreVisibleEditor = () => {
            window.requestAnimationFrame(() => {
                editorState.restoreScroll();
                editorState.renderCursorOrSelection();
            });
        };

        const disposable = api.onDidActiveChange(({ isActive }) => {
            if (!isActive) return;
            restoreVisibleEditor();
        });

        if (api.isActive) {
            restoreVisibleEditor();
        }

        return () => {
            disposable.dispose();
        };
    }, [api, editorState, paneFile?.id]);

    return (
        <div className="editor-container">
            {paneFile && editorState ? (
                <AnycodeEditorReact
                    key={`editor:${paneFile.id}`}
                    id={paneFile.id}
                    editorState={editorState}
                />
            ) : (
                <div className="no-editor"></div>
            )}
        </div>
    );
};

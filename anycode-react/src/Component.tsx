import React, { useLayoutEffect, useRef } from 'react';
import { AnycodeEditor } from 'anycode-base';

interface AnycodeEditorProps {
    id: string;
    editorState: AnycodeEditor;
}

export default function AnycodeEditorReact({ id, editorState,  }: AnycodeEditorProps) {

    const containerRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        if (!editorState || !containerRef.current) return;

        const host = containerRef.current;
        const editorContainer = editorState.getContainer();
        host.replaceChildren(editorContainer);

        if (editorState.hasScroll()) {
            let focus = editorState.requestedFocus();

            if (focus) {
                let { line, column } = editorState.getCursor();
                if (line !== undefined && column !== undefined) {
                    editorState.requestFocus(line, column);
                    editorState.renderCursorOrSelection();
                }
            } else {
                editorState.onAttach();
            }
        } else {
            editorState.render();
            let { line, column } = editorState.getCursor();
            if (line !== undefined && column !== undefined) {
                editorState.requestFocus(line, column);
                editorState.renderCursorOrSelection();
            }
        }

        return () => {
            // The editor node is moved between hosts on the next mount.
            // Avoid clearing here to prevent a brief blank frame during switches.
        };
    }, [id, editorState]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}

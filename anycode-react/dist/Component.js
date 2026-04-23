import { jsx as _jsx } from "react/jsx-runtime";
import { useLayoutEffect, useRef } from 'react';
export default function AnycodeEditorReact({ id, editorState, }) {
    const containerRef = useRef(null);
    useLayoutEffect(() => {
        if (!editorState || !containerRef.current)
            return;
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
            }
            else {
                editorState.onAttach();
            }
        }
        else {
            editorState.render();
            let { line, column } = editorState.getCursor();
            if (line !== undefined && column !== undefined) {
                editorState.requestFocus(line, column);
                editorState.renderCursorOrSelection();
            }
        }
        return () => {
            if (host.contains(editorContainer)) {
                host.replaceChildren();
            }
        };
    }, [id, editorState]);
    return _jsx("div", { ref: containerRef, style: { width: '100%', height: '100%' } });
}

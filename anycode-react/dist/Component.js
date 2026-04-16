import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useLayoutEffect, useRef } from 'react';
export default function AnycodeEditorReact({ id, editorState, activationKey = 0, isActive = false }) {
    const containerRef = useRef(null);
    const instanceIdRef = useRef(Math.random().toString(36).slice(2, 8));
    const didInitActivationEffectRef = useRef(false);
    const mountEditor = () => {
        if (!editorState || !containerRef.current)
            return;
        console.log('[AnycodeEditorReact] mountEditor:start', {
            instanceId: instanceIdRef.current,
            fileId: id,
            activationKey,
            hasScroll: editorState.hasScroll(),
            requestedFocus: editorState.requestedFocus(),
        });
        containerRef.current.innerHTML = '';
        containerRef.current.appendChild(editorState.getContainer());
        if (editorState.hasScroll()) {
            const focus = editorState.requestedFocus();
            if (focus) {
                const { line, column } = editorState.getCursor();
                if (line !== undefined && column !== undefined) {
                    editorState.requestFocus(line, column);
                    editorState.renderCursorOrSelection();
                }
            }
            else {
                editorState.onAttach();
            }
            return;
        }
        editorState.render();
        const { line, column } = editorState.getCursor();
        if (line !== undefined && column !== undefined) {
            editorState.requestFocus(line, column);
            editorState.renderCursorOrSelection();
        }
        console.log('[AnycodeEditorReact] mountEditor:done', {
            instanceId: instanceIdRef.current,
            fileId: id,
            activationKey,
        });
    };
    useLayoutEffect(() => {
        console.log('[AnycodeEditorReact] layoutEffect:fileChange', {
            instanceId: instanceIdRef.current,
            fileId: id,
            activationKey,
        });
        mountEditor();
    }, [id, editorState]);
    useLayoutEffect(() => {
        if (!editorState || !containerRef.current)
            return;
        if (!didInitActivationEffectRef.current) {
            didInitActivationEffectRef.current = true;
            return;
        }
        if (!isActive)
            return;
        if (!containerRef.current.contains(editorState.getContainer())) {
            console.log('[AnycodeEditorReact] layoutEffect:activation:reattachContainer', {
                instanceId: instanceIdRef.current,
                fileId: id,
                activationKey,
            });
            containerRef.current.innerHTML = '';
            containerRef.current.appendChild(editorState.getContainer());
        }
        console.log('[AnycodeEditorReact] layoutEffect:activation:onAttach', {
            instanceId: instanceIdRef.current,
            fileId: id,
            activationKey,
        });
        editorState.onAttach();
    }, [activationKey, editorState, isActive]);
    useEffect(() => {
        if (!containerRef.current || !editorState)
            return;
        const host = containerRef.current;
        let rafId = null;
        const observer = new ResizeObserver(() => {
            if (rafId !== null) {
                cancelAnimationFrame(rafId);
            }
            rafId = requestAnimationFrame(() => {
                console.log('[AnycodeEditorReact] resizeObserver:onAttach', {
                    instanceId: instanceIdRef.current,
                    fileId: id,
                    activationKey,
                });
                if (isActive) {
                    editorState.onAttach();
                }
            });
        });
        observer.observe(host);
        return () => {
            observer.disconnect();
            if (rafId !== null) {
                cancelAnimationFrame(rafId);
            }
        };
    }, [editorState, id, isActive]);
    useEffect(() => {
        console.log('[AnycodeEditorReact] mounted', {
            instanceId: instanceIdRef.current,
            fileId: id,
        });
        return () => {
            console.log('[AnycodeEditorReact] unmounted', {
                instanceId: instanceIdRef.current,
                fileId: id,
            });
        };
    }, []);
    return _jsx("div", { ref: containerRef, style: { width: '100%', height: '100%' } });
}

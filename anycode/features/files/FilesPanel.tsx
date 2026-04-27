import { useCallback, useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import { TreeNodeComponent } from '../../components';
import type { TreeNode } from '../../types';

type FilesPanelProps = {
    fileTree: TreeNode[];
    activeNodeId: string | null;
    focusRequestToken: number | null;
    onActivateNode: (nodeId: string) => void;
    onToggle: (nodeId: string) => void;
    onSelect: (nodeId: string) => void;
    onOpenFile: (path: string, line?: number, column?: number) => void;
    onLoadFolder: (path: string) => void;
    onFocusEditor: () => void;
    onNavigateByKey: (key: string, handlers: {
        onOpenFile: (path: string) => void;
        onLoadFolder: (path: string) => void;
        onFocusEditor?: () => void;
    }) => boolean;
};

export const FilesPanel = ({
    fileTree,
    activeNodeId,
    focusRequestToken,
    onActivateNode,
    onToggle,
    onSelect,
    onOpenFile,
    onLoadFolder,
    onFocusEditor,
    onNavigateByKey,
}: FilesPanelProps) => {
    const treeRef = useRef<HTMLDivElement | null>(null);
    const treeNodeRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const shouldAutoScrollRef = useRef(false);

    const handleNodeRef = useCallback((nodeId: string, element: HTMLDivElement | null) => {
        if (element) {
            treeNodeRefs.current.set(nodeId, element);
            return;
        }
        treeNodeRefs.current.delete(nodeId);
    }, []);

    const navigate = useCallback((key: string): boolean => {
        return onNavigateByKey(key, {
            onOpenFile: (path: string) => onOpenFile(path),
            onLoadFolder,
            onFocusEditor,
        });
    }, [onFocusEditor, onLoadFolder, onNavigateByKey, onOpenFile]);

    const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
        const handled = navigate(event.key);
        if (handled) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                shouldAutoScrollRef.current = true;
            }
            event.preventDefault();
        }
    }, [navigate]);

    const handleMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
        if (event.button !== 0) {
            return;
        }
        treeRef.current?.focus();
    }, []);

    useEffect(() => {
        const onDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
            const treeEl = treeRef.current;
            if (!treeEl) {
                return;
            }

            const activeEl = document.activeElement;
            const isTreeFocused = activeEl === treeEl || treeEl.contains(activeEl);
            if (!isTreeFocused) {
                return;
            }

            const handled = navigate(event.key);
            if (handled) {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                    shouldAutoScrollRef.current = true;
                }
                event.preventDefault();
                event.stopPropagation();
                if (event.key === 'Enter') {
                    treeRef.current?.blur();
                }
            }
        };

        document.addEventListener('keydown', onDocumentKeyDown, true);
        return () => {
            document.removeEventListener('keydown', onDocumentKeyDown, true);
        };
    }, [navigate]);

    useEffect(() => {
        if (focusRequestToken === null) {
            return;
        }

        treeRef.current?.focus();
    }, [focusRequestToken]);

    useEffect(() => {
        if (!activeNodeId) {
            return;
        }
        if (!shouldAutoScrollRef.current) {
            return;
        }

        const nodeEl = treeNodeRefs.current.get(activeNodeId);
        nodeEl?.scrollIntoView({ block: 'nearest' });
        shouldAutoScrollRef.current = false;
    }, [activeNodeId]);

    return (
        <div className="file-system-panel">
            <div className="file-system-content">
                {fileTree.length === 0 ? (
                    <p className="file-system-empty"> </p>
                ) : (
                    <div
                        ref={treeRef}
                        className="file-tree"
                        role="tree"
                        tabIndex={0}
                        onKeyDown={handleKeyDown}
                        onMouseDown={handleMouseDown}
                    >
                        {fileTree.map((node) => (
                            <TreeNodeComponent
                                key={node.id}
                                node={node}
                                activeNodeId={activeNodeId}
                                onNodeRef={handleNodeRef}
                                onActivate={onActivateNode}
                                onToggle={onToggle}
                                onSelect={onSelect}
                                onOpenFile={onOpenFile}
                                onLoadFolder={onLoadFolder}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

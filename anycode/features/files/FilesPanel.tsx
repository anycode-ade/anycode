import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { TreeNodeComponent, type ChangedFile } from '../../components';
import type { TreeNode } from '../../types';
import { Icons } from '../../components/Icons';
import { usePersistedScroll } from '../../hooks/usePersistedScroll';
import { normalizePath } from '../../utils';

type FilesPanelProps = {
    fileTree: TreeNode[];
    activeNodeId: string | null;
    changedFiles?: ChangedFile[];
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
    fileIconsStyle?: 'colored' | 'monochrome' | 'disabled';
    onDeleteNode?: (path: string) => void;
    onRenameNode?: (oldPath: string, newPath: string) => void;
    onCreateNode?: (parentPath: string, name: string, isFile: boolean, onCreated?: (path: string) => void) => void;
};

const getParentPath = (path: string): string => {
    const lastSlashIndex = path.lastIndexOf('/');
    return lastSlashIndex !== -1 ? path.substring(0, lastSlashIndex) : '';
};

interface ContextMenuState {
    x: number;
    y: number;
    node: TreeNode;
}

interface CreatingNodeState {
    parentPath: string;
    isFile: boolean;
}

export const FilesPanel = ({
    fileTree,
    activeNodeId,
    changedFiles,
    focusRequestToken,
    onActivateNode,
    onToggle,
    onSelect,
    onOpenFile,
    onLoadFolder,
    onFocusEditor,
    onNavigateByKey,
    fileIconsStyle,
    onDeleteNode,
    onRenameNode,
    onCreateNode,
}: FilesPanelProps) => {
    const scrollRef = usePersistedScroll<HTMLDivElement>('files-panel', 'local', [fileTree]);
    const treeRef = useRef<HTMLDivElement | null>(null);
    const treeNodeRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const shouldAutoScrollRef = useRef(false);
    const suppressNextTreeClickRef = useRef(false);

    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
    const [creatingNode, setCreatingNode] = useState<CreatingNodeState | null>(null);

    const gitStatusMap = useMemo(() => {
        const map = new Map<string, string>();
        if (!changedFiles || changedFiles.length === 0) return map;
        for (const file of changedFiles) {
            const norm = normalizePath(file.path).replace(/^\/+/, '');
            const status = file.status || 'modified';
            map.set(norm, status);

            let parent = norm;
            while (parent.includes('/')) {
                parent = parent.substring(0, parent.lastIndexOf('/'));
                if (!map.has(parent)) {
                    map.set(parent, 'modified');
                }
            }
        }
        return map;
    }, [changedFiles]);

    const handleNodeRef = useCallback((nodeId: string, element: HTMLDivElement | null) => {
        if (element) {
            treeNodeRefs.current.set(nodeId, element);
            return;
        }
        treeNodeRefs.current.delete(nodeId);
    }, []);

    const handleContextMenu = useCallback((e: React.MouseEvent, node: TreeNode) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY, node });
    }, []);

    const closeContextMenu = useCallback(() => {
        setContextMenu(null);
    }, []);

    useEffect(() => {
        if (!contextMenu) return;

        const handleGlobalClick = () => {
            closeContextMenu();
        };

        const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
            if (e.key === 'Escape') {
                closeContextMenu();
            }
        };

        document.addEventListener('click', handleGlobalClick);
        document.addEventListener('contextmenu', handleGlobalClick);
        document.addEventListener('keydown', handleGlobalKeyDown);

        return () => {
            document.removeEventListener('click', handleGlobalClick);
            document.removeEventListener('contextmenu', handleGlobalClick);
            document.removeEventListener('keydown', handleGlobalKeyDown);
        };
    }, [contextMenu, closeContextMenu]);

    const getRelativePath = useCallback((absolutePath: string) => {
        const rootPath = fileTree[0]?.path;
        if (!rootPath) return absolutePath;
        if (absolutePath === rootPath) return '.';
        if (absolutePath.startsWith(rootPath + '/')) {
            return absolutePath.substring(rootPath.length + 1);
        }
        return absolutePath;
    }, [fileTree]);

    const handleCopyName = (e: React.MouseEvent) => {
        e.stopPropagation();
        closeContextMenu();
        if (!contextMenu) return;
        navigator.clipboard.writeText(contextMenu.node.name);
    };

    const handleCopyRelativePath = (e: React.MouseEvent) => {
        e.stopPropagation();
        closeContextMenu();
        if (!contextMenu) return;
        const relativePath = getRelativePath(contextMenu.node.path);
        navigator.clipboard.writeText(relativePath);
    };

    const handleCopyFullPath = (e: React.MouseEvent) => {
        e.stopPropagation();
        closeContextMenu();
        if (!contextMenu) return;
        navigator.clipboard.writeText(contextMenu.node.path);
    };

    const handleRenameClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        closeContextMenu();
        if (contextMenu) {
            setEditingNodeId(contextMenu.node.id);
        }
    };

    const handleNewFileClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        closeContextMenu();
        if (contextMenu) {
            const node = contextMenu.node;
            const parentPath = node.type === 'directory' ? node.path : getParentPath(node.path);
            setCreatingNode({ parentPath, isFile: true });
            setEditingNodeId('virtual-new-node');
        }
    };

    const handleNewFolderClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        closeContextMenu();
        if (contextMenu) {
            const node = contextMenu.node;
            const parentPath = node.type === 'directory' ? node.path : getParentPath(node.path);
            setCreatingNode({ parentPath, isFile: false });
            setEditingNodeId('virtual-new-node');
        }
    };

    const handleRenameSubmit = useCallback((oldPath: string, newName: string) => {
        setEditingNodeId(null);

        const isCreate = oldPath.endsWith('/virtual-temp-node');
        if (isCreate) {
            setCreatingNode(null);
            if (onCreateNode && creatingNode) {
                onCreateNode(creatingNode.parentPath, newName, creatingNode.isFile);
            }
            return;
        }

        if (!onRenameNode) return;

        const lastSlashIndex = oldPath.lastIndexOf('/');
        const parentPath = lastSlashIndex !== -1 ? oldPath.substring(0, lastSlashIndex) : '';
        const newPath = parentPath ? `${parentPath}/${newName}` : newName;

        onRenameNode(oldPath, newPath);
    }, [onRenameNode, onCreateNode, creatingNode]);

    const handleDeleteClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        closeContextMenu();

        if (!contextMenu || !onDeleteNode) return;

        const { node } = contextMenu;
        const isFile = node.type === 'file';
        const typeStr = isFile ? 'file' : 'folder';
        const confirmMsg = `Are you sure you want to delete the ${typeStr} "${node.name}"?\nThis action cannot be undone.`;

        if (window.confirm(confirmMsg)) {
            onDeleteNode(node.path);
        }
    };

    const handlePanelContextMenu = (e: React.MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.closest('.tree-item-content')) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        const rootPath = fileTree[0]?.path || '';
        const rootNode: TreeNode = {
            id: rootPath,
            name: '',
            path: rootPath,
            type: 'directory',
            isExpanded: true,
        };

        setContextMenu({
            x: e.clientX, y: e.clientY, node: rootNode,
        });
    };

    const navigate = useCallback((key: string): boolean => {
        return onNavigateByKey(key, {
            onOpenFile: (path: string) => onOpenFile(path),
            onLoadFolder: (path: string) => onLoadFolder(path),
            onFocusEditor: onFocusEditor,
        });
    }, [onNavigateByKey, onOpenFile, onLoadFolder, onFocusEditor]);

    const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
        if (editingNodeId !== null) {
            return;
        }
        if (navigate(e.key)) {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                shouldAutoScrollRef.current = true;
            }
            e.preventDefault();
            e.stopPropagation();
            if (e.key === 'Enter') {
                treeRef.current?.blur();
            }
        }
    }, [navigate, editingNodeId]);

    const handleMouseDown = useCallback((e: MouseEvent<HTMLDivElement>) => {
        if (e.button !== 0) {
            return;
        }
        treeRef.current?.focus({ preventScroll: true });
    }, []);

    const handleTreeMouseDownCapture = useCallback((e: MouseEvent<HTMLDivElement>) => {
        if (e.button !== 0 || !contextMenu) {
            return;
        }

        suppressNextTreeClickRef.current = true;
        closeContextMenu();
        e.preventDefault();
        e.stopPropagation();
    }, [closeContextMenu, contextMenu]);

    const handleTreeClickCapture = useCallback((e: MouseEvent<HTMLDivElement>) => {
        if (!suppressNextTreeClickRef.current) {
            return;
        }

        suppressNextTreeClickRef.current = false;
        e.preventDefault();
        e.stopPropagation();
    }, []);

    useEffect(() => {
        if (focusRequestToken === null) {
            return;
        }

        treeRef.current?.focus({ preventScroll: true });
    }, [focusRequestToken]);

    useEffect(() => {
        if (!activeNodeId || !shouldAutoScrollRef.current) return;
        const activeElement = treeNodeRefs.current.get(activeNodeId);
        if (activeElement) {
            activeElement.scrollIntoView({ block: 'nearest' });
        }
        shouldAutoScrollRef.current = false;
    }, [activeNodeId]);

    const injectVirtualNode = useCallback((nodes: TreeNode[]): TreeNode[] => {
        if (!creatingNode) return nodes;

        return nodes.map((node) => {
            if (node.path === creatingNode.parentPath && node.type === 'directory') {
                const virtualNode: TreeNode = {
                    id: 'virtual-new-node',
                    name: '',
                    path: `${creatingNode.parentPath}/virtual-temp-node`,
                    type: creatingNode.isFile ? 'file' : 'directory',
                    isExpanded: false,
                };
                return {
                    ...node,
                    isExpanded: true,
                    children: node.children ? [...node.children, virtualNode] : [virtualNode],
                };
            }
            if (node.children) {
                return {
                    ...node,
                    children: injectVirtualNode(node.children),
                };
            }
            return node;
        });
    }, [creatingNode]);

    const displayTree = useMemo(() => {
        return injectVirtualNode(fileTree);
    }, [fileTree, injectVirtualNode]);

    const menuWidth = 196;
    const menuHeight = 250;
    const xPos = contextMenu ? Math.min(contextMenu.x, window.innerWidth - menuWidth - 8) : 0;
    const yPos = contextMenu ? Math.min(contextMenu.y, window.innerHeight - menuHeight - 8) : 0;

    const isWorkspaceRoot = contextMenu && fileTree[0] && contextMenu.node.path === fileTree[0].path;

    return (
        <div className="file-system-panel">
            <div ref={scrollRef} className="file-system-content" onContextMenu={handlePanelContextMenu}>
                {displayTree.length === 0 ? (
                    <p className="file-system-empty"> </p>
                ) : (
                    <div
                        ref={treeRef}
                        className="file-tree"
                        role="tree"
                        tabIndex={0}
                        onKeyDown={handleKeyDown}
                        onMouseDownCapture={handleTreeMouseDownCapture}
                        onClickCapture={handleTreeClickCapture}
                        onMouseDown={handleMouseDown}
                    >
                        {displayTree.map((node) => (
                            <TreeNodeComponent
                                key={node.id}
                                node={node}
                                activeNodeId={activeNodeId}
                                fileIconsStyle={fileIconsStyle}
                                gitStatusMap={gitStatusMap}
                                onNodeRef={handleNodeRef}
                                onActivate={onActivateNode}
                                onToggle={onToggle}
                                onSelect={onSelect}
                                onOpenFile={onOpenFile}
                                onLoadFolder={onLoadFolder}
                                onContextMenu={handleContextMenu}
                                editingNodeId={editingNodeId}
                                onRename={handleRenameSubmit}
                                onCancelRename={() => {
                                    setEditingNodeId(null);
                                    setCreatingNode(null);
                                }}
                            />
                        ))}
                    </div>
                )}
            </div>

            {contextMenu && createPortal(
                <div
                    className="tree-context-menu"
                    style={{
                        position: 'fixed',
                        left: xPos,
                        top: yPos,
                        zIndex: 9999,
                    }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button type="button" onClick={handleNewFileClick}>
                        New File
                    </button>
                    <button type="button" onClick={handleNewFolderClick}>
                        New Folder
                    </button>
                    <div className="tree-context-menu-separator" />
                    <button type="button" onClick={handleCopyName}>
                        Copy Name
                    </button>
                    <button type="button" onClick={handleCopyRelativePath}>
                        Copy Relative Path
                    </button>
                    <button type="button" onClick={handleCopyFullPath}>
                        Copy Full Path
                    </button>
                    {!isWorkspaceRoot && (
                        <>
                            <button type="button" onClick={handleRenameClick}>
                                Rename...
                            </button>
                            <div className="tree-context-menu-separator" />
                            <button
                                type="button"
                                className="delete"
                                onClick={handleDeleteClick}
                            >
                                <Icons.Trash size={14} />
                                <span>Delete {contextMenu.node.type === 'file' ? 'File' : 'Folder'}</span>
                            </button>
                        </>
                    )}
                </div>,
                document.body,
            )}
        </div>
    );
};

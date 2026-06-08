import { useCallback, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { TreeNode, WatcherCreate, WatcherRemove } from '../types';
import { getFileName, getParentPath, joinPath } from '../utils';

type UseFileTreeParams = {
    wsRef: React.RefObject<Socket | null>;
    isConnected: boolean;
};

type TreeNavigationHandlers = {
    onOpenFile: (path: string) => void;
    onLoadFolder: (path: string) => void;
    onFocusEditor?: () => void;
};

type VisibleTreeWalkContext = {
    firstVisible: TreeNode | null;
    prevVisible: TreeNode | null;
    currentNode: TreeNode | null;
    nextVisible: TreeNode | null;
    parentNode: TreeNode | null;
};

const findSelectedNodeId = (nodes: TreeNode[]): string | null => {
    for (const node of nodes) {
        if (node.isSelected) {
            return node.id;
        }

        if (node.children?.length) {
            const selectedId = findSelectedNodeId(node.children);
            if (selectedId) {
                return selectedId;
            }
        }
    }

    return null;
};

const mergeChildrenWithPreviousState = (
    nextChildren: TreeNode[],
    prevChildren: TreeNode[] = [],
): TreeNode[] => {
    const prevById = new Map(prevChildren.map((child) => [child.id, child]));

    return nextChildren.map((nextChild) => {
        const prevChild = prevById.get(nextChild.id);
        if (!prevChild || prevChild.type !== nextChild.type) {
            return nextChild;
        }

        if (nextChild.type === 'directory') {
            return {
                ...nextChild,
                children: prevChild.children ?? nextChild.children,
                isExpanded: prevChild.isExpanded ?? nextChild.isExpanded,
                isSelected: prevChild.isSelected ?? nextChild.isSelected,
                isLoading: false,
                hasLoaded: prevChild.hasLoaded ?? nextChild.hasLoaded,
            };
        }

        return {
            ...nextChild,
            isSelected: prevChild.isSelected ?? nextChild.isSelected,
        };
    });
};

const walkVisibleForNode = (nodes: TreeNode[], targetNodeId: string | null): VisibleTreeWalkContext => {
    const context: VisibleTreeWalkContext = {
        firstVisible: null,
        prevVisible: null,
        currentNode: null,
        nextVisible: null,
        parentNode: null,
    };

    let lastVisited: TreeNode | null = null;
    let shouldPickNext = false;

    const walk = (innerNodes: TreeNode[], parent: TreeNode | null = null) => {
        for (const node of innerNodes) {
            if (!context.firstVisible) {
                context.firstVisible = node;
            }

            if (shouldPickNext && !context.nextVisible) {
                context.nextVisible = node;
                shouldPickNext = false;
            }

            if (targetNodeId && node.id === targetNodeId) {
                context.currentNode = node;
                context.parentNode = parent;
                context.prevVisible = lastVisited;
                shouldPickNext = true;
            }

            lastVisited = node;

            if (node.type === 'directory' && node.isExpanded && node.children?.length) {
                walk(node.children, node);
            }
        }
    };

    walk(nodes);
    return context;
};

export const useFileTree = ({ wsRef, isConnected }: UseFileTreeParams) => {
    const [fileTree, setFileTree] = useState<TreeNode[]>([]);
    const [activeNodeId, setActiveNodeId] = useState<string | null>(null);

    const setActiveNode = useCallback((nodeId: string | null) => {
        setActiveNodeId(nodeId);
    }, []);

    const convertToTree = useCallback((files: string[], dirs: string[], basePath: string): TreeNode[] => {
        const treeNodes: TreeNode[] = [];

        dirs.forEach((dirName) => {
            const dirPath = basePath === '.' ? dirName : joinPath(basePath, dirName);
            treeNodes.push({
                id: dirPath,
                name: dirName,
                type: 'directory',
                path: dirPath,
                children: [],
                isExpanded: false,
                isSelected: false,
                isLoading: false,
                hasLoaded: false,
            });
        });

        files.forEach((fileName) => {
            const filePath = basePath === '.' ? fileName : joinPath(basePath, fileName);
            treeNodes.push({
                id: filePath,
                name: fileName,
                type: 'file',
                path: filePath,
                isExpanded: false,
                isSelected: false,
                isLoading: false,
                hasLoaded: false,
            });
        });

        return treeNodes;
    }, []);

    const handleOpenFolderResponse = useCallback((response: any) => {
        if (response.error) {
            console.error('Failed to open folder:', response.error);
            return;
        }

        const basePath = response.fullpath;

        setFileTree((prev) => {
            if (response.relative_path === '.') {
                const prevRoot = prev.find((node) => node.id === basePath);
                const children = convertToTree(response.files, response.dirs, basePath);
                const mergedChildren = mergeChildrenWithPreviousState(children, prevRoot?.children);
                const rootNode: TreeNode = {
                    id: basePath,
                    name: response.name || 'Root',
                    type: 'directory',
                    path: basePath,
                    children: mergedChildren,
                    isExpanded: true,
                    isSelected: prevRoot?.isSelected ?? false,
                    isLoading: false,
                    hasLoaded: true,
                };
                return [rootNode];
            }

            const updateNode = (nodes: TreeNode[]): TreeNode[] => {
                return nodes.map((node) => {
                    if (node.id === basePath) {
                        const nextChildren = convertToTree(response.files, response.dirs, basePath);
                        return {
                            ...node,
                            children: mergeChildrenWithPreviousState(nextChildren, node.children),
                            isExpanded: true,
                            isLoading: false,
                            hasLoaded: true,
                        };
                    }

                    if (node.children) {
                        return { ...node, children: updateNode(node.children) };
                    }

                    return node;
                });
            };

            return updateNode(prev);
        });
    }, [convertToTree]);

    const openFolder = useCallback((path: string) => {
        if (!wsRef.current || !isConnected) return;
        wsRef.current.emit('dir:list', { path }, handleOpenFolderResponse);
    }, [wsRef, isConnected, handleOpenFolderResponse]);

    const toggleNode = useCallback((nodeId: string) => {
        setFileTree((prevTree) => {
            const updateNode = (nodes: TreeNode[]): TreeNode[] => {
                return nodes.map((node) => {
                    if (node.id === nodeId) {
                        return { ...node, isExpanded: !node.isExpanded };
                    }

                    if (node.children) {
                        return { ...node, children: updateNode(node.children) };
                    }

                    return node;
                });
            };

            return updateNode(prevTree);
        });
    }, []);

    const findNodeByPath = useCallback((nodes: TreeNode[], filePath: string): TreeNode | null => {
        for (const node of nodes) {
            if (node.path === filePath && node.type === 'file') {
                return node;
            }
            if (node.children) {
                const found = findNodeByPath(node.children, filePath);
                if (found) return found;
            }
        }
        return null;
    }, []);

    const selectNode = useCallback((nodeId: string) => {
        setFileTree((prevTree) => {
            const updateNode = (nodes: TreeNode[]): TreeNode[] => {
                return nodes.map((node) => {
                    const updatedChildren = node.children ? updateNode(node.children) : undefined;
                    if (node.id === nodeId) {
                        return { ...node, isSelected: true, children: updatedChildren };
                    }
                    return { ...node, isSelected: false, children: updatedChildren };
                });
            };
            return updateNode(prevTree);
        });
    }, []);

    const clearFileSelection = useCallback(() => {
        const hasSelection = (nodes: TreeNode[]): boolean => {
            if (!Array.isArray(nodes)) return false;
            for (const node of nodes) {
                if (node.isSelected) return true;
                if (node.children && hasSelection(node.children)) return true;
            }
            return false;
        };

        setFileTree((prevTree) => {
            if (!hasSelection(prevTree)) {
                return prevTree;
            }
            const clearSelection = (nodes: TreeNode[]): TreeNode[] => {
                return nodes.map((node) => {
                    const updatedChildren = node.children ? clearSelection(node.children) : undefined;
                    return { ...node, isSelected: false, children: updatedChildren };
                });
            };
            return clearSelection(prevTree);
        });
    }, []);

    const navigateByKey = useCallback((key: string, handlers: TreeNavigationHandlers): boolean => {
        if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(key)) {
            return false;
        }

        if (!fileTree.length) {
            return true;
        }

        const fallbackNodeId = activeNodeId ?? findSelectedNodeId(fileTree);
        const {
            firstVisible,
            prevVisible,
            currentNode,
            nextVisible,
            parentNode,
        } = walkVisibleForNode(fileTree, fallbackNodeId);

        if (key === 'ArrowDown') {
            if (!currentNode) {
                if (firstVisible) {
                    setActiveNodeId(firstVisible.id);
                }
                return true;
            }

            if (nextVisible) {
                setActiveNodeId(nextVisible.id);
            }
            return true;
        }

        if (key === 'ArrowUp') {
            if (!currentNode) {
                if (firstVisible) {
                    setActiveNodeId(firstVisible.id);
                }
                return true;
            }

            if (prevVisible) {
                setActiveNodeId(prevVisible.id);
            }
            return true;
        }

        if (key === 'ArrowLeft') {
            if (!currentNode) {
                return true;
            }

            if (currentNode.type === 'directory') {
                if (currentNode.isExpanded) {
                    toggleNode(currentNode.id);
                    return true;
                }

                if (parentNode) {
                    setActiveNodeId(parentNode.id);
                }
                return true;
            }

            if (parentNode) {
                if (parentNode.type === 'directory' && parentNode.isExpanded) {
                    toggleNode(parentNode.id);
                }
                setActiveNodeId(parentNode.id);
            }
            return true;
        }

        if (key === 'ArrowRight') {
            if (!currentNode) {
                if (firstVisible) {
                    setActiveNodeId(firstVisible.id);
                }
                return true;
            }

            if (currentNode.type === 'directory' && !currentNode.isExpanded) {
                handlers.onLoadFolder(currentNode.path);
            }
            return true;
        }

        if (key === 'Enter' && currentNode?.type === 'file') {
            setActiveNodeId(currentNode.id);
            selectNode(currentNode.id);
            handlers.onOpenFile(currentNode.path);
            handlers.onFocusEditor?.();
            return true;
        }

        return false;
    }, [activeNodeId, fileTree, selectNode, toggleNode]);

    const handleWatcherCreate = useCallback((watcherCreate: WatcherCreate) => {
        const { path, isFile } = watcherCreate;
        const fileName = getFileName(path);
        const parentPath = getParentPath(path);

        setFileTree((prevTree) => {
            const addNode = (nodes: TreeNode[]): TreeNode[] => {
                return nodes.map((node) => {
                    if (node.type === 'directory' && node.path === parentPath && node.children) {
                        const exists = node.children.some((child) => child.path === path);
                        if (exists) return node;

                        const newNode: TreeNode = {
                            id: path,
                            name: fileName,
                            type: isFile ? 'file' : 'directory',
                            path,
                            children: isFile ? undefined : [],
                            isExpanded: false,
                            isSelected: false,
                            isLoading: false,
                            hasLoaded: !isFile,
                        };

                        return {
                            ...node,
                            children: [...node.children, newNode].sort((a, b) => {
                                if (a.type !== b.type) {
                                    return a.type === 'directory' ? -1 : 1;
                                }
                                return a.name.localeCompare(b.name);
                            }),
                        };
                    }

                    if (node.children) {
                        return { ...node, children: addNode(node.children) };
                    }

                    return node;
                });
            };

            return addNode(prevTree);
        });
    }, []);

    const handleWatcherRemove = useCallback((watcherRemove: WatcherRemove) => {
        const { path } = watcherRemove;

        setFileTree((prevTree) => {
            const removeNode = (nodes: TreeNode[]): TreeNode[] => {
                return nodes
                    .filter((node) => node.path !== path)
                    .map((node) => {
                        if (node.children) {
                            return { ...node, children: removeNode(node.children) };
                        }
                        return node;
                    });
            };

            return removeNode(prevTree);
        });

        setActiveNodeId((prev) => (prev === path ? null : prev));
    }, []);

    const deleteNode = useCallback((path: string) => {
        if (!wsRef.current || !isConnected) return;
        wsRef.current.emit('file:delete', { path }, (response: any) => {
            if (response && response.error) {
                console.error('Failed to delete file/folder:', response.error);
            }
        });
    }, [wsRef, isConnected]);

    const renameNodeOnDisk = useCallback((oldPath: string, newPath: string) => {
        if (!wsRef.current || !isConnected) return;
        wsRef.current.emit('file:rename', { old_path: oldPath, new_path: newPath }, (response: any) => {
            if (response && response.error) {
                console.error('Failed to rename file/folder:', response.error);
            }
        });
    }, [wsRef, isConnected]);

    const createNodeOnDisk = useCallback((parentPath: string, name: string, isFile: boolean, onCreated?: (path: string) => void) => {
        if (!wsRef.current || !isConnected) return;
        wsRef.current.emit('file:create', { parent_path: parentPath, name, is_file: isFile }, (response: any) => {
            if (response && response.success) {
                const createdPath = isFile ? response.file : response.dir;
                if (createdPath) {
                    handleWatcherCreate({ path: createdPath, isFile });
                    onCreated?.(createdPath);
                }
            } else if (response && response.error) {
                console.error('Failed to create file/folder:', response.error);
            }
        });
    }, [wsRef, isConnected, handleWatcherCreate]);

    const handleFileRenamed = useCallback((data: { old: string; new: string }) => {
        const { old: oldPath, new: newPath } = data;
        const fileName = getFileName(newPath);
        const oldPrefix = oldPath + '/';
        const newPrefix = newPath + '/';

        setFileTree((prevTree) => {
            const renameInNodes = (nodes: TreeNode[]): TreeNode[] => {
                return nodes.map((node) => {
                    if (node.path === oldPath) {
                        return {
                            ...node,
                            id: newPath,
                            name: fileName,
                            path: newPath,
                            children: node.children ? renameInNodes(node.children) : undefined,
                        };
                    }
                    if (node.path.startsWith(oldPrefix)) {
                        const relative = node.path.substring(oldPrefix.length);
                        const nextPath = newPrefix + relative;
                        return {
                            ...node,
                            id: nextPath,
                            path: nextPath,
                            children: node.children ? renameInNodes(node.children) : undefined,
                        };
                    }
                    if (node.children) {
                        return { ...node, children: renameInNodes(node.children) };
                    }
                    return node;
                });
            };
            return renameInNodes(prevTree);
        });

        setActiveNodeId((prev) => {
            if (prev === oldPath) return newPath;
            if (prev?.startsWith(oldPrefix)) {
                return newPrefix + prev.substring(oldPrefix.length);
            }
            return prev;
        });
    }, []);

    return {
        fileTree,
        deleteNode,
        renameNodeOnDisk,
        createNodeOnDisk,
        handleFileRenamed,
        activeNodeId,
        setActiveNode,
        openFolder,
        handleOpenFolderResponse,
        toggleNode,
        findNodeByPath,
        selectNode,
        clearFileSelection,
        navigateByKey,
        handleWatcherCreate,
        handleWatcherRemove,
    };
};

import { useCallback, useState } from 'react';
import type { TreeNode, WatcherCreate, WatcherRemove } from '../types';
import { getFileName, getParentPath, joinPath } from '../utils';

export const useFileTree = () => {
    const [fileTree, setFileTree] = useState<TreeNode[]>([]);

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

        if (response.relative_path === '.') {
            const children = convertToTree(response.files, response.dirs, basePath);
            const rootNode: TreeNode = {
                id: basePath,
                name: response.name || 'Root',
                type: 'directory',
                path: basePath,
                children,
                isExpanded: true,
                isSelected: false,
                isLoading: false,
                hasLoaded: true,
            };
            setFileTree([rootNode]);
            return;
        }

        setFileTree((prev) => {
            const updateNode = (nodes: TreeNode[]): TreeNode[] => {
                return nodes.map((node) => {
                    if (node.id === basePath) {
                        return {
                            ...node,
                            children: convertToTree(response.files, response.dirs, basePath),
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
        setFileTree((prevTree) => {
            const clearSelection = (nodes: TreeNode[]): TreeNode[] => {
                return nodes.map((node) => {
                    const updatedChildren = node.children ? clearSelection(node.children) : undefined;
                    return { ...node, isSelected: false, children: updatedChildren };
                });
            };
            return clearSelection(prevTree);
        });
    }, []);

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
    }, []);

    return {
        fileTree,
        handleOpenFolderResponse,
        toggleNode,
        findNodeByPath,
        selectNode,
        clearFileSelection,
        handleWatcherCreate,
        handleWatcherRemove,
    };
};

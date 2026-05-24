import React, { memo } from 'react';
import { TreeNode } from '../types';
import './TreeNodeComponent.css';

interface TreeNodeComponentProps {
    node: TreeNode;
    level?: number;
    activeNodeId: string | null;
    onNodeRef: (nodeId: string, element: HTMLDivElement | null) => void;
    onActivate: (nodeId: string) => void;
    onToggle: (nodeId: string) => void;
    onSelect: (nodeId: string) => void;
    onOpenFile: (path: string) => void;
    onLoadFolder: (path: string) => void;
}

const isPathWithinNode = (nodePath: string, activeNodeId: string | null): boolean => {
    if (!activeNodeId) {
        return false;
    }

    if (activeNodeId === nodePath) {
        return true;
    }

    return activeNodeId.startsWith(`${nodePath}/`);
};

const TreeNodeComponentImpl: React.FC<TreeNodeComponentProps> = ({
    node,
    level = 0,
    activeNodeId,
    onNodeRef,
    onActivate,
    onToggle,
    onSelect,
    onOpenFile,
    onLoadFolder,
}) => {
    const hasChildren = node.type === 'directory';
    const isExpanded = Boolean(node.isExpanded);
    const isSelected = Boolean(node.isSelected);
    const isActive = activeNodeId === node.id;

    const handleToggle = (e: React.MouseEvent) => {
        e.stopPropagation();
        onActivate(node.id);

        if (!hasChildren) {
            return;
        }

        if (!isExpanded) {
            onLoadFolder(node.path);
        } else {
            onToggle(node.id);
        }
    };

    const handleNameClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isActive) {
            return;
        }
        onActivate(node.id);

        if (node.type === 'file') {
            onSelect(node.id);
            onOpenFile(node.path);
            return;
        }

        if (!isExpanded) {
            onLoadFolder(node.path);
            return;
        }

        onToggle(node.id);
    };

    const title = typeof node.size === 'number' ? `${node.path} ${node.size} B` : node.path;
    const handleActivateOnly = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.button !== 0) {
            return;
        }
        onActivate(node.id);
    };

    return (
        <div className="tree-item">
            <div
                className={`tree-item-content ${node.type} ${isSelected ? 'selected' : ''} ${isActive ? 'active' : ''}`}
                ref={(element) => onNodeRef(node.id, element)}
                onMouseDown={handleActivateOnly}
            >
                <div className="tree-indent" style={{ width: level * 20 }}></div>

                <div
                    className={`tree-toggle ${hasChildren ? (isExpanded ? 'expanded' : 'collapsed') : 'leaf'}`}
                    onClick={handleToggle}
                >
                    {hasChildren ? '▶' : ''}
                </div>

                <span className="tree-name" title={title} onClick={handleNameClick} onMouseDown={(e) => e.stopPropagation()}>
                    {node.name}
                </span>
            </div>

            {hasChildren && isExpanded && node.children && node.children.length > 0 && (
                <div className="tree-children">
                    {node.children.map((child) => (
                        <TreeNodeComponent
                            key={child.id}
                            node={child}
                            level={level + 1}
                            activeNodeId={activeNodeId}
                            onNodeRef={onNodeRef}
                            onActivate={onActivate}
                            onToggle={onToggle}
                            onSelect={onSelect}
                            onOpenFile={onOpenFile}
                            onLoadFolder={onLoadFolder}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

const areEqual = (prev: TreeNodeComponentProps, next: TreeNodeComponentProps): boolean => {
    if (prev.node !== next.node) {
        return false;
    }

    if (prev.level !== next.level) {
        return false;
    }

    if (
        prev.onNodeRef !== next.onNodeRef
        || prev.onActivate !== next.onActivate
        || prev.onToggle !== next.onToggle
        || prev.onSelect !== next.onSelect
        || prev.onOpenFile !== next.onOpenFile
        || prev.onLoadFolder !== next.onLoadFolder
    ) {
        return false;
    }

    if (prev.activeNodeId === next.activeNodeId) {
        return true;
    }

    const prevAffectsNode = prev.activeNodeId === prev.node.id;
    const nextAffectsNode = next.activeNodeId === next.node.id;
    if (prevAffectsNode || nextAffectsNode) {
        return false;
    }

    if (prev.node.type === 'directory') {
        const prevInside = isPathWithinNode(prev.node.path, prev.activeNodeId);
        const nextInside = isPathWithinNode(prev.node.path, next.activeNodeId);
        if (prevInside || nextInside) {
            return false;
        }
    }

    return true;
};

export const TreeNodeComponent = memo(TreeNodeComponentImpl, areEqual);

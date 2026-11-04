import React, { useState, useEffect, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import { Icons } from '../../components/Icons';

interface TreeItemData {
  id?: string;
  label: string;
  description?: string;
  tooltip?: string;
  icon?: string;
  collapsibleState: number; // 0: None, 1: Collapsed, 2: Expanded
  command?: { command: string; arguments?: any[] };
  children?: TreeItemData[];
  isExpanded?: boolean;
  isLoading?: boolean;
}

interface TreeViewPanelProps {
  viewId: string;
  title: string;
  wsRef: React.RefObject<Socket | null>;
  onOpenFile?: (path: string) => void;
  refreshTrigger?: number;
}

export const TreeViewPanel: React.FC<TreeViewPanelProps> = ({
  viewId,
  title,
  wsRef,
  onOpenFile,
  refreshTrigger = 0,
}) => {
  const [items, setItems] = useState<TreeItemData[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchChildren = useCallback(
    (elementId?: string): Promise<TreeItemData[]> => {
      return new Promise((resolve) => {
        if (!wsRef.current) return resolve([]);
        wsRef.current.emit('ext:treeview:children', { viewId, elementId }, (res: any[]) => {
          if (Array.isArray(res)) {
            resolve(
              res.map((item) => ({
                ...item,
                isExpanded: item.collapsibleState === 2,
              }))
            );
          } else {
            resolve([]);
          }
        });
      });
    },
    [viewId, wsRef]
  );

  const reloadTree = useCallback(() => {
    setIsLoading(true);
    fetchChildren().then((rootItems) => {
      setItems(rootItems);
      setIsLoading(false);
    });
  }, [fetchChildren]);

  useEffect(() => {
    reloadTree();
  }, [reloadTree, refreshTrigger]);

  const handleItemClick = async (item: TreeItemData) => {
    if (item.collapsibleState > 0) {
      if (!item.isExpanded && !item.children) {
        item.isLoading = true;
        setItems([...items]);
        const children = await fetchChildren(item.id);
        item.children = children;
        item.isLoading = false;
      }
      item.isExpanded = !item.isExpanded;
      setItems([...items]);
    }

    if (item.command && wsRef.current) {
      if (item.command.command === 'vscode.open' && item.command.arguments?.[0]) {
        const arg = item.command.arguments[0];
        const path = typeof arg === 'string' ? arg : arg?.fsPath || arg?.path;
        if (path && onOpenFile) {
          onOpenFile(path);
        }
      }

      wsRef.current.emit('ext:command:execute', {
        command: item.command.command,
        args: item.command.arguments,
      });
    }
  };

  const renderIcon = (item: TreeItemData) => {
    if (!item.icon) {
      if (item.collapsibleState > 0) {
        return item.isExpanded ? <Icons.FolderOpen size={14} color="#e5c07b" /> : <Icons.Folder size={14} color="#e5c07b" />;
      }
      return <Icons.File size={13} color="#8a9199" />;
    }

    if (item.icon.startsWith('http://') || item.icon.startsWith('https://') || item.icon.startsWith('/')) {
      return <img src={item.icon} alt="" style={{ width: 14, height: 14, objectFit: 'contain' }} />;
    }

    // Common VS Code icon IDs
    switch (item.icon) {
      case 'repo':
      case 'gitlens-repositories-view':
        return <Icons.Git size={14} color="#61afef" />;
      case 'git-commit':
      case 'gitlens-commits-view':
      case 'gitlens-commit-view':
        return <Icons.GitCommit size={14} color="#98c379" />;
      case 'git-branch':
      case 'gitlens-branches-view':
        return <Icons.GitBranch size={14} color="#e5c07b" />;
      case 'history':
      case 'gitlens-history-view':
        return <Icons.History size={14} color="#c678dd" />;
      default:
        return item.collapsibleState > 0 ? (
          <Icons.Folder size={14} color="#e5c07b" />
        ) : (
          <Icons.File size={13} color="#8a9199" />
        );
    }
  };

  const renderTree = (nodeList: TreeItemData[], depth = 0) => {
    return nodeList.map((node, idx) => (
      <div key={node.id || `${depth}-${idx}`} className="ext-tree-node-wrapper">
        <div
          className={`ext-tree-node ${node.isLoading ? 'loading' : ''}`}
          style={{ paddingLeft: `${depth * 14 + 10}px` }}
          onClick={() => handleItemClick(node)}
          title={node.tooltip || node.label}
        >
          <div className="ext-tree-node-chevron">
            {node.collapsibleState > 0 ? (
              <span className={`ext-tree-arrow ${node.isExpanded ? 'open' : ''}`}>
                <Icons.ChevronRight size={11} />
              </span>
            ) : (
              <span className="ext-tree-bullet" />
            )}
          </div>
          <div className="ext-tree-node-icon">{renderIcon(node)}</div>
          <span className="ext-tree-node-label">{node.label}</span>
          {node.description && <span className="ext-tree-node-desc">{node.description}</span>}
          {node.isLoading && <span className="ext-tree-node-loading">...</span>}
        </div>
        {node.isExpanded && node.children && renderTree(node.children, depth + 1)}
      </div>
    ));
  };

  return (
    <div className="ext-treeview-container">
      {isLoading ? (
        <div className="ext-tree-empty-state">Loading {title}...</div>
      ) : items.length === 0 ? (
        <div className="ext-tree-empty-state">No items</div>
      ) : (
        renderTree(items)
      )}
    </div>
  );
};

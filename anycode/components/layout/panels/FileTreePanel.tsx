import React from 'react';
import { type IDockviewPanelProps } from 'dockview';
import { TreeNodeComponent } from '../../TreeNodeComponent';
import { FileTreePanelContext, useRequiredContext } from '../contexts';

export const FileTreePanel: React.FC<IDockviewPanelProps> = () => {
    const ctx = useRequiredContext(FileTreePanelContext, 'FileTreePanelContext');

    return (
        <div className="file-system-panel">
            <div className="file-system-content">
                {ctx.fileTree.fileTree.length === 0 ? (
                    <p className="file-system-empty">No files loaded yet</p>
                ) : (
                    <div className="file-tree">
                        {ctx.fileTree.fileTree.map((node) => (
                            <TreeNodeComponent
                                key={node.id}
                                node={node}
                                onToggle={ctx.fileTree.toggleNode}
                                onSelect={ctx.fileTree.selectNode}
                                onOpenFile={ctx.openFileInEditorPane}
                                onLoadFolder={ctx.openFolder}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

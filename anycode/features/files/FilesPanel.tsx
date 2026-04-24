import { TreeNodeComponent } from '../../components';
import type { TreeNode } from '../../types';

type FilesPanelProps = {
    fileTree: TreeNode[];
    onToggle: (nodeId: string) => void;
    onSelect: (nodeId: string) => void;
    onOpenFile: (path: string, line?: number, column?: number) => void;
    onLoadFolder: (path: string) => void;
};

export const FilesPanel = ({
    fileTree,
    onToggle,
    onSelect,
    onOpenFile,
    onLoadFolder,
}: FilesPanelProps) => (
    <div className="file-system-panel">
        <div className="file-system-content">
            {fileTree.length === 0 ? (
                <p className="file-system-empty"> </p>
            ) : (
                <div className="file-tree">
                    {fileTree.map((node) => (
                        <TreeNodeComponent
                            key={node.id}
                            node={node}
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

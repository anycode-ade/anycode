import React, { useCallback } from 'react';
import { Allotment } from 'allotment';
import { WorkspacePaneFrame } from './WorkspacePaneFrame';
import type { WorkspaceNode, WorkspacePaneNode } from './types';

type WorkspaceViewProps = {
    layout: WorkspaceNode;
    activePaneId: string;
    activeSplitId?: string | null;
    onFocusPane: (paneId: string) => void;
    onResizeSplit?: (splitId: string, sizes: [number, number]) => void;
    renderPaneContent: (pane: WorkspacePaneNode) => React.ReactNode;
};

export const WorkspaceView: React.FC<WorkspaceViewProps> = ({
    layout,
    activePaneId,
    activeSplitId = null,
    onFocusPane,
    onResizeSplit,
    renderPaneContent,
}) => {
    const renderNode = useCallback((node: WorkspaceNode): React.ReactNode => {
        if (node.type === 'split') {
            const splitKey = `${node.id}:${node.direction}`;
            const splitLayoutKey = `${splitKey}:${node.sizes?.join(',') ?? 'auto'}`;
            return (
                <div key={splitKey} className={`workspace-split-node ${node.direction} ${node.id === activeSplitId ? 'active' : ''}`}>
                    <Allotment
                        key={splitLayoutKey}
                        vertical={node.direction === 'column'}
                        defaultSizes={node.sizes}
                        onDragEnd={(sizes) => {
                            if (sizes.length !== 2) return;
                            const first = sizes[0];
                            const second = sizes[1];
                            if (!Number.isFinite(first) || !Number.isFinite(second)) return;
                            if (first <= 0 || second <= 0) return;
                            onResizeSplit?.(node.id, [first, second]);
                        }}
                    >
                        <Allotment.Pane key={`${splitKey}-0`}>
                            {renderNode(node.children[0])}
                        </Allotment.Pane>
                        <Allotment.Pane key={`${splitKey}-1`}>
                            {renderNode(node.children[1])}
                        </Allotment.Pane>
                    </Allotment>
                </div>
            );
        }

        return (
            <WorkspacePaneFrame
                key={node.id}
                pane={node}
                isActive={node.id === activePaneId}
                onFocus={() => onFocusPane(node.id)}
            >
                {renderPaneContent(node)}
            </WorkspacePaneFrame>
        );
    }, [activePaneId, activeSplitId, onFocusPane, onResizeSplit, renderPaneContent]);

    return (
        <div className="workspace-root">
            {renderNode(layout)}
        </div>
    );
};

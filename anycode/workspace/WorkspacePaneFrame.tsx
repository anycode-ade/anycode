import React from 'react';
import { type WorkspacePaneNode } from './types';

type WorkspacePaneFrameProps = {
    pane: WorkspacePaneNode;
    isActive: boolean;
    onFocus: () => void;
    children: React.ReactNode;
};

export const WorkspacePaneFrame: React.FC<WorkspacePaneFrameProps> = ({
    pane: _pane,
    isActive,
    onFocus,
    children,
}) => {
    return (
        <div
            className={`workspace-pane-frame ${isActive ? 'active' : ''}`}
            onMouseDown={onFocus}
        >
            <div className="workspace-pane-body">
                {children}
            </div>
        </div>
    );
};

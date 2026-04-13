import React from 'react';
import { Icons } from '../../components/Icons';
import type { WorkspacePaneKind } from '../types';

type WorkspaceEmptyPaneProps = {
    onSelectKind: (kind: WorkspacePaneKind) => void;
    onSplit: (direction: 'row' | 'column') => void;
    onSwap: () => void;
    onToggleSplitDirection: () => void;
    onActivateParentPane: () => void;
    onClose: () => void;
};

const EMPTY_OPTIONS: Array<{ kind: WorkspacePaneKind; label: string; icon: React.ReactNode }> = [
    { kind: 'files', label: 'Files', icon: <Icons.LeftPanelOpened /> },
    { kind: 'search', label: 'Search', icon: <Icons.Search /> },
    { kind: 'changes', label: 'Changes', icon: <Icons.Git /> },
    { kind: 'terminal', label: 'Terminal', icon: <Icons.BottomPanelOpened /> },
    { kind: 'editor', label: 'Editor', icon: <Icons.EditorOpened /> },
    { kind: 'agent', label: 'Agent', icon: <Icons.RightPanelOpened /> },
    { kind: 'toolbar', label: 'Toolbar', icon: <Icons.BottomPanelOpened /> },
];

export const WorkspaceEmptyPane: React.FC<WorkspaceEmptyPaneProps> = ({
    onSelectKind,
    onSplit,
    onSwap,
    onToggleSplitDirection,
    onActivateParentPane,
    onClose,
}) => {
    return (
        <div className="workspace-empty-pane">
            <div className="workspace-empty-pane-title">Empty pane</div>
            <div className="workspace-empty-pane-actions">
                <button
                    className="workspace-empty-pane-action"
                    onClick={() => onSplit('row')}
                    title="Split pane horizontally"
                    aria-label="Split pane horizontally"
                >
                    <Icons.SplitHorizontal />
                    <span>Split H</span>
                </button>
                <button
                    className="workspace-empty-pane-action"
                    onClick={() => onSplit('column')}
                    title="Split pane vertically"
                    aria-label="Split pane vertically"
                >
                    <Icons.SplitVertical />
                    <span>Split V</span>
                </button>
                <button
                    className="workspace-empty-pane-action danger"
                    onClick={onClose}
                    title="Close pane"
                    aria-label="Close pane"
                >
                    <Icons.Close />
                    <span>Close</span>
                </button>
                <button
                    className="workspace-empty-pane-action"
                    onClick={onSwap}
                    title="Swap panes"
                    aria-label="Swap panes"
                >
                    <Icons.SwapPanes />
                    <span>Swap</span>
                </button>
                <button
                    className="workspace-empty-pane-action"
                    onClick={onToggleSplitDirection}
                    title="Toggle split direction"
                    aria-label="Toggle split direction"
                >
                    <Icons.ToggleSplitDirection />
                    <span>Toggle Split</span>
                </button>
                <button
                    className="workspace-empty-pane-action"
                    onClick={onActivateParentPane}
                    title="Activate parent pane"
                    aria-label="Activate parent pane"
                >
                    <Icons.ActivateParent />
                    <span>Parent</span>
                </button>
            </div>
            <div className="workspace-empty-pane-options">
                {EMPTY_OPTIONS.map((option) => (
                    <button
                        key={option.kind}
                        className="workspace-empty-pane-option"
                        onClick={() => onSelectKind(option.kind)}
                        title={`Open ${option.label.toLowerCase()}`}
                        aria-label={`Open ${option.label.toLowerCase()}`}
                    >
                        {option.icon}
                        <span>{option.label}</span>
                    </button>
                ))}
            </div>
        </div>
    );
};

import React, { useEffect, useRef, useState } from 'react';
import { AcpAgentsList } from '../../components/agent/AcpAgentsList';
import { Icons } from '../../components/Icons';
import type { AcpSession, Terminal } from '../../types';
import type { FileState } from '../../types';
import type { ToolbarPaneState, WorkspaceSplitDirection } from '../types';

type WorkspaceToolbarPaneProps = {
    state: ToolbarPaneState;
    files: FileState[];
    terminals: Terminal[];
    agents: AcpSession[];
    selectedAgentId: string | null;
    activeFileId: string | null;
    activeTerminalIndex: number;
    onSelectFile: (fileId: string) => void;
    onCloseFile: (fileId: string) => void;
    onSelectTerminal: (index: number) => void;
    onCloseTerminal: (index: number) => void;
    onSelectAgent: (agentId: string) => void;
    onCloseAgent: (agentId: string) => void;
    onSplitActivePane: (direction: WorkspaceSplitDirection) => void;
    onCloseActivePane: () => void;
    onClearActivePane: () => void;
    onSwapActivePane: () => void;
    onToggleActivePaneSplitDirection: () => void;
    onActivateParentPane: () => void;
    onToggleDiff: () => void;
    diffEnabled: boolean;
};

export const WorkspaceToolbarPane: React.FC<WorkspaceToolbarPaneProps> = ({
    state,
    files,
    terminals,
    agents,
    selectedAgentId,
    activeFileId,
    activeTerminalIndex,
    onSelectFile,
    onCloseFile,
    onSelectTerminal,
    onCloseTerminal,
    onSelectAgent,
    onCloseAgent,
    onSplitActivePane,
    onCloseActivePane,
    onClearActivePane,
    onSwapActivePane,
    onToggleActivePaneSplitDirection,
    onActivateParentPane,
    onToggleDiff,
    diffEnabled,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [orientation, setOrientation] = useState<'horizontal' | 'vertical'>('horizontal');
    const [contentLayout, setContentLayout] = useState<'columns' | 'list'>('columns');
    const [actionsHidden, setActionsHidden] = useState(false);

    useEffect(() => {
        const element = containerRef.current;
        if (!element || state.mode !== 'auto') return;

        const observer = new ResizeObserver(([entry]) => {
            const { width, height } = entry.contentRect;
            setOrientation(width >= height ? 'horizontal' : 'vertical');
            setContentLayout(width >= height ? 'columns' : 'list');
        });

        observer.observe(element);
        return () => observer.disconnect();
    }, [state.mode]);

    const resolvedOrientation = state.mode && state.mode !== 'auto' ? state.mode : orientation;

    return (
        <div
            ref={containerRef}
            className={`workspace-toolbar-pane ${resolvedOrientation} ${state.compact ? 'compact' : ''}`}
        >
            <div className="workspace-toolbar-actions">
                <button
                    className="workspace-toolbar-action"
                    onClick={() => setActionsHidden((prev) => !prev)}
                    title={actionsHidden ? 'Show actions' : 'Hide actions'}
                    aria-label={actionsHidden ? 'Show actions' : 'Hide actions'}
                >
                    {actionsHidden ? <Icons.ChevronRight /> : <Icons.ChevronLeft />}
                </button>

                {!actionsHidden && (
                    <>
                        <button
                            className="workspace-toolbar-action"
                            onClick={() => onSplitActivePane('row')}
                            title="Split active pane horizontally"
                            aria-label="Split active pane horizontally"
                        >
                            <Icons.SplitHorizontal />
                        </button>
                        <button
                            className="workspace-toolbar-action"
                            onClick={() => onSplitActivePane('column')}
                            title="Split active pane vertically"
                            aria-label="Split active pane vertically"
                        >
                            <Icons.SplitVertical />
                        </button>
                        <button
                            className="workspace-toolbar-action"
                            onClick={onCloseActivePane}
                            title="Close active pane"
                            aria-label="Close active pane"
                        >
                            <Icons.Close />
                        </button>
                        <button
                            className="workspace-toolbar-action"
                            onClick={onClearActivePane}
                            title="Clear active pane"
                            aria-label="Clear active pane"
                        >
                            <Icons.ClearPane />
                        </button>
                        <button
                            className="workspace-toolbar-action"
                            onClick={onSwapActivePane}
                            title="Swap panes"
                            aria-label="Swap panes"
                        >
                            <Icons.SwapPanes />
                        </button>
                        <button
                            className="workspace-toolbar-action"
                            onClick={onToggleActivePaneSplitDirection}
                            title="Toggle split direction"
                            aria-label="Toggle split direction"
                        >
                            <Icons.ToggleSplitDirection />
                        </button>
                        <button
                            className="workspace-toolbar-action"
                            onClick={onActivateParentPane}
                            title="Activate parent pane"
                            aria-label="Activate parent pane"
                        >
                            <Icons.ActivateParent />
                        </button>
                        <button
                            className={`workspace-toolbar-action ${diffEnabled ? 'active' : ''}`}
                            onClick={onToggleDiff}
                            title={diffEnabled ? 'Disable diff mode' : 'Enable diff mode'}
                            aria-label={diffEnabled ? 'Disable diff mode' : 'Enable diff mode'}
                        >
                            <Icons.Diff />
                        </button>
                    </>
                )}
            </div>

            <div className={`workspace-toolbar-tabs ${contentLayout}`}>
                {files.map((file) => (
                    <div
                        key={file.id}
                        className={`tab ${activeFileId === file.id ? 'active' : ''}`}
                        onClick={() => onSelectFile(file.id)}
                    >
                        <span className="tab-filename">{file.name}</span>
                        <button
                            className="tab-close-button"
                            onClick={(event) => {
                                event.stopPropagation();
                                onCloseFile(file.id);
                            }}
                        >
                            ×
                        </button>
                    </div>
                ))}
            </div>

            <div className={`workspace-toolbar-terminals ${contentLayout}`}>
                {terminals.map((term, index) => (
                    <div
                        key={term.id}
                        className={`tab ${index === activeTerminalIndex ? 'active' : ''}`}
                        onClick={() => onSelectTerminal(index)}
                    >
                        <span className="tab-filename">{term.name}</span>
                        <button
                            className="tab-close-button"
                            onClick={(event) => {
                                event.stopPropagation();
                                onCloseTerminal(index);
                            }}
                        >
                            ×
                        </button>
                    </div>
                ))}
            </div>

            <div className={`workspace-toolbar-agents ${contentLayout}`}>
                <AcpAgentsList
                    agents={agents}
                    selectedAgentId={selectedAgentId}
                    onSelectAgent={onSelectAgent}
                    onCloseAgent={onCloseAgent}
                />
            </div>
        </div>
    );
};

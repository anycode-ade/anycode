import React from 'react';
import { type IDockviewPanelProps } from 'dockview';
import { AcpAgentsList } from '../../agent/AcpAgentsList';
import { ToolbarPanelContext, useRequiredContext } from '../contexts';

export const ToolbarPanel: React.FC<IDockviewPanelProps> = () => {
    const ctx = useRequiredContext(ToolbarPanelContext, 'ToolbarPanelContext');

    return (
        <div className="toolbar toolbar-horizontal">
            <div className="toolbar-scroll-content">
                <div className="toolbar-tabs">
                    {ctx.editors.files.map((file) => (
                        <div
                            key={file.id}
                            className={`tab ${ctx.editors.activeFileId === file.id ? 'active' : ''}`}
                            onClick={() => ctx.editors.setActiveFileId(file.id)}
                        >
                            <span className="tab-filename"> {file.name} </span>
                            <button className="tab-close-button" onClick={(e) => { e.stopPropagation(); ctx.editors.closeFile(file.id); }}>×</button>
                        </div>
                    ))}
                </div>

                <div className="toolbar-terminals">
                    {ctx.terminals.terminals.map((term, index) => (
                        <div
                            key={term.id}
                            className={`tab ${ctx.focusedTerminalId === term.id ? 'active' : ''}`}
                            onClick={() => ctx.bindTerminalToFocusedPane(term.id)}
                        >
                            <span className="tab-filename">{term.name}</span>
                            <button
                                className="tab-close-button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    ctx.terminals.closeTerminal(index);
                                }}
                            >
                                ×
                            </button>
                        </div>
                    ))}
                    <button
                        type="button"
                        className="terminal-toolbar-add-btn"
                        title="New terminal"
                        onClick={() => {
                            const newTerminal = ctx.terminals.addTerminal();
                            ctx.bindTerminalToFocusedPane(newTerminal.id);
                        }}
                    >
                        +
                    </button>
                </div>

                <div className="acp-agents-container app-toolbar-agents">
                    <AcpAgentsList
                        agents={ctx.sessionsArray}
                        selectedAgentId={ctx.focusedAgentId}
                        onSelectAgent={ctx.bindAgentToFocusedPane}
                        onCloseAgent={ctx.handleCloseAgentEverywhere}
                    />
                </div>
            </div>
        </div>
    );
};

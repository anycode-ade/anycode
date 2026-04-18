import React, { useEffect } from 'react';
import { type IDockviewPanelProps } from 'dockview';
import TerminalComponent from '../../TerminalComponent';
import { TerminalPanelContext, useRequiredContext } from '../contexts';

export const TerminalPanel: React.FC<IDockviewPanelProps> = ({ api }) => {
    const ctx = useRequiredContext(TerminalPanelContext, 'TerminalPanelContext');
    const paneId = api.id;

    const paneTerminalId = ctx.terminalPaneTerminalIds[paneId] ?? null;
    const paneHasBoundTerminal = paneTerminalId
        ? ctx.terminals.terminals.some((term) => term.id === paneTerminalId)
        : false;

    useEffect(() => {
        if (paneHasBoundTerminal) return;

        const fallbackTerminalId =
            ctx.terminals.terminals[ctx.terminals.terminalSelected]?.id
            ?? ctx.terminals.terminals[0]?.id
            ?? null;

        if (fallbackTerminalId) {
            ctx.bindTerminalToPane(paneId, fallbackTerminalId);
            return;
        }

        const newTerminal = ctx.terminals.addTerminal();
        ctx.bindTerminalToPane(paneId, newTerminal.id);
    }, [paneHasBoundTerminal, paneId, ctx.terminals, ctx.bindTerminalToPane]);

    return (
        <div
            className="terminal-panel"
            onMouseDown={() => {
                ctx.setFocusedTerminalPaneId(paneId);
            }}
        >
            <div className="terminal-pane-content">
                {ctx.terminals.terminals.map((term) => (
                    <div
                        key={term.id}
                        className="terminal-container"
                        style={{
                            visibility: term.id === paneTerminalId && paneHasBoundTerminal ? 'visible' : 'hidden',
                            opacity: term.id === paneTerminalId && paneHasBoundTerminal ? 1 : 0,
                            pointerEvents: term.id === paneTerminalId && paneHasBoundTerminal ? 'auto' : 'none',
                            height: '100%',
                            position: term.id === paneTerminalId ? 'relative' : 'absolute',
                            width: '100%',
                            top: 0,
                            left: 0,
                        }}
                    >
                        <TerminalComponent
                            name={term.name}
                            onData={ctx.terminals.handleTerminalData}
                            onMessage={ctx.terminals.handleTerminalDataCallback}
                            onResize={ctx.terminals.handleTerminalResize}
                            rows={term.rows}
                            cols={term.cols}
                            isConnected={ctx.isConnected}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
};

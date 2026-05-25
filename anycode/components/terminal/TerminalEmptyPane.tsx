import React from 'react';
import { type Terminal } from '../../types';
import './TerminalEmptyPane.css';

interface TerminalEmptyPaneProps {
  terminals: Terminal[];
  onSelectTerminal: (terminalId: string) => void;
  onCloseTerminal: (terminalId: string) => void;
  onCreateTerminal: () => void;
}

export const TerminalEmptyPane: React.FC<TerminalEmptyPaneProps> = ({
  terminals,
  onSelectTerminal,
  onCloseTerminal,
  onCreateTerminal,
}) => {
  return (
    <div className="terminal-pane-empty">
      {terminals.length > 0 && (
        <div className="terminal-pane-opened">
          <div className="terminal-pane-title">Opened terminals</div>
          <div className="terminal-pane-actions">
            {terminals.map((terminal) => (
              <div key={terminal.id} className="terminal-pane-opened-item">
                <button
                  className="terminal-pane-action terminal-pane-opened-action"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectTerminal(terminal.id);
                  }}
                  title={terminal.name}
                  type="button"
                >
                  term:{terminal.name}
                </button>
                <button
                  className="tab-close-button terminal-pane-close-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseTerminal(terminal.id);
                  }}
                  title={`Close ${terminal.name}`}
                  type="button"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="terminal-pane-create">
        <div className="terminal-pane-title">Create new terminal</div>
        <div className="terminal-pane-actions">
          <button
            className="terminal-pane-action"
            onClick={(event) => {
              event.stopPropagation();
              onCreateTerminal();
            }}
            type="button"
          >
            + New Terminal
          </button>
        </div>
      </div>
    </div>
  );
};

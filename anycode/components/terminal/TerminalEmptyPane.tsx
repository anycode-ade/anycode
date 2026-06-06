import React from 'react';
import { type Terminal } from '../../types';
import { Icons } from '../Icons';
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
                  className="tab-close-button terminal-pane-close-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseTerminal(terminal.id);
                  }}
                  title={`Close ${terminal.name}`}
                  type="button"
                >
                  <Icons.Close size={8} />
                </button>
                <button
                  className="terminal-pane-opened-action"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectTerminal(terminal.id);
                  }}
                  title={terminal.name}
                  type="button"
                >
                  <Icons.Terminal />
                  <span>term: {terminal.name}</span>
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
            <Icons.Terminal />
            <span>New Terminal</span>
          </button>
        </div>
      </div>
    </div>
  );
};

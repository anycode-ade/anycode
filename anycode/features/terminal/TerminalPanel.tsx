import Terminal from '../../components/terminal/Terminal';
import { TerminalEmptyPane } from '../../components/terminal/TerminalEmptyPane';
import type { Terminal as TerminalState } from '../../types';
import type { FontConfig } from '../../hooks/useSettings';

type TerminalPanelProps = {
    panelKey: string;
    focusRequestToken: number | null;
    isConnected: boolean;
    terminals: TerminalState[];
    terminalPanes: {
        getSelectedId: (paneKey: string) => string | null;
        setSelectedForPane: (paneKey: string, terminalId: string | null) => void;
        closeTab: (terminalId: string) => void;
        createTerminalForActivePane: () => void;
    };
    onTerminalData: (name: string, data: string) => void;
    onTerminalMessage: (name: string, callback: (data: string) => void) => () => void;
    onTerminalResize: (name: string, cols: number, rows: number) => void;
    onIsTerminalClosing: (name: string) => boolean;
    fontConfig: FontConfig;
};

export const TerminalPanel = ({
    panelKey,
    focusRequestToken,
    isConnected,
    terminals,
    terminalPanes,
    onTerminalData,
    onTerminalMessage,
    onTerminalResize,
    onIsTerminalClosing,
    fontConfig,
}: TerminalPanelProps) => {
    const selectedTerminalId = terminalPanes.getSelectedId(panelKey);
    if (selectedTerminalId === null) {
        return (
            <div className="terminal-panel terminal-panel-empty">
                <TerminalEmptyPane
                    terminals={terminals}
                    onSelectTerminal={(terminalId) => terminalPanes.setSelectedForPane(panelKey, terminalId)}
                    onCloseTerminal={terminalPanes.closeTab}
                    onCreateTerminal={terminalPanes.createTerminalForActivePane}
                />
            </div>
        );
    }

    const selectedTerminal = terminals.find((terminal) => terminal.id === selectedTerminalId);
    if (!selectedTerminal) {
        return (
            <div className="terminal-panel terminal-panel-empty">
                <TerminalEmptyPane
                    terminals={terminals}
                    onSelectTerminal={(terminalId) => terminalPanes.setSelectedForPane(panelKey, terminalId)}
                    onCloseTerminal={terminalPanes.closeTab}
                    onCreateTerminal={terminalPanes.createTerminalForActivePane}
                />
            </div>
        );
    }

    return (
        <div className="terminal-panel">
            <div className="terminal-content">
                <div className="terminal-container">
                    <Terminal
                        key={`${panelKey}-${selectedTerminal.id}`}
                        name={selectedTerminal.name}
                        focusRequestToken={focusRequestToken}
                        onData={onTerminalData}
                        onMessage={onTerminalMessage}
                        onResize={onTerminalResize}
                        rows={selectedTerminal.rows}
                        cols={selectedTerminal.cols}
                        isConnected={isConnected}
                        isTerminalClosing={onIsTerminalClosing}
                        fontConfig={fontConfig}
                    />
                </div>
            </div>
        </div>
    );
};

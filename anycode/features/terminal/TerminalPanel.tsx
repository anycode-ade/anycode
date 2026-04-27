import Terminal from '../../components/terminal/Terminal';
import { TerminalEmptyPane } from '../../components/terminal/TerminalEmptyPane';
import type { Terminal as TerminalState } from '../../types';

type TerminalPanelProps = {
    panelKey: string;
    focusRequestToken: number | null;
    isConnected: boolean;
    terminals: TerminalState[];
    terminalPanes: {
        getSelectedIndex: (paneKey: string) => number | null;
        setSelectedForPane: (paneKey: string, index: number | null) => void;
        closeTab: (index: number) => void;
        createTerminalForActivePane: () => void;
    };
    onTerminalData: (name: string, data: string) => void;
    onTerminalMessage: (name: string, callback: (data: string) => void) => () => void;
    onTerminalResize: (name: string, cols: number, rows: number) => void;
    onIsTerminalClosing: (name: string) => boolean;
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
}: TerminalPanelProps) => {
    const selectedIndex = terminalPanes.getSelectedIndex(panelKey);
    if (selectedIndex === null) {
        return (
            <div className="terminal-panel terminal-panel-empty">
                <TerminalEmptyPane
                    terminals={terminals}
                    onSelectTerminal={(index) => terminalPanes.setSelectedForPane(panelKey, index)}
                    onCloseTerminal={terminalPanes.closeTab}
                    onCreateTerminal={terminalPanes.createTerminalForActivePane}
                />
            </div>
        );
    }

    const selectedTerminal = terminals[selectedIndex];
    if (!selectedTerminal) {
        return null;
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
                    />
                </div>
            </div>
        </div>
    );
};

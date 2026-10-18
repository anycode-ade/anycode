import Terminal from '../../components/terminal/Terminal';
import { TerminalEmptyPane } from '../../components/terminal/TerminalEmptyPane';
import type { Terminal as TerminalState } from '../../types';
import type { FontConfig } from '../../hooks/useSettings';
import type { WorkspaceProject } from '../../workspace';

type TerminalPanelProps = {
    panelKey: string;
    focusRequestToken: number | null;
    isConnected: boolean;
    terminals: TerminalState[];
    projects: WorkspaceProject[];
    activeProjectId: string | null;
    onCreateTerminal: (projectId: string) => void;
    terminalPanes: {
        getSelectedId: (paneKey: string) => string | null;
        setSelectedForPane: (paneKey: string, terminalId: string | null) => void;
        closeTab: (terminalId: string) => void;
    };
    onTerminalData: (name: string, session: string, data: string) => void;
    onTerminalMessage: (name: string, session: string, callback: (data: string) => void) => () => void;
    onTerminalResize: (name: string, session: string, cols: number, rows: number) => void;
    onIsTerminalClosing: (name: string, session: string) => boolean;
    onUploadFile: (file: File) => Promise<string | null>;
    fontConfig: FontConfig;
};

export const TerminalPanel = ({
    panelKey,
    focusRequestToken,
    isConnected,
    terminals,
    projects,
    activeProjectId,
    onCreateTerminal,
    terminalPanes,
    onTerminalData,
    onTerminalMessage,
    onTerminalResize,
    onIsTerminalClosing,
    onUploadFile,
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
                    onCreateTerminal={onCreateTerminal}
                    projects={projects}
                    activeProjectId={activeProjectId}
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
                    onCreateTerminal={onCreateTerminal}
                    projects={projects}
                    activeProjectId={activeProjectId}
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
                        session={selectedTerminal.session}
                        focusRequestToken={focusRequestToken}
                        onData={onTerminalData}
                        onMessage={onTerminalMessage}
                        onResize={onTerminalResize}
                        isConnected={isConnected}
                        isTerminalClosing={onIsTerminalClosing}
                        onUploadFile={onUploadFile}
                        fontConfig={fontConfig}
                    />
                </div>
            </div>
        </div>
    );
};

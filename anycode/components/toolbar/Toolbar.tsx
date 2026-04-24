import type { FileState, Terminal, AcpSession } from '../../types';
import './Toolbar.css';

interface ToolbarProps {
    files: FileState[];
    activeFileId: string | null;
    terminals: Terminal[];
    activeTerminalIndex: number | null;
    agentSessions: AcpSession[];
    activeAgentId: string | null;
    onSelectFile: (fileId: string) => void;
    onCloseFile: (fileId: string) => void;
    onSelectTerminal: (index: number) => void;
    onCloseTerminal: (index: number) => void;
    onSelectAgent: (agentId: string) => void;
    onCloseAgent: (agentId: string) => void;
}

export const Toolbar = ({
    files,
    activeFileId,
    terminals,
    activeTerminalIndex,
    agentSessions,
    activeAgentId,
    onSelectFile,
    onCloseFile,
    onSelectTerminal,
    onCloseTerminal,
    onSelectAgent,
    onCloseAgent,
}: ToolbarProps) => (
    <div className="toolbar">
        <div className="toolbar-tabs">
            {files.map((file) => (
                <div
                    key={file.id}
                    className={`tab ${activeFileId === file.id ? 'active' : ''}`}
                    onClick={() => onSelectFile(file.id)}
                >
                    <span className="tab-filename"> {file.name} </span>
                    <button
                        className="tab-close-button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onCloseFile(file.id);
                        }}
                    >
                        ×
                    </button>
                </div>
            ))}
            {terminals.map((terminal, index) => (
                <div
                    key={`toolbar-terminal-${terminal.id}`}
                    className={`tab tab-terminal ${activeTerminalIndex === index ? 'active' : ''}`}
                    onClick={() => onSelectTerminal(index)}
                >
                    <span className="tab-filename">{`term:${terminal.name}`}</span>
                    <button
                        className="tab-close-button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onCloseTerminal(index);
                        }}
                    >
                        ×
                    </button>
                </div>
            ))}
            {agentSessions.map((session) => (
                <div
                    key={`toolbar-agent-${session.agentId}`}
                    className={`tab tab-agent ${activeAgentId === session.agentId ? 'active' : ''}`}
                    onClick={() => onSelectAgent(session.agentId)}
                >
                    <span className="tab-filename">{`${session.agentName || session.agentId}`}</span>
                    <button
                        className="tab-close-button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onCloseAgent(session.agentId);
                        }}
                    >
                        ×
                    </button>
                </div>
            ))}
        </div>
    </div>
);

import type { FileState, Terminal, AcpSession } from '../../types';
import type { WheelEvent } from 'react';
import { TabContextMenu } from './TabContextMenu';
import type { TabMenuAction } from './TabContextMenu';
import { ToolbarTab } from './ToolbarTab';
import { useTabContextMenu } from './useTabContextMenu';
import './Toolbar.css';

interface ToolbarProps {
    files: FileState[];
    activeFileId: string | null;
    terminals: Terminal[];
    activeTerminalId: string | null;
    agentSessions: AcpSession[];
    activeAgentId: string | null;
    onSelectFile: (fileId: string) => void;
    onCloseFile: (fileId: string) => void;
    onSelectTerminal: (terminalId: string) => void;
    onCloseTerminal: (terminalId: string) => void;
    onSelectAgent: (agentId: string) => void;
    onCloseAgent: (agentId: string) => void;
}

const copyText = (text: string) => {
    navigator.clipboard?.writeText(text).catch(() => undefined);
};

export const Toolbar = ({
    files,
    activeFileId,
    terminals,
    activeTerminalId,
    agentSessions,
    activeAgentId,
    onSelectFile,
    onCloseFile,
    onSelectTerminal,
    onCloseTerminal,
    onSelectAgent,
    onCloseAgent,
}: ToolbarProps) => {
    const { closeMenu, menuRef, openMenu, tabMenu } = useTabContextMenu();
    
    const handleTabsWheel = (event: WheelEvent<HTMLDivElement>) => {
        if (event.deltaY === 0) return;
        const tabsElement = event.currentTarget;
        const maxScrollLeft = tabsElement.scrollWidth - tabsElement.clientWidth;
        if (maxScrollLeft <= 0) return;
        const previousScrollLeft = tabsElement.scrollLeft;
        tabsElement.scrollLeft += event.deltaY;
        if (tabsElement.scrollLeft !== previousScrollLeft) {
            event.preventDefault();
        }
    };

    const menuGroups: TabMenuAction[][] = (() => {
        if (!tabMenu) {
            return [];
        }

        switch (tabMenu.kind) {
            case 'file': {
                const file = files.find((f) => f.id === tabMenu.targetId);
                if (!file) return [];
                const fileIndex = files.findIndex((f) => f.id === file.id);
                const hasRight = fileIndex >= 0 && files.length > fileIndex + 1;
                return [
                    [{ key: 'copy-path', label: 'Copy path', onClick: () => copyText(file.id) }],
                    [
                        { key: 'close', label: 'Close', onClick: () => onCloseFile(file.id) },
                        {
                            key: 'close-right',
                            label: 'Close right',
                            disabled: !hasRight,
                            onClick: () => {
                                files.slice(fileIndex + 1).forEach((f) => onCloseFile(f.id));
                            },
                        },
                        {
                            key: 'close-all',
                            label: 'Close all',
                            onClick: () => files.forEach((f) => onCloseFile(f.id)),
                        },
                    ],
                ];
            }
            case 'terminal': {
                const terminalIndex = terminals.findIndex((t) => t.id === tabMenu.targetId);
                if (terminalIndex < 0) return [];
                const terminal = terminals[terminalIndex];
                const hasRight = terminals.length > terminalIndex + 1;
                return [
                    [{ key: 'copy-terminal-name', label: 'Copy terminal name', onClick: () => copyText(terminal.name) }],
                    [
                        { key: 'close-terminal', label: 'Close', onClick: () => onCloseTerminal(terminal.id) },
                        {
                            key: 'close-right-terminals',
                            label: 'Close right',
                            disabled: !hasRight,
                            // Close from the end so indices stay valid
                            onClick: () => {
                                for (let i = terminals.length - 1; i > terminalIndex; i -= 1) {
                                    onCloseTerminal(terminals[i].id);
                                }
                            },
                        },
                        {
                            key: 'close-all-terminals',
                            label: 'Close all',
                            onClick: () => {
                                for (let i = terminals.length - 1; i >= 0; i -= 1) {
                                    onCloseTerminal(terminals[i].id);
                                }
                            },
                        },
                    ],
                ];
            }
            case 'agent': {
                const agent = agentSessions.find((s) => s.agentId === tabMenu.targetId);
                if (!agent) return [];
                return [
                    [
                        { key: 'copy-agent-id', label: 'Copy agent id', onClick: () => copyText(agent.agentId) },
                        {
                            key: 'copy-agent-name',
                            label: 'Copy agent name',
                            onClick: () => copyText(agent.agentName || agent.agentId),
                        },
                    ],
                    [
                        { key: 'close-agent', label: 'Close', onClick: () => onCloseAgent(agent.agentId) },
                        {
                            key: 'close-all-agents',
                            label: 'Close all',
                            onClick: () => agentSessions.forEach((s) => onCloseAgent(s.agentId)),
                        },
                    ],
                ];
            }
        }
    })();

    return (
        <div className="toolbar">
            <div className="toolbar-tabs" onWheel={handleTabsWheel}>
                {files.map((file) => (
                    <ToolbarTab
                        key={file.id}
                        active={activeFileId === file.id}
                        label={file.name}
                        title={file.id}
                        onSelect={() => onSelectFile(file.id)}
                        onClose={() => onCloseFile(file.id)}
                        onContextMenu={(event) => openMenu(event, 'file', file.id)}
                    />
                ))}
                {terminals.map((terminal) => (
                    <ToolbarTab
                        key={`toolbar-terminal-${terminal.id}`}
                        active={activeTerminalId === terminal.id}
                        label={`term:${terminal.name}`}
                        variant="terminal"
                        onSelect={() => onSelectTerminal(terminal.id)}
                        onClose={() => onCloseTerminal(terminal.id)}
                        onContextMenu={(event) => openMenu(event, 'terminal', terminal.id)}
                    />
                ))}
                {agentSessions.map((session) => (
                    <ToolbarTab
                        key={`toolbar-agent-${session.agentId}`}
                        active={activeAgentId === session.agentId}
                        label={session.agentName || session.agentId}
                        variant="agent"
                        onSelect={() => onSelectAgent(session.agentId)}
                        onClose={() => onCloseAgent(session.agentId)}
                        onContextMenu={(event) => openMenu(event, 'agent', session.agentId)}
                    />
                ))}
            </div>

            {tabMenu && menuGroups.length > 0 && (
                <TabContextMenu
                    menuRef={menuRef}
                    anchor={tabMenu.anchor}
                    groups={menuGroups}
                    onClose={closeMenu}
                />
            )}
        </div>
    );
};

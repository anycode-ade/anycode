import type { FileState, Terminal, AcpSession } from '../../types';
import { WheelEvent, useState, useMemo } from 'react';
import { loadItem, saveItem } from '../../storage';
import { TabContextMenu } from './TabContextMenu';
import type { TabMenuAction } from './TabContextMenu';
import { ToolbarTab } from './ToolbarTab';
import { useTabContextMenu } from './useTabContextMenu';
import './Toolbar.css';

const PINNED_FILES_KEY = 'pinnedFiles';
const PINNED_TERMINALS_KEY = 'pinnedTerminals';
const PINNED_AGENTS_KEY = 'pinnedAgents';

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

    const [pinnedFileIds, setPinnedFileIds] = useState<string[]>(() => {
        return loadItem<string[]>(PINNED_FILES_KEY) ?? [];
    });
    const [pinnedTerminalIds, setPinnedTerminalIds] = useState<string[]>(() => {
        return loadItem<string[]>(PINNED_TERMINALS_KEY) ?? [];
    });
    const [pinnedAgentIds, setPinnedAgentIds] = useState<string[]>(() => {
        return loadItem<string[]>(PINNED_AGENTS_KEY) ?? [];
    });

    const togglePinFile = (fileId: string) => {
        setPinnedFileIds((prev) => {
            const next = prev.includes(fileId)
                ? prev.filter((id) => id !== fileId)
                : [...prev, fileId];
            saveItem(PINNED_FILES_KEY, next);
            return next;
        });
    };

    const togglePinTerminal = (terminalId: string) => {
        setPinnedTerminalIds((prev) => {
            const next = prev.includes(terminalId)
                ? prev.filter((id) => id !== terminalId)
                : [...prev, terminalId];
            saveItem(PINNED_TERMINALS_KEY, next);
            return next;
        });
    };

    const togglePinAgent = (agentId: string) => {
        setPinnedAgentIds((prev) => {
            const next = prev.includes(agentId)
                ? prev.filter((id) => id !== agentId)
                : [...prev, agentId];
            saveItem(PINNED_AGENTS_KEY, next);
            return next;
        });
    };

    const sortedFiles = useMemo(() => {
        const pinned = pinnedFileIds
            .map((id) => files.find((f) => f.id === id))
            .filter((f): f is FileState => !!f);
        const pinnedSet = new Set(pinnedFileIds);
        const unpinned = files.filter((f) => !pinnedSet.has(f.id));
        return [...pinned, ...unpinned];
    }, [files, pinnedFileIds]);

    const sortedTerminals = useMemo(() => {
        const pinned = pinnedTerminalIds
            .map((id) => terminals.find((t) => t.id === id))
            .filter((t): t is Terminal => !!t);
        const pinnedSet = new Set(pinnedTerminalIds);
        const unpinned = terminals.filter((t) => !pinnedSet.has(t.id));
        return [...pinned, ...unpinned];
    }, [terminals, pinnedTerminalIds]);

    const sortedAgentSessions = useMemo(() => {
        const pinned = pinnedAgentIds
            .map((id) => agentSessions.find((s) => s.agentId === id))
            .filter((s): s is AcpSession => !!s);
        const pinnedSet = new Set(pinnedAgentIds);
        const unpinned = agentSessions.filter((s) => !pinnedSet.has(s.agentId));
        return [...pinned, ...unpinned];
    }, [agentSessions, pinnedAgentIds]);

    // Mass tab closing helper handlers
    const handleCloseRightFiles = (fileId: string) => {
        const fileIndexSorted = sortedFiles.findIndex((f) => f.id === fileId);
        if (fileIndexSorted < 0) return;
        sortedFiles.slice(fileIndexSorted + 1).forEach((f) => {
            if (!pinnedFileIds.includes(f.id)) {
                onCloseFile(f.id);
            }
        });
    };

    const handleCloseAllFiles = () => {
        files.forEach((f) => {
            if (!pinnedFileIds.includes(f.id)) {
                onCloseFile(f.id);
            }
        });
    };

    const handleCloseRightTerminals = (terminalId: string) => {
        const terminalIndexSorted = sortedTerminals.findIndex((t) => t.id === terminalId);
        if (terminalIndexSorted < 0) return;
        const rightTerminals = sortedTerminals.slice(terminalIndexSorted + 1);
        for (let i = rightTerminals.length - 1; i >= 0; i -= 1) {
            const t = rightTerminals[i];
            if (!pinnedTerminalIds.includes(t.id)) {
                onCloseTerminal(t.id);
            }
        }
    };

    const handleCloseAllTerminals = () => {
        for (let i = terminals.length - 1; i >= 0; i -= 1) {
            const t = terminals[i];
            if (!pinnedTerminalIds.includes(t.id)) {
                onCloseTerminal(t.id);
            }
        }
    };

    const handleCloseAllAgents = () => {
        agentSessions.forEach((s) => {
            if (!pinnedAgentIds.includes(s.agentId)) {
                onCloseAgent(s.agentId);
            }
        });
    };

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
                const isPinned = pinnedFileIds.includes(file.id);
                const fileIndexSorted = sortedFiles.findIndex((f) => f.id === file.id);
                const hasRight = fileIndexSorted >= 0 && sortedFiles.length > fileIndexSorted + 1;
                return [
                    [
                        { key: 'copy-path', label: 'Copy path', onClick: () => copyText(file.id) },
                        { key: 'pin-file', label: isPinned ? 'Unpin' : 'Pin', onClick: () => togglePinFile(file.id) },
                    ],
                    [
                        { key: 'close', label: 'Close', onClick: () => onCloseFile(file.id) },
                        {
                            key: 'close-right',
                            label: 'Close right',
                            disabled: !hasRight,
                            onClick: () => handleCloseRightFiles(file.id),
                        },
                        {
                            key: 'close-all',
                            label: 'Close all',
                            onClick: handleCloseAllFiles,
                        },
                    ],
                ];
            }
            case 'terminal': {
                const terminalIndex = terminals.findIndex((t) => t.id === tabMenu.targetId);
                if (terminalIndex < 0) return [];
                const terminal = terminals[terminalIndex];
                const isPinned = pinnedTerminalIds.includes(terminal.id);
                const terminalIndexSorted = sortedTerminals.findIndex((t) => t.id === terminal.id);
                const hasRight = sortedTerminals.length > terminalIndexSorted + 1;
                return [
                    [
                        { key: 'copy-terminal-name', label: 'Copy terminal name', onClick: () => copyText(terminal.name) },
                        { key: 'pin-terminal', label: isPinned ? 'Unpin' : 'Pin', onClick: () => togglePinTerminal(terminal.id) },
                    ],
                    [
                        { key: 'close-terminal', label: 'Close', onClick: () => onCloseTerminal(terminal.id) },
                        {
                            key: 'close-right-terminals',
                            label: 'Close right',
                            disabled: !hasRight,
                            onClick: () => handleCloseRightTerminals(terminal.id),
                        },
                        {
                            key: 'close-all-terminals',
                            label: 'Close all',
                            onClick: handleCloseAllTerminals,
                        },
                    ],
                ];
            }
            case 'agent': {
                const agent = agentSessions.find((s) => s.agentId === tabMenu.targetId);
                if (!agent) return [];
                const isPinned = pinnedAgentIds.includes(agent.agentId);
                return [
                    [
                        { key: 'copy-agent-id', label: 'Copy agent id', onClick: () => copyText(agent.agentId) },
                        {
                            key: 'copy-agent-name',
                            label: 'Copy agent name',
                            onClick: () => copyText(agent.agentName || agent.agentId),
                        },
                        { key: 'pin-agent', label: isPinned ? 'Unpin' : 'Pin', onClick: () => togglePinAgent(agent.agentId) },
                    ],
                    [
                        { key: 'close-agent', label: 'Close', onClick: () => onCloseAgent(agent.agentId) },
                        {
                            key: 'close-all-agents',
                            label: 'Close all',
                            onClick: handleCloseAllAgents,
                        },
                    ],
                ];
            }
        }
    })();

    return (
        <div className="toolbar">
            <div className="toolbar-tabs" onWheel={handleTabsWheel}>
                {sortedFiles.map((file) => (
                    <ToolbarTab
                        key={file.id}
                        active={activeFileId === file.id}
                        label={file.name}
                        title={file.id}
                        pinned={pinnedFileIds.includes(file.id)}
                        onUnpin={() => togglePinFile(file.id)}
                        onSelect={() => onSelectFile(file.id)}
                        onClose={() => onCloseFile(file.id)}
                        onContextMenu={(event) => openMenu(event, 'file', file.id)}
                    />
                ))}
                {sortedTerminals.map((terminal) => (
                    <ToolbarTab
                        key={`toolbar-terminal-${terminal.id}`}
                        active={activeTerminalId === terminal.id}
                        label={`term:${terminal.name}`}
                        variant="terminal"
                        pinned={pinnedTerminalIds.includes(terminal.id)}
                        onUnpin={() => togglePinTerminal(terminal.id)}
                        onSelect={() => onSelectTerminal(terminal.id)}
                        onClose={() => onCloseTerminal(terminal.id)}
                        onContextMenu={(event) => openMenu(event, 'terminal', terminal.id)}
                    />
                ))}
                {sortedAgentSessions.map((session) => (
                    <ToolbarTab
                        key={`toolbar-agent-${session.agentId}`}
                        active={activeAgentId === session.agentId}
                        label={session.agentName || session.agentId}
                        variant="agent"
                        pinned={pinnedAgentIds.includes(session.agentId)}
                        onUnpin={() => togglePinAgent(session.agentId)}
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

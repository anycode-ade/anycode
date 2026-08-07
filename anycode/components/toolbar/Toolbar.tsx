import type { FileState, Terminal, AcpSession } from '../../types';
import { useState, useMemo, useEffect, useRef } from 'react';
import { loadItem, saveItem } from '../../storage';
import { TabContextMenu } from './TabContextMenu';
import type { TabMenuAction } from './TabContextMenu';
import { ToolbarTab } from './ToolbarTab';
import { useTabContextMenu } from './useTabContextMenu';
import './Toolbar.css';
import type { ConnectionStatus } from '../../hooks/useSocket';

const PINNED_FILES_KEY = 'pinnedFiles';
const PINNED_TERMINALS_KEY = 'pinnedTerminals';
const PINNED_AGENTS_KEY = 'pinnedAgents';

const FILE_IDS_ORDER_KEY = 'toolbarFileIdsOrder';
const TERMINAL_IDS_ORDER_KEY = 'toolbarTerminalIdsOrder';
const AGENT_IDS_ORDER_KEY = 'toolbarAgentIdsOrder';

interface ToolbarProps {
    files: FileState[];
    activeFileId: string | null;
    terminals: Terminal[];
    activeTerminalId: string | null;
    agentSessions: AcpSession[];
    activeAgentId: string | null;
    fileIconsStyle?: 'colored' | 'monochrome' | 'disabled';
    onSelectFile: (fileId: string) => void;
    onCloseFile: (fileId: string) => void;
    onSelectTerminal: (terminalId: string) => void;
    onCloseTerminal: (terminalId: string) => void;
    onSelectAgent: (agentId: string) => void;
    onCloseAgent: (agentId: string) => void;
    showConnectionStatus?: boolean;
    connectionStatus?: ConnectionStatus;
    onReconnect?: () => void;
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
    fileIconsStyle = 'colored',
    onSelectFile,
    onCloseFile,
    onSelectTerminal,
    onCloseTerminal,
    onSelectAgent,
    onCloseAgent,
    showConnectionStatus = false,
    connectionStatus = 'connected',
    onReconnect,
}: ToolbarProps) => {
    const { closeMenu, menuRef, openMenu, tabMenu } = useTabContextMenu();
    const tabsRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const tabsElement = tabsRef.current;
        if (!tabsElement) return;

        const handleWheel = (event: WheelEvent) => {
            if (event.deltaY === 0) return;
            const maxScrollLeft = tabsElement.scrollWidth - tabsElement.clientWidth;
            if (maxScrollLeft <= 0) return;
            const previousScrollLeft = tabsElement.scrollLeft;
            tabsElement.scrollLeft += event.deltaY;
            if (tabsElement.scrollLeft !== previousScrollLeft) {
                event.preventDefault();
            }
        };

        tabsElement.addEventListener('wheel', handleWheel, { passive: false });
        return () => {
            tabsElement.removeEventListener('wheel', handleWheel);
        };
    }, []);

    const [pinnedFileIds, setPinnedFileIds] = useState<string[]>(() => {
        return loadItem<string[]>(PINNED_FILES_KEY) ?? [];
    });
    const [pinnedTerminalIds, setPinnedTerminalIds] = useState<string[]>(() => {
        return loadItem<string[]>(PINNED_TERMINALS_KEY) ?? [];
    });
    const [pinnedAgentIds, setPinnedAgentIds] = useState<string[]>(() => {
        return loadItem<string[]>(PINNED_AGENTS_KEY) ?? [];
    });

    const [fileIdsOrder, setFileIdsOrder] = useState<string[]>(() => {
        return loadItem<string[]>(FILE_IDS_ORDER_KEY) ?? [];
    });
    const [terminalIdsOrder, setTerminalIdsOrder] = useState<string[]>(() => {
        return loadItem<string[]>(TERMINAL_IDS_ORDER_KEY) ?? [];
    });
    const [agentIdsOrder, setAgentIdsOrder] = useState<string[]>(() => {
        return loadItem<string[]>(AGENT_IDS_ORDER_KEY) ?? [];
    });

    const [draggedItem, setDraggedItem] = useState<{
        type: 'file' | 'terminal' | 'agent';
        id: string;
    } | null>(null);

    useEffect(() => {
        saveItem(FILE_IDS_ORDER_KEY, fileIdsOrder);
    }, [fileIdsOrder]);

    useEffect(() => {
        saveItem(TERMINAL_IDS_ORDER_KEY, terminalIdsOrder);
    }, [terminalIdsOrder]);

    useEffect(() => {
        saveItem(AGENT_IDS_ORDER_KEY, agentIdsOrder);
    }, [agentIdsOrder]);

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
        const pinned = files.filter((f) => pinnedFileIds.includes(f.id));
        const unpinned = files.filter((f) => !pinnedFileIds.includes(f.id));

        const sortFunc = (a: FileState, b: FileState) => {
            const indexA = fileIdsOrder.indexOf(a.id);
            const indexB = fileIdsOrder.indexOf(b.id);
            if (indexA === -1 && indexB === -1) return 0;
            if (indexA === -1) return 1;
            if (indexB === -1) return -1;
            return indexA - indexB;
        };

        return [...pinned.sort(sortFunc), ...unpinned.sort(sortFunc)];
    }, [files, pinnedFileIds, fileIdsOrder]);

    const sortedTerminals = useMemo(() => {
        const pinned = terminals.filter((t) => pinnedTerminalIds.includes(t.id));
        const unpinned = terminals.filter((t) => !pinnedTerminalIds.includes(t.id));

        const sortFunc = (a: Terminal, b: Terminal) => {
            const indexA = terminalIdsOrder.indexOf(a.id);
            const indexB = terminalIdsOrder.indexOf(b.id);
            if (indexA === -1 && indexB === -1) return 0;
            if (indexA === -1) return 1;
            if (indexB === -1) return -1;
            return indexA - indexB;
        };

        return [...pinned.sort(sortFunc), ...unpinned.sort(sortFunc)];
    }, [terminals, pinnedTerminalIds, terminalIdsOrder]);

    const sortedAgentSessions = useMemo(() => {
        const pinned = agentSessions.filter((s) => pinnedAgentIds.includes(s.agentId));
        const unpinned = agentSessions.filter((s) => !pinnedAgentIds.includes(s.agentId));

        const sortFunc = (a: AcpSession, b: AcpSession) => {
            const indexA = agentIdsOrder.indexOf(a.agentId);
            const indexB = agentIdsOrder.indexOf(b.agentId);
            if (indexA === -1 && indexB === -1) return 0;
            if (indexA === -1) return 1;
            if (indexB === -1) return -1;
            return indexA - indexB;
        };

        return [...pinned.sort(sortFunc), ...unpinned.sort(sortFunc)];
    }, [agentSessions, pinnedAgentIds, agentIdsOrder]);

    const handleDragStart = (e: React.DragEvent, type: 'file' | 'terminal' | 'agent', id: string) => {
        setDraggedItem({ type, id });
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragEnd = () => {
        setDraggedItem(null);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
    };

    const handleDragOver = (e: React.DragEvent, type: 'file' | 'terminal' | 'agent', targetId: string) => {
        if (!draggedItem || draggedItem.type !== type || draggedItem.id === targetId) {
            return;
        }

        e.preventDefault();

        if (type === 'file') {
            const isDraggedPinned = pinnedFileIds.includes(draggedItem.id);
            const isTargetPinned = pinnedFileIds.includes(targetId);

            if (isDraggedPinned !== isTargetPinned) {
                return;
            }

            setFileIdsOrder((prev) => {
                let nextOrder = [...prev];
                const currentSortedIds = sortedFiles.map((f) => f.id);
                currentSortedIds.forEach((id) => {
                    if (!nextOrder.includes(id)) {
                        nextOrder.push(id);
                    }
                });

                const fromIndex = nextOrder.indexOf(draggedItem.id);
                const toIndex = nextOrder.indexOf(targetId);

                if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
                    nextOrder.splice(fromIndex, 1);
                    nextOrder.splice(toIndex, 0, draggedItem.id);
                }
                return nextOrder;
            });
        } else if (type === 'terminal') {
            const isDraggedPinned = pinnedTerminalIds.includes(draggedItem.id);
            const isTargetPinned = pinnedTerminalIds.includes(targetId);

            if (isDraggedPinned !== isTargetPinned) {
                return;
            }

            setTerminalIdsOrder((prev) => {
                let nextOrder = [...prev];
                const currentSortedIds = sortedTerminals.map((t) => t.id);
                currentSortedIds.forEach((id) => {
                    if (!nextOrder.includes(id)) {
                        nextOrder.push(id);
                    }
                });

                const fromIndex = nextOrder.indexOf(draggedItem.id);
                const toIndex = nextOrder.indexOf(targetId);

                if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
                    nextOrder.splice(fromIndex, 1);
                    nextOrder.splice(toIndex, 0, draggedItem.id);
                }
                return nextOrder;
            });
        } else if (type === 'agent') {
            const isDraggedPinned = pinnedAgentIds.includes(draggedItem.id);
            const isTargetPinned = pinnedAgentIds.includes(targetId);

            if (isDraggedPinned !== isTargetPinned) {
                return;
            }

            setAgentIdsOrder((prev) => {
                let nextOrder = [...prev];
                const currentSortedIds = sortedAgentSessions.map((s) => s.agentId);
                currentSortedIds.forEach((id) => {
                    if (!nextOrder.includes(id)) {
                        nextOrder.push(id);
                    }
                });

                const fromIndex = nextOrder.indexOf(draggedItem.id);
                const toIndex = nextOrder.indexOf(targetId);

                if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
                    nextOrder.splice(fromIndex, 1);
                    nextOrder.splice(toIndex, 0, draggedItem.id);
                }
                return nextOrder;
            });
        }
    };

    // Mass tab closing helper handlers
    const handleCloseRightFiles = (fileId: string) => {
        const fileIndexSorted = sortedFiles.findIndex((f) => f.id === fileId);
        if (fileIndexSorted < 0) return;
        sortedFiles.slice(fileIndexSorted + 1).forEach((f) => {
            if (!pinnedFileIds.includes(f.id)) {
                setFileIdsOrder((prev) => prev.filter((id) => id !== f.id));
                onCloseFile(f.id);
            }
        });
    };

    const handleCloseOtherFiles = (fileId: string) => {
        files.forEach((f) => {
            if (f.id !== fileId && !pinnedFileIds.includes(f.id)) {
                setFileIdsOrder((prev) => prev.filter((id) => id !== f.id));
                onCloseFile(f.id);
            }
        });
    };

    const handleCloseAllFiles = () => {
        files.forEach((f) => {
            if (!pinnedFileIds.includes(f.id)) {
                setFileIdsOrder((prev) => prev.filter((id) => id !== f.id));
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

    const handleCloseOtherTerminals = (terminalId: string) => {
        for (let i = terminals.length - 1; i >= 0; i -= 1) {
            const t = terminals[i];
            if (t.id !== terminalId && !pinnedTerminalIds.includes(t.id)) {
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

    const handleCloseOtherAgents = (agentId: string) => {
        agentSessions.forEach((s) => {
            if (s.agentId !== agentId && !pinnedAgentIds.includes(s.agentId)) {
                onCloseAgent(s.agentId);
            }
        });
    };

    const handleCloseAllAgents = () => {
        agentSessions.forEach((s) => {
            if (!pinnedAgentIds.includes(s.agentId)) {
                onCloseAgent(s.agentId);
            }
        });
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
                const hasOtherClosable = files.some((f) => f.id !== file.id && !pinnedFileIds.includes(f.id));
                return [
                    [
                        { key: 'copy-path', label: 'Copy path', onClick: () => copyText(file.id) },
                        { key: 'copy-name', label: 'Copy name', onClick: () => copyText(file.name) },
                        { key: 'pin-file', label: isPinned ? 'Unpin' : 'Pin', onClick: () => togglePinFile(file.id) },
                    ],
                    [
                        {
                            key: 'close',
                            label: 'Close',
                            onClick: () => {
                                setFileIdsOrder((prev) => prev.filter((id) => id !== file.id));
                                onCloseFile(file.id);
                            },
                        },
                        {
                            key: 'close-others',
                            label: 'Close others',
                            disabled: !hasOtherClosable,
                            onClick: () => handleCloseOtherFiles(file.id),
                        },
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
                const hasOtherClosable = terminals.some(
                    (t) => t.id !== terminal.id && !pinnedTerminalIds.includes(t.id),
                );
                return [
                    [
                        { key: 'copy-terminal-name', label: 'Copy terminal name', onClick: () => copyText(terminal.name) },
                        { key: 'pin-terminal', label: isPinned ? 'Unpin' : 'Pin', onClick: () => togglePinTerminal(terminal.id) },
                    ],
                    [
                        { key: 'close-terminal', label: 'Close', onClick: () => onCloseTerminal(terminal.id) },
                        {
                            key: 'close-other-terminals',
                            label: 'Close others',
                            disabled: !hasOtherClosable,
                            onClick: () => handleCloseOtherTerminals(terminal.id),
                        },
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
                const hasOtherClosable = agentSessions.some(
                    (s) => s.agentId !== agent.agentId && !pinnedAgentIds.includes(s.agentId),
                );
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
                            key: 'close-other-agents',
                            label: 'Close others',
                            disabled: !hasOtherClosable,
                            onClick: () => handleCloseOtherAgents(agent.agentId),
                        },
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
            {showConnectionStatus ? (
                <button
                    type="button"
                    className="toolbar-connection-status"
                    onClick={onReconnect}
                    title="Retry connection"
                    aria-label="Retry backend connection"
                >
                    <span className="toolbar-connection-dot" aria-hidden="true" />
                    <span>Disconnected</span>
                    <span className="toolbar-connection-detail">
                        {connectionStatus === 'connecting' ? 'Connecting...' : 'Reconnecting...'}
                    </span>
                </button>
            ) : (
                <div className="toolbar-tabs" ref={tabsRef}>
                    {sortedFiles.map((file) => (
                        <ToolbarTab
                            key={file.id}
                            active={activeFileId === file.id}
                            label={file.name}
                            title={file.id}
                            filePath={file.id}
                            fileIconsStyle={fileIconsStyle}
                            pinned={pinnedFileIds.includes(file.id)}
                            onUnpin={() => togglePinFile(file.id)}
                            onSelect={() => onSelectFile(file.id)}
                            onClose={() => {
                                setFileIdsOrder((prev) => prev.filter((id) => id !== file.id));
                                onCloseFile(file.id);
                            }}
                            onContextMenu={(event) => openMenu(event, 'file', file.id)}
                            draggable={true}
                            dragging={draggedItem?.type === 'file' && draggedItem?.id === file.id}
                            onDragStart={(event) => handleDragStart(event, 'file', file.id)}
                            onDragEnd={handleDragEnd}
                            onDragOver={(event) => handleDragOver(event, 'file', file.id)}
                            onDrop={handleDrop}
                        />
                    ))}
                    {sortedFiles.length > 0 && sortedTerminals.length > 0 && (
                        <div className="tab-group-separator" />
                    )}
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
                            draggable={true}
                            dragging={draggedItem?.type === 'terminal' && draggedItem?.id === terminal.id}
                            onDragStart={(event) => handleDragStart(event, 'terminal', terminal.id)}
                            onDragEnd={handleDragEnd}
                            onDragOver={(event) => handleDragOver(event, 'terminal', terminal.id)}
                            onDrop={handleDrop}
                        />
                    ))}
                    {sortedAgentSessions.length > 0 && (sortedFiles.length > 0 || sortedTerminals.length > 0) && (
                        <div className="tab-group-separator" />
                    )}
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
                            draggable={true}
                            dragging={draggedItem?.type === 'agent' && draggedItem?.id === session.agentId}
                            onDragStart={(event) => handleDragStart(event, 'agent', session.agentId)}
                            onDragEnd={handleDragEnd}
                            onDragOver={(event) => handleDragOver(event, 'agent', session.agentId)}
                            onDrop={handleDrop}
                        />
                    ))}
                </div>
            )}

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

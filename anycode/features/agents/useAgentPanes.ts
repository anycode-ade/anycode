import { useCallback, useEffect, useState } from 'react';
import type { AcpSession } from '../../types';
import { loadItem, saveItem } from '../../storage';

type UseAgentPanesParams = {
    sessions: AcpSession[];
    selectedAgentId: string | null;
    setSelectedAgentId: (agentId: string | null) => void;
};

export const useAgentPanes = ({
    sessions,
    selectedAgentId,
    setSelectedAgentId,
}: UseAgentPanesParams) => {
    const [selectedByPane, setSelectedByPane] = useState<Record<string, string | null>>(() => (
        loadItem<Record<string, string | null>>('agentSelectedByPane') ?? { agent: null }
    ));
    const [activePaneId, setActivePaneId] = useState<string>('agent');

    useEffect(() => {
        saveItem('agentSelectedByPane', selectedByPane);
    }, [selectedByPane]);

    useEffect(() => {
        const validAgentIds = new Set(sessions.map((session) => session.agentId));
        if (validAgentIds.size === 0) {
            // Keep pane selections during initial reconnect after page reload.
            return;
        }

        setSelectedByPane((prev) => {
            if (Object.keys(prev).length === 0) {
                return prev;
            }

            const next: Record<string, string | null> = {};
            let changed = false;

            // First pass: keep only valid selections.
            Object.entries(prev).forEach(([paneKey, selected]) => {
                const normalized = selected && validAgentIds.has(selected) ? selected : null;
                next[paneKey] = normalized;
                if (normalized !== selected) {
                    changed = true;
                }
            });

            // Second pass: if a pane has no selection but there are free sessions,
            // bind them so multiple restored agent panes are not left empty.
            const occupied = new Set(
                Object.values(next).filter((value): value is string => value !== null),
            );
            const availableAgentIds = sessions
                .map((session) => session.agentId)
                .filter((agentId) => !occupied.has(agentId));

            if (availableAgentIds.length > 0) {
                for (const paneKey of Object.keys(next)) {
                    if (next[paneKey] !== null) {
                        continue;
                    }
                    const nextAgentId = availableAgentIds.shift();
                    if (!nextAgentId) {
                        break;
                    }
                    next[paneKey] = nextAgentId;
                    changed = true;
                }
            }

            return changed ? next : prev;
        });
    }, [sessions]);

    const getSelectedId = useCallback((paneKey: string): string | null => {
        if (Object.hasOwn(selectedByPane, paneKey)) {
            return selectedByPane[paneKey] ?? null;
        }
        if (paneKey === 'agent') {
            return selectedAgentId ?? null;
        }
        return null;
    }, [selectedAgentId, selectedByPane]);

    const selectForPane = useCallback((paneKey: string, agentId: string | null) => {
        setSelectedByPane((prev) => {
            if (prev[paneKey] === agentId) {
                return prev;
            }
            return {
                ...prev,
                [paneKey]: agentId,
            };
        });
        if (selectedAgentId !== agentId) {
            setSelectedAgentId(agentId);
        }
    }, [selectedAgentId, setSelectedAgentId]);

    const selectFromToolbar = useCallback((agentId: string) => {
        const paneKey = activePaneId || 'agent';
        selectForPane(paneKey, agentId);
    }, [activePaneId, selectForPane]);

    const registerPane = useCallback((paneKey: string) => {
        setActivePaneId(paneKey);
        setSelectedByPane((prev) => {
            if (Object.hasOwn(prev, paneKey)) {
                return prev;
            }

            return {
                ...prev,
                [paneKey]: null,
            };
        });
    }, []);

    const unregisterPane = useCallback((paneKey: string) => {
        setSelectedByPane((prev) => {
            const next = { ...prev };
            delete next[paneKey];
            return Object.keys(next).length > 0 ? next : { agent: null };
        });
        setActivePaneId((current) => current === paneKey ? 'agent' : current);
    }, []);

    return {
        activePaneId,
        setActivePaneId,
        getSelectedId,
        selectForPane,
        selectFromToolbar,
        registerPane,
        unregisterPane,
    };
};

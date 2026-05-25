import { useCallback, useEffect, useState } from 'react';
import type { Terminal } from '../../types';
import { loadItem, saveItem } from '../../storage';

type UseTerminalPanesParams = {
    terminals: Terminal[];
    addTerminal: () => string;
    closeTerminal: (id: string) => void;
};

export const useTerminalPanes = ({
    terminals,
    addTerminal,
    closeTerminal,
}: UseTerminalPanesParams) => {
    const [selectedByPane, setSelectedByPane] = useState<Record<string, string | null>>(() => (
        loadItem<Record<string, string | null>>('terminalSelectedByPane') ?? { terminal: null }
    ));
    const [activePaneId, setActivePaneId] = useState<string>('terminal');

    useEffect(() => {
        saveItem('terminalSelectedByPane', selectedByPane);
    }, [selectedByPane]);

    useEffect(() => {
        const terminalIds = new Set(terminals.map((terminal) => terminal.id));
        setSelectedByPane((prev) => {
            const next: Record<string, string | null> = {};
            const source = Object.keys(prev).length > 0 ? prev : { terminal: null };
            let hasChanges = false;
            Object.entries(source).forEach(([paneKey, selected]) => {
                const normalized = selected !== null && terminalIds.has(selected) ? selected : null;
                next[paneKey] = normalized;
                if (normalized !== selected) {
                    hasChanges = true;
                }
            });
            if (!hasChanges && Object.keys(next).length === Object.keys(prev).length) {
                return prev;
            }
            return hasChanges ? next : prev;
        });
    }, [terminals]);

    const getSelectedId = useCallback((paneKey: string): string | null => {
        const selected = Object.hasOwn(selectedByPane, paneKey) ? selectedByPane[paneKey] : null;
        return selected ?? null;
    }, [selectedByPane]);

    const setSelectedForPane = useCallback((paneKey: string, terminalId: string | null) => {
        setSelectedByPane((prev) => ({
            ...prev,
            [paneKey]: terminalId,
        }));
    }, []);

    const selectTab = useCallback((terminalId: string) => {
        const paneKey = activePaneId || 'terminal';
        setSelectedForPane(paneKey, terminalId);
    }, [activePaneId, setSelectedForPane]);

    const closeTab = useCallback((terminalId: string) => {
        closeTerminal(terminalId);
        setSelectedByPane((prev) => {
            const next: Record<string, string | null> = {};
            Object.entries(prev).forEach(([paneKey, selected]) => {
                next[paneKey] = selected === terminalId ? null : selected;
            });
            return next;
        });
    }, [closeTerminal]);

    const createTerminalForActivePane = useCallback(() => {
        const terminalId = addTerminal();
        const paneKey = activePaneId || 'terminal';
        setSelectedForPane(paneKey, terminalId);
    }, [activePaneId, addTerminal, setSelectedForPane]);

    const registerPane = useCallback((paneKey: string) => {
        setActivePaneId(paneKey);
        setSelectedByPane((prev) => ({
            ...prev,
            [paneKey]: prev[paneKey] ?? null,
        }));
    }, []);

    const unregisterPane = useCallback((paneKey: string) => {
        setSelectedByPane((prev) => {
            const next = { ...prev };
            delete next[paneKey];
            return Object.keys(next).length > 0 ? next : { terminal: null };
        });
        setActivePaneId((current) => current === paneKey ? 'terminal' : current);
    }, []);

    return {
        activePaneId,
        setActivePaneId,
        getSelectedId,
        setSelectedForPane,
        selectTab,
        closeTab,
        createTerminalForActivePane,
        registerPane,
        unregisterPane,
    };
};

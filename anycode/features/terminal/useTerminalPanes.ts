import { useCallback, useEffect, useState } from 'react';
import type { Terminal } from '../../types';
import { loadItem, saveItem } from '../../storage';

type UseTerminalPanesParams = {
    terminals: Terminal[];
    addTerminal: () => void;
    closeTerminal: (index: number) => void;
};

export const useTerminalPanes = ({
    terminals,
    addTerminal,
    closeTerminal,
}: UseTerminalPanesParams) => {
    const [selectedByPane, setSelectedByPane] = useState<Record<string, number | null>>(() => (
        loadItem<Record<string, number | null>>('terminalSelectedByPane') ?? { terminal: null }
    ));
    const [activePaneId, setActivePaneId] = useState<string>('terminal');

    useEffect(() => {
        saveItem('terminalSelectedByPane', selectedByPane);
    }, [selectedByPane]);

    useEffect(() => {
        const lastIndex = terminals.length - 1;
        setSelectedByPane((prev) => {
            const next: Record<string, number | null> = {};
            const source = Object.keys(prev).length > 0 ? prev : { terminal: null };
            Object.entries(source).forEach(([paneKey, selected]) => {
                if (selected === null || lastIndex < 0) {
                    next[paneKey] = null;
                    return;
                }
                next[paneKey] = Math.min(Math.max(selected, 0), lastIndex);
            });
            return next;
        });
    }, [terminals.length]);

    const getSelectedIndex = useCallback((paneKey: string): number | null => {
        const selected = Object.hasOwn(selectedByPane, paneKey) ? selectedByPane[paneKey] : null;
        if (selected === null || terminals.length === 0) {
            return null;
        }
        const lastIndex = terminals.length - 1;
        return Math.min(Math.max(selected, 0), lastIndex);
    }, [selectedByPane, terminals.length]);

    const setSelectedForPane = useCallback((paneKey: string, index: number | null) => {
        const nextIndex = index === null ? null : Math.max(0, index);
        setSelectedByPane((prev) => ({
            ...prev,
            [paneKey]: nextIndex,
        }));
    }, []);

    const selectTab = useCallback((index: number) => {
        const paneKey = activePaneId || 'terminal';
        setSelectedForPane(paneKey, index);
    }, [activePaneId, setSelectedForPane]);

    const closeTab = useCallback((index: number) => {
        closeTerminal(index);
        setSelectedByPane((prev) => {
            const next: Record<string, number | null> = {};
            Object.entries(prev).forEach(([paneKey, selected]) => {
                if (selected === null) {
                    next[paneKey] = null;
                    return;
                }
                if (selected > index) {
                    next[paneKey] = selected - 1;
                    return;
                }
                if (selected === index) {
                    next[paneKey] = null;
                    return;
                }
                next[paneKey] = selected;
            });
            return next;
        });
    }, [closeTerminal]);

    const createTerminalForActivePane = useCallback(() => {
        addTerminal();
        const paneKey = activePaneId || 'terminal';
        setSelectedForPane(paneKey, terminals.length);
    }, [activePaneId, addTerminal, setSelectedForPane, terminals.length]);

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
        getSelectedIndex,
        setSelectedForPane,
        selectTab,
        closeTab,
        createTerminalForActivePane,
        registerPane,
        unregisterPane,
    };
};

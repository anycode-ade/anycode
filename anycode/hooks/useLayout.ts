import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PanelId } from '../components/layout/Layout';

type FocusRequest = {
    target: PanelId;
    panelKey?: string;
    nonce: number;
};

type UseLayoutParams = {
    activeEditorPaneId: string;
    activeTerminalPaneId: string;
    activeAgentPaneId: string;
    onFocusEditorPane: (panelKey: string) => void;
    onActivateTerminalPane: (panelKey: string) => void;
    onActivateAgentPane: (panelKey: string) => void;
};

const defaultPanelKeysById: Record<PanelId, string[]> = {
    toolbar: ['toolbar'],
    files: ['files'],
    search: ['search'],
    changes: ['changes'],
    editor: [],
    terminal: [],
    agent: [],
    browser: ['browser'],
    settings: ['settings'],
};

export const useLayout = ({
    activeEditorPaneId,
    activeTerminalPaneId,
    activeAgentPaneId,
    onFocusEditorPane,
    onActivateTerminalPane,
    onActivateAgentPane,
}: UseLayoutParams) => {
    const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
    const activePanelRef = useRef<{ panelId: PanelId; panelKey: string } | null>(null);
    const lastActiveAgentPaneIdRef = useRef<string>(activeAgentPaneId || 'agent');
    const panelKeysByIdRef = useRef<Record<PanelId, string[]>>({ ...defaultPanelKeysById });

    useEffect(() => {
        if (activeAgentPaneId) {
            lastActiveAgentPaneIdRef.current = activeAgentPaneId;
        }
    }, [activeAgentPaneId]);

    const getPreferredPanelKey = useCallback((panelId: PanelId): string | undefined => {
        if (panelId === 'editor') {
            return activeEditorPaneId;
        }
        if (panelId === 'terminal') {
            return activeTerminalPaneId;
        }
        if (panelId === 'agent') {
            return lastActiveAgentPaneIdRef.current;
        }
        return undefined;
    }, [activeEditorPaneId, activeTerminalPaneId]);

    const getFocusablePanelKey = useCallback((panelId: PanelId): string | undefined => {
        if (panelId !== 'editor' && panelId !== 'terminal' && panelId !== 'agent') {
            return undefined;
        }

        const panelKeys = panelKeysByIdRef.current[panelId] ?? [];
        if (panelKeys.length === 0) {
            return undefined;
        }

        const activePanel = activePanelRef.current;
        const isTargetFocused = activePanel?.panelId === panelId && panelKeys.includes(activePanel.panelKey);
        if (isTargetFocused && activePanel) {
            const currentIndex = panelKeys.indexOf(activePanel.panelKey);
            return panelKeys[(currentIndex + 1) % panelKeys.length];
        }

        const preferredPanelKey = getPreferredPanelKey(panelId);
        return preferredPanelKey && panelKeys.includes(preferredPanelKey)
            ? preferredPanelKey
            : panelKeys[0];
    }, [getPreferredPanelKey]);

    const handleCtrlFocusShortcut = useCallback((event: KeyboardEvent): boolean => {
        if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
            return false;
        }

        let focusTarget: PanelId | null = null;
        switch (event.code) {
            case 'Digit1':
                focusTarget = 'files';
                break;
            case 'Digit2':
                focusTarget = 'editor';
                break;
            case 'Digit3':
                focusTarget = 'terminal';
                break;
            case 'Digit4':
                focusTarget = 'agent';
                break;
            default:
                break;
        }
        if (!focusTarget) {
            return false;
        }

        event.preventDefault();
        setFocusRequest({
            target: focusTarget,
            panelKey: getFocusablePanelKey(focusTarget),
            nonce: Date.now(),
        });
        return true;
    }, [getFocusablePanelKey]);

    const requestPanelFocus = useCallback((panelId: PanelId, panelKey?: string) => {
        setFocusRequest({
            target: panelId,
            panelKey,
            nonce: Date.now(),
        });
    }, []);

    const handlePanelAdded = useCallback((panelId: PanelId, panelKey: string) => {
        const current = panelKeysByIdRef.current[panelId] ?? [];
        if (!current.includes(panelKey)) {
            panelKeysByIdRef.current[panelId] = [...current, panelKey];
        }
    }, []);

    const handlePanelRemoved = useCallback((panelId: PanelId, panelKey: string) => {
        const current = panelKeysByIdRef.current[panelId] ?? [];
        if (current.includes(panelKey)) {
            panelKeysByIdRef.current[panelId] = current.filter((key) => key !== panelKey);
        }

        if (activePanelRef.current?.panelKey === panelKey) {
            activePanelRef.current = null;
        }
    }, []);

    const handlePanelActivated = useCallback((panelId: PanelId, panelKey: string) => {
        activePanelRef.current = { panelId, panelKey };

        if (panelId === 'agent') {
            lastActiveAgentPaneIdRef.current = panelKey;
        }
    }, []);

    const getFocusRequestToken = useCallback((panelId: PanelId, panelKey?: string): number | null => {
        if (focusRequest?.target !== panelId) {
            return null;
        }
        if (focusRequest.panelKey && panelKey && focusRequest.panelKey !== panelKey) {
            return null;
        }
        return focusRequest.nonce;
    }, [focusRequest]);

    useEffect(() => {
        if (!focusRequest) {
            return;
        }

        if (focusRequest.target === 'editor' && activeEditorPaneId) {
            onFocusEditorPane(focusRequest.panelKey ?? activeEditorPaneId);
            return;
        }

        if (focusRequest.target === 'terminal') {
            const knownTerminalPanels = panelKeysByIdRef.current.terminal;
            const requestedKey = focusRequest.panelKey;
            const resolvedKey = requestedKey && knownTerminalPanels.includes(requestedKey)
                ? requestedKey
                : activeTerminalPaneId;
            onActivateTerminalPane(resolvedKey || 'terminal');
            return;
        }

        if (focusRequest.target === 'agent') {
            const knownAgentPanels = panelKeysByIdRef.current.agent;
            const requestedKey = focusRequest.panelKey;
            const resolvedKey = requestedKey && knownAgentPanels.includes(requestedKey)
                ? requestedKey
                : activeAgentPaneId;
            onActivateAgentPane(resolvedKey || 'agent');
        }
    }, [
        activeAgentPaneId,
        activeEditorPaneId,
        activeTerminalPaneId,
        focusRequest,
        onActivateAgentPane,
        onActivateTerminalPane,
        onFocusEditorPane,
    ]);

    return useMemo(() => ({
        getFocusRequestToken,
        handleCtrlFocusShortcut,
        requestPanelFocus,
        handlePanelAdded,
        handlePanelRemoved,
        handlePanelActivated,
    }), [
        getFocusRequestToken,
        handleCtrlFocusShortcut,
        requestPanelFocus,
        handlePanelAdded,
        handlePanelRemoved,
        handlePanelActivated,
    ]);
};

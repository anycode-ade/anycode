import React from 'react';
import { DockviewReact, type IDockviewHeaderActionsProps, type IDockviewPanelProps } from 'dockview';
import { Icons } from '../Icons';

export type PaneType = 'fileTree' | 'search' | 'changes' | 'editor' | 'terminal' | 'agent' | 'toolbar' | 'empty';
export type RealPaneType = Exclude<PaneType, 'empty'>;

export const PANE_IDS: Record<RealPaneType, string> = {
    fileTree: 'pane:fileTree',
    search: 'pane:search',
    changes: 'pane:changes',
    editor: 'pane:editor',
    terminal: 'pane:terminal',
    agent: 'pane:agent',
    toolbar: 'pane:toolbar',
};

export const PANE_TITLES: Record<PaneType, string> = {
    fileTree: 'Files',
    search: 'Search',
    changes: 'Changes',
    editor: 'Editor',
    terminal: 'Terminal',
    agent: 'Agent',
    toolbar: 'Toolbar',
    empty: 'Empty',
};

export const AVAILABLE_PANES: Array<{ type: RealPaneType; label: string }> = [
    { type: 'fileTree', label: 'File Tree' },
    { type: 'search', label: 'Search' },
    { type: 'changes', label: 'Changes' },
    { type: 'editor', label: 'Editor' },
    { type: 'terminal', label: 'Terminal' },
    { type: 'agent', label: 'Agent' },
    { type: 'toolbar', label: 'Toolbar' },
];

export const PANEL_CONSTRAINTS = { minimumWidth: 0, minimumHeight: 0 } as const;
export const TOOLBAR_PANEL_HEIGHT = 35;
export const TOOLBAR_PANEL_CONSTRAINTS = {
    minimumWidth: 0,
    minimumHeight: TOOLBAR_PANEL_HEIGHT,
    maximumHeight: TOOLBAR_PANEL_HEIGHT,
} as const;

export type ContextProviderDescriptor = {
    context: React.Context<any>;
    value: any;
};

type LayoutProps = {
    providers: ContextProviderDescriptor[];
    dockviewComponents: Record<string, React.FC<IDockviewPanelProps>>;
    HeaderActions: React.FC<IDockviewHeaderActionsProps>;
    onDockviewReady: (event: { api: any }) => void;
};

const ContextProviders: React.FC<{
    providers: ContextProviderDescriptor[];
    children: React.ReactNode;
}> = ({ providers, children }) => (
    <>
        {providers.reduceRight<React.ReactNode>((acc, { context: Context, value }) => (
            <Context.Provider value={value}>{acc}</Context.Provider>
        ), children)}
    </>
);

export const Layout: React.FC<LayoutProps> = ({
    providers,
    dockviewComponents,
    HeaderActions,
    onDockviewReady,
}) => (
    <div className="app-container">
        <ContextProviders providers={providers}>
            <div className="main-content layout dockview-theme-dark anycode-dockview-theme">
                <DockviewReact
                    className="anycode-dockview"
                    components={dockviewComponents}
                    rightHeaderActionsComponent={HeaderActions}
                    onReady={onDockviewReady}
                />
            </div>
        </ContextProviders>
    </div>
);

export const createDefaultLayout = (api: any) => {
    const fileTreePanel = api.addPanel({
        id: PANE_IDS.fileTree,
        title: PANE_TITLES.fileTree,
        component: 'fileTree',
        params: { paneType: 'fileTree' },
        ...PANEL_CONSTRAINTS,
    });

    api.addPanel({
        id: PANE_IDS.search,
        title: PANE_TITLES.search,
        component: 'search',
        params: { paneType: 'search' },
        inactive: true,
        ...PANEL_CONSTRAINTS,
        position: {
            referencePanel: fileTreePanel,
            direction: 'within',
        },
    });

    api.addPanel({
        id: PANE_IDS.changes,
        title: PANE_TITLES.changes,
        component: 'changes',
        params: { paneType: 'changes' },
        inactive: true,
        ...PANEL_CONSTRAINTS,
        position: {
            referencePanel: fileTreePanel,
            direction: 'within',
        },
    });

    const editorPanel = api.addPanel({
        id: PANE_IDS.editor,
        title: PANE_TITLES.editor,
        component: 'editor',
        params: { paneType: 'editor' },
        ...PANEL_CONSTRAINTS,
        position: {
            referencePanel: fileTreePanel,
            direction: 'right',
        },
    });

    api.addPanel({
        id: PANE_IDS.agent,
        title: PANE_TITLES.agent,
        component: 'agent',
        params: { paneType: 'agent' },
        ...PANEL_CONSTRAINTS,
        position: {
            referencePanel: editorPanel,
            direction: 'right',
        },
    });

    const terminalPanel = api.addPanel({
        id: PANE_IDS.terminal,
        title: PANE_TITLES.terminal,
        component: 'terminal',
        params: { paneType: 'terminal' },
        ...PANEL_CONSTRAINTS,
        position: {
            referencePanel: editorPanel,
            direction: 'below',
        },
    });

    const toolbarPanel = api.addPanel({
        id: PANE_IDS.toolbar,
        title: PANE_TITLES.toolbar,
        component: 'toolbar',
        params: { paneType: 'toolbar' },
        ...TOOLBAR_PANEL_CONSTRAINTS,
        position: {
            referencePanel: terminalPanel,
            direction: 'below',
        },
    });

    fileTreePanel.group?.api.setSize({ width: 280 });
    terminalPanel.group?.api.setSize({ height: 220 });
    toolbarPanel.group?.api.setSize({ height: TOOLBAR_PANEL_HEIGHT });
    toolbarPanel.api?.setConstraints?.(TOOLBAR_PANEL_CONSTRAINTS);
    toolbarPanel.group?.api?.setConstraints?.(TOOLBAR_PANEL_CONSTRAINTS);
};

export const createEmptySplitPanel = ({
    containerApi,
    referencePanel,
    panelId,
    direction,
}: {
    containerApi: any;
    referencePanel: any;
    panelId: string;
    direction: 'right' | 'below';
}) => containerApi.addPanel({
    id: panelId,
    title: PANE_TITLES.empty,
    component: 'empty',
    params: { paneType: 'empty' },
    ...PANEL_CONSTRAINTS,
    position: {
        referencePanel,
        direction,
    },
});

export const createEmptyTabPanel = ({
    containerApi,
    referencePanel,
    panelId,
}: {
    containerApi: any;
    referencePanel: any;
    panelId: string;
}) => containerApi.addPanel({
    id: panelId,
    title: PANE_TITLES.empty,
    component: 'empty',
    params: { paneType: 'empty' },
    ...PANEL_CONSTRAINTS,
    position: {
        referencePanel,
        direction: 'within',
    },
});

export const createHeaderActions = ({
    getNextEmptyPanelId,
}: {
    getNextEmptyPanelId: (kind: 'split' | 'tab') => string;
}): React.FC<IDockviewHeaderActionsProps> => {
    const HeaderActions: React.FC<IDockviewHeaderActionsProps> = ({ activePanel, containerApi }) => {
        if (!activePanel) return null;

        const addTab = () => {
            createEmptyTabPanel({
                containerApi,
                referencePanel: activePanel,
                panelId: getNextEmptyPanelId('tab'),
            });
        };

        const splitHorizontal = () => {
            createEmptySplitPanel({
                containerApi,
                referencePanel: activePanel,
                panelId: getNextEmptyPanelId('split'),
                direction: 'below',
            });
        };

        const splitVertical = () => {
            createEmptySplitPanel({
                containerApi,
                referencePanel: activePanel,
                panelId: getNextEmptyPanelId('split'),
                direction: 'right',
            });
        };

        return (
            <div className="dockview-header-actions">
                <button
                    type="button"
                    className="dockview-header-action"
                    title="Add tab"
                    onClick={addTab}
                >
                    +
                </button>
                <button
                    type="button"
                    className="dockview-header-action"
                    title="Split horizontal"
                    onClick={splitHorizontal}
                >
                    <Icons.SplitHorizontal />
                </button>
                <button
                    type="button"
                    className="dockview-header-action"
                    title="Split vertical"
                    onClick={splitVertical}
                >
                    <Icons.SplitVertical />
                </button>
                <button
                    type="button"
                    className="dockview-header-action close"
                    title="Close panel"
                    onClick={() => activePanel.api.close()}
                >
                    <Icons.Close />
                </button>
            </div>
        );
    };

    return HeaderActions;
};

type DockviewDisposer = { dispose: () => void };

type CreateDockviewReadyHandlerOptions = {
    createDefaultLayout: (api: any) => void;
    loadSavedLayout: () => any;
    saveLayout: (layout: any) => void;
    terminals: Array<{ id: string }>;
    terminalSelected: number;
    setTerminalPaneTerminalIds: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    setFocusedTerminalPaneId: React.Dispatch<React.SetStateAction<string | null>>;
    dockviewApiRef: React.MutableRefObject<any>;
    dockviewDisposerRef: React.MutableRefObject<DockviewDisposer | null>;
};

const applyPanelConstraints = (api: any) => {
    [...api.groups, ...api.panels].forEach((item: any) => item.api?.setConstraints?.(PANEL_CONSTRAINTS));
};

const applyToolbarConstraints = (api: any) => {
    const toolbarPanels = api.panels.filter((panel: any) => panel?.id?.startsWith('pane:toolbar'));
    toolbarPanels.forEach((toolbarPanel: any) => {
        toolbarPanel.api?.setConstraints?.(TOOLBAR_PANEL_CONSTRAINTS);
        toolbarPanel.group?.api?.setConstraints?.(TOOLBAR_PANEL_CONSTRAINTS);
    });
};

const applyToolbarSize = (api: any) => {
    const toolbarPanels = api.panels.filter((panel: any) => panel?.id?.startsWith('pane:toolbar'));
    toolbarPanels.forEach((toolbarPanel: any) => {
        toolbarPanel.group?.api?.setSize?.({ height: TOOLBAR_PANEL_HEIGHT });
    });
};

const restoreOrCreateLayout = ({
    api,
    loadSavedLayout,
    createDefaultLayout,
}: {
    api: any;
    loadSavedLayout: () => any;
    createDefaultLayout: (api: any) => void;
}) => {
    const savedLayout = loadSavedLayout();
    if (savedLayout) {
        try {
            api.fromJSON(savedLayout);
            return;
        } catch (error) {
            console.warn('Failed to restore dockview layout, fallback to default', error);
            api.clear();
        }
    }
    createDefaultLayout(api);
};

const restoreInitialTerminalBinding = ({
    api,
    terminals,
    terminalSelected,
    setTerminalPaneTerminalIds,
    setFocusedTerminalPaneId,
}: {
    api: any;
    terminals: Array<{ id: string }>;
    terminalSelected: number;
    setTerminalPaneTerminalIds: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    setFocusedTerminalPaneId: React.Dispatch<React.SetStateAction<string | null>>;
}) => {
    const terminalPanel = api.getPanel(PANE_IDS.terminal);
    terminalPanel?.group?.api.setSize({ height: 220 });
    const initialTerminalId =
        terminals[terminalSelected]?.id
        ?? terminals[0]?.id
        ?? null;

    if (terminalPanel && initialTerminalId) {
        setTerminalPaneTerminalIds((prev) => {
            const existingTerminalId = prev[terminalPanel.id];
            if (existingTerminalId && terminals.some((term) => term.id === existingTerminalId)) {
                return prev;
            }
            if (existingTerminalId === initialTerminalId) return prev;
            return { ...prev, [terminalPanel.id]: initialTerminalId };
        });
        setFocusedTerminalPaneId((prev) => prev ?? terminalPanel.id);
    }
};

const bindLayoutSubscriptions = ({
    api,
    dockviewDisposerRef,
    saveLayout,
}: {
    api: any;
    dockviewDisposerRef: React.MutableRefObject<DockviewDisposer | null>;
    saveLayout: (layout: any) => void;
}) => {
    dockviewDisposerRef.current?.dispose();

    const onDidLayoutChange = api.onDidLayoutChange(() => {
        applyPanelConstraints(api);
        applyToolbarConstraints(api);
        saveLayout(api.toJSON());
    });

    const onDidAddGroup = api.onDidAddGroup((group: any) => {
        group.api?.setConstraints?.(PANEL_CONSTRAINTS);
        applyToolbarConstraints(api);
    });

    const onDidAddPanel = api.onDidAddPanel((panel: any) => {
        panel.api?.setConstraints?.(PANEL_CONSTRAINTS);
        if (panel?.id?.startsWith('pane:toolbar')) {
            panel.api?.setConstraints?.(TOOLBAR_PANEL_CONSTRAINTS);
            panel.group?.api?.setConstraints?.(TOOLBAR_PANEL_CONSTRAINTS);
            panel.group?.api?.setSize?.({ height: TOOLBAR_PANEL_HEIGHT });
        }
    });

    dockviewDisposerRef.current = {
        dispose: () => {
            onDidLayoutChange.dispose();
            onDidAddGroup.dispose();
            onDidAddPanel.dispose();
        },
    };
};

export const createDockviewReadyHandler = ({
    createDefaultLayout,
    loadSavedLayout,
    saveLayout,
    terminals,
    terminalSelected,
    setTerminalPaneTerminalIds,
    setFocusedTerminalPaneId,
    dockviewApiRef,
    dockviewDisposerRef,
}: CreateDockviewReadyHandlerOptions) => (event: { api: any }) => {
    dockviewApiRef.current = event.api;

    restoreOrCreateLayout({
        api: event.api,
        loadSavedLayout,
        createDefaultLayout,
    });

    applyPanelConstraints(event.api);
    applyToolbarConstraints(event.api);
    applyToolbarSize(event.api);

    const fileTreePanel = event.api.getPanel(PANE_IDS.fileTree);
    fileTreePanel?.api.setActive();
    fileTreePanel?.group?.api.setSize({ width: 280 });

    restoreInitialTerminalBinding({
        api: event.api,
        terminals,
        terminalSelected,
        setTerminalPaneTerminalIds,
        setFocusedTerminalPaneId,
    });

    bindLayoutSubscriptions({
        api: event.api,
        dockviewDisposerRef,
        saveLayout,
    });

    saveLayout(event.api.toJSON());
};

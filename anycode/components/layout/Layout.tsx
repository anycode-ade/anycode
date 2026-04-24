import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    DockviewApi,
    DockviewReact,
    Orientation,
    SplitviewApi,
    SplitviewReact,
    type IDockviewHeaderActionsProps,
    type DockviewReadyEvent,
    type IDockviewPanel,
    type IDockviewPanelProps,
    type ISplitviewPanelProps,
} from 'dockview';
import {
    loadAgentPanelVisible,
    loadEditorPanelVisible,
    loadFilesPanelVisible,
    loadItem,
    loadTerminalPanelVisible,
    saveItem,
} from '../../storage';
import { Icons } from '../Icons';
import './Layout.css';

export type SplitPaneConfig = {
    id: string;
    content: React.ReactNode;
    visible?: boolean;
    minSize?: number;
    maxSize?: number;
    size?: number;
    className?: string;
};

type PaneParams = {
    content: React.ReactNode;
    className?: string;
};

type SplitDirection = 'row' | 'column';

type SplitProps = {
    direction: SplitDirection;
    panes: SplitPaneConfig[];
    className?: string;
};

const SplitPanel: React.FC<ISplitviewPanelProps<PaneParams>> = ({ params }) => (
    <div className={`dock-split-pane ${params.className ?? ''}`.trim()}>
        {params.content}
    </div>
);

const splitComponents = {
    pane: SplitPanel,
};

const splitOrientation = (direction: SplitDirection): Orientation => (
    direction === 'column' ? Orientation.VERTICAL : Orientation.HORIZONTAL
);

export const Split: React.FC<SplitProps> = ({ direction, panes, className }) => {
    const apiRef = useRef<SplitviewApi | null>(null);
    const containerClassName = useMemo(() => (
        ['dock-split', 'dockview-theme-dark', className].filter(Boolean).join(' ')
    ), [className]);

    useEffect(() => () => {
        apiRef.current = null;
    }, []);

    useEffect(() => {
        const api = apiRef.current;
        if (!api) {
            return;
        }

        api.updateOptions({ orientation: splitOrientation(direction) });
    }, [direction]);

    const syncPanels = useCallback((api: SplitviewApi) => {
        const paneMap = new Map(panes.map((pane) => [pane.id, pane]));

        for (const panel of [...api.panels]) {
            if (!paneMap.has(panel.id)) {
                api.removePanel(panel);
            }
        }

        panes.forEach((pane, index) => {
            let panel = api.getPanel(pane.id);

            if (!panel) {
                panel = api.addPanel({
                    id: pane.id,
                    component: 'pane',
                    index,
                    size: pane.size,
                    minimumSize: pane.minSize,
                    maximumSize: pane.maxSize,
                    params: {
                        content: pane.content,
                        className: pane.className,
                    },
                });
            } else {
                panel.api.updateParameters({
                    content: pane.content,
                    className: pane.className,
                });

                panel.api.setConstraints({
                    minimumSize: pane.minSize,
                    maximumSize: pane.maxSize,
                });
            }

            const currentIndex = api.panels.findIndex((current) => current.id === pane.id);
            if (currentIndex !== -1 && currentIndex !== index) {
                api.movePanel(currentIndex, index);
            }

            panel.api.setVisible(pane.visible ?? true);
        });
    }, [panes]);

    useEffect(() => {
        const api = apiRef.current;
        if (!api) {
            return;
        }

        syncPanels(api);
    }, [syncPanels]);

    return (
        <div className={containerClassName}>
            <SplitviewReact
                components={splitComponents}
                proportionalLayout
                orientation={splitOrientation(direction)}
                onReady={({ api }) => {
                    apiRef.current = api;
                    api.updateOptions({ orientation: splitOrientation(direction) });
                    syncPanels(api);
                }}
            />
        </div>
    );
};

export type PanelId = 'files' | 'search' | 'changes' | 'editor' | 'agent' | 'terminal' | 'toolbar';

type PanelParams = {
    panelKey: string;
    panelId: PanelId;
    content: React.ReactNode;
};

type PanelPlacementDirection = 'above' | 'right' | 'below' | 'within';

type PanelPlacement = {
    direction: PanelPlacementDirection;
    referenceIds: readonly PanelId[];
};

type PanelDefinition = {
    id: PanelId;
    title: string;
    pickerVisible: boolean;
    disableClose?: boolean;
    allowMultiple?: boolean;
    defaultPlacements?: readonly PanelPlacement[];
};

type PanelPickerParams = {
    pickerPanelId: string;
    onSelectPanel: (panelId: PanelId, pickerPanelId: string) => void;
};

type PanelVisibility = Record<PanelId, boolean>;

type LayoutProps = {
    renderPanel: (panelId: PanelId, panelKey: string) => React.ReactNode;
    onPanelAdded?: (id: PanelId, panelKey: string) => void;
    onPanelRemoved?: (id: PanelId, panelKey: string) => void;
    onPanelActivated?: (id: PanelId, panelKey: string) => void;
};

type SerializedLayout = ReturnType<DockviewApi['toJSON']>;

const PANEL_INSTANCE_SEPARATOR = '__';
const EMPTY_PANE_PREFIX = 'empty-pane-';

const getPanelBaseId = (panelKey: string): PanelId | null => {
    const directMatch = panelKey as PanelId;
    if (Object.hasOwn(panelDefinitionById, directMatch)) {
        return directMatch;
    }

    const separatorIndex = panelKey.indexOf(PANEL_INSTANCE_SEPARATOR);
    if (separatorIndex !== -1) {
        const baseId = panelKey.slice(0, separatorIndex) as PanelId;
        if (Object.hasOwn(panelDefinitionById, baseId)) {
            return baseId;
        }
    }

    return null;
};

const createPanelKey = (panelId: PanelId): string => (
    `${panelId}${PANEL_INSTANCE_SEPARATOR}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
);

const createPickerPanelId = (): string => `${EMPTY_PANE_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const isPickerPanel = (panelId: string): boolean => panelId.startsWith(EMPTY_PANE_PREFIX);

const getPanelsByBaseId = (api: DockviewApi, panelId: PanelId): IDockviewPanel[] => (
    api.panels.filter((panel) => getPanelBaseId(panel.id) === panelId)
);

const getPanelByBaseId = (api: DockviewApi, panelId: PanelId): IDockviewPanel | undefined => (
    getPanelsByBaseId(api, panelId)[0]
);

const panelDefinitions = [
    {
        id: 'toolbar',
        title: 'Anycode',
        pickerVisible: false,
        disableClose: true,
    },
    {
        id: 'files',
        title: 'Files',
        pickerVisible: true,
    },
    {
        id: 'search',
        title: 'Search',
        pickerVisible: true,
        defaultPlacements: [
            { direction: 'within', referenceIds: ['files'] },
        ],
    },
    {
        id: 'changes',
        title: 'Changes',
        pickerVisible: true,
        defaultPlacements: [
            { direction: 'within', referenceIds: ['files', 'search'] },
        ],
    },
    {
        id: 'editor',
        title: 'Editor',
        pickerVisible: true,
        allowMultiple: true,
        defaultPlacements: [
            { direction: 'right', referenceIds: ['files', 'search', 'changes'] },
        ],
    },
    {
        id: 'agent',
        title: 'Agent',
        pickerVisible: true,
        allowMultiple: true,
        defaultPlacements: [
            { direction: 'right', referenceIds: ['editor'] },
        ],
    },
    {
        id: 'terminal',
        title: 'Terminal',
        pickerVisible: true,
        allowMultiple: true,
        defaultPlacements: [
            { direction: 'below', referenceIds: ['editor'] },
        ],
    },
] as const satisfies readonly PanelDefinition[];

const panelDefinitionById = Object.fromEntries(
    panelDefinitions.map((definition) => [definition.id, definition]),
) as Record<PanelId, PanelDefinition>;

const panelTitles: Record<PanelId, string> = Object.fromEntries(
    panelDefinitions.map((definition) => [definition.id, definition.title]),
) as Record<PanelId, string>;

const panelSyncOrder: PanelId[] = ['files', 'editor', 'agent', 'search', 'changes', 'terminal'];
const LAYOUT_STORAGE_KEY = 'layout';
const LAYOUT_VERSION_STORAGE_KEY = 'layoutVersion';
const CURRENT_LAYOUT_VERSION = 4;

const loadPanelVisibility = (): PanelVisibility => ({
    files: (loadItem<number>(LAYOUT_VERSION_STORAGE_KEY) ?? 0) < CURRENT_LAYOUT_VERSION ? true : loadFilesPanelVisible(),
    search: (loadItem<number>(LAYOUT_VERSION_STORAGE_KEY) ?? 0) < CURRENT_LAYOUT_VERSION ? true : (loadItem<boolean>('searchPanelVisible') ?? false),
    changes: (loadItem<number>(LAYOUT_VERSION_STORAGE_KEY) ?? 0) < CURRENT_LAYOUT_VERSION ? true : (loadItem<boolean>('changesPanelVisible') ?? false),
    editor: (loadItem<number>(LAYOUT_VERSION_STORAGE_KEY) ?? 0) < CURRENT_LAYOUT_VERSION ? true : loadEditorPanelVisible(),
    agent: (loadItem<number>(LAYOUT_VERSION_STORAGE_KEY) ?? 0) < CURRENT_LAYOUT_VERSION ? true : loadAgentPanelVisible(),
    terminal: loadTerminalPanelVisible(),
    toolbar: true,
});

const hasSavedPanel = (layout: SerializedLayout, panelId: PanelId): boolean => (
    Object.keys(layout.panels).some((panelKey) => getPanelBaseId(panelKey) === panelId)
);

const shouldUseSavedLayout = (layout: SerializedLayout): boolean => {
    const savedLayoutVersion = loadItem<number>(LAYOUT_VERSION_STORAGE_KEY) ?? 0;
    if (savedLayoutVersion < CURRENT_LAYOUT_VERSION) {
        return false;
    }

    if (hasSavedPanel(layout, 'toolbar')) {
        return false;
    }

    return Object.keys(layout.panels).some((panelKey) => {
        const baseId = getPanelBaseId(panelKey);
        return baseId !== null && baseId !== 'toolbar';
    });
};

const LayoutPanel: React.FC<IDockviewPanelProps<PanelParams>> = ({ params }) => (
    <div className={`layout-dock-panel layout-dock-panel--${params.panelId}`}>
        {params.content}
    </div>
);

const panelPickerOrder: PanelId[] = panelDefinitions
    .filter((definition) => definition.pickerVisible)
    .map((definition) => definition.id);

const PanelPicker: React.FC<IDockviewPanelProps<PanelPickerParams>> = ({ params }) => (
    <div className="layout-dock-panel layout-dock-panel--picker">
        <div className="layout-panel-picker">
            <div className="layout-panel-picker-title">Empty Pane</div>
            <div className="layout-panel-picker-list">
                {panelPickerOrder.map((panelId) => (
                    <button
                        key={panelId}
                        className="layout-panel-picker-item"
                        onClick={() => {
                            if (typeof params.onSelectPanel === 'function') {
                                params.onSelectPanel(panelId, params.pickerPanelId);
                            }
                        }}
                        type="button"
                    >
                        {panelTitles[panelId]}
                    </button>
                ))}
            </div>
        </div>
    </div>
);

const LayoutHeaderActions: React.FC<IDockviewHeaderActionsProps & {
    onSplitRight: (api: DockviewApi, referencePanelId: string) => void;
    onSplitDown: (api: DockviewApi, referencePanelId: string) => void;
    onAddTab: (api: DockviewApi, referencePanelId: string) => void;
    onClosePanel: (api: DockviewApi, panel: IDockviewPanel) => void;
}> = ({ containerApi, activePanel, onSplitRight, onSplitDown, onAddTab, onClosePanel }) => {
    if (!activePanel) {
        return null;
    }

    const canClosePanel = activePanel.id !== 'toolbar' && (containerApi.totalPanels > 1 || !isPickerPanel(activePanel.id));

    return (
        <div className="layout-header-actions">
            <button
                className="layout-header-action-btn layout-header-action-btn--plus"
                onClick={() => onAddTab(containerApi, activePanel.id)}
                type="button"
                title="Add Empty Tab"
                aria-label="Add Empty Tab"
            >
                <span className="layout-header-action-plus" aria-hidden="true">+</span>
            </button>

            <button
                className="layout-header-action-btn layout-header-action-btn--split-right"
                onClick={() => onSplitRight(containerApi, activePanel.id)}
                type="button"
                title="Split Right"
                aria-label="Split Right"
            >
                <Icons.LayoutSplitRight />
            </button>

            <button
                className="layout-header-action-btn layout-header-action-btn--split-down"
                onClick={() => onSplitDown(containerApi, activePanel.id)}
                type="button"
                title="Split Down"
                aria-label="Split Down"
            >
                <Icons.LayoutSplitDown />
            </button>

            {canClosePanel ? (
                <button
                    className="layout-header-action-btn layout-header-action-btn--close"
                    onClick={() => onClosePanel(containerApi, activePanel)}
                    type="button"
                    title="Close Panel"
                    aria-label="Close Panel"
                >
                    <Icons.LayoutClose />
                </button>
            ) : null}
        </div>
    );
};

const getDefaultPanelPosition = (
    api: DockviewApi,
    panelId: PanelId,
) => {
    const definition = panelDefinitionById[panelId];

    for (const placement of definition.defaultPlacements ?? []) {
        for (const referenceId of placement.referenceIds) {
            const referencePanel = api.getPanel(referenceId) ?? getPanelByBaseId(api, referenceId);
            if (referencePanel) {
                return {
                    referencePanel,
                    direction: placement.direction,
                };
            }
        }
    }

    return undefined;
};

const addPanel = (
    api: DockviewApi,
    panelKey: string,
    panelId: PanelId,
    content: React.ReactNode,
): IDockviewPanel => {
    const definition = panelDefinitionById[panelId];
    const existing = api.getPanel(panelKey);
    if (existing) {
        existing.api.updateParameters({ panelId, panelKey, content });
        return existing;
    }

    return api.addPanel({
        id: panelKey,
        component: 'layoutPanel',
        title: definition.title,
        params: { panelId, panelKey, content },
        minimumWidth: 0,
        minimumHeight: 0,
        position: getDefaultPanelPosition(api, panelId),
        //@ts-ignore
        disableClose: definition.disableClose,
    });
};

const addRootPickerPanel = (
    api: DockviewApi,
    onSelectPanel: (panelId: PanelId, pickerPanelId: string) => void,
): IDockviewPanel => {
    const pickerPanelId = createPickerPanelId();
    return api.addPanel<PanelPickerParams>({
        id: pickerPanelId,
        component: 'panelPicker',
        title: 'Empty',
        minimumWidth: 0,
        minimumHeight: 0,
        params: {
            pickerPanelId,
            onSelectPanel,
        },
    });
};

export const Layout: React.FC<LayoutProps> = ({
    renderPanel,
    onPanelAdded,
    onPanelRemoved,
    onPanelActivated,
}) => {
    const apiRef = useRef<DockviewApi | null>(null);
    const [visibility, setVisibility] = useState<PanelVisibility>(loadPanelVisibility);
    const listenersRef = useRef<Array<{ dispose: () => void }>>([]);
    const layoutSaveTimerRef = useRef<number | null>(null);
    const emptyPaneRestoreTimerRef = useRef<number | null>(null);
    const splitRightRef = useRef<(api: DockviewApi, referencePanelId: string) => void>(() => {});
    const splitDownRef = useRef<(api: DockviewApi, referencePanelId: string) => void>(() => {});
    const addTabRef = useRef<(api: DockviewApi, referencePanelId: string) => void>(() => {});
    const closePanelRef = useRef<(api: DockviewApi, panel: IDockviewPanel) => void>(() => {});
    const renderPanelRef = useRef<LayoutProps['renderPanel']>(renderPanel);

    renderPanelRef.current = renderPanel;

    const panelEntries = useMemo(() => (
        panelSyncOrder.map((id) => ({
            id,
            visible: visibility[id],
        }))
    ), [visibility]);

    useEffect(() => {
        saveItem('filesPanelVisible', visibility.files);
        saveItem('searchPanelVisible', visibility.search);
        saveItem('changesPanelVisible', visibility.changes);
        saveItem('editorPanelVisible', visibility.editor);
        saveItem('agentPanelVisible', visibility.agent);
        saveItem('terminalPanelVisible', visibility.terminal);
    }, [visibility]);

    const resolvePanelContent = useCallback((panelId: PanelId, panelKey: string): React.ReactNode => (
        renderPanelRef.current(panelId, panelKey)
    ), []);

    const disposeListeners = useCallback(() => {
        for (const listener of listenersRef.current) {
            listener.dispose();
        }
        listenersRef.current = [];
    }, []);

    const queueSaveLayout = useCallback((api: DockviewApi) => {
        if (layoutSaveTimerRef.current !== null) {
            clearTimeout(layoutSaveTimerRef.current);
        }
        layoutSaveTimerRef.current = window.setTimeout(() => {
            layoutSaveTimerRef.current = null;
            const raw = api.toJSON();
            const sanitized = {
                ...raw,
                panels: Object.fromEntries(
                    Object.entries(raw.panels).map(([id, state]) => [id, { ...state, params: {} }]),
                ),
            };
            saveItem(LAYOUT_STORAGE_KEY, sanitized);
            saveItem(LAYOUT_VERSION_STORAGE_KEY, CURRENT_LAYOUT_VERSION);
        }, 120);
    }, []);

    const syncPanels = useCallback((api: DockviewApi) => {
        for (const panel of panelEntries) {
            const definition = panelDefinitionById[panel.id];

            if (definition.allowMultiple) {
                const existingPanels = getPanelsByBaseId(api, panel.id);

                if (!panel.visible) {
                    for (const existing of existingPanels) {
                        api.removePanel(existing);
                    }
                    continue;
                }

                if (existingPanels.length === 0) {
                    addPanel(api, panel.id, panel.id, resolvePanelContent(panel.id, panel.id));
                    continue;
                }

                for (const existing of existingPanels) {
                    existing.api.updateParameters({
                        panelId: panel.id,
                        panelKey: existing.id,
                        content: resolvePanelContent(panel.id, existing.id),
                    });
                }
                continue;
            }

            const existing = api.getPanel(panel.id);

            if (!panel.visible) {
                if (existing) {
                    api.removePanel(existing);
                }
                continue;
            }

            addPanel(api, panel.id, panel.id, resolvePanelContent(panel.id, panel.id));
        }
    }, [panelEntries, resolvePanelContent]);

    const syncToolbarSize = useCallback((api: DockviewApi) => {
        const toolbarPanel = api.getPanel('toolbar');
        if (!toolbarPanel) {
            return;
        }

        toolbarPanel.api.setSize({
            height: 44,
        });
    }, []);

    const handleSelectPanelFromPicker = useCallback((panelId: PanelId, pickerPanelId: string) => {
        const api = apiRef.current;
        if (!api) {
            return;
        }

        const pickerPanel = api.getPanel(pickerPanelId);
        if (!pickerPanel) {
            return;
        }

        setVisibility((prev) => ({ ...prev, [panelId]: true }));

        const definition = panelDefinitionById[panelId];
        const targetPanelKey = definition.allowMultiple ? createPanelKey(panelId) : panelId;
        const targetPanel = definition.allowMultiple
            ? addPanel(api, targetPanelKey, panelId, resolvePanelContent(panelId, targetPanelKey))
            : (api.getPanel(panelId) ?? addPanel(api, panelId, panelId, resolvePanelContent(panelId, panelId)));

        targetPanel.api.moveTo({
            group: pickerPanel.group,
            position: 'center',
        });
        targetPanel.api.setActive();

        const stalePickerPanel = api.getPanel(pickerPanelId);
        if (stalePickerPanel) {
            api.removePanel(stalePickerPanel);
        }
    }, [resolvePanelContent]);

    const addPickerPanel = useCallback((
        api: DockviewApi,
        referencePanelId: string,
        direction: 'right' | 'below' | 'within',
    ) => {
        const referencePanel = api.getPanel(referencePanelId);
        if (!referencePanel) {
            return;
        }

        const pickerPanelId = createPickerPanelId();
        api.addPanel<PanelPickerParams>({
            id: pickerPanelId,
            component: 'panelPicker',
            title: 'Empty',
            position: {
                referencePanel,
                direction,
            },
            minimumWidth: 0,
            minimumHeight: 0,
            params: {
                pickerPanelId,
                onSelectPanel: handleSelectPanelFromPicker,
            },
        });
    }, [handleSelectPanelFromPicker]);

    const rebindPickerPanels = useCallback((api: DockviewApi) => {
        for (const panel of api.panels) {
            if (!isPickerPanel(panel.id)) {
                continue;
            }

            panel.api.updateParameters({
                pickerPanelId: panel.id,
                onSelectPanel: handleSelectPanelFromPicker,
            });
        }
    }, [handleSelectPanelFromPicker]);

    const handleSplitPanelRight = useCallback((api: DockviewApi, referencePanelId: string) => {
        addPickerPanel(api, referencePanelId, 'right');
    }, [addPickerPanel]);

    const handleSplitPanelDown = useCallback((api: DockviewApi, referencePanelId: string) => {
        addPickerPanel(api, referencePanelId, 'below');
    }, [addPickerPanel]);

    const handleAddEmptyTab = useCallback((api: DockviewApi, referencePanelId: string) => {
        addPickerPanel(api, referencePanelId, 'within');
    }, [addPickerPanel]);

    const handleClosePanel = useCallback((api: DockviewApi, panel: IDockviewPanel) => {
        if (api.totalPanels <= 1) {
            if (isPickerPanel(panel.id)) {
                return;
            }

            addPickerPanel(api, panel.id, 'within');
        }

        panel.api.close();
    }, [addPickerPanel]);

    useEffect(() => {
        splitRightRef.current = handleSplitPanelRight;
        splitDownRef.current = handleSplitPanelDown;
        addTabRef.current = handleAddEmptyTab;
        closePanelRef.current = handleClosePanel;
    }, [handleAddEmptyTab, handleClosePanel, handleSplitPanelDown, handleSplitPanelRight]);

    const renderRightHeaderActions = useCallback((props: IDockviewHeaderActionsProps) => (
        <LayoutHeaderActions
            {...props}
            onSplitRight={(api, referencePanelId) => splitRightRef.current(api, referencePanelId)}
            onSplitDown={(api, referencePanelId) => splitDownRef.current(api, referencePanelId)}
            onAddTab={(api, referencePanelId) => addTabRef.current(api, referencePanelId)}
            onClosePanel={(api, panel) => closePanelRef.current(api, panel)}
        />
    ), []);

    useEffect(() => () => {
        if (layoutSaveTimerRef.current !== null) {
            clearTimeout(layoutSaveTimerRef.current);
        }
        if (emptyPaneRestoreTimerRef.current !== null) {
            clearTimeout(emptyPaneRestoreTimerRef.current);
        }
        disposeListeners();
        apiRef.current = null;
    }, [disposeListeners]);

    useEffect(() => {
        const api = apiRef.current;
        if (!api) {
            return;
        }

        syncPanels(api);
        syncToolbarSize(api);
    });

    const handleReady = useCallback(({ api }: DockviewReadyEvent) => {
        disposeListeners();
        apiRef.current = api;

        listenersRef.current = [
            api.onDidAddPanel((panel) => {
                const baseId = getPanelBaseId(panel.id);
                if (!baseId) {
                    return;
                }
                setVisibility((prev) => ({ ...prev, [baseId]: true }));
                onPanelAdded?.(baseId, panel.id);
            }),
            api.onDidRemovePanel((panel) => {
                const baseId = getPanelBaseId(panel.id);
                if (baseId) {
                    onPanelRemoved?.(baseId, panel.id);
                    const hasRemainingPanels = getPanelsByBaseId(api, baseId).length > 0;
                    setVisibility((prev) => ({ ...prev, [baseId]: hasRemainingPanels }));
                }

                if (api.totalPanels === 0 && emptyPaneRestoreTimerRef.current === null) {
                    emptyPaneRestoreTimerRef.current = window.setTimeout(() => {
                        emptyPaneRestoreTimerRef.current = null;
                        if (api.totalPanels === 0) {
                            addRootPickerPanel(api, handleSelectPanelFromPicker).api.setActive();
                        }
                    }, 0);
                }
            }),
            api.onDidActivePanelChange((panel) => {
                if (!panel) return;
                const baseId = getPanelBaseId(panel.id);
                if (!baseId) return;
                onPanelActivated?.(baseId, panel.id);
            }),
            api.onDidLayoutChange(() => {
                queueSaveLayout(api);
            }),
        ];

        const savedLayout = loadItem<SerializedLayout>(LAYOUT_STORAGE_KEY);
        const useSavedLayout = Boolean(savedLayout?.grid && savedLayout?.panels && shouldUseSavedLayout(savedLayout));

        if (savedLayout?.grid && savedLayout?.panels && useSavedLayout) {
            try {
                api.fromJSON(savedLayout, { reuseExistingPanels: false });
            } catch {
                syncPanels(api);
            }
        } else {
            syncPanels(api);
        }

        rebindPickerPanels(api);
        syncPanels(api);
        if (!useSavedLayout) {
            api.getPanel('files')?.api.setActive();
            api.getPanel('editor')?.api.setActive();
        }
        syncToolbarSize(api);
        queueSaveLayout(api);
    }, [
        disposeListeners,
        onPanelAdded,
        onPanelRemoved,
        onPanelActivated,
        handleSelectPanelFromPicker,
        queueSaveLayout,
        rebindPickerPanels,
        syncPanels,
        syncToolbarSize,
    ]);

    return (
        <div className="layout dockview-theme-dark">
            <div className="layout-main">
                <DockviewReact
                    components={{ layoutPanel: LayoutPanel, panelPicker: PanelPicker }}
                    className="layout-root"
                    onReady={handleReady}
                    rightHeaderActionsComponent={renderRightHeaderActions}
                />
            </div>
            <div className="layout-toolbar">
                {renderPanelRef.current('toolbar', 'toolbar')}
            </div>
        </div>
    );
};

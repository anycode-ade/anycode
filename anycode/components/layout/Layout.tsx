import React, { useCallback, useEffect, useMemo, useRef } from 'react';
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
import { loadItem, saveItem } from '../../storage';
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

type Panels = Record<PanelId, React.ReactNode>;
type PanelVisibility = Record<PanelId, boolean>;

type LayoutProps = {
    panels: Panels;
    visibility: PanelVisibility;
    toolbarHeaderVisible: boolean;
    onPanelVisibilityChange?: (id: PanelId, visible: boolean) => void;
    panelContentOverrides?: Partial<Record<PanelId, (panelKey: string) => React.ReactNode>>;
    onPanelAdded?: (id: PanelId, panelKey: string) => void;
    onPanelRemoved?: (id: PanelId, panelKey: string) => void;
    onPanelActivated?: (id: PanelId, panelKey: string) => void;
};

type SerializedLayout = ReturnType<DockviewApi['toJSON']>;

const PANEL_INSTANCE_SEPARATOR = '__';

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

const getPanelsByBaseId = (api: DockviewApi, panelId: PanelId): IDockviewPanel[] => (
    api.panels.filter((panel) => getPanelBaseId(panel.id) === panelId)
);

const panelDefinitions = [
    {
        id: 'toolbar',
        title: 'Anycode',
        pickerVisible: true,
        disableClose: true,
    },
    {
        id: 'files',
        title: 'Files',
        pickerVisible: true,
        defaultPlacements: [
            { direction: 'above', referenceIds: ['toolbar'] },
        ],
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

const panelSyncOrder: PanelId[] = panelDefinitions.map((definition) => definition.id);
const LAYOUT_STORAGE_KEY = 'layout';

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
                        onClick={() => params.onSelectPanel(panelId, params.pickerPanelId)}
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
}> = ({ containerApi, activePanel, onSplitRight, onSplitDown, onAddTab }) => {
    if (!activePanel) {
        return null;
    }

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

            {activePanel.id !== 'toolbar' ? (
                <button
                    className="layout-header-action-btn layout-header-action-btn--close"
                    onClick={() => activePanel.api.close()}
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
            const referencePanel = api.getPanel(referenceId);
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

export const Layout: React.FC<LayoutProps> = ({
    panels,
    visibility,
    toolbarHeaderVisible,
    onPanelVisibilityChange,
    panelContentOverrides,
    onPanelAdded,
    onPanelRemoved,
    onPanelActivated,
}) => {
    const apiRef = useRef<DockviewApi | null>(null);
    const listenersRef = useRef<Array<{ dispose: () => void }>>([]);
    const layoutSaveTimerRef = useRef<number | null>(null);

    const panelEntries = useMemo(() => (
        panelSyncOrder.map((id) => ({
            id,
            content: panels[id],
            visible: visibility[id],
        }))
    ), [panels, visibility]);

    const resolvePanelContent = useCallback((panelId: PanelId, panelKey: string): React.ReactNode => {
        const override = panelContentOverrides?.[panelId];
        return override ? override(panelKey) : panels[panelId];
    }, [panelContentOverrides, panels]);

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

            addPanel(api, panel.id, panel.id, panel.content);
        }
    }, [panelEntries, resolvePanelContent]);

    const syncToolbarSize = useCallback((api: DockviewApi) => {
        const toolbarPanel = api.getPanel('toolbar');
        if (!toolbarPanel) {
            return;
        }

        toolbarPanel.api.setSize({
            height: toolbarHeaderVisible ? 78 : 44,
        });
    }, [toolbarHeaderVisible]);

    const handleSelectPanelFromPicker = useCallback((panelId: PanelId, pickerPanelId: string) => {
        const api = apiRef.current;
        if (!api) {
            return;
        }

        const pickerPanel = api.getPanel(pickerPanelId);
        if (!pickerPanel) {
            return;
        }

        if (panelId !== 'toolbar') {
            onPanelVisibilityChange?.(panelId, true);
        }

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
    }, [onPanelVisibilityChange, resolvePanelContent]);

    const addPickerPanel = useCallback((
        api: DockviewApi,
        referencePanelId: string,
        direction: 'right' | 'below' | 'within',
    ) => {
        const referencePanel = api.getPanel(referencePanelId);
        if (!referencePanel) {
            return;
        }

        const pickerPanelId = `empty-pane-${Date.now()}`;
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

    const handleSplitPanelRight = useCallback((api: DockviewApi, referencePanelId: string) => {
        addPickerPanel(api, referencePanelId, 'right');
    }, [addPickerPanel]);

    const handleSplitPanelDown = useCallback((api: DockviewApi, referencePanelId: string) => {
        addPickerPanel(api, referencePanelId, 'below');
    }, [addPickerPanel]);

    const handleAddEmptyTab = useCallback((api: DockviewApi, referencePanelId: string) => {
        addPickerPanel(api, referencePanelId, 'within');
    }, [addPickerPanel]);

    useEffect(() => () => {
        if (layoutSaveTimerRef.current !== null) {
            clearTimeout(layoutSaveTimerRef.current);
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
    }, [syncPanels, syncToolbarSize]);

    const handleReady = useCallback(({ api }: DockviewReadyEvent) => {
        disposeListeners();
        apiRef.current = api;

        listenersRef.current = [
            api.onDidAddPanel((panel) => {
                const baseId = getPanelBaseId(panel.id);
                if (!baseId) {
                    return;
                }
                onPanelVisibilityChange?.(baseId, true);
                onPanelAdded?.(baseId, panel.id);
            }),
            api.onDidRemovePanel((panel) => {
                const baseId = getPanelBaseId(panel.id);
                if (!baseId) {
                    return;
                }
                onPanelRemoved?.(baseId, panel.id);
                const hasRemainingPanels = getPanelsByBaseId(api, baseId).length > 0;
                onPanelVisibilityChange?.(baseId, hasRemainingPanels);
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
        if (savedLayout?.grid && savedLayout?.panels) {
            try {
                api.fromJSON(savedLayout, { reuseExistingPanels: false });
            } catch {
                syncPanels(api);
            }
        } else {
            syncPanels(api);
        }

        syncPanels(api);
        syncToolbarSize(api);
        queueSaveLayout(api);
    }, [
        disposeListeners,
        onPanelVisibilityChange,
        onPanelAdded,
        onPanelRemoved,
        onPanelActivated,
        queueSaveLayout,
        syncPanels,
        syncToolbarSize,
    ]);

    return (
        <div className="layout dockview-theme-dark">
            <DockviewReact
                components={{ layoutPanel: LayoutPanel, panelPicker: PanelPicker }}
                className="layout-root"
                onReady={handleReady}
                rightHeaderActionsComponent={(props) => (
                    <LayoutHeaderActions
                        {...props}
                        onSplitRight={handleSplitPanelRight}
                        onSplitDown={handleSplitPanelDown}
                        onAddTab={handleAddEmptyTab}
                    />
                )}
            />
        </div>
    );
};

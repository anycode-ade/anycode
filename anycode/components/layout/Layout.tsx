import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import {
    CURRENT_LAYOUT_VERSION,
    LAYOUT_VERSION_STORAGE_KEY,
    createLayoutState,
    getDockviewLayout,
    hasLayoutPanels,
    isLayoutState,
    loadLayoutState,
    storeLayoutState,
    type DockviewLayout,
    type LayoutPanelId,
} from './layoutState';
import {
    DEFAULT_DIFF_VIEW_MODE,
    getNextDiffMode,
    type DiffViewMode,
} from '../../types/diffMode';
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

export type PanelId = 'files' | 'search' | 'changes' | 'editor' | 'agent' | 'terminal' | 'browser' | 'toolbar';

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
type PanelViewStateHandlers = {
    captureViewState: () => unknown;
    restoreViewState: (state: unknown) => void;
};

type ScrollSnapshot = {
    path: number[];
    scrollLeft: number;
    scrollTop: number;
};

type LayoutViewStateRegistry = {
    registerPanelViewState: (panelKey: string, handlers: PanelViewStateHandlers) => () => void;
};

type LayoutProps = {
    renderPanel: (panelId: PanelId, panelKey: string) => React.ReactNode;
    onPanelAdded?: (id: PanelId, panelKey: string) => void;
    onPanelRemoved?: (id: PanelId, panelKey: string) => void;
    onPanelActivated?: (id: PanelId, panelKey: string) => void;
    onCycleEditorDiffMode?: (panelKey: string) => void;
    isEditorDiffEnabled?: (panelKey: string) => boolean;
    getEditorDiffViewMode?: (panelKey: string) => DiffViewMode;
    onActionsReady?: (actions: LayoutActions | null) => void;
};

export type LayoutActions = {
    ensureEditorPanel: (preferredPanelId?: string | null) => string | null;
    ensurePanel: (panelId: PanelId) => string | null;
};

const LayoutViewStateContext = React.createContext<LayoutViewStateRegistry | null>(null);

export const useLayoutPanelViewState = (
    panelKey: string,
    handlers: PanelViewStateHandlers,
) => {
    const registry = useContext(LayoutViewStateContext);
    const handlersRef = useRef(handlers);

    useLayoutEffect(() => {
        handlersRef.current = handlers;
    }, [handlers]);

    useLayoutEffect(() => {
        if (!registry) {
            return undefined;
        }

        return registry.registerPanelViewState(panelKey, {
            captureViewState: () => handlersRef.current.captureViewState(),
            restoreViewState: (state) => handlersRef.current.restoreViewState(state),
        });
    }, [panelKey, registry]);
};

const getElementPath = (root: HTMLElement, element: HTMLElement): number[] => {
    const path: number[] = [];
    let current: HTMLElement | null = element;

    while (current && current !== root) {
        const parent: HTMLElement | null = current.parentElement;
        if (!parent) {
            break;
        }

        path.unshift(Array.prototype.indexOf.call(parent.children, current));
        current = parent;
    }

    return path;
};

const getElementByPath = (root: HTMLElement, path: number[]): HTMLElement | null => {
    let current: Element = root;

    for (const index of path) {
        const next = current.children[index];
        if (!(next instanceof HTMLElement)) {
            return null;
        }
        current = next;
    }

    return current instanceof HTMLElement ? current : null;
};

const getPanelScrollSnapshots = (panelRoot: HTMLElement): ScrollSnapshot[] => {
    const elements = [panelRoot, ...Array.from(panelRoot.querySelectorAll<HTMLElement>('*'))];

    return elements
        .map((element) => ({
            path: getElementPath(panelRoot, element),
            scrollLeft: element.scrollLeft,
            scrollTop: element.scrollTop,
        }))
        .filter((snapshot) => snapshot.scrollTop > 0 || snapshot.scrollLeft > 0);
};

const restorePanelScrollSnapshots = (panelRoot: HTMLElement, snapshots: ScrollSnapshot[]) => {
    snapshots.forEach((snapshot) => {
        const element = getElementByPath(panelRoot, snapshot.path);
        if (!element) {
            return;
        }

        if (snapshot.scrollTop > 0) {
            element.scrollTop = snapshot.scrollTop;
        }
        if (snapshot.scrollLeft > 0) {
            element.scrollLeft = snapshot.scrollLeft;
        }
    });
};

const PANEL_INSTANCE_SEPARATOR = '__';
const EMPTY_PANE_PREFIX = 'empty-pane-';
const PANEL_CONSTRAINTS = {
    minimumWidth: 0,
    minimumHeight: 0,
};

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

const getLayoutPanelId = (panelKey: string): LayoutPanelId | null => (
    isPickerPanel(panelKey) ? 'picker' : getPanelBaseId(panelKey)
);

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
    {
        id: 'browser',
        title: 'Browser',
        pickerVisible: true,
        allowMultiple: true,
        defaultPlacements: [
            { direction: 'right', referenceIds: ['editor', 'terminal'] },
        ],
    },
] as const satisfies readonly PanelDefinition[];

const panelDefinitionById = Object.fromEntries(
    panelDefinitions.map((definition) => [definition.id, definition]),
) as Record<PanelId, PanelDefinition>;

const panelTitles: Record<PanelId, string> = Object.fromEntries(
    panelDefinitions.map((definition) => [definition.id, definition.title]),
) as Record<PanelId, string>;

const getLayoutPanelTitle = (panelId: LayoutPanelId): string => (
    panelId === 'picker' ? 'Empty' : panelTitles[panelId]
);

const panelSyncOrder: PanelId[] = ['files', 'editor', 'agent', 'search', 'changes', 'terminal', 'browser'];
const loadPanelVisibility = (): PanelVisibility => ({
    files: (loadItem<number>(LAYOUT_VERSION_STORAGE_KEY) ?? 0) < CURRENT_LAYOUT_VERSION ? true : loadFilesPanelVisible(),
    search: (loadItem<number>(LAYOUT_VERSION_STORAGE_KEY) ?? 0) < CURRENT_LAYOUT_VERSION ? true : (loadItem<boolean>('searchPanelVisible') ?? false),
    changes: (loadItem<number>(LAYOUT_VERSION_STORAGE_KEY) ?? 0) < CURRENT_LAYOUT_VERSION ? true : (loadItem<boolean>('changesPanelVisible') ?? false),
    editor: (loadItem<number>(LAYOUT_VERSION_STORAGE_KEY) ?? 0) < CURRENT_LAYOUT_VERSION ? true : loadEditorPanelVisible(),
    agent: (loadItem<number>(LAYOUT_VERSION_STORAGE_KEY) ?? 0) < CURRENT_LAYOUT_VERSION ? true : loadAgentPanelVisible(),
    terminal: loadTerminalPanelVisible(),
    browser: (loadItem<boolean>('browserPanelVisible') ?? false),
    toolbar: true,
});

const hasSavedPanel = (layout: DockviewLayout, panelId: PanelId): boolean => (
    Object.keys(layout.panels).some((panelKey) => getPanelBaseId(panelKey) === panelId)
);

const shouldUseSavedLayout = (layoutState: ReturnType<typeof loadLayoutState>): boolean => {
    if (!layoutState) {
        return false;
    }

    const savedLayoutVersion = loadItem<number>(LAYOUT_VERSION_STORAGE_KEY) ?? 0;
    if (isLayoutState(layoutState) && layoutState.version !== CURRENT_LAYOUT_VERSION) {
        return false;
    }

    if (isLayoutState(layoutState) && !hasLayoutPanels(layoutState.root)) {
        return false;
    }

    if (!isLayoutState(layoutState) && savedLayoutVersion < 4) {
        return false;
    }

    const layout = getDockviewLayout(layoutState, getLayoutPanelTitle);
    if (hasSavedPanel(layout, 'toolbar')) {
        return false;
    }

    return Object.keys(layout.panels).some((panelKey) => {
        const layoutPanelId = getLayoutPanelId(panelKey);
        return layoutPanelId !== null && layoutPanelId !== 'toolbar';
    });
};

const getSplitPanelSizes = (
    referencePanel: IDockviewPanel,
    direction: 'right' | 'below' | 'within',
): { width?: number; height?: number } => {
    if (direction === 'right') {
        const width = referencePanel.group.api.width;
        return width > 1 ? { width: width / 2 } : {};
    }

    if (direction === 'below') {
        const height = referencePanel.group.api.height;
        return height > 1 ? { height: height / 2 } : {};
    }

    return {};
};

const LayoutPanel: React.FC<IDockviewPanelProps<PanelParams>> = ({ params }) => {
    const rootRef = useRef<HTMLDivElement | null>(null);

    const captureViewState = useCallback((): ScrollSnapshot[] => {
        const root = rootRef.current;
        return root ? getPanelScrollSnapshots(root) : [];
    }, []);

    const restoreViewState = useCallback((state: unknown) => {
        const root = rootRef.current;
        if (!root || !Array.isArray(state)) {
            return;
        }

        restorePanelScrollSnapshots(root, state as ScrollSnapshot[]);
    }, []);

    useLayoutPanelViewState(params.panelKey, {
        captureViewState,
        restoreViewState,
    });

    return (
        <div ref={rootRef} className={`layout-dock-panel layout-dock-panel--${params.panelId}`}>
            {params.content}
        </div>
    );
};

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
    onCycleEditorDiffMode?: (panelKey: string) => void;
    isEditorDiffEnabled?: (panelKey: string) => boolean;
    getEditorDiffViewMode?: (panelKey: string) => DiffViewMode;
}> = ({
    containerApi,
    activePanel,
    onSplitRight,
    onSplitDown,
    onAddTab,
    onClosePanel,
    onCycleEditorDiffMode,
    isEditorDiffEnabled,
    getEditorDiffViewMode,
}) => {
    if (!activePanel) {
        return null;
    }

    const activePanelBaseId = getPanelBaseId(activePanel.id);
    const isEditorPanel = activePanelBaseId === 'editor';
    const fallbackMode = isEditorDiffEnabled?.(activePanel.id) ? 'combine' : DEFAULT_DIFF_VIEW_MODE;
    const diffMode = getEditorDiffViewMode?.(activePanel.id) ?? fallbackMode;
    const nextDiffMode = getNextDiffMode(diffMode);
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

            {isEditorPanel ? (
                <button
                    className={`layout-header-action-btn layout-header-action-btn--diff ${diffMode !== 'plain' ? 'layout-header-action-btn--active' : ''}`}
                    onClick={() => onCycleEditorDiffMode?.(activePanel.id)}
                    type="button"
                    title={`current mode - ${diffMode}\nnext mode - ${nextDiffMode}`}
                    aria-label={`Diff mode ${diffMode}. Next ${nextDiffMode}`}
                >
                    {diffMode === 'plain' ? 'P' : diffMode === 'diff' ? 'D' : 'C'}
                </button>
            ) : null}

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

    const panel = api.addPanel({
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
    panel.group.api.setConstraints(PANEL_CONSTRAINTS);
    return panel;
};

const addRootPickerPanel = (
    api: DockviewApi,
    onSelectPanel: (panelId: PanelId, pickerPanelId: string) => void,
): IDockviewPanel => {
    const pickerPanelId = createPickerPanelId();
    const panel = api.addPanel<PanelPickerParams>({
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
    panel.group.api.setConstraints(PANEL_CONSTRAINTS);
    return panel;
};

export const Layout: React.FC<LayoutProps> = ({
    renderPanel,
    onPanelAdded,
    onPanelRemoved,
    onPanelActivated,
    onCycleEditorDiffMode,
    isEditorDiffEnabled,
    getEditorDiffViewMode,
    onActionsReady,
}) => {
    const apiRef = useRef<DockviewApi | null>(null);
    const [visibility, setVisibility] = useState<PanelVisibility>(loadPanelVisibility);
    const listenersRef = useRef<Array<{ dispose: () => void }>>([]);
    const layoutSaveTimerRef = useRef<number | null>(null);
    const emptyPaneRestoreTimerRef = useRef<number | null>(null);
    const isRestoringLayoutRef = useRef<boolean>(false);
    const panelViewStateHandlersRef = useRef(new Map<string, PanelViewStateHandlers>());
    const panelViewStatesRef = useRef<Record<string, unknown>>({});
    const restoreViewStatesFrameRef = useRef<number | null>(null);
    const splitRightRef = useRef<(api: DockviewApi, referencePanelId: string) => void>(() => {});
    const splitDownRef = useRef<(api: DockviewApi, referencePanelId: string) => void>(() => {});
    const addTabRef = useRef<(api: DockviewApi, referencePanelId: string) => void>(() => {});
    const closePanelRef = useRef<(api: DockviewApi, panel: IDockviewPanel) => void>(() => {});
    const renderPanelRef = useRef<LayoutProps['renderPanel']>(renderPanel);
    const onCycleEditorDiffModeRef = useRef<LayoutProps['onCycleEditorDiffMode']>(onCycleEditorDiffMode);
    const isEditorDiffEnabledRef = useRef<LayoutProps['isEditorDiffEnabled']>(isEditorDiffEnabled);
    const getEditorDiffViewModeRef = useRef<LayoutProps['getEditorDiffViewMode']>(getEditorDiffViewMode);

    renderPanelRef.current = renderPanel;
    onCycleEditorDiffModeRef.current = onCycleEditorDiffMode;
    isEditorDiffEnabledRef.current = isEditorDiffEnabled;
    getEditorDiffViewModeRef.current = getEditorDiffViewMode;

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
        saveItem('browserPanelVisible', visibility.browser);
    }, [visibility]);

    const resolvePanelContent = useCallback((panelId: PanelId, panelKey: string): React.ReactNode => (
        renderPanelRef.current(panelId, panelKey)
    ), []);

    const ensureEditorPanel = useCallback((preferredPanelId?: string | null): string | null => {
        const api = apiRef.current;
        if (!api) {
            return null;
        }

        const preferredPanel = preferredPanelId ? api.getPanel(preferredPanelId) : undefined;
        const activePanel = api.activePanel;
        const activeEditorPanel = activePanel && getPanelBaseId(activePanel.id) === 'editor'
            ? activePanel
            : null;
        const existingPanel = preferredPanel ?? activeEditorPanel ?? getPanelsByBaseId(api, 'editor')[0];
        if (existingPanel) {
            existingPanel.api.setActive();
            return existingPanel.id;
        }

        const panelKey = createPanelKey('editor');
        const filesPanel = api.getPanel('files');
        const editorPanel = api.addPanel({
            id: panelKey,
            component: 'layoutPanel',
            title: panelTitles.editor,
            params: {
                panelId: 'editor',
                panelKey,
                content: resolvePanelContent('editor', panelKey),
            },
            minimumWidth: 0,
            minimumHeight: 0,
            position: filesPanel
                ? {
                    referencePanel: filesPanel,
                    direction: 'right',
                }
                : getDefaultPanelPosition(api, 'editor'),
        });

        setVisibility((prev) => ({ ...prev, editor: true }));
        editorPanel.group.api.setConstraints(PANEL_CONSTRAINTS);
        editorPanel.api.setActive();
        return editorPanel.id;
    }, [resolvePanelContent]);

    const ensurePanel = useCallback((panelId: PanelId): string | null => {
        const api = apiRef.current;
        if (!api) {
            return null;
        }

        const definition = panelDefinitionById[panelId];
        if (definition.allowMultiple) {
            const existing = getPanelsByBaseId(api, panelId)[0];
            if (existing) {
                existing.api.setActive();
                return existing.id;
            }

            const panelKey = createPanelKey(panelId);
            const panel = addPanel(api, panelKey, panelId, resolvePanelContent(panelId, panelKey));
            panel.api.setActive();
            setVisibility((prev) => ({ ...prev, [panelId]: true }));
            return panel.id;
        }

        const existing = api.getPanel(panelId);
        if (existing) {
            existing.api.setActive();
            setVisibility((prev) => ({ ...prev, [panelId]: true }));
            return existing.id;
        }

        const panel = addPanel(api, panelId, panelId, resolvePanelContent(panelId, panelId));
        panel.api.setActive();
        setVisibility((prev) => ({ ...prev, [panelId]: true }));
        return panel.id;
    }, [resolvePanelContent]);

    useEffect(() => {
        onActionsReady?.({
            ensureEditorPanel,
            ensurePanel,
        });

        return () => {
            onActionsReady?.(null);
        };
    }, [ensureEditorPanel, ensurePanel, onActionsReady]);

    const disposeListeners = useCallback(() => {
        for (const listener of listenersRef.current) {
            listener.dispose();
        }
        listenersRef.current = [];
    }, []);

    const registerPanelViewState = useCallback((panelKey: string, handlers: PanelViewStateHandlers) => {
        panelViewStateHandlersRef.current.set(panelKey, handlers);

        return () => {
            if (panelViewStateHandlersRef.current.get(panelKey) === handlers) {
                panelViewStateHandlersRef.current.delete(panelKey);
            }
        };
    }, []);

    const viewStateRegistry = useMemo<LayoutViewStateRegistry>(() => ({
        registerPanelViewState,
    }), [registerPanelViewState]);

    const capturePanelViewStates = useCallback(() => {
        const nextStates: Record<string, unknown> = {};

        panelViewStateHandlersRef.current.forEach((handlers, panelKey) => {
            nextStates[panelKey] = handlers.captureViewState();
        });

        panelViewStatesRef.current = {
            ...panelViewStatesRef.current,
            ...nextStates,
        };
    }, []);

    const applyPanelViewStates = useCallback(() => {
        Object.entries(panelViewStatesRef.current).forEach(([panelKey, state]) => {
            panelViewStateHandlersRef.current.get(panelKey)?.restoreViewState(state);
        });
    }, []);

    const restorePanelViewStates = useCallback(() => {
        if (restoreViewStatesFrameRef.current !== null) {
            cancelAnimationFrame(restoreViewStatesFrameRef.current);
        }

        // Apply immediately to avoid a visible one-frame jump to scrollTop=0.
        applyPanelViewStates();

        // Run one follow-up pass in the next frame for content that mounts asynchronously.
        restoreViewStatesFrameRef.current = requestAnimationFrame(() => {
            restoreViewStatesFrameRef.current = null;
            applyPanelViewStates();
        });
    }, [applyPanelViewStates]);

    const queueSaveLayout = useCallback((api: DockviewApi) => {
        if (layoutSaveTimerRef.current !== null) {
            clearTimeout(layoutSaveTimerRef.current);
        }
        restorePanelViewStates();
        layoutSaveTimerRef.current = window.setTimeout(() => {
            layoutSaveTimerRef.current = null;
            const raw = api.toJSON();
            const sanitized = {
                ...raw,
                panels: Object.fromEntries(
                    Object.entries(raw.panels).map(([id, state]) => [id, { ...state, params: {} }]),
                ),
            };
            storeLayoutState(createLayoutState(sanitized, getLayoutPanelId));
        }, 120);
    }, [restorePanelViewStates]);

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

    const refreshPanelContents = useCallback((api: DockviewApi) => {
        for (const panel of api.panels) {
            const panelId = getPanelBaseId(panel.id);
            if (!panelId) {
                continue;
            }

            panel.group.api.setConstraints(PANEL_CONSTRAINTS);
            panel.api.updateParameters({
                panelId,
                panelKey: panel.id,
                content: resolvePanelContent(panelId, panel.id),
            });
        }
    }, [resolvePanelContent]);

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
        const existingPanel = definition.allowMultiple ? undefined : api.getPanel(panelId);
        const targetPanel = existingPanel ?? api.addPanel({
            id: targetPanelKey,
            component: 'layoutPanel',
            title: definition.title,
            params: {
                panelId,
                panelKey: targetPanelKey,
                content: resolvePanelContent(panelId, targetPanelKey),
            },
            minimumWidth: 0,
            minimumHeight: 0,
            position: {
                referenceGroup: pickerPanel.group,
                direction: 'within',
            },
            //@ts-ignore
            disableClose: definition.disableClose,
        });
        targetPanel.group.api.setConstraints(PANEL_CONSTRAINTS);

        if (existingPanel) {
            targetPanel.api.moveTo({
                group: pickerPanel.group,
                position: 'center',
            });
        }
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
        capturePanelViewStates();

        const splitSize = getSplitPanelSizes(referencePanel, direction);
        const pickerPanelId = createPickerPanelId();
        const pickerPanel = api.addPanel<PanelPickerParams>({
            id: pickerPanelId,
            component: 'panelPicker',
            title: 'Empty',
            position: {
                referencePanel,
                direction,
            },
            minimumWidth: 0,
            minimumHeight: 0,
            initialWidth: splitSize.width,
            initialHeight: splitSize.height,
            params: {
                pickerPanelId,
                onSelectPanel: handleSelectPanelFromPicker,
            },
        });
        pickerPanel.group.api.setConstraints(PANEL_CONSTRAINTS);
  
        if (splitSize.width !== undefined || splitSize.height !== undefined) {
            window.requestAnimationFrame(() => {
                referencePanel.group.api.setSize(splitSize);
                pickerPanel.group.api.setSize(splitSize);
            });
        }
        restorePanelViewStates();
    }, [capturePanelViewStates, handleSelectPanelFromPicker, restorePanelViewStates]);

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
            onCycleEditorDiffMode={(panelKey) => onCycleEditorDiffModeRef.current?.(panelKey)}
            isEditorDiffEnabled={(panelKey) => isEditorDiffEnabledRef.current?.(panelKey) ?? false}
            getEditorDiffViewMode={(panelKey) => getEditorDiffViewModeRef.current?.(panelKey) ?? DEFAULT_DIFF_VIEW_MODE}
        />
    ), []);

    useEffect(() => () => {
        if (layoutSaveTimerRef.current !== null) {
            clearTimeout(layoutSaveTimerRef.current);
        }
        if (emptyPaneRestoreTimerRef.current !== null) {
            clearTimeout(emptyPaneRestoreTimerRef.current);
        }
        if (restoreViewStatesFrameRef.current !== null) {
            cancelAnimationFrame(restoreViewStatesFrameRef.current);
        }
        disposeListeners();
        apiRef.current = null;
    }, [disposeListeners]);

    useLayoutEffect(() => {
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
                    if (!isRestoringLayoutRef.current) {
                        onPanelRemoved?.(baseId, panel.id);
                    }
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
                if (isRestoringLayoutRef.current) {
                    return;
                }
                queueSaveLayout(api);
            }),
            api.onWillDragPanel(() => {
                capturePanelViewStates();
            }),
            api.onWillDrop(() => {
                capturePanelViewStates();
            }),
            api.onDidMovePanel(() => {
                restorePanelViewStates();
            }),
        ];

        const savedLayoutState = loadLayoutState();
        const savedLayout = savedLayoutState
            ? getDockviewLayout(savedLayoutState, getLayoutPanelTitle)
            : null;
        const useSavedLayout = Boolean(savedLayout?.grid && savedLayout?.panels && shouldUseSavedLayout(savedLayoutState));
        let restoredSavedLayout = false;

        isRestoringLayoutRef.current = true;
        try {
            if (savedLayout?.grid && savedLayout?.panels && useSavedLayout) {
                try {
                    api.fromJSON(savedLayout, { reuseExistingPanels: false });
                    restoredSavedLayout = true;
                } catch {
                    syncPanels(api);
                }
            } else {
                syncPanels(api);
            }

            rebindPickerPanels(api);
            if (restoredSavedLayout) {
                refreshPanelContents(api);
            } else {
                syncPanels(api);
            }
        } finally {
            isRestoringLayoutRef.current = false;
        }

        if (!restoredSavedLayout) {
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
        capturePanelViewStates,
        restorePanelViewStates,
        refreshPanelContents,
        rebindPickerPanels,
        syncPanels,
        syncToolbarSize,
    ]);

    return (
        <div className="layout dockview-theme-dark">
            <div className="layout-main">
                <LayoutViewStateContext.Provider value={viewStateRegistry}>
                    <DockviewReact
                        components={{ layoutPanel: LayoutPanel, panelPicker: PanelPicker }}
                        className="layout-root"
                        onReady={handleReady}
                        rightHeaderActionsComponent={renderRightHeaderActions}
                    />
                </LayoutViewStateContext.Provider>
            </div>
            <div className="layout-toolbar">
                {renderPanelRef.current('toolbar', 'toolbar')}
            </div>
        </div>
    );
};

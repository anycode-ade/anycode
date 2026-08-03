import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
    DockviewApi,
    Orientation,
    SplitviewApi,
    type DockviewReadyEvent,
    type IDockviewPanel,
    DockviewPanelApi,
} from 'dockview';
import {
    DockviewReact,
    SplitviewReact,
    type IDockviewHeaderActionsProps,
    type IDockviewPanelProps,
    type ISplitviewPanelProps,
} from 'dockview-react';
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
    type DiffMode,
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
type DockviewGridNode = DockviewLayout['grid']['root'];
type DockviewLeafNode = {
    type: 'leaf';
    data: {
        id: string;
        views: string[];
        activeView?: string;
    };
};
type DockviewBranchNode = {
    type: 'branch';
    data: DockviewGridNode[];
};

type LayoutSiblingNode = {
    groupIds: string[];
};

type LayoutSiblingInfo = {
    direction: 'horizontal' | 'vertical';
    siblings: LayoutSiblingNode[];
    targetIndex: number;
};

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

const getNextLayoutDirection = (direction: 'horizontal' | 'vertical'): 'horizontal' | 'vertical' => (
    direction === 'horizontal' ? 'vertical' : 'horizontal'
);

const getLayoutDirection = (orientation: Orientation): 'horizontal' | 'vertical' => (
    orientation === Orientation.HORIZONTAL ? 'horizontal' : 'vertical'
);

const isDockviewLeafNode = (node: DockviewGridNode): node is DockviewLeafNode => (
    node.type === 'leaf'
);

const getLeafGroupIds = (node: DockviewGridNode): string[] => {
    if (isDockviewLeafNode(node)) {
        return [node.data.id];
    }

    const branch = node as unknown as DockviewBranchNode;
    return branch.data.flatMap(getLeafGroupIds);
};

const findLayoutSiblings = (
    node: DockviewGridNode,
    targetGroupId: string,
    direction: 'horizontal' | 'vertical',
): LayoutSiblingInfo | null => {
    if (isDockviewLeafNode(node)) {
        return null;
    }

    const branch = node as unknown as DockviewBranchNode;
    const directTargetIndex = branch.data.findIndex((child) => (
        isDockviewLeafNode(child) && child.data.id === targetGroupId
    ));

    if (directTargetIndex !== -1) {
        return {
            direction,
            siblings: branch.data.map((child) => ({
                groupIds: getLeafGroupIds(child),
            })),
            targetIndex: directTargetIndex,
        };
    }

    const nextDirection = getNextLayoutDirection(direction);
    for (const child of branch.data) {
        const nested = findLayoutSiblings(child, targetGroupId, nextDirection);
        if (nested) {
            return nested;
        }
    }

    return null;
};

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

export type PanelId = 'files' | 'search' | 'changes' | 'editor' | 'agent' | 'terminal' | 'browser' | 'toolbar' | 'settings';

type PanelParams = {
    panelKey: string;
    panelId: PanelId;
    content?: React.ReactNode;
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
    onCycleEditorDiffMode?: (panelKey: string) => void;
    isEditorDiffEnabled?: (panelKey: string) => boolean;
    getEditorDiffMode?: (panelKey: string) => DiffMode;
    onActionsReady?: (actions: LayoutActions | null) => void;
    canResetPanel?: (panelKey: string, panelId: PanelId) => boolean;
    onResetPanel?: (panelKey: string, panelId: PanelId) => void;
};

export type LayoutActions = {
    ensureEditorPanel: (preferredPanelId?: string | null) => string | null;
    isEditorPanelVisible: (preferredPanelId?: string | null) => boolean;
    ensurePanel: (panelId: PanelId) => string | null;
};

export const LayoutVersionContext = React.createContext<number>(0);
export const LayoutPanelApiContext = React.createContext<DockviewPanelApi | null>(null);
const LayoutRenderContext = React.createContext<((panelId: PanelId, panelKey: string) => React.ReactNode) | null>(null);

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
    {
        id: 'settings',
        title: 'Settings',
        pickerVisible: true,
        defaultPlacements: [
            { direction: 'within', referenceIds: ['files', 'search', 'changes'] },
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

const panelSyncOrder: PanelId[] = ['files', 'editor', 'agent', 'search', 'changes', 'terminal', 'browser', 'settings'];
const loadPanelVisibility = (): PanelVisibility => ({
    files: (loadItem<number>(LAYOUT_VERSION_STORAGE_KEY) ?? 0) < CURRENT_LAYOUT_VERSION ? true : loadFilesPanelVisible(),
    search: (loadItem<number>(LAYOUT_VERSION_STORAGE_KEY) ?? 0) < CURRENT_LAYOUT_VERSION ? true : (loadItem<boolean>('searchPanelVisible') ?? false),
    changes: (loadItem<number>(LAYOUT_VERSION_STORAGE_KEY) ?? 0) < CURRENT_LAYOUT_VERSION ? true : (loadItem<boolean>('changesPanelVisible') ?? false),
    editor: (loadItem<number>(LAYOUT_VERSION_STORAGE_KEY) ?? 0) < CURRENT_LAYOUT_VERSION ? true : loadEditorPanelVisible(),
    agent: (loadItem<number>(LAYOUT_VERSION_STORAGE_KEY) ?? 0) < CURRENT_LAYOUT_VERSION ? true : loadAgentPanelVisible(),
    terminal: loadTerminalPanelVisible(),
    browser: (loadItem<boolean>('browserPanelVisible') ?? false),
    settings: (loadItem<boolean>('settingsPanelVisible') ?? false),
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
        return layoutPanelId !== null && layoutPanelId !== 'toolbar' && layoutPanelId !== 'picker';
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

const LayoutPanel: React.FC<IDockviewPanelProps<PanelParams>> = ({ params, api }) => {
    const renderPanel = useContext(LayoutRenderContext);

    const content = renderPanel ? renderPanel(params.panelId, params.panelKey) : params.content;

    return (
        <LayoutPanelApiContext.Provider value={api}>
            <div className={`layout-dock-panel layout-dock-panel--${params.panelId}`}>
                {content}
            </div>
        </LayoutPanelApiContext.Provider>
    );
};

const panelPickerOrder: PanelId[] = panelDefinitions
    .filter((definition) => definition.pickerVisible)
    .map((definition) => definition.id);

const pickerIconMap: Record<PanelId, React.ComponentType | undefined> = {
    files: Icons.Files,
    search: Icons.Search,
    changes: Icons.Git,
    editor: Icons.Editor,
    agent: Icons.Agent,
    terminal: Icons.Terminal,
    browser: Icons.Browser,
    settings: Icons.Settings,
    toolbar: undefined,
};

const PanelPicker: React.FC<IDockviewPanelProps<PanelPickerParams>> = ({ params }) => (
    <div className="layout-dock-panel layout-dock-panel--picker">
        <div className="layout-panel-picker">
            <div className="layout-panel-picker-header">
                <div className="layout-panel-picker-title">Empty Pane</div>
            </div>
            <div className="layout-panel-picker-list">
                {panelPickerOrder.map((panelId) => {
                    const Icon = pickerIconMap[panelId];
                    return (
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
                            {Icon && <Icon />}
                            <span>{panelTitles[panelId]}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    </div>
);

const DOCKVIEW_COMPONENTS = {
    layoutPanel: LayoutPanel,
    panelPicker: PanelPicker,
};

const LayoutHeaderActions: React.FC<IDockviewHeaderActionsProps & {
    onSplitRight: (api: DockviewApi, referencePanelId: string) => void;
    onSplitDown: (api: DockviewApi, referencePanelId: string) => void;
    onAddTab: (api: DockviewApi, referencePanelId: string) => void;
    onClosePanel: (api: DockviewApi, panel: IDockviewPanel) => void;
    onCycleEditorDiffMode?: (panelKey: string) => void;
    isEditorDiffEnabled?: (panelKey: string) => boolean;
    getEditorDiffMode?: (panelKey: string) => DiffMode;
    canResetPanel?: (panelKey: string, panelId: PanelId) => boolean;
    onResetPanel?: (panelKey: string, panelId: PanelId) => void;
}> = ({
    containerApi,
    activePanel,
    onSplitRight,
    onSplitDown,
    onAddTab,
    onClosePanel,
    onCycleEditorDiffMode,
    isEditorDiffEnabled,
    getEditorDiffMode,
    canResetPanel,
    onResetPanel,
}) => {
    if (!activePanel) {
        return null;
    }

    const activePanelBaseId = getPanelBaseId(activePanel.id);
    const isEditorPanel = activePanelBaseId === 'editor';
    const fallbackMode = isEditorDiffEnabled?.(activePanel.id) ? 'combine' : DEFAULT_DIFF_VIEW_MODE;
    const diffMode = getEditorDiffMode?.(activePanel.id) ?? fallbackMode;
    const nextDiffMode = getNextDiffMode(diffMode);
    const canClosePanel = activePanel.id !== 'toolbar' && (containerApi.totalPanels > 1 || !isPickerPanel(activePanel.id));
    const showResetButton = activePanelBaseId && (activePanelBaseId === 'terminal' || activePanelBaseId === 'agent') && canResetPanel?.(activePanel.id, activePanelBaseId);

    return (
        <div className="layout-header-actions">
            {showResetButton ? (
                <button
                    className="layout-header-action-btn layout-header-action-btn--back"
                    onClick={() => onResetPanel?.(activePanel.id, activePanelBaseId)}
                    type="button"
                    title={`Back to Empty ${activePanelBaseId === 'terminal' ? 'Terminal' : 'Agent'}`}
                    aria-label={`Back to Empty ${activePanelBaseId === 'terminal' ? 'Terminal' : 'Agent'}`}
                >
                    <Icons.ArrowLeft />
                </button>
            ) : null}

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
    content?: React.ReactNode,
): IDockviewPanel => {
    const definition = panelDefinitionById[panelId];
    const existing = api.getPanel(panelKey);
    if (existing) {
        return existing;
    }

    const panel = api.addPanel({
        id: panelKey,
        component: 'layoutPanel',
        title: definition.title,
        params: { panelId, panelKey, content },
        minimumWidth: panelId === 'agent' ? 200 : 0,
        minimumHeight: panelId === 'agent' ? 200 : 0,
        position: getDefaultPanelPosition(api, panelId),
        //@ts-ignore
        disableClose: definition.disableClose,
    });
    if (panelId === 'agent') {
        panel.group.api.setConstraints({
            minimumWidth: 200,
            minimumHeight: 200,
        });
        // @ts-ignore
        panel.group._snap = true;
    } else {
        panel.group.api.setConstraints(PANEL_CONSTRAINTS);
    }
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
    getEditorDiffMode,
    onActionsReady,
    canResetPanel,
    onResetPanel,
}) => {
    const apiRef = useRef<DockviewApi | null>(null);
    const [visibility, setVisibility] = useState<PanelVisibility>(loadPanelVisibility);
    const [layoutVersion, setLayoutVersion] = useState(0);
    const listenersRef = useRef<Array<{ dispose: () => void }>>([]);
    const parentGroupMap = useRef<Map<string, string>>(new Map(Object.entries(loadItem<Record<string, string>>('layoutParentGroups') ?? {})));
    const layoutSaveTimerRef = useRef<number | null>(null);
    const emptyPaneRestoreTimerRef = useRef<number | null>(null);
    const isRestoringLayoutRef = useRef<boolean>(false);
    const lastLayoutSnapshotRef = useRef<string | null>(null);
    const lastStructuralSnapshotRef = useRef<string | null>(null);
    const lastGroupsLayoutRef = useRef<Map<string, { width: number; height: number; panels: string[] }>>(new Map());
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

    const getLayoutSnapshot = useCallback((api: DockviewApi): string => {
        const raw = api.toJSON();
        const sanitized = {
            ...raw,
            panels: Object.fromEntries(
                Object.entries(raw.panels).map(([id, state]) => [id, { ...state, params: {} }]),
            ),
        };
        delete sanitized.activeGroup;

        return JSON.stringify(sanitized);
    }, []);

    const getStructuralLayoutSnapshot = useCallback((api: DockviewApi): string => {
        const raw = api.toJSON();
        const sanitizeGrid = (node: any): any => {
            if (!node) return null;
            if (node.type === 'branch') {
                const children = Array.isArray(node.data) ? node.data : [];
                return {
                    type: 'branch',
                    orientation: node.orientation,
                    children: children.map(sanitizeGrid),
                };
            }
            if (node.type === 'leaf') {
                const views = node.data && Array.isArray(node.data.views) ? node.data.views : [];
                return {
                    type: 'leaf',
                    views,
                };
            }
            return null;
        };
        return JSON.stringify(sanitizeGrid(raw.grid?.root));
    }, []);

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

    const findEditorPanel = useCallback((preferredPanelId?: string | null): IDockviewPanel | null => {
        const api = apiRef.current;
        if (!api) {
            return null;
        }

        const preferredPanel = preferredPanelId ? api.getPanel(preferredPanelId) : undefined;
        const activePanel = api.activePanel;
        const activeEditorPanel = activePanel && getPanelBaseId(activePanel.id) === 'editor'
            ? activePanel
            : null;
        return preferredPanel ?? activeEditorPanel ?? getPanelsByBaseId(api, 'editor')[0] ?? null;
    }, []);

    const isEditorPanelVisible = useCallback((preferredPanelId?: string | null): boolean => (
        findEditorPanel(preferredPanelId)?.api.isVisible ?? false
    ), [findEditorPanel]);

    const ensureEditorPanel = useCallback((preferredPanelId?: string | null): string | null => {
        const api = apiRef.current;
        if (!api) {
            return null;
        }

        const existingPanel = findEditorPanel(preferredPanelId);
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
    }, [findEditorPanel, resolvePanelContent]);

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
            isEditorPanelVisible,
            ensurePanel,
        });

        return () => {
            onActionsReady?.(null);
        };
    }, [ensureEditorPanel, ensurePanel, isEditorPanelVisible, onActionsReady]);

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

            // Keep parentGroupMap clean by only keeping entries for groups that still exist
            const currentGroupIds = new Set(api.groups.map(g => g.id));
            let mapChanged = false;
            for (const key of parentGroupMap.current.keys()) {
                if (!currentGroupIds.has(key)) {
                    parentGroupMap.current.delete(key);
                    mapChanged = true;
                }
            }
            if (mapChanged) {
                saveItem('layoutParentGroups', Object.fromEntries(parentGroupMap.current.entries()));
            }

            const snapshot = getLayoutSnapshot(api);
            if (snapshot === lastLayoutSnapshotRef.current) {
                return;
            }
            lastLayoutSnapshotRef.current = snapshot;
            const parsedSnapshot = JSON.parse(snapshot) as DockviewLayout;
            storeLayoutState(createLayoutState(parsedSnapshot, getLayoutPanelId));
        }, 120);
    }, [getLayoutSnapshot]);

    const updateGroupsLayoutSnapshot = useCallback((api: DockviewApi) => {
        const snapshot = new Map<string, { width: number; height: number; panels: string[] }>();
        api.groups.forEach((group) => {
            snapshot.set(group.id, {
                width: group.api.width,
                height: group.api.height,
                panels: group.panels.map((p) => p.id),
            });
        });
        lastGroupsLayoutRef.current = snapshot;
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
        if (!toolbarPanel) return;
        toolbarPanel.api.setSize({ height: 44 });
    }, []);

    const refreshPanelContents = useCallback((api: DockviewApi) => {
        for (const panel of api.panels) {
            const panelId = getPanelBaseId(panel.id);
            if (!panelId) {
                continue;
            }

            if (panelId === 'agent') {
                panel.group.api.setConstraints({
                    minimumWidth: 200,
                    minimumHeight: 200,
                });
                // @ts-ignore
                panel.group._snap = true;
            } else {
                panel.group.api.setConstraints(PANEL_CONSTRAINTS);
            }
            panel.api.updateParameters({
                panelId,
                panelKey: panel.id,
            });
        }
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
            minimumWidth: panelId === 'agent' ? 200 : 0,
            minimumHeight: panelId === 'agent' ? 200 : 0,
            position: {
                referenceGroup: pickerPanel.group,
                direction: 'within',
            },
            //@ts-ignore
            disableClose: definition.disableClose,
        });
        if (panelId === 'agent') {
            targetPanel.group.api.setConstraints({
                minimumWidth: 200,
                minimumHeight: 200,
            });
            // @ts-ignore
            targetPanel.group._snap = true;
        } else {
            targetPanel.group.api.setConstraints(PANEL_CONSTRAINTS);
        }

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

        if (direction === 'right' || direction === 'below') {
            parentGroupMap.current.set(pickerPanel.group.id, referencePanel.group.id);
            saveItem('layoutParentGroups', Object.fromEntries(parentGroupMap.current.entries()));
        }

        if (splitSize.width !== undefined || splitSize.height !== undefined) {
            window.requestAnimationFrame(() => {
                referencePanel.group.api.setSize(splitSize);
                pickerPanel.group.api.setSize(splitSize);
            });
        }
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

        const group = panel.group;
        const shouldRestoreProportions = group && group.panels.length === 1;

        interface SiblingGroupSize {
            id: string;
            width: number;
            height: number;
        }

        let siblingSizes: SiblingGroupSize[] = [];
        let layoutSiblingInfo: LayoutSiblingInfo | null = null;
        let absorberGroupIds: string[] = [];
        let closedGroupSize = 0;

        if (shouldRestoreProportions) {
            const layout = api.toJSON();
            layoutSiblingInfo = findLayoutSiblings(
                layout.grid.root,
                group.id,
                getLayoutDirection(layout.grid.orientation),
            );

            if (layoutSiblingInfo) {
                closedGroupSize = layoutSiblingInfo.direction === 'horizontal'
                    ? group.api.width
                    : group.api.height;

                const siblingGroupIds = layoutSiblingInfo.siblings
                    .flatMap((sibling) => sibling.groupIds)
                    .filter((id) => id !== group.id);

                siblingSizes = siblingGroupIds
                    .map((id) => {
                        const siblingGroup = api.groups.find((g) => g.id === id);
                        return siblingGroup
                            ? {
                                id,
                                width: siblingGroup.api.width,
                                height: siblingGroup.api.height,
                            }
                            : null;
                    })
                    .filter((size): size is SiblingGroupSize => size !== null);
            }
        }

        const parentGroupId = group ? parentGroupMap.current.get(group.id) : undefined;

        if (layoutSiblingInfo) {
            const parentSibling = parentGroupId
                ? layoutSiblingInfo.siblings.find((sibling) => sibling.groupIds.includes(parentGroupId))
                : undefined;
            const adjacentSibling = layoutSiblingInfo.siblings[
                layoutSiblingInfo.targetIndex > 0
                    ? layoutSiblingInfo.targetIndex - 1
                    : layoutSiblingInfo.targetIndex + 1
            ];
            absorberGroupIds = (parentSibling ?? adjacentSibling)?.groupIds ?? [];
        }

        if (group) {
            parentGroupMap.current.delete(group.id);
            saveItem('layoutParentGroups', Object.fromEntries(parentGroupMap.current.entries()));
        }

        panel.api.close();

        if (layoutSiblingInfo && siblingSizes.length > 0 && absorberGroupIds.length > 0) {
            window.requestAnimationFrame(() => {
                siblingSizes.forEach((sibling) => {
                    const remainingGroup = api.groups.find((g) => g.id === sibling.id);
                    if (!remainingGroup) return;

                    const isAbsorber = absorberGroupIds.includes(sibling.id);
                    const targetSize: { width?: number; height?: number } = {};

                    if (layoutSiblingInfo.direction === 'horizontal') {
                        targetSize.width = isAbsorber
                            ? sibling.width + closedGroupSize
                            : sibling.width;
                    } else {
                        targetSize.height = isAbsorber
                            ? sibling.height + closedGroupSize
                            : sibling.height;
                    }

                    remainingGroup.api.setSize(targetSize);
                });
            });
        }
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
            onCycleEditorDiffMode={onCycleEditorDiffMode}
            isEditorDiffEnabled={isEditorDiffEnabled}
            getEditorDiffMode={getEditorDiffMode}
            canResetPanel={canResetPanel}
            onResetPanel={onResetPanel}
        />
    ), [getEditorDiffMode, isEditorDiffEnabled, onCycleEditorDiffMode, canResetPanel, onResetPanel]);

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
            api.onDidActivePanelChange((event) => {
                const panel = event.panel;
                if (!panel) return;
                const baseId = getPanelBaseId(panel.id);
                if (!baseId) return;
                onPanelActivated?.(baseId, panel.id);
                if (baseId === 'editor') {
                    setLayoutVersion((v) => v + 1);
                }
            }),
            api.onDidLayoutChange(() => {
                if (isRestoringLayoutRef.current) {
                    return;
                }

                const prevGroups = lastGroupsLayoutRef.current;
                const currentGroups = api.groups;

                if (prevGroups) {
                    // Case 1: A group was removed (merge / close)
                    if (prevGroups.size > currentGroups.length) {
                        const currentGroupIds = new Set(currentGroups.map((g) => g.id));
                        const removedGroupIds = Array.from(prevGroups.keys()).filter((id) => !currentGroupIds.has(id));

                        if (removedGroupIds.length === 1 && lastLayoutSnapshotRef.current) {
                            const removedGroupId = removedGroupIds[0];
                            const prevGroupData = prevGroups.get(removedGroupId);
                            const prevLayout = JSON.parse(lastLayoutSnapshotRef.current) as DockviewLayout;

                            if (prevGroupData && prevLayout?.grid?.root) {
                                const layoutSiblingInfo = findLayoutSiblings(
                                    prevLayout.grid.root,
                                    removedGroupId,
                                    getLayoutDirection(prevLayout.grid.orientation),
                                );

                                if (layoutSiblingInfo) {
                                    const closedGroupSize = layoutSiblingInfo.direction === 'horizontal'
                                        ? prevGroupData.width
                                        : prevGroupData.height;

                                    const siblingGroupIds = layoutSiblingInfo.siblings
                                        .flatMap((sibling) => sibling.groupIds)
                                        .filter((id) => id !== removedGroupId);

                                    // Check if this was a drag-and-drop merge by finding the recipient group in currentGroups
                                    let recipientGroup: any = null;
                                    for (const panelId of prevGroupData.panels) {
                                        const currentGroup = currentGroups.find((cg) => cg.panels.some((p) => p.id === panelId));
                                        if (currentGroup) {
                                            recipientGroup = currentGroup;
                                            break;
                                        }
                                    }

                                    let absorberGroupIds: string[] = [];
                                    if (recipientGroup) {
                                        absorberGroupIds = [recipientGroup.id];
                                    } else {
                                        const parentGroupId = parentGroupMap.current.get(removedGroupId);
                                        const parentSibling = parentGroupId
                                            ? layoutSiblingInfo.siblings.find((sibling) => sibling.groupIds.includes(parentGroupId))
                                            : undefined;
                                        const adjacentSibling = layoutSiblingInfo.siblings[
                                            layoutSiblingInfo.targetIndex > 0
                                                ? layoutSiblingInfo.targetIndex - 1
                                                : layoutSiblingInfo.targetIndex + 1
                                        ];
                                        absorberGroupIds = (parentSibling ?? adjacentSibling)?.groupIds ?? [];
                                    }

                                    window.requestAnimationFrame(() => {
                                        siblingGroupIds.forEach((id) => {
                                            const remainingGroup = api.groups.find((g) => g.id === id);
                                            if (!remainingGroup) return;

                                            const prevSiblingData = prevGroups.get(id);
                                            if (!prevSiblingData) return;

                                            const isAbsorber = absorberGroupIds.includes(id);
                                            const targetSize: { width?: number; height?: number } = {};

                                            if (layoutSiblingInfo.direction === 'horizontal') {
                                                targetSize.width = isAbsorber
                                                    ? prevSiblingData.width + closedGroupSize
                                                    : prevSiblingData.width;
                                            } else {
                                                targetSize.height = isAbsorber
                                                    ? prevSiblingData.height + closedGroupSize
                                                    : prevSiblingData.height;
                                            }

                                            remainingGroup.api.setSize(targetSize);
                                        });

                                        updateGroupsLayoutSnapshot(api);
                                    });
                                }
                            }
                        }
                    }
                    // Case 2: A group was added (split / drag-to-edge) 
                    else if (currentGroups.length > prevGroups.size) {
                        const newGroupIds = currentGroups.filter((cg) => !prevGroups.has(cg.id)).map((cg) => cg.id);

                        if (newGroupIds.length === 1) {
                            const newGroupId = newGroupIds[0];
                            const newGroup = currentGroups.find((cg) => cg.id === newGroupId);

                            if (newGroup && newGroup.panels.length > 0) {
                                const movedPanelId = newGroup.panels[0].id;

                                // Find where this panel came from
                                let sourceGroupId: string | null = null;
                                for (const [id, data] of prevGroups.entries()) {
                                    if (data.panels.includes(movedPanelId)) {
                                        sourceGroupId = id;
                                        break;
                                    }
                                }

                                if (sourceGroupId) {
                                    const prevSourceData = prevGroups.get(sourceGroupId);
                                    const currentLayout = api.toJSON();
                                    const layoutSiblingInfo = findLayoutSiblings(
                                        currentLayout.grid.root,
                                        newGroupId,
                                        getLayoutDirection(currentLayout.grid.orientation),
                                    );

                                    if (prevSourceData && layoutSiblingInfo) {
                                        window.requestAnimationFrame(() => {
                                            currentGroups.forEach((cg) => {
                                                const prevData = prevGroups.get(cg.id);
                                                const targetSize: { width?: number; height?: number } = {};

                                                if (cg.id === newGroupId || cg.id === sourceGroupId) {
                                                    // Split the source group's previous size
                                                    if (layoutSiblingInfo.direction === 'horizontal') {
                                                        targetSize.width = prevSourceData.width / 2;
                                                        targetSize.height = prevSourceData.height;
                                                    } else {
                                                        targetSize.width = prevSourceData.width;
                                                        targetSize.height = prevSourceData.height / 2;
                                                    }
                                                } else if (prevData) {
                                                    // Restore previous size for unaffected groups
                                                    targetSize.width = prevData.width;
                                                    targetSize.height = prevData.height;
                                                }

                                                if (targetSize.width !== undefined || targetSize.height !== undefined) {
                                                    cg.api.setSize(targetSize);
                                                }
                                            });

                                            updateGroupsLayoutSnapshot(api);
                                        });
                                    }
                                }
                            }
                        }
                    }
                }

                const snapshot = getStructuralLayoutSnapshot(api);
                if (snapshot !== lastStructuralSnapshotRef.current) {
                    lastStructuralSnapshotRef.current = snapshot;
                    setLayoutVersion((v) => v + 1);
                }

                queueSaveLayout(api);
                updateGroupsLayoutSnapshot(api);
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

        if (api.totalPanels === 0) {
            addRootPickerPanel(api, handleSelectPanelFromPicker).api.setActive();
        }

        if (!restoredSavedLayout) {
            api.getPanel('files')?.api.setActive();
            api.getPanel('editor')?.api.setActive();
        }

        lastLayoutSnapshotRef.current = getLayoutSnapshot(api);

        syncToolbarSize(api);
        queueSaveLayout(api);
        updateGroupsLayoutSnapshot(api);
    }, [
        disposeListeners,
        onPanelAdded,
        onPanelRemoved,
        onPanelActivated,
        handleSelectPanelFromPicker,
        queueSaveLayout,
        updateGroupsLayoutSnapshot,
        refreshPanelContents,
        rebindPickerPanels,
        syncPanels,
        syncToolbarSize,
        getLayoutSnapshot,
    ]);

    return (
        <div className="layout dockview-theme-dark">
            <div className="layout-main">
                <LayoutVersionContext.Provider value={layoutVersion}>
                    <LayoutRenderContext.Provider value={renderPanel}>
                        <DockviewReact
                            components={DOCKVIEW_COMPONENTS}
                            className="layout-root"
                            onReady={handleReady}
                            rightHeaderActionsComponent={renderRightHeaderActions}
                        />
                    </LayoutRenderContext.Provider>
                </LayoutVersionContext.Provider>
            </div>
            <div className="layout-toolbar">
                {renderPanelRef.current('toolbar', 'toolbar')}
            </div>
        </div>
    );
};

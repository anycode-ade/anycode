import { Orientation, type DockviewApi } from 'dockview';
import { loadItem, saveItem } from '../../storage';
import type { PanelId } from './Layout';

export const LAYOUT_STORAGE_KEY = 'layout';
export const LAYOUT_VERSION_STORAGE_KEY = 'layoutVersion';
export const CURRENT_LAYOUT_VERSION = 4;

export type DockviewLayout = ReturnType<DockviewApi['toJSON']>;

export type LayoutState = {
    version: number;
    root: LayoutNode;
};

export type LayoutNode = LayoutGroup | LayoutContainer;

export type LayoutGroup = {
    type: 'group';
    panels: LayoutPanel[];
    activePanelKey?: string;
};

export type LayoutContainer = {
    type: 'container';
    direction: 'horizontal' | 'vertical';
    children: LayoutNode[];
    sizes?: number[];
};

export type LayoutPanel = {
    key: string;
    id: PanelId;
};

type LayoutStorageValue = LayoutState | DockviewLayout;
type DockviewGridNode = DockviewLayout['grid']['root'];
type DockviewLeafNode = {
    type: 'leaf';
    data: {
        views: string[];
        activeView?: string;
    };
    size?: number;
};
type DockviewBranchNode = {
    type: 'branch';
    data: DockviewGridNode[];
    size?: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
    typeof value === 'object' && value !== null
);

export const isLayoutState = (value: unknown): value is LayoutState => (
    isRecord(value)
    && typeof value.version === 'number'
    && isRecord(value.root)
    && (value.root.type === 'group' || value.root.type === 'container')
);

const getSplitDirection = (orientation: Orientation): 'horizontal' | 'vertical' => (
    orientation === Orientation.HORIZONTAL ? 'horizontal' : 'vertical'
);

const getOrientation = (direction: 'horizontal' | 'vertical'): Orientation => (
    direction === 'horizontal' ? Orientation.HORIZONTAL : Orientation.VERTICAL
);

const getNextDirection = (direction: 'horizontal' | 'vertical'): 'horizontal' | 'vertical' => (
    direction === 'horizontal' ? 'vertical' : 'horizontal'
);

const createLayoutNode = (
    node: DockviewGridNode,
    panels: DockviewLayout['panels'],
    direction: 'horizontal' | 'vertical',
    getPanelId: (panelKey: string) => PanelId | null,
): LayoutNode => {
    if (node.type === 'leaf') {
        const group = (node as unknown as DockviewLeafNode).data;
        return {
            type: 'group',
            panels: group.views
                .map((key: string) => {
                    const id = getPanelId(key);
                    return id ? { key, id } : null;
                })
                .filter((panel: LayoutPanel | null): panel is LayoutPanel => (
                    panel !== null && Object.hasOwn(panels, panel.key)
                )),
            activePanelKey: group.activeView,
        };
    }

    const branch = node as unknown as DockviewBranchNode;
    return {
        type: 'container',
        direction,
        children: branch.data.map((child) => createLayoutNode(child, panels, getNextDirection(direction), getPanelId)),
        sizes: branch.data.map((child) => child.size ?? 0),
    };
};

const createDockviewNode = (
    node: LayoutNode,
    panels: DockviewLayout['panels'],
    nextGroupId: () => string,
): DockviewGridNode => {
    if (node.type === 'group') {
        const views = node.panels.map((panel) => panel.key);
        const groupId = nextGroupId();

        node.panels.forEach((panel) => {
            panels[panel.key] = {
                id: panel.key,
                contentComponent: 'layoutPanel',
                params: {},
                title: panel.id,
            };
        });

        return {
            type: 'leaf',
            data: {
                id: groupId,
                views,
                activeView: node.activePanelKey && views.includes(node.activePanelKey)
                    ? node.activePanelKey
                    : views[0],
            },
            size: 0,
        };
    }

    return {
        type: 'branch',
        data: node.children.map((child, index) => ({
            ...createDockviewNode(child, panels, nextGroupId),
            size: node.sizes?.[index] ?? 0,
        })),
        size: 0,
    };
};

export const createLayoutState = (
    dockview: DockviewLayout,
    getPanelId: (panelKey: string) => PanelId | null,
): LayoutState => ({
    version: CURRENT_LAYOUT_VERSION,
    root: createLayoutNode(
        dockview.grid.root,
        dockview.panels,
        getSplitDirection(dockview.grid.orientation),
        getPanelId,
    ),
});

export const createDockviewLayout = (
    layout: LayoutState,
    getPanelTitle: (panelId: PanelId) => string,
): DockviewLayout => {
    let groupIndex = 0;
    const panels: DockviewLayout['panels'] = {};
    const nextGroupId = () => `group-${groupIndex++}`;
    const root = createDockviewNode(layout.root, panels, nextGroupId);

    Object.values(panels).forEach((panel) => {
        const panelId = panel.title as PanelId;
        panel.title = getPanelTitle(panelId);
    });

    return {
        grid: {
            root,
            width: 0,
            height: 0,
            orientation: layout.root.type === 'container' ? getOrientation(layout.root.direction) : Orientation.HORIZONTAL,
        },
        panels,
    };
};

export const getDockviewLayout = (
    layout: LayoutStorageValue,
    getPanelTitle: (panelId: PanelId) => string,
): DockviewLayout => (
    isLayoutState(layout) ? createDockviewLayout(layout, getPanelTitle) : layout
);

export const loadLayoutState = (): LayoutStorageValue | null => (
    loadItem<LayoutStorageValue>(LAYOUT_STORAGE_KEY)
);

export const storeLayoutState = (layout: LayoutState) => {
    saveItem(LAYOUT_STORAGE_KEY, layout);
    saveItem(LAYOUT_VERSION_STORAGE_KEY, CURRENT_LAYOUT_VERSION);
};

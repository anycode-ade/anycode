import React from 'react';
import { type IDockviewPanelProps } from 'dockview';
import {
    AVAILABLE_PANES,
    PANE_TITLES,
    TOOLBAR_PANEL_CONSTRAINTS,
    PANEL_CONSTRAINTS,
    type RealPaneType,
} from '../Layout';

export const EmptyPanel: React.FC<IDockviewPanelProps> = ({ api, containerApi }) => {
    const replaceWithPane = (paneType: RealPaneType) => {
        const currentPanel = containerApi.getPanel(api.id);
        if (!currentPanel) return;

        containerApi.addPanel({
            id: `pane:${paneType}:split:${Date.now()}`,
            title: PANE_TITLES[paneType],
            component: paneType,
            params: { paneType },
            ...(paneType === 'toolbar' ? TOOLBAR_PANEL_CONSTRAINTS : PANEL_CONSTRAINTS),
            position: {
                referencePanel: currentPanel,
                direction: 'within',
            },
        });
        currentPanel.api.close();
    };

    return (
        <div className="empty-pane">
            <div className="empty-pane-title">Select Pane Type</div>
            <ul className="empty-pane-list">
                {AVAILABLE_PANES.map((pane) => (
                    <li key={pane.type}>
                        <button
                            type="button"
                            className="empty-pane-item-btn"
                            onClick={() => replaceWithPane(pane.type)}
                        >
                            {pane.label}
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
};

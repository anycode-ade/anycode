import type { RefObject } from 'react';
import './TabContextMenu.css';

export type TabMenuAction = {
    key: string;
    label: string;
    disabled?: boolean;
    onClick: () => void;
};

type TabContextMenuProps = {
    anchor: [number, number];
    groups: TabMenuAction[][];
    onClose: () => void;
    menuRef: RefObject<HTMLDivElement | null>;
};

export const TabContextMenu = ({
    anchor,
    groups,
    onClose,
    menuRef,
}: TabContextMenuProps) => (
    <div
        ref={menuRef}
        className="tab-context-menu"
        style={{ left: anchor[0], top: anchor[1] }}
        role="menu"
        onContextMenu={(event) => event.preventDefault()}
    >
        {groups.map((actions, groupIndex) => (
            <div key={actions[0]?.key ?? groupIndex}>
                {groupIndex > 0 && <div className="tab-context-menu-separator" />}
                {actions.map((action) => (
                    <button
                        key={action.key}
                        type="button"
                        role="menuitem"
                        disabled={action.disabled}
                        onClick={() => {
                            action.onClick();
                            onClose();
                        }}
                    >
                        {action.label}
                    </button>
                ))}
            </div>
        ))}
    </div>
);

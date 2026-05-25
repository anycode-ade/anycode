import type { MouseEvent as ReactMouseEvent } from 'react';

type ToolbarTabProps = {
    active: boolean;
    label: string;
    title?: string;
    variant?: 'terminal' | 'agent';
    onSelect: () => void;
    onClose: () => void;
    onContextMenu: (event: ReactMouseEvent) => void;
};

export const ToolbarTab = ({
    active,
    label,
    title,
    variant,
    onSelect,
    onClose,
    onContextMenu,
}: ToolbarTabProps) => {
    const className = [
        'tab',
        variant === 'terminal' ? 'tab-terminal' : '',
        variant === 'agent' ? 'tab-agent' : '',
        active ? 'active' : '',
    ].filter(Boolean).join(' ');

    return (
        <div
            className={className}
            onClick={() => !active && onSelect()}
            onContextMenu={onContextMenu}
        >
            <span className="tab-filename" title={title}>{label}</span>
            <button
                type="button"
                className="tab-close-button"
                onClick={(event) => {
                    event.stopPropagation();
                    onClose();
                }}
            >
                ×
            </button>
        </div>
    );
};

import type { MouseEvent as ReactMouseEvent } from 'react';
import { Icons } from '../Icons';

type ToolbarTabProps = {
    active: boolean;
    label: string;
    title?: string;
    variant?: 'terminal' | 'agent';
    pinned?: boolean;
    onUnpin?: () => void;
    onSelect: () => void;
    onClose: () => void;
    onContextMenu: (event: ReactMouseEvent) => void;
    draggable?: boolean;
    dragging?: boolean;
    onDragStart?: (event: React.DragEvent) => void;
    onDragEnd?: (event: React.DragEvent) => void;
    onDragOver?: (event: React.DragEvent) => void;
    onDrop?: (event: React.DragEvent) => void;
};

export const ToolbarTab = ({
    active,
    label,
    title,
    variant,
    pinned,
    onUnpin,
    onSelect,
    onClose,
    onContextMenu,
    draggable,
    dragging,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDrop,
}: ToolbarTabProps) => {
    const className = [
        'tab',
        variant === 'terminal' ? 'tab-terminal' : '',
        variant === 'agent' ? 'tab-agent' : '',
        active ? 'active' : '',
        pinned ? 'tab-pinned' : '',
        dragging ? 'tab-dragging' : '',
    ].filter(Boolean).join(' ');

    return (
        <div
            className={className}
            onClick={() => !active && onSelect()}
            onContextMenu={onContextMenu}
            draggable={draggable}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragOver={onDragOver}
            onDrop={onDrop}
        >
            <span className="tab-filename" title={title}>{label}</span>
            {pinned ? (
                <button
                    type="button"
                    className="tab-pin-button"
                    title="Unpin tab"
                    onClick={(event) => {
                        event.stopPropagation();
                        onUnpin?.();
                    }}
                >
                    <Icons.Pin />
                </button>
            ) : (
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
            )}
        </div>
    );
};



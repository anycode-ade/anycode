import type { MouseEvent as ReactMouseEvent } from 'react';
import { Icons } from '../Icons';
import { FileIcon } from '../FileIcon';
import { AgentIcon } from '../agent/AgentIcon';

type ToolbarTabProps = {
    active: boolean;
    label: string;
    title?: string;
    variant?: 'terminal' | 'agent';
    filePath?: string;
    fileIconsStyle?: 'colored' | 'monochrome' | 'disabled';
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
    filePath,
    fileIconsStyle = 'colored',
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

    const hasIcon = (!variant && !!filePath) || variant === 'agent' || variant === 'terminal';
    const showIconContainer = !pinned || hasIcon;

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
            {showIconContainer && (
                <div className="tab-icon-container">
                    {!pinned && (
                        <button
                            type="button"
                            className="tab-close-button"
                            onClick={(event) => {
                                event.stopPropagation();
                                onClose();
                            }}
                            title="Close tab"
                        >
                            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                <path d="M4 4L12 12M12 4L4 12" />
                            </svg>
                        </button>
                    )}
                    {!variant && filePath && (
                        <FileIcon path={filePath} styleType={fileIconsStyle} className="tab-file-icon" />
                    )}
                    {variant === 'agent' && (
                        <AgentIcon name={label} size={16} className="tab-agent-icon" />
                    )}
                    {variant === 'terminal' && (
                        <span className="tab-terminal-icon">
                            <Icons.Terminal />
                        </span>
                    )}
                </div>
            )}
            <span className="tab-filename" title={title}>{label}</span>
            {pinned && (
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
            )}
        </div>
    );
};



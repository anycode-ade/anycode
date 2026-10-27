import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Socket } from 'socket.io-client';
import {
    addRemoteProject,
    browseServerDirectory,
    type RecentWorkspace,
    type ServerDirectoryListing,
    type WorkspaceState,
} from '../workspace';
import { Icons } from './Icons';
import './ServerFolderPicker.css';

type ServerFolderPickerProps = {
    socket: Socket | null;
    isConnected: boolean;
    recentProjects: RecentWorkspace[];
    /** Element the picker pops out of. Without one, the picker is a centered dialog. */
    anchor: HTMLElement | null;
    /** When set, the popover is centered horizontally on this element instead of aligned to the anchor's right edge. */
    alignTo?: HTMLElement | null;
    onClose: () => void;
    onAdded: (state: WorkspaceState) => void;
};

const POPOVER_WIDTH = 360;
const VIEWPORT_MARGIN = 8;

// Opens below the anchor, or above it when the space below is smaller (e.g. a button at the bottom of a panel).
const getPopoverStyle = (anchorRect: DOMRect, alignRect?: DOMRect): React.CSSProperties => {
    const preferredLeft = alignRect
        ? alignRect.left + alignRect.width / 2 - POPOVER_WIDTH / 2
        : anchorRect.right - POPOVER_WIDTH;
    const left = Math.min(
        Math.max(preferredLeft, VIEWPORT_MARGIN),
        window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN,
    );
    const spaceBelow = window.innerHeight - anchorRect.bottom - 6 - VIEWPORT_MARGIN;
    const spaceAbove = anchorRect.top - 6 - VIEWPORT_MARGIN;
    if (spaceBelow >= spaceAbove) {
        return { top: anchorRect.bottom + 6, left, width: POPOVER_WIDTH, maxHeight: spaceBelow };
    }
    return { bottom: window.innerHeight - anchorRect.top + 6, left, width: POPOVER_WIDTH, maxHeight: spaceAbove };
};

export const ServerFolderPicker = ({
    socket,
    isConnected,
    recentProjects,
    anchor,
    alignTo,
    onClose,
    onAdded,
}: ServerFolderPickerProps) => {
    const [listing, setListing] = useState<ServerDirectoryListing | null>(null);
    const [pathInput, setPathInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [isAdding, setIsAdding] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [popoverStyle] = useState<React.CSSProperties | null>(() => (
        anchor ? getPopoverStyle(anchor.getBoundingClientRect(), alignTo?.getBoundingClientRect()) : null
    ));
    const dialogRef = useRef<HTMLElement>(null);
    const browseRequestRef = useRef(0);
    const isPopover = popoverStyle !== null;
    const parentPath = listing?.parent ?? null;

    const browse = useCallback(async (path?: string) => {
        if (!socket || !isConnected) {
            setError('Server unavailable. Check your connection and try again.');
            return;
        }
        const requestId = ++browseRequestRef.current;
        setLoading(true);
        setError(null);
        try {
            const next = await browseServerDirectory(socket, path);
            if (browseRequestRef.current !== requestId) return;
            setListing(next);
            setPathInput(next.path);
        } catch (reason) {
            if (browseRequestRef.current === requestId) {
                setError(reason instanceof Error ? reason.message : 'Could not open the server folder.');
            }
        } finally {
            if (browseRequestRef.current === requestId) setLoading(false);
        }
    }, [socket, isConnected]);

    useEffect(() => {
        void browse();
    }, [browse]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    useEffect(() => {
        if (!anchor) return;

        // Capture phase, like the project switcher: the tree row stops bubbling mousedown.
        const handleMouseDown = (event: MouseEvent) => {
            const target = event.target as Node;
            if (anchor.contains(target) || dialogRef.current?.contains(target)) return;
            onClose();
        };
        const handleScroll = (event: Event) => {
            if (dialogRef.current?.contains(event.target as Node)) return;
            onClose();
        };

        document.addEventListener('mousedown', handleMouseDown, true);
        window.addEventListener('scroll', handleScroll, true);
        window.addEventListener('resize', onClose);
        return () => {
            document.removeEventListener('mousedown', handleMouseDown, true);
            window.removeEventListener('scroll', handleScroll, true);
            window.removeEventListener('resize', onClose);
        };
    }, [anchor, onClose]);

    const addCurrentFolder = useCallback(async () => {
        const path = pathInput.trim();
        if (!socket || !isConnected || !listing || !path) return;
        setIsAdding(true);
        setError(null);
        try {
            const state = await addRemoteProject(socket, path);
            onAdded(state);
            onClose();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Could not add this folder.');
        } finally {
            setIsAdding(false);
        }
    }, [socket, isConnected, listing, pathInput, onAdded, onClose]);

    const dialog = (
        <section
            ref={dialogRef}
            className={isPopover ? 'server-folder-dialog server-folder-popover' : 'server-folder-dialog'}
            style={popoverStyle ?? undefined}
            role="dialog"
            aria-modal={isPopover ? undefined : true}
            aria-labelledby="server-folder-title"
        >
            <header className="server-folder-header">
                <div>
                    <h2 id="server-folder-title">Add project folder</h2>
                    <p>Choose folders on the machine running the Anycode server.</p>
                </div>
                <div className="server-folder-actions">
                    <button
                        type="button"
                        className="primary"
                        disabled={isAdding || !listing || !isConnected}
                        onClick={() => void addCurrentFolder()}
                    >
                        Add
                    </button>
                    <button type="button" className="server-folder-close" aria-label="Close" title="Close" onClick={onClose}><Icons.CloseSmall size={14} /></button>
                </div>
            </header>

            <form className="server-folder-path" onSubmit={(event) => {
                event.preventDefault();
                void browse(pathInput);
            }}>
                <label htmlFor="server-folder-path-input">path</label>
                <div>
                    <input
                        id="server-folder-path-input"
                        aria-label="Server path"
                        value={pathInput}
                        onChange={(event) => setPathInput(event.target.value)}
                        placeholder="/path/to/project"
                        autoComplete="off"
                    />
                </div>
            </form>

            {!isPopover && recentProjects.length > 0 && (
                <div className="server-folder-recents">
                    <span>Recent folders</span>
                    {recentProjects.slice(0, 5).map((project) => (
                        <button
                            key={project.path}
                            type="button"
                            title={project.path}
                            onClick={() => void browse(project.path)}
                        >
                            <strong>{project.name}</strong>
                            <small>{project.path}</small>
                        </button>
                    ))}
                </div>
            )}

            <div className="server-folder-list" aria-busy={loading}>
                {!listing && loading && <div className="server-folder-loading">Loading folders…</div>}
                {parentPath && (
                    <button
                        type="button"
                        className="server-folder-entry"
                        aria-label="Parent folder"
                        title={parentPath}
                        onClick={() => void browse(parentPath)}
                    >
                        <span aria-hidden="true">↑</span>
                        <span>..</span>
                        <small>{parentPath}</small>
                    </button>
                )}
                {listing?.directories.length === 0 && (
                    <div className="server-folder-empty">This folder has no subfolders.</div>
                )}
                {listing?.directories.map((directory) => (
                    <button
                        key={directory.path}
                        type="button"
                        className="server-folder-entry"
                        title={directory.path}
                        onDoubleClick={() => void browse(directory.path)}
                        onClick={() => {
                            setPathInput(directory.path);
                            setError(null);
                        }}
                    >
                        <span aria-hidden="true">📁</span>
                        <span>{directory.name}</span>
                        <small>{directory.path}</small>
                    </button>
                ))}
            </div>

            {error && <div className="server-folder-error" role="alert">{error}</div>}

        </section>
    );

    if (isPopover) return createPortal(dialog, document.body);

    return (
        <div className="server-folder-backdrop" role="presentation" onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
        }}>
            {dialog}
        </div>
    );
};

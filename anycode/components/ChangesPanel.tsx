import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Icons } from './Icons';
import { FileIcon } from './FileIcon';
import { usePersistedScroll } from '../hooks/usePersistedScroll';
import './ChangesPanel.css';

const COMMIT_MESSAGE_STORAGE_KEY = 'commitMessage';

export enum GitActionState {
    Idle = 'idle',
    InProgress = 'in_progress',
    Success = 'success',
    Error = 'error',
}

export interface ChangedFile {
    path: string;
    status: 'modified' | 'added' | 'deleted' | 'renamed' | 'conflict';
    staged?: boolean;
    unstaged?: boolean;
    conflicted?: boolean;
    added?: number;
    removed?: number;
}

interface ChangesPanelProps {
    files: ChangedFile[];
    active: ChangedFile | null;
    branch: string;
    branches: { name: string; is_current: boolean }[];
    isSwitchingBranch: boolean;
    fileIconsStyle?: 'colored' | 'monochrome' | 'disabled';
    onFileClick: (path: string) => void;
    onRefresh: () => void;
    onBranchChange: (branch: string) => Promise<boolean>;
    onCommit: (message: string) => Promise<boolean>;
    onPush: () => void;
    pushStatus: { state: GitActionState; message?: string };
    onPull: () => void;
    onRevert: (path: string) => void;
    onStage: (path: string) => void;
    onUnstage: (path: string) => void;
    onOpenMultibuffer: () => void;
}

const statusTextColors: Record<ChangedFile['status'], string> = {
    modified: 'file-status-modified',
    added: 'file-status-added',
    deleted: 'file-status-deleted',
    renamed: 'file-status-renamed',
    conflict: 'file-status-conflict',
};

const getDisplayName = (path: string): string => {
    const normalized = path.replace(/\\/g, '/');
    const parts = normalized.split('/');
    return parts[parts.length - 1] || path;
};

const areChangedFileEqual = (prev: ChangedFile, next: ChangedFile): boolean => (
    prev.path === next.path
    && prev.status === next.status
    && !!prev.staged === !!next.staged
    && !!prev.unstaged === !!next.unstaged
    && !!prev.conflicted === !!next.conflicted
    && (prev.added ?? 0) === (next.added ?? 0)
    && (prev.removed ?? 0) === (next.removed ?? 0)
);

interface ChangesPanelItemProps {
    rowId: string;
    file: ChangedFile;
    mode: 'merge' | 'staged' | 'changed' | 'flat';
    isActive: boolean;
    isSelected: boolean;
    fileIconsStyle?: 'colored' | 'monochrome' | 'disabled';
    style?: React.CSSProperties;
    onClick: (rowId: string, path: string) => void;
    onRevert: (path: string) => void;
    onStage: (path: string) => void;
    onUnstage: (path: string) => void;
    setItemRef: (rowId: string, element: HTMLDivElement | null) => void;
}

interface ChangesFileStatsProps {
    added: number;
    removed: number;
}

const ChangesFileStats = React.memo(({ added, removed }: ChangesFileStatsProps) => {
    if (added === 0 && removed === 0) {
        return null;
    }
    return (
        <span className="changes-file-stats">
            {added > 0 && <span className="changes-stat-added">+{added}</span>}
            {removed > 0 && <span className="changes-stat-removed">-{removed}</span>}
        </span>
    );
});
ChangesFileStats.displayName = 'ChangesFileStats';

const ChangesPanelItemImpl: React.FC<ChangesPanelItemProps> = ({
    rowId,
    file,
    mode,
    isActive,
    isSelected,
    fileIconsStyle = 'colored',
    style,
    onClick,
    onRevert,
    onStage,
    onUnstage,
    setItemRef,
}) => {
    const handleRevert = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        const confirmed = window.confirm(
            `Revert changes for "${file.path}"? This cannot be undone.`
        );
        if (confirmed) {
            onRevert(file.path);
        }
    }, [file.path, onRevert]);

    const refCallback = useCallback((element: HTMLDivElement | null) => {
        setItemRef(rowId, element);
    }, [rowId, setItemRef]);

    const handleStageToggle = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (mode === 'staged') {
            onUnstage(file.path);
            return;
        }
        onStage(file.path);
    }, [file.path, mode, onStage, onUnstage]);

    const stageButtonLabel = mode === 'staged' ? '−' : '+';
    const stageButtonTitle = mode === 'staged' ? 'Unstage Changes' : 'Stage Changes';

    return (
        <div
            ref={refCallback}
            style={style}
            className={`changes-virtual-row changes-item ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''}`}
            onClick={() => onClick(rowId, file.path)}
            role="option"
            aria-selected={isSelected}
        >
            <div className="changes-file-info">
                <div className="changes-file-main">
                    <FileIcon path={file.path} styleType={fileIconsStyle} className="changes-file-icon" />
                    <span
                        className={`changes-filename ${statusTextColors[file.status]}`}
                        title={file.path}
                    >
                        {getDisplayName(file.path)}
                    </span>
                </div>
            </div>
            <div className="changes-file-meta">
                <div className="changes-item-actions">
                    <button
                        className="changes-revert-btn"
                        onClick={handleRevert}
                        title="Revert Changes"
                    >
                        ↩
                    </button>
                    <button
                        className="changes-stage-toggle-btn"
                        onClick={handleStageToggle}
                        title={stageButtonTitle}
                        aria-label={stageButtonTitle}
                    >
                        {stageButtonLabel}
                    </button>
                </div>
                <ChangesFileStats added={file.added ?? 0} removed={file.removed ?? 0} />
            </div>
        </div>
    );
};

const areChangesPanelItemsEqual = (
    prev: ChangesPanelItemProps,
    next: ChangesPanelItemProps,
): boolean => (
    prev.rowId === next.rowId
    && prev.mode === next.mode
    && prev.isActive === next.isActive
    && prev.isSelected === next.isSelected
    && prev.fileIconsStyle === next.fileIconsStyle
    && prev.onClick === next.onClick
    && prev.onRevert === next.onRevert
    && prev.onStage === next.onStage
    && prev.onUnstage === next.onUnstage
    && prev.setItemRef === next.setItemRef
    && prev.style?.transform === next.style?.transform
    && prev.style?.height === next.style?.height
    && areChangedFileEqual(prev.file, next.file)
);

const ChangesPanelItem = React.memo(ChangesPanelItemImpl, areChangesPanelItemsEqual);

const FILE_ROW_HEIGHT = 32;
const GROUP_HEADER_HEIGHT = 28;
const OVERSCAN_PX = 250;

export type VirtualChangesRow =
    | {
          key: string;
          kind: 'group-header';
          groupType: 'merge' | 'staged' | 'changed';
          title: string;
          stats: { added: number; removed: number };
          onAction?: () => void;
          actionTitle?: string;
          actionLabel?: string;
          top: number;
          height: number;
      }
    | {
          key: string;
          kind: 'file';
          file: ChangedFile;
          mode: 'merge' | 'staged' | 'changed' | 'flat';
          rowId: string;
          top: number;
          height: number;
      };

const ChangesPanelImpl: React.FC<ChangesPanelProps> = ({
    files,
    active,
    branch,
    branches,
    isSwitchingBranch,
    fileIconsStyle = 'colored',
    onFileClick,
    onRefresh,
    onBranchChange,
    onCommit,
    onPush,
    pushStatus,
    onPull,
    onRevert,
    onStage,
    onUnstage,
    onOpenMultibuffer,
}) => {
    const [message, setMessage] = useState(() => {
        if (typeof window === 'undefined') return '';
        return localStorage.getItem(COMMIT_MESSAGE_STORAGE_KEY) ?? '';
    });
    const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
    const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(600);
    const listRef = usePersistedScroll<HTMLDivElement>('changes-panel', 'session', [files]);
    const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const shouldAutoScrollRef = useRef(false);

    useEffect(() => {
        const list = listRef.current;
        if (!list) return;
        const updateSize = () => {
            setViewportHeight(list.clientHeight || 600);
            setScrollTop(list.scrollTop);
        };
        updateSize();
        const observer = new ResizeObserver(updateSize);
        observer.observe(list);
        return () => observer.disconnect();
    }, [listRef]);

    const setItemRef = useCallback((rowId: string, element: HTMLDivElement | null) => {
        if (element) {
            itemRefs.current.set(rowId, element);
            return;
        }
        itemRefs.current.delete(rowId);
    }, []);

    const conflictingFiles = useMemo(
        () => files.filter((file) => file.conflicted || file.status === 'conflict'),
        [files],
    );
    const stagedFiles = useMemo(
        () => files.filter((file) => !file.conflicted && !!file.staged),
        [files],
    );
    const changedFiles = useMemo(
        () => files.filter((file) => !file.conflicted && !!file.unstaged),
        [files],
    );
    const hasSections = conflictingFiles.length > 0 || stagedFiles.length > 0 || changedFiles.length > 0;
    const displayedRows = useMemo(() => {
        if (hasSections) {
            return [
                ...conflictingFiles.map((file) => ({ file, mode: 'merge' as const, rowId: `merge::${file.path}` })),
                ...stagedFiles.map((file) => ({ file, mode: 'staged' as const, rowId: `staged::${file.path}` })),
                ...changedFiles.map((file) => ({ file, mode: 'changed' as const, rowId: `changed::${file.path}` })),
            ];
        }

        return files.map((file) => ({ file, mode: 'flat' as const, rowId: `flat::${file.path}` }));
    }, [changedFiles, conflictingFiles, files, hasSections, stagedFiles]);

    const countGroupStats = useCallback((groupFiles: ChangedFile[]) => ({
        added: groupFiles.reduce((acc, file) => acc + (file.added ?? 0), 0),
        removed: groupFiles.reduce((acc, file) => acc + (file.removed ?? 0), 0),
    }), []);
    const mergeStats = useMemo(() => countGroupStats(conflictingFiles), [conflictingFiles, countGroupStats]);
    const stagedStats = useMemo(() => countGroupStats(stagedFiles), [countGroupStats, stagedFiles]);
    const changedStats = useMemo(() => countGroupStats(changedFiles), [changedFiles, countGroupStats]);

    const handleStageAllChanged = useCallback(() => {
        if (changedFiles.length === 0) {
            return;
        }
        for (const file of changedFiles) {
            onStage(file.path);
        }
    }, [changedFiles, onStage]);

    const handleUnstageAll = useCallback(() => {
        if (stagedFiles.length === 0) {
            return;
        }
        for (const file of stagedFiles) {
            onUnstage(file.path);
        }
    }, [onUnstage, stagedFiles]);

    const { virtualRows, totalHeight } = useMemo(() => {
        const nextRows: VirtualChangesRow[] = [];
        let top = 0;

        const pushRow = (row: Omit<VirtualChangesRow, 'top'>) => {
            nextRows.push({ ...row, top } as VirtualChangesRow);
            top += row.height;
        };

        if (hasSections) {
            if (conflictingFiles.length > 0) {
                pushRow({
                    key: 'header::merge',
                    kind: 'group-header',
                    groupType: 'merge',
                    title: 'Merged',
                    stats: mergeStats,
                    height: GROUP_HEADER_HEIGHT,
                });
                for (const file of conflictingFiles) {
                    pushRow({
                        key: `merge::${file.path}`,
                        kind: 'file',
                        file,
                        mode: 'merge',
                        rowId: `merge::${file.path}`,
                        height: FILE_ROW_HEIGHT,
                    });
                }
            }
            if (stagedFiles.length > 0) {
                pushRow({
                    key: 'header::staged',
                    kind: 'group-header',
                    groupType: 'staged',
                    title: 'Staged',
                    stats: stagedStats,
                    onAction: handleUnstageAll,
                    actionTitle: 'Unstage All Changes',
                    actionLabel: '−',
                    height: GROUP_HEADER_HEIGHT,
                });
                for (const file of stagedFiles) {
                    pushRow({
                        key: `staged::${file.path}`,
                        kind: 'file',
                        file,
                        mode: 'staged',
                        rowId: `staged::${file.path}`,
                        height: FILE_ROW_HEIGHT,
                    });
                }
            }
            if (changedFiles.length > 0) {
                pushRow({
                    key: 'header::changed',
                    kind: 'group-header',
                    groupType: 'changed',
                    title: 'Changes',
                    stats: changedStats,
                    onAction: handleStageAllChanged,
                    actionTitle: 'Stage All Changes',
                    actionLabel: '+',
                    height: GROUP_HEADER_HEIGHT,
                });
                for (const file of changedFiles) {
                    pushRow({
                        key: `changed::${file.path}`,
                        kind: 'file',
                        file,
                        mode: 'changed',
                        rowId: `changed::${file.path}`,
                        height: FILE_ROW_HEIGHT,
                    });
                }
            }
        } else {
            for (const file of files) {
                pushRow({
                    key: `flat::${file.path}`,
                    kind: 'file',
                    file,
                    mode: 'flat',
                    rowId: `flat::${file.path}`,
                    height: FILE_ROW_HEIGHT,
                });
            }
        }

        return { virtualRows: nextRows, totalHeight: top };
    }, [
        hasSections,
        conflictingFiles,
        stagedFiles,
        changedFiles,
        files,
        mergeStats,
        stagedStats,
        changedStats,
        handleUnstageAll,
        handleStageAllChanged,
    ]);

    const visibleRows = useMemo(() => {
        const start = Math.max(0, scrollTop - OVERSCAN_PX);
        const end = scrollTop + viewportHeight + OVERSCAN_PX;
        return virtualRows.filter((row) => row.top + row.height >= start && row.top <= end);
    }, [virtualRows, scrollTop, viewportHeight]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (message) {
            localStorage.setItem(COMMIT_MESSAGE_STORAGE_KEY, message);
        } else {
            localStorage.removeItem(COMMIT_MESSAGE_STORAGE_KEY);
        }
    }, [message]);

    useEffect(() => {
        if (displayedRows.length === 0) {
            setActiveFilePath(null);
            setSelectedRowId(null);
            return;
        }

        if (!active) {
            setActiveFilePath(null);
            return;
        }
        setActiveFilePath(active.path);
    }, [active, displayedRows]);

    useEffect(() => {
        if (displayedRows.length === 0) {
            setSelectedRowId(null);
            return;
        }

        if (selectedRowId && displayedRows.some((row) => row.rowId === selectedRowId)) {
            return;
        }

        if (activeFilePath) {
            const activeRow = displayedRows.find((row) => row.file.path === activeFilePath);
            if (activeRow) {
                setSelectedRowId(activeRow.rowId);
                return;
            }
        }

        setSelectedRowId(displayedRows[0].rowId);
    }, [activeFilePath, displayedRows, selectedRowId]);

    useEffect(() => {
        if (!selectedRowId || !shouldAutoScrollRef.current) {
            return;
        }

        const targetRow = virtualRows.find((r) => r.kind === 'file' && r.rowId === selectedRowId);
        const list = listRef.current;
        if (targetRow && list) {
            if (targetRow.top < list.scrollTop) {
                list.scrollTop = targetRow.top;
            } else if (targetRow.top + targetRow.height > list.scrollTop + list.clientHeight) {
                list.scrollTop = targetRow.top + targetRow.height - list.clientHeight;
            }
        }
        shouldAutoScrollRef.current = false;
    }, [selectedRowId, virtualRows, listRef]);

    const handleItemClick = useCallback((rowId: string, path: string) => {
        setSelectedRowId(rowId);
        onFileClick(path);
    }, [onFileClick]);

    const navigateByKey = useCallback((key: string): boolean => {
        if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(key)) {
            return false;
        }

        if (displayedRows.length === 0) {
            return true;
        }

        const currentIndex = Math.max(0, displayedRows.findIndex((row) => row.rowId === selectedRowId));

        if (key === 'ArrowDown') {
            const nextIndex = Math.min(displayedRows.length - 1, currentIndex + 1);
            setSelectedRowId(displayedRows[nextIndex].rowId);
            shouldAutoScrollRef.current = true;
            return true;
        }

        if (key === 'ArrowUp') {
            const prevIndex = Math.max(0, currentIndex - 1);
            setSelectedRowId(displayedRows[prevIndex].rowId);
            shouldAutoScrollRef.current = true;
            return true;
        }

        if (key === 'Enter' && selectedRowId) {
            const selectedRow = displayedRows.find((row) => row.rowId === selectedRowId);
            if (selectedRow) {
                onFileClick(selectedRow.file.path);
                listRef.current?.blur();
                return true;
            }
        }

        return false;
    }, [displayedRows, listRef, onFileClick, selectedRowId]);

    const handleListKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
        const handled = navigateByKey(event.key);
        if (handled) {
            event.preventDefault();
            event.stopPropagation();
        }
    }, [navigateByKey]);

    const handleListMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        if (event.button !== 0) {
            return;
        }
        listRef.current?.focus();
    }, [listRef]);

    const stagedFilesCount = useMemo(
        () => files.filter((file) => !!file.staged && !file.conflicted).length,
        [files],
    );
    const totalAdded = useMemo(
        () => files.reduce((acc, file) => acc + (file.added ?? 0), 0),
        [files],
    );
    const totalRemoved = useMemo(
        () => files.reduce((acc, file) => acc + (file.removed ?? 0), 0),
        [files],
    );

    const handleCommit = async () => {
        if (message.trim() && stagedFilesCount > 0) {
            const success = await onCommit(message);
            if (success) {
                setMessage('');
            }
        }
    };

    const handleRevertAll = () => {
        if (files.length === 0) {
            return;
        }

        const confirmed = window.confirm(
            `Revert all changes for ${files.length} file(s)? This cannot be undone.`
        );

        if (!confirmed) {
            return;
        }

        for (const file of files) {
            onRevert(file.path);
        }
    };

    const handleBranchChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
        const nextBranch = e.target.value;
        if (!nextBranch || nextBranch === branch) {
            return;
        }
        await onBranchChange(nextBranch);
    };
    const isCurrentBranchInList = branches.some((item) => item.name === branch);

    return (
        <div className="changes-panel">
            <div className="changes-message-container">
                <div className="changes-message-mirror" aria-hidden="true">
                    {message + '\u200b'}
                </div>
                <textarea
                    className="changes-message-input"
                    placeholder="Message..."
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={1}
                />
            </div>

            <div className="changes-header">
                <div className="changes-title">
                    <span className="changes-branch-icon"><Icons.Git /></span>
                    <select
                        className="changes-branch-select"
                        value={isCurrentBranchInList ? branch : ''}
                        onChange={handleBranchChange}
                        disabled={isSwitchingBranch || branches.length === 0}
                        title={isSwitchingBranch ? 'Switching branch...' : 'Select branch'}
                        aria-label="Select branch"
                    >
                        {branches.length === 0 || !isCurrentBranchInList ? (
                            <option value="">{branch || 'HEAD'}</option>
                        ) : null}
                        {branches.length > 0 ? (
                            branches.map((item) => (
                                <option key={item.name} value={item.name}>
                                    {item.name}
                                </option>
                            ))
                        ) : null}
                    </select>
                </div>
                <div className="changes-actions-right">
                    {pushStatus.state !== GitActionState.Idle && (
                        <span className={`changes-push-status changes-push-status-${pushStatus.state}`} role="status">
                            {pushStatus.state === GitActionState.InProgress && <span className="changes-push-spinner" aria-hidden="true" />}
                            {pushStatus.message}
                        </span>
                    )}
                    <button
                        className="changes-action-btn changes-action-btn-icon"
                        onClick={handleCommit}
                        disabled={!message.trim() || stagedFilesCount === 0}
                        title="Commit"
                        aria-label="Commit"
                    >
                        <Icons.GitCommit />
                    </button>
                    <button
                        className="changes-action-btn changes-action-btn-icon"
                        onClick={onPull}
                        title="Pull"
                        aria-label="Pull"
                    >
                        <Icons.GitPull />
                    </button>
                    <button
                        className="changes-action-btn changes-action-btn-icon"
                        onClick={onPush}
                        disabled={pushStatus.state === GitActionState.InProgress}
                        title="Push"
                        aria-label="Push"
                    >
                        <Icons.GitPush />
                    </button>
                    <button
                        className="changes-action-btn changes-action-btn-icon"
                        onClick={onRefresh}
                        title="Refresh"
                        aria-label="Refresh"
                    >
                        <Icons.Refresh />
                    </button>
                </div>
            </div>

            <div className="changes-list-header">
                <div className="changes-list-title">
                    <span className="changes-count">
                        {files.length} changed
                    </span>
                </div>
                <button
                    className="changes-review-btn"
                    onClick={onOpenMultibuffer}
                    disabled={files.length === 0}
                    title="Review all changes"
                    aria-label="Review all changes"
                >
                    <span>Review</span>
                </button>
                <div className="changes-list-header-right">
                    {(totalAdded > 0 || totalRemoved > 0) && (
                        <span className="changes-list-stats">
                            {totalAdded > 0 && (
                                <span className="changes-stat-added">+{totalAdded}</span>
                            )}
                            {totalRemoved > 0 && (
                                <span className="changes-stat-removed">-{totalRemoved}</span>
                            )}
                        </span>
                    )}
                    <div className="changes-list-header-actions">
                        <button
                            className="changes-revert-btn changes-revert-all-btn"
                            onClick={handleRevertAll}
                            title="Revert All Changes"
                            aria-label="Revert All Changes"
                        >
                            ↩
                        </button>
                    </div>
                </div>
            </div>

            <div
                ref={listRef}
                className="changes-list"
                role="listbox"
                tabIndex={0}
                aria-label="Changed files"
                onKeyDown={handleListKeyDown}
                onMouseDown={handleListMouseDown}
                onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            >
                {files.length === 0 ? (
                    <div className="changes-empty">
                        No changes
                    </div>
                ) : (
                    <div className="changes-virtual-spacer" style={{ height: totalHeight }}>
                        {visibleRows.map((row) => {
                            const style: React.CSSProperties = {
                                transform: `translateY(${row.top}px)`,
                                height: row.height,
                            };

                            if (row.kind === 'group-header') {
                                const isMerge = row.groupType === 'merge';
                                return (
                                    <div
                                        key={row.key}
                                        style={style}
                                        className={`changes-virtual-row changes-group-title ${
                                            isMerge
                                                ? 'changes-group-title-conflicts'
                                                : 'changes-group-title-with-action changes-group-title-hover-action'
                                        }`}
                                    >
                                        <span className="changes-group-title-label">{row.title}</span>
                                        <span className="changes-group-title-right">
                                            {(row.stats.added > 0 || row.stats.removed > 0) && (
                                                <span className="changes-group-stats">
                                                    {row.stats.added > 0 && (
                                                        <span className="changes-stat-added">+{row.stats.added}</span>
                                                    )}
                                                    {row.stats.removed > 0 && (
                                                        <span className="changes-stat-removed">-{row.stats.removed}</span>
                                                    )}
                                                </span>
                                            )}
                                            {row.onAction && (
                                                <button
                                                    className="changes-group-action-btn changes-group-action-btn-hover"
                                                    onClick={row.onAction}
                                                    title={row.actionTitle}
                                                    aria-label={row.actionTitle}
                                                >
                                                    {row.actionLabel}
                                                </button>
                                            )}
                                        </span>
                                    </div>
                                );
                            }

                            return (
                                <ChangesPanelItem
                                    key={row.key}
                                    rowId={row.rowId}
                                    file={row.file}
                                    mode={row.mode}
                                    style={style}
                                    isActive={activeFilePath === row.file.path}
                                    isSelected={selectedRowId === row.rowId}
                                    fileIconsStyle={fileIconsStyle}
                                    onClick={handleItemClick}
                                    onRevert={onRevert}
                                    onStage={onStage}
                                    onUnstage={onUnstage}
                                    setItemRef={setItemRef}
                                />
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

const areChangedFilesEqual = (prev: ChangedFile[], next: ChangedFile[]): boolean => {
    if (prev === next) {
        return true;
    }
    if (prev.length !== next.length) {
        return false;
    }

    for (let i = 0; i < prev.length; i += 1) {
        const a = prev[i];
        const b = next[i];
        if (!areChangedFileEqual(a, b)) {
            return false;
        }
    }

    return true;
};

const areBranchesEqual = (
    prev: { name: string; is_current: boolean }[],
    next: { name: string; is_current: boolean }[],
): boolean => {
    if (prev === next) {
        return true;
    }
    if (prev.length !== next.length) {
        return false;
    }

    for (let i = 0; i < prev.length; i += 1) {
        if (prev[i].name !== next[i].name || prev[i].is_current !== next[i].is_current) {
            return false;
        }
    }
    return true;
};

const areEqual = (prev: ChangesPanelProps, next: ChangesPanelProps): boolean => {
    if (prev.pushStatus.state !== next.pushStatus.state || prev.pushStatus.message !== next.pushStatus.message) {
        return false;
    }

    if (prev.onOpenMultibuffer !== next.onOpenMultibuffer) {
        return false;
    }

    if (prev.fileIconsStyle !== next.fileIconsStyle) {
        return false;
    }

    if (prev.branch !== next.branch || prev.isSwitchingBranch !== next.isSwitchingBranch) {
        return false;
    }

    const prevActivePath = prev.active?.path ?? null;
    const nextActivePath = next.active?.path ?? null;
    if (prevActivePath !== nextActivePath) {
        return false;
    }

    if (!areChangedFilesEqual(prev.files, next.files)) {
        return false;
    }

    if (!areBranchesEqual(prev.branches, next.branches)) {
        return false;
    }

    return true;
};

export const ChangesPanel = React.memo(ChangesPanelImpl, areEqual);

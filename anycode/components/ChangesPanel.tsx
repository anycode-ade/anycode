import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Icons } from './Icons';
import './ChangesPanel.css';

const COMMIT_MESSAGE_STORAGE_KEY = 'commitMessage';

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
    onFileClick: (path: string) => void;
    onRefresh: () => void;
    onBranchChange: (branch: string) => Promise<boolean>;
    onCommit: (message: string) => Promise<boolean>;
    onPush: () => void;
    onPull: () => void;
    onRevert: (path: string) => void;
    onStage: (path: string) => void;
    onUnstage: (path: string) => void;
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

interface ChangesPanelItemProps {
    rowId: string;
    file: ChangedFile;
    mode: 'merge' | 'staged' | 'changed' | 'flat';
    isActive: boolean;
    isSelected: boolean;
    onClick: (rowId: string, path: string) => void;
    onRevert: (path: string) => void;
    onStage: (path: string) => void;
    onUnstage: (path: string) => void;
    setItemRef: (rowId: string, element: HTMLDivElement | null) => void;
}

const ChangesPanelItemImpl: React.FC<ChangesPanelItemProps> = ({
    rowId,
    file,
    mode,
    isActive,
    isSelected,
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
            className={`changes-item ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''}`}
            onClick={() => onClick(rowId, file.path)}
            role="option"
            aria-selected={isSelected}
        >
            <div className="changes-file-info">
                <div className="changes-file-main">
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
                {(file.added ?? 0) > 0 || (file.removed ?? 0) > 0 ? (
                    <span className="changes-file-stats">
                        {(file.added ?? 0) > 0 && (
                            <span className="changes-stat-added">+{file.added}</span>
                        )}
                        {(file.removed ?? 0) > 0 && (
                            <span className="changes-stat-removed">-{file.removed}</span>
                        )}
                    </span>
                ) : null}
            </div>
        </div>
    );
};

const ChangesPanelItem = React.memo(ChangesPanelItemImpl);

const ChangesPanelImpl: React.FC<ChangesPanelProps> = ({
    files,
    active,
    branch,
    branches,
    isSwitchingBranch,
    onFileClick,
    onRefresh,
    onBranchChange,
    onCommit,
    onPush,
    onPull,
    onRevert,
    onStage,
    onUnstage,
}) => {
    const [message, setMessage] = useState(() => {
        if (typeof window === 'undefined') return '';
        return localStorage.getItem(COMMIT_MESSAGE_STORAGE_KEY) ?? '';
    });
    const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
    const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
    const listRef = useRef<HTMLDivElement | null>(null);
    const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const shouldAutoScrollRef = useRef(false);

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

        const item = itemRefs.current.get(selectedRowId);
        item?.scrollIntoView({ block: 'nearest' });
        shouldAutoScrollRef.current = false;
    }, [selectedRowId]);

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
    }, [displayedRows, onFileClick, selectedRowId]);

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
    }, []);

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

    const handleBranchChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
        const nextBranch = e.target.value;
        if (!nextBranch || nextBranch === branch) {
            return;
        }
        await onBranchChange(nextBranch);
    };
    const isCurrentBranchInList = branches.some((item) => item.name === branch);
    const renderFiles = useCallback((filesGroup: ChangedFile[], mode: 'merge' | 'staged' | 'changed' | 'flat') => (
        filesGroup.map((file) => (
            <ChangesPanelItem
                key={`${mode}::${file.path}`}
                rowId={`${mode}::${file.path}`}
                file={file}
                mode={mode}
                isActive={activeFilePath === file.path}
                isSelected={selectedRowId === `${mode}::${file.path}`}
                onClick={handleItemClick}
                onRevert={onRevert}
                onStage={onStage}
                onUnstage={onUnstage}
                setItemRef={setItemRef}
            />
        ))
    ), [activeFilePath, handleItemClick, onRevert, onStage, onUnstage, selectedRowId, setItemRef]);

    return (
        <div className="changes-panel">
            {/*<div className="changes-panel-title">Changes</div>*/}
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
            >
                {files.length === 0 ? (
                    <div className="changes-empty">
                        No changes
                    </div>
                ) : hasSections ? (
                    <>
                        {conflictingFiles.length > 0 && (
                            <div className="changes-group">
                                <div className="changes-group-title changes-group-title-conflicts">
                                    <span className="changes-group-title-label">Merged</span>
                                    <span className="changes-group-title-right">
                                        {(mergeStats.added > 0 || mergeStats.removed > 0) && (
                                            <span className="changes-group-stats">
                                                {mergeStats.added > 0 && (
                                                    <span className="changes-stat-added">+{mergeStats.added}</span>
                                                )}
                                                {mergeStats.removed > 0 && (
                                                    <span className="changes-stat-removed">-{mergeStats.removed}</span>
                                                )}
                                            </span>
                                        )}
                                    </span>
                                </div>
                                {renderFiles(conflictingFiles, 'merge')}
                            </div>
                        )}
                        {stagedFiles.length > 0 && (
                            <div className="changes-group">
                                <div className="changes-group-title changes-group-title-with-action changes-group-title-hover-action">
                                    <span className="changes-group-title-label">Staged</span>
                                    <span className="changes-group-title-right">
                                        {(stagedStats.added > 0 || stagedStats.removed > 0) && (
                                            <span className="changes-group-stats">
                                                {stagedStats.added > 0 && (
                                                    <span className="changes-stat-added">+{stagedStats.added}</span>
                                                )}
                                                {stagedStats.removed > 0 && (
                                                    <span className="changes-stat-removed">-{stagedStats.removed}</span>
                                                )}
                                            </span>
                                        )}
                                        <button
                                            className="changes-group-action-btn changes-group-action-btn-hover"
                                            onClick={handleUnstageAll}
                                            title="Unstage All Changes"
                                            aria-label="Unstage All Changes"
                                        >
                                            −
                                        </button>
                                    </span>
                                </div>
                                {renderFiles(stagedFiles, 'staged')}
                            </div>
                        )}
                        {changedFiles.length > 0 && (
                            <div className="changes-group">
                                <div className="changes-group-title changes-group-title-with-action changes-group-title-hover-action">
                                    <span className="changes-group-title-label">Changes</span>
                                    <span className="changes-group-title-right">
                                        {(changedStats.added > 0 || changedStats.removed > 0) && (
                                            <span className="changes-group-stats">
                                                {changedStats.added > 0 && (
                                                    <span className="changes-stat-added">+{changedStats.added}</span>
                                                )}
                                                {changedStats.removed > 0 && (
                                                    <span className="changes-stat-removed">-{changedStats.removed}</span>
                                                )}
                                            </span>
                                        )}
                                        <button
                                            className="changes-group-action-btn changes-group-action-btn-hover"
                                            onClick={handleStageAllChanged}
                                            title="Stage All Changes"
                                            aria-label="Stage All Changes"
                                        >
                                            +
                                        </button>
                                    </span>
                                </div>
                                {renderFiles(changedFiles, 'changed')}
                            </div>
                        )}
                    </>
                ) : (
                    renderFiles(files, 'flat')
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
        if (
            a.path !== b.path
            || a.status !== b.status
            || !!a.staged !== !!b.staged
            || !!a.unstaged !== !!b.unstaged
            || !!a.conflicted !== !!b.conflicted
            || (a.added ?? 0) !== (b.added ?? 0)
            || (a.removed ?? 0) !== (b.removed ?? 0)
        ) {
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

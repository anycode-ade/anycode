import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileIcon } from './FileIcon';
import { Icons } from './Icons';
import type { GitHistoryCommit, GitHistoryFile, GitHistorySearchMode } from '../hooks/useGit';
import { usePersistedScroll } from '../hooks/usePersistedScroll';
import './HistoryPanel.css';

interface HistoryPanelProps {
    branch: string;
    commits: GitHistoryCommit[];
    filesByCommit: Record<string, GitHistoryFile[]>;
    hasMore: boolean;
    loading: boolean;
    loaded: boolean;
    filesLoading: Record<string, boolean>;
    historyPath: string | null;
    activeFilePath: string | null;
    fileIconsStyle?: 'colored' | 'monochrome' | 'disabled';
    onRefresh: () => void;
    onLoadMore: () => void;
    onSearch: (mode: GitHistorySearchMode, query: string) => void;
    onClearSearch: () => void;
    onCancelSearch: () => void;
    onCommitExpand: (hash: string) => void;
    onFileClick: (hash: string, file: GitHistoryFile) => void;
    onShowRepository: () => void;
    onShowFile: (path: string) => void;
}

type HistoryRow =
    | { key: string; kind: 'commit'; commit: GitHistoryCommit; height: number; top: number }
    | { key: string; kind: 'commit-stats'; hash: string; fileCount: number; allFileCount: number; showingAll: boolean; added: number; removed: number; height: number; top: number }
    | { key: string; kind: 'file'; hash: string; file: GitHistoryFile; height: number; top: number }
    | { key: string; kind: 'message'; text: string; height: number; top: number }
    | { key: string; kind: 'load-more'; height: number; top: number };

const COMMIT_ROW_HEIGHT = 55;
const COMMIT_STATS_ROW_HEIGHT = 28;
const FILE_ROW_HEIGHT = 32;
const MESSAGE_ROW_HEIGHT = 38;
const LOAD_MORE_ROW_HEIGHT = 48;
const OVERSCAN_PX = 240;
const LOADING_INDICATOR_DELAY_MS = 180;

const getDisplayName = (path: string): string => {
    const parts = path.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || path;
};

const matchesHistoryPath = (filePath: string | null | undefined, historyPath: string): boolean => {
    if (!filePath) return false;
    const file = filePath.replace(/\\/g, '/');
    const history = historyPath.replace(/\\/g, '/');
    return history === file || history.endsWith(`/${file}`);
};

const formatRelativeTime = (timestamp: number): string => {
    const seconds = Math.round((timestamp * 1000 - Date.now()) / 1000);
    const absoluteSeconds = Math.abs(seconds);
    const unit = absoluteSeconds < 60 ? 'second'
        : absoluteSeconds < 3600 ? 'minute'
            : absoluteSeconds < 86400 ? 'hour'
                : absoluteSeconds < 2592000 ? 'day'
                    : absoluteSeconds < 31536000 ? 'month' : 'year';
    const divisor = unit === 'second' ? 1 : unit === 'minute' ? 60 : unit === 'hour' ? 3600 : unit === 'day' ? 86400 : unit === 'month' ? 2592000 : 31536000;
    return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(Math.round(seconds / divisor), unit);
};

const getAvatarUrl = (email: string): string | null => {
    const match = email.trim().match(
        /^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i,
    );

    if (!match) {
        const normalizedEmail = email.trim();
        return normalizedEmail
            ? `https://avatars.githubusercontent.com/u/e?email=${encodeURIComponent(normalizedEmail)}&s=128`
            : null;
    }

    const username = match[1];
    return `https://github.com/${encodeURIComponent(username)}.png?size=128`;
};

const statusTextColors: Record<GitHistoryFile['status'], string> = {
    modified: 'file-status-modified',
    added: 'file-status-added',
    deleted: 'file-status-deleted',
    renamed: 'file-status-renamed',
    conflict: 'file-status-conflict',
};

export const HistoryPanel: React.FC<HistoryPanelProps> = ({
    branch,
    commits,
    filesByCommit,
    hasMore,
    loading,
    loaded,
    filesLoading,
    historyPath,
    activeFilePath,
    fileIconsStyle = 'colored',
    onRefresh,
    onLoadMore,
    onSearch,
    onClearSearch,
    onCancelSearch,
    onCommitExpand,
    onFileClick,
    onShowRepository,
    onShowFile,
}) => {
    const [expandedHashes, setExpandedHashes] = useState<Set<string>>(() => new Set());
    const [showAllFilesHashes, setShowAllFilesHashes] = useState<Set<string>>(() => new Set());
    const [isAnimating, setIsAnimating] = useState(false);
    const [scrollTop, setScrollTop] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchMode, setSearchMode] = useState<GitHistorySearchMode>('message');
    const [appliedQuery, setAppliedQuery] = useState('');
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [shouldRenderSearch, setShouldRenderSearch] = useState(false);
    const [showLoadingIndicator, setShowLoadingIndicator] = useState(!loaded);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const listRef = usePersistedScroll<HTMLDivElement>('history-panel', 'session', [commits.length]);

    useEffect(() => {
        if (!loaded && !loading) {
            onRefresh();
        }
    }, [loaded, loading, onRefresh]);

    useEffect(() => {
        setShowAllFilesHashes(new Set());
    }, [historyPath]);

    useEffect(() => {
        const element = listRef.current;
        if (!element) return;
        const updateHeight = () => setViewportHeight(element.clientHeight);
        updateHeight();
        const syncScrollPosition = () => setScrollTop(element.scrollTop);
        requestAnimationFrame(() => requestAnimationFrame(syncScrollPosition));
        const observer = new ResizeObserver(updateHeight);
        observer.observe(element);
        return () => observer.disconnect();
    }, [commits.length]);

    useEffect(() => {
        if (!isSearchOpen) return;
        const frame = requestAnimationFrame(() => searchInputRef.current?.focus());
        return () => cancelAnimationFrame(frame);
    }, [isSearchOpen]);

    useEffect(() => {
        if (!loading) {
            setShowLoadingIndicator(false);
            return;
        }
        if (!loaded) {
            setShowLoadingIndicator(true);
            return;
        }
        const timer = window.setTimeout(() => setShowLoadingIndicator(true), LOADING_INDICATOR_DELAY_MS);
        return () => window.clearTimeout(timer);
    }, [loaded, loading]);

    const handleToggleCommit = useCallback((hash: string) => {
        const isExpanded = expandedHashes.has(hash);
        setIsAnimating(true);
        window.setTimeout(() => setIsAnimating(false), 160);
        setExpandedHashes((current) => {
            const next = new Set(current);
            if (next.has(hash)) next.delete(hash);
            else next.add(hash);
            return next;
        });
        if (!isExpanded) onCommitExpand(hash);
    }, [expandedHashes, onCommitExpand]);

    const handleRefresh = useCallback(() => {
        setExpandedHashes(new Set());
        setShowAllFilesHashes(new Set());
        onRefresh();
    }, [onRefresh]);

    const handleShowAllFiles = useCallback((hash: string) => {
        setShowAllFilesHashes((current) => {
            const next = new Set(current);
            next.add(hash);
            return next;
        });
    }, []);

    const handleShowFile = useCallback(() => {
        if (!activeFilePath || historyPath === activeFilePath) return;
        setExpandedHashes(new Set());
        setSearchQuery('');
        setAppliedQuery('');
        setIsSearchOpen(false);
        onShowFile(activeFilePath);
    }, [activeFilePath, historyPath, onShowFile]);

    const handleSearch = useCallback(() => {
        const query = searchQuery.trim();
        if (!query) {
            setAppliedQuery('');
            onClearSearch();
        } else {
            setAppliedQuery(query);
            onSearch(searchMode, query);
        }
        if (listRef.current) listRef.current.scrollTop = 0;
    }, [listRef, onClearSearch, onSearch, searchMode, searchQuery]);

    const handleClearSearch = useCallback(() => {
        setSearchQuery('');
        setAppliedQuery('');
        onClearSearch();
        if (listRef.current) listRef.current.scrollTop = 0;
    }, [listRef, onClearSearch]);

    const handleToggleSearch = useCallback(() => {
        if (isSearchOpen) {
            if (searchQuery || appliedQuery) handleClearSearch();
            else onCancelSearch();
            setIsSearchOpen(false);
        } else {
            setShouldRenderSearch(true);
            setIsSearchOpen(true);
        }
    }, [appliedQuery, handleClearSearch, isSearchOpen, onCancelSearch, searchQuery]);

    const handleSearchModeChange = useCallback((mode: GitHistorySearchMode) => {
        if (mode === searchMode) return;
        setSearchMode(mode);
        if (appliedQuery && searchQuery.trim() === appliedQuery) {
            onSearch(mode, appliedQuery);
            if (listRef.current) listRef.current.scrollTop = 0;
        }
    }, [appliedQuery, listRef, onSearch, searchMode, searchQuery]);

    const { rows, totalHeight } = useMemo(() => {
        const nextRows: HistoryRow[] = [];
        let top = 0;
        const push = (row: Omit<HistoryRow, 'top'>) => {
            nextRows.push({ ...row, top } as HistoryRow);
            top += row.height;
        };

        for (const commit of commits) {
            push({ key: `commit:${commit.hash}`, kind: 'commit', commit, height: COMMIT_ROW_HEIGHT });
            if (!expandedHashes.has(commit.hash)) continue;
            const allFiles = filesByCommit[commit.hash];
            const showingAll = !historyPath || showAllFilesHashes.has(commit.hash);
            const files = allFiles?.filter((file) => showingAll || matchesHistoryPath(file.path, historyPath) || matchesHistoryPath(file.old_path, historyPath));
            if (!files) {
                push({ key: `loading:${commit.hash}`, kind: 'message', text: filesLoading[commit.hash] ? 'Loading files…' : 'Files unavailable', height: MESSAGE_ROW_HEIGHT });
            } else if (files.length === 0) {
                push({ key: `empty:${commit.hash}`, kind: 'message', text: 'No changed files', height: MESSAGE_ROW_HEIGHT });
            } else {
                const totals = files.reduce((result, file) => ({
                    added: result.added + file.added,
                    removed: result.removed + file.removed,
                }), { added: 0, removed: 0 });
                push({
                    key: `stats:${commit.hash}`,
                    kind: 'commit-stats',
                    hash: commit.hash,
                    fileCount: files.length,
                    allFileCount: allFiles.length,
                    showingAll,
                    added: totals.added,
                    removed: totals.removed,
                    height: COMMIT_STATS_ROW_HEIGHT,
                });
                for (const file of files) {
                    push({ key: `file:${commit.hash}:${file.old_path || ''}:${file.path}`, kind: 'file', hash: commit.hash, file, height: FILE_ROW_HEIGHT });
                }
            }
        }

        if (commits.length === 0 && !loading && loaded) {
            push({
                key: 'empty-history',
                kind: 'message',
                text: appliedQuery ? 'No matching commits' : 'No commits',
                height: MESSAGE_ROW_HEIGHT,
            });
        }
        if (loading && showLoadingIndicator) {
            // Keep a stable loading row during scope changes and pagination.
            push({ key: 'loading-history', kind: 'message', text: 'Loading history…', height: LOAD_MORE_ROW_HEIGHT });
        } else if (hasMore) {
            push({ key: 'load-more', kind: 'load-more', height: LOAD_MORE_ROW_HEIGHT });
        }
        return { rows: nextRows, totalHeight: top };
    }, [appliedQuery, commits, expandedHashes, filesByCommit, filesLoading, hasMore, historyPath, loaded, loading, showAllFilesHashes, showLoadingIndicator]);

    const visibleRows = useMemo(() => {
        const start = Math.max(0, scrollTop - OVERSCAN_PX);
        const end = scrollTop + viewportHeight + OVERSCAN_PX;
        return rows.filter((row) => row.top + row.height >= start && row.top <= end);
    }, [rows, scrollTop, viewportHeight]);

    const isSearching = loading && !!appliedQuery;

    return (
        <div className="history-panel">
            <div className="history-header">
                <div className="history-scope" role="tablist" aria-label="History scope">
                    <button type="button" className={!historyPath ? 'active' : ''} onClick={onShowRepository} role="tab" aria-selected={!historyPath}>Repository</button>
                    <button type="button" className={historyPath ? 'active' : ''} onClick={handleShowFile} disabled={!activeFilePath} role="tab" aria-selected={!!historyPath} title={activeFilePath || 'Open a file to view its history'}>File</button>
                    <span title={historyPath || branch || 'HEAD'}>{historyPath ? getDisplayName(historyPath) : branch || 'HEAD'}</span>
                </div>
                <div className="history-header-actions">
                    {historyPath ? <button className="history-header-button active" type="button" onClick={handleShowFile} disabled={!activeFilePath} title={activeFilePath ? 'Show history for current file' : 'Open a file to view its history'} aria-label="Show history for current file" aria-pressed="true">
                        <Icons.Crosshair />
                    </button> : null}
                    {!historyPath ? <button className={`history-header-button ${isSearchOpen ? 'active' : ''}`} type="button" onClick={handleToggleSearch} title={isSearchOpen ? 'Close history search' : 'Search history'} aria-label={isSearchOpen ? 'Close history search' : 'Search history'} aria-expanded={isSearchOpen}>
                        <Icons.Search />
                    </button> : null}
                    <button className="history-header-button" type="button" onClick={handleRefresh} disabled={loading} title="Refresh history" aria-label="Refresh history">
                        <Icons.Refresh />
                    </button>
                </div>
            </div>
            {shouldRenderSearch ? <div
                className={`history-search ${isSearchOpen ? 'open' : 'closing'}`}
                onAnimationEnd={() => {
                    if (!isSearchOpen) setShouldRenderSearch(false);
                }}
                aria-hidden={!isSearchOpen}
            >
                <div className="history-search-input-wrapper">
                    <span className="history-search-icon"><Icons.Search /></span>
                    <input
                        ref={searchInputRef}
                        className="history-search-input"
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                handleSearch();
                            } else if (event.key === 'Escape' && isSearching) {
                                event.preventDefault();
                                onCancelSearch();
                            } else if (event.key === 'Escape' && (searchQuery || appliedQuery)) {
                                event.preventDefault();
                                handleClearSearch();
                                setIsSearchOpen(false);
                            } else if (event.key === 'Escape') {
                                event.preventDefault();
                                onCancelSearch();
                                setIsSearchOpen(false);
                            }
                        }}
                        placeholder={`Search by ${searchMode}`}
                        aria-label="Search Git history"
                    />
                    {searchQuery ? (
                        <button className="history-search-clear" type="button" onClick={handleClearSearch} title="Clear search" aria-label="Clear history search">
                            <Icons.Close size={10} />
                        </button>
                    ) : null}
                </div>
                <div className="history-search-mode-toggle" role="tablist" aria-label="History search field">
                    {(['message', 'hash', 'author'] as const).map((mode) => (
                        <button
                            key={mode}
                            type="button"
                            className={`search-mode-button ${searchMode === mode ? 'active' : ''}`}
                            onClick={() => handleSearchModeChange(mode)}
                            role="tab"
                            aria-selected={searchMode === mode}
                        >
                            {mode[0].toUpperCase() + mode.slice(1)}
                        </button>
                    ))}
                    <button
                        className="history-search-submit"
                        type="button"
                        onClick={isSearching ? onCancelSearch : handleSearch}
                        disabled={!isSearching && (!searchQuery.trim() || loading)}
                        aria-live="polite"
                        aria-busy={isSearching}
                    >
                        {isSearching ? <span className="history-search-spinner" aria-hidden="true" /> : null}
                        {isSearching ? 'Cancel' : 'Search'}
                    </button>
                </div>
            </div> : null}
            <div
                ref={listRef}
                className="history-list"
                role="list"
                aria-label="Git history"
                onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            >
                <div className="history-virtual-spacer" style={{ height: totalHeight }}>
                    {visibleRows.map((row) => {
                        const style = { transform: `translateY(${row.top}px)`, height: row.height };
                        if (row.kind === 'commit') {
                            const expanded = expandedHashes.has(row.commit.hash);
                            const avatarUrl = getAvatarUrl(row.commit.author_email);
                            return (
                                <button key={row.key} style={style} className={`history-virtual-row history-commit-row ${expanded ? 'expanded' : ''} ${isAnimating ? 'history-animating' : ''}`} type="button" role="listitem" onClick={() => handleToggleCommit(row.commit.hash)} aria-expanded={expanded} title={row.commit.message}>
                                    <span className={`history-chevron ${expanded ? 'expanded' : ''}`}>▶</span>
                                    <span className="history-commit-main">
                                        <span className="history-summary">
                                            {row.commit.summary || '(no message)'}
                                            {row.commit.tags?.map((tag) => <span key={tag} className="history-tag">{tag}</span>)}
                                        </span>
                                        <span className="history-meta">
                                            {avatarUrl ? <img className="history-avatar" src={avatarUrl} alt="" /> : null}
                                            <span>{row.commit.author_name || row.commit.author_email || 'Unknown'}</span>
                                            <span className="history-meta-separator">·</span>
                                            <span>{formatRelativeTime(row.commit.timestamp)}</span>
                                            <span className="history-meta-separator">·</span>
                                            <code
                                                className="history-hash"
                                                title="Copy full commit hash"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    void navigator.clipboard?.writeText(row.commit.hash);
                                                }}
                                            >{row.commit.hash.slice(0, 7)}</code>
                                        </span>
                                    </span>
                                </button>
                            );
                        }
                        if (row.kind === 'file') {
                            return (
                                <button key={row.key} style={style} className={`history-virtual-row history-file-row ${isAnimating ? 'history-animating' : ''}`} type="button" role="listitem" onClick={() => onFileClick(row.hash, row.file)} title={row.file.old_path ? `${row.file.old_path} → ${row.file.path}` : row.file.path}>
                                    <FileIcon path={row.file.path} styleType={fileIconsStyle} className="history-file-icon" />
                                    <span className={`history-file-name ${statusTextColors[row.file.status]}`}>{getDisplayName(row.file.path)}</span>
                                    {row.file.old_path ? <span className="history-old-path">← {row.file.old_path}</span> : <span className="history-file-spacer" />}
                                    {row.file.binary ? <span className="history-binary">binary</span> : (
                                        <span className="history-file-stats">
                                            {row.file.added > 0 ? <span className="history-stat-added">+{row.file.added}</span> : null}
                                            {row.file.removed > 0 ? <span className="history-stat-removed">-{row.file.removed}</span> : null}
                                        </span>
                                    )}
                                    <span className={`history-status history-status-${row.file.status}`}>{row.file.status.charAt(0).toUpperCase()}</span>
                                </button>
                            );
                        }
                        if (row.kind === 'commit-stats') {
                            return (
                                <div key={row.key} style={style} className="history-virtual-row history-commit-stats" role="listitem">
                                    <span>{row.fileCount} {row.fileCount === 1 ? 'file' : 'files'} changed</span>
                                    {historyPath && !row.showingAll && row.allFileCount > row.fileCount ? <button type="button" className="history-show-all-files" onClick={() => handleShowAllFiles(row.hash)}>Show all ({row.allFileCount})</button> : null}
                                    <span className="history-stat-added history-commit-stat-added">+{row.added}</span>
                                    <span className="history-stat-removed">-{row.removed}</span>
                                </div>
                            );
                        }
                        if (row.kind === 'load-more') {
                            return <div key={row.key} style={style} className="history-virtual-row history-load-more-row"><button type="button" onClick={onLoadMore}>Load more</button></div>;
                        }
                        return <div key={row.key} style={style} className="history-virtual-row history-message" role="listitem">{row.text}</div>;
                    })}
                </div>
            </div>
        </div>
    );
};

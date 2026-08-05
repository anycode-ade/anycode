import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { ChangedFile } from '../components';

type UseGitParams = {
    wsRef: React.RefObject<Socket | null>;
    isConnected: boolean;
};

type GitPatchItem = {
    path: string;
    status: ChangedFile['status'] | 'removed';
    staged?: boolean;
    unstaged?: boolean;
    conflicted?: boolean;
    added?: number;
    removed?: number;
};

type GitStatusFullUpdate = {
    kind?: 'full';
    files: ChangedFile[];
    branch: string;
    head_hash?: string;
};

type GitStatusPatchUpdate = {
    kind: 'patch';
    branch: string;
    head_hash?: string;
    files: GitPatchItem[];
};

type GitStatusUpdate = GitStatusFullUpdate | GitStatusPatchUpdate;

type GitBranch = {
    name: string;
    is_current: boolean;
};

export type GitHistoryCommit = {
    hash: string;
    tags?: string[];
    parents: string[];
    summary: string;
    message: string;
    author_name: string;
    author_email: string;
    timestamp: number;
    timezone_offset: number;
};

export type GitHistoryFile = {
    path: string;
    old_path?: string | null;
    status: ChangedFile['status'];
    added: number;
    removed: number;
    binary: boolean;
};

export type GitHistoryFileContent = {
    old_content: string | null;
    new_content: string | null;
    old_binary: boolean;
    new_binary: boolean;
};

export type GitHistorySearchMode = 'message' | 'hash' | 'author';

const HISTORY_PAGE_SIZE = 50;

const areChangedFilesEqual = (prev: ChangedFile, next: ChangedFile): boolean => (
    prev.path === next.path
    && prev.status === next.status
    && prev.staged === next.staged
    && prev.unstaged === next.unstaged
    && prev.conflicted === next.conflicted
    && prev.added === next.added
    && prev.removed === next.removed
);

const sortChangedFiles = (files: ChangedFile[]): ChangedFile[] => {
    return [...files].sort((a, b) => {
        if (a.path < b.path) return -1;
        if (a.path > b.path) return 1;

        if (a.status < b.status) return -1;
        if (a.status > b.status) return 1;

        const aStaged = a.staged ? 1 : 0;
        const bStaged = b.staged ? 1 : 0;
        if (aStaged !== bStaged) return aStaged - bStaged;

        const aUnstaged = a.unstaged ? 1 : 0;
        const bUnstaged = b.unstaged ? 1 : 0;
        if (aUnstaged !== bUnstaged) return aUnstaged - bUnstaged;

        const aConflicted = a.conflicted ? 1 : 0;
        const bConflicted = b.conflicted ? 1 : 0;
        if (aConflicted !== bConflicted) return aConflicted - bConflicted;

        const aAdded = a.added ?? 0;
        const bAdded = b.added ?? 0;
        if (aAdded !== bAdded) return aAdded - bAdded;

        const aRemoved = a.removed ?? 0;
        const bRemoved = b.removed ?? 0;
        if (aRemoved !== bRemoved) return aRemoved - bRemoved;

        return 0;
    });
};

export const useGit = ({ wsRef, isConnected }: UseGitParams) => {
    const [changedFiles, setChangedFiles] = useState<ChangedFile[]>([]);
    const [gitBranch, setGitBranch] = useState<string>('');
    const [branches, setBranches] = useState<GitBranch[]>([]);
    const [isSwitchingBranch, setIsSwitchingBranch] = useState(false);
    const [historyCommits, setHistoryCommits] = useState<GitHistoryCommit[]>([]);
    const [historyFiles, setHistoryFiles] = useState<Record<string, GitHistoryFile[]>>({});
    const [historyHasMore, setHistoryHasMore] = useState(false);
    const [isHistoryLoading, setIsHistoryLoading] = useState(false);
    const [isHistoryLoaded, setIsHistoryLoaded] = useState(false);
    const [historyFilesLoading, setHistoryFilesLoading] = useState<Record<string, boolean>>({});
    const isHistoryLoadingRef = useRef(false);
    const historyFilesLoadingRef = useRef(new Set<string>());
    const historyCommitsRef = useRef<GitHistoryCommit[]>([]);
    const historySearchRef = useRef<{ mode: GitHistorySearchMode; query: string } | null>(null);
    const historyRequestIdRef = useRef(0);
    const activeHistorySearchRequestIdRef = useRef<number | null>(null);
    const gitHeadHashRef = useRef<string | undefined>(undefined);

    const cancelHistorySearch = useCallback(() => {
        const requestId = activeHistorySearchRequestIdRef.current;
        if (historySearchRef.current && wsRef.current && isConnected) {
            wsRef.current.emit('git:history-search-cancel', {
                request_id: requestId,
            });
        }
        activeHistorySearchRequestIdRef.current = null;
        // Invalidate the active callback even when the server acknowledgement
        // races with the next normal-history request.
        historyRequestIdRef.current += 1;
        isHistoryLoadingRef.current = false;
        setIsHistoryLoading(false);
        setHistoryHasMore(false);
    }, [isConnected, wsRef]);

    useEffect(() => () => {
        const requestId = activeHistorySearchRequestIdRef.current;
        if (historySearchRef.current && wsRef.current?.connected) {
            wsRef.current.emit('git:history-search-cancel', {
                request_id: requestId,
            });
        }
    }, [wsRef]);

    const requestHistoryPage = useCallback((reset: boolean, search: { mode: GitHistorySearchMode; query: string } | null) => {
        if (!wsRef.current || !isConnected || (!reset && isHistoryLoadingRef.current)) return;
        const offset = reset ? 0 : historyCommitsRef.current.length;
        if (!search && historySearchRef.current) {
            wsRef.current.emit('git:history-search-cancel', {
                request_id: activeHistorySearchRequestIdRef.current,
            });
            activeHistorySearchRequestIdRef.current = null;
            historySearchRef.current = null;
        }
        const requestId = ++historyRequestIdRef.current;
        if (search) activeHistorySearchRequestIdRef.current = requestId;
        isHistoryLoadingRef.current = true;
        setIsHistoryLoading(true);
        if (reset) {
            historyCommitsRef.current = [];
            setHistoryCommits([]);
            setHistoryHasMore(false);
            setHistoryFiles({});
        }
        const event = search ? 'git:history-search' : 'git:history';
        const payload = search
            ? {
                mode: search.mode,
                query: search.query,
                request_id: requestId,
                offset,
                limit: HISTORY_PAGE_SIZE,
            }
            : { offset, limit: HISTORY_PAGE_SIZE };
        wsRef.current.emit(event, payload, (response: any) => {
            if (requestId !== historyRequestIdRef.current) return;
            if (search && response.request_id !== requestId) return;
            if (activeHistorySearchRequestIdRef.current === requestId) {
                activeHistorySearchRequestIdRef.current = null;
            }
            isHistoryLoadingRef.current = false;
            setIsHistoryLoading(false);
            setIsHistoryLoaded(true);
            if (response.success) {
                const commits = response.commits || [];
                if (search && response.streamed) {
                    setHistoryHasMore(!!response.has_more);
                    return;
                }
                const nextCommits = reset ? commits : [...historyCommitsRef.current, ...commits];
                historyCommitsRef.current = nextCommits;
                setHistoryCommits(nextCommits);
                if (reset) setHistoryFiles({});
                setHistoryHasMore(!!response.has_more);
            }
        });
    }, [isConnected, wsRef]);

    const handleHistorySearchResults = useCallback((data: { request_id?: number; commits?: GitHistoryCommit[] }) => {
        if (data.request_id !== historyRequestIdRef.current || !activeHistorySearchRequestIdRef.current) return;
        const commits = data.commits || [];
        if (!commits.length) return;
        const nextCommits = [...historyCommitsRef.current, ...commits];
        historyCommitsRef.current = nextCommits;
        setHistoryCommits(nextCommits);
    }, []);

    const fetchHistory = useCallback((reset = true) => {
        if (reset && historySearchRef.current) cancelHistorySearch();
        if (reset) historySearchRef.current = null;
        requestHistoryPage(reset, null);
    }, [cancelHistorySearch, requestHistoryPage]);

    const searchHistory = useCallback((mode: GitHistorySearchMode, query: string) => {
        const trimmedQuery = query.trim();
        if (!trimmedQuery) {
            cancelHistorySearch();
            historySearchRef.current = null;
            requestHistoryPage(true, null);
            return;
        }
        const search = { mode, query: trimmedQuery };
        historySearchRef.current = search;
        requestHistoryPage(true, search);
    }, [cancelHistorySearch, requestHistoryPage]);

    const clearHistorySearch = useCallback(() => {
        cancelHistorySearch();
        historySearchRef.current = null;
        requestHistoryPage(true, null);
    }, [cancelHistorySearch, requestHistoryPage]);

    const refreshHistory = useCallback(() => {
        const current = historySearchRef.current;
        if (!current) {
            requestHistoryPage(true, null);
            return;
        }
        requestHistoryPage(true, current);
    }, [requestHistoryPage]);

    const loadMoreHistory = useCallback(() => {
        requestHistoryPage(false, historySearchRef.current);
    }, [requestHistoryPage]);

    const fetchHistoryFiles = useCallback((hash: string) => {
        if (!wsRef.current || !isConnected || historyFiles[hash] || historyFilesLoadingRef.current.has(hash)) return;
        historyFilesLoadingRef.current.add(hash);
        setHistoryFilesLoading((prev) => ({ ...prev, [hash]: true }));
        wsRef.current.emit('git:history-files', { hash }, (response: any) => {
            historyFilesLoadingRef.current.delete(hash);
            setHistoryFilesLoading((prev) => ({ ...prev, [hash]: false }));
            if (response.success) {
                setHistoryFiles((prev) => ({ ...prev, [hash]: response.files || [] }));
            }
        });
    }, [historyFiles, isConnected, wsRef]);

    const fetchHistoryFileContent = useCallback((hash: string, file: GitHistoryFile): Promise<GitHistoryFileContent | null> => (
        new Promise((resolve) => {
            if (!wsRef.current || !isConnected) return resolve(null);
            wsRef.current.emit('git:history-file', {
                hash,
                path: file.path,
                old_path: file.old_path || undefined,
            }, (response: any) => {
                if (!response.success) {
                    alert('Failed to open historical diff: ' + response.error);
                    resolve(null);
                    return;
                }
                resolve(response as GitHistoryFileContent);
            });
        })
    ), [isConnected, wsRef]);

    const fetchGitStatus = useCallback(() => {
        if (!wsRef.current || !isConnected) return;

        wsRef.current.emit('git:status', {}, (response: any) => {
            if (response.success) {
                setChangedFiles(sortChangedFiles(response.files || []));
                setGitBranch(response.branch || '');
                gitHeadHashRef.current = response.head_hash;
            } else {
                setChangedFiles([]);
                setGitBranch('');
                gitHeadHashRef.current = undefined;
            }
        });
    }, [wsRef, isConnected]);

    const fetchBranches = useCallback(() => {
        if (!wsRef.current || !isConnected) return;

        wsRef.current.emit('git:branches', {}, (response: any) => {
            if (response.success) {
                setBranches(response.branches || []);
            } else {
                setBranches([]);
            }
        });
    }, [wsRef, isConnected]);

    const handleGitStatusUpdate = useCallback((data: GitStatusUpdate) => {
        if (data.kind === 'patch') {
            setGitBranch(data.branch || '');
            setChangedFiles((prev) => {
                const next = new Map(prev.map((file) => [file.path, file]));
                let structurallyChanged = false;
                for (const item of data.files || []) {
                    if (item.status === 'removed') {
                        if (next.has(item.path)) {
                            next.delete(item.path);
                            structurallyChanged = true;
                        }
                    } else {
                        const existing = next.get(item.path);
                        if (!existing) {
                            next.set(item.path, {
                                path: item.path,
                                status: item.status,
                                staged: item.staged,
                                unstaged: item.unstaged,
                                conflicted: item.conflicted,
                                added: item.added,
                                removed: item.removed,
                            });
                            structurallyChanged = true;
                        } else {
                            const updated: ChangedFile = {
                                path: item.path,
                                status: item.status,
                                staged: item.staged,
                                unstaged: item.unstaged,
                                conflicted: item.conflicted,
                                added: item.added,
                                removed: item.removed,
                            };
                            if (!areChangedFilesEqual(existing, updated)) {
                                next.set(item.path, updated);
                                structurallyChanged = true;
                            }
                        }
                    }
                }
                if (!structurallyChanged) {
                    return prev;
                }
                return sortChangedFiles(Array.from(next.values()));
            });
            return;
        }

        const headChanged = data.head_hash !== undefined
            && gitHeadHashRef.current !== undefined
            && gitHeadHashRef.current !== data.head_hash;
        gitHeadHashRef.current = data.head_hash;

        setGitBranch(data.branch || '');
        setChangedFiles((prev) => {
            const nextFiles = sortChangedFiles(data.files || []);
            if (prev.length !== nextFiles.length) {
                const prevByPath = new Map(prev.map((file) => [file.path, file]));
                return nextFiles.map((file) => {
                    const previousFile = prevByPath.get(file.path);
                    return previousFile && areChangedFilesEqual(previousFile, file)
                        ? previousFile
                        : file;
                });
            }
            let isDifferent = false;
            const reusedFiles = new Array<ChangedFile>(nextFiles.length);
            for (let i = 0; i < prev.length; i++) {
                const a = prev[i];
                const b = nextFiles[i];
                if (areChangedFilesEqual(a, b)) {
                    reusedFiles[i] = a;
                } else {
                    reusedFiles[i] = b;
                    isDifferent = true;
                }
            }
            if (isDifferent) {
                return reusedFiles;
            }
            return prev;
        });

        if (headChanged) {
            refreshHistory();
        }
    }, [refreshHistory]);

    const commit = useCallback((message: string): Promise<boolean> => {
        return new Promise((resolve) => {
            if (!wsRef.current || !isConnected) {
                resolve(false);
                return;
            }

            wsRef.current.emit('git:commit', { message }, (response: any) => {
                if (response.success) {
                    fetchGitStatus();
                    refreshHistory();
                    resolve(true);
                } else {
                    alert('Commit failed: ' + response.error);
                    resolve(false);
                }
            });
        });
    }, [wsRef, isConnected, fetchGitStatus, refreshHistory]);

    const push = useCallback(() => {
        if (!wsRef.current || !isConnected) return;

        wsRef.current.emit('git:push', {}, (response: any) => {
            if (response.success) {
                fetchGitStatus();
            } else {
                alert('Push failed: ' + response.error);
            }
        });
    }, [wsRef, isConnected, fetchGitStatus]);

    const pull = useCallback(() => {
        if (!wsRef.current || !isConnected) return;

        wsRef.current.emit('git:pull', {}, (response: any) => {
            if (response.success) {
                const status = response.status;

                if (status === 'up_to_date') {
                    alert('Already up to date');
                } else if (status === 'fast_forward') {
                    alert('Fast-forwarded');
                } else if (status === 'merged') {
                    alert('Merged successfully');
                } else if (status === 'conflict') {
                    const files = response.files || [];
                    alert(`Merge conflicts in:\n${files.join('\n')}\n\nResolve conflicts and commit.`);
                }

                fetchGitStatus();
                if (status !== 'conflict') refreshHistory();
            } else {
                alert('Pull failed: ' + response.error);
            }
        });
    }, [wsRef, isConnected, fetchGitStatus, refreshHistory]);

    const revert = useCallback((path: string) => {
        if (!wsRef.current || !isConnected) return;

        wsRef.current.emit('git:revert', { path }, (response: any) => {
            if (response.success) {
                fetchGitStatus();
            } else {
                alert('Revert failed: ' + response.error);
            }
        });
    }, [wsRef, isConnected, fetchGitStatus]);

    const checkoutBranch = useCallback((branch: string): Promise<boolean> => {
        return new Promise((resolve) => {
            if (!wsRef.current || !isConnected || !branch) {
                resolve(false);
                return;
            }

            setIsSwitchingBranch(true);
            wsRef.current.emit('git:checkout', { branch }, (response: any) => {
                setIsSwitchingBranch(false);
                if (response.success) {
                    fetchGitStatus();
                    fetchBranches();
                    refreshHistory();
                    resolve(true);
                } else {
                    alert(response.error || 'Failed to change branch');
                    resolve(false);
                }
            });
        });
    }, [wsRef, isConnected, fetchGitStatus, fetchBranches, refreshHistory]);

    const stage = useCallback((path: string) => {
        if (!wsRef.current || !isConnected) return;
        wsRef.current.emit('git:stage', { path }, (response: any) => {
            if (response.success) {
                fetchGitStatus();
            } else {
                alert('Stage failed: ' + response.error);
            }
        });
    }, [fetchGitStatus, isConnected, wsRef]);

    const unstage = useCallback((path: string) => {
        if (!wsRef.current || !isConnected) return;
        wsRef.current.emit('git:unstage', { path }, (response: any) => {
            if (response.success) {
                fetchGitStatus();
            } else {
                alert('Unstage failed: ' + response.error);
            }
        });
    }, [fetchGitStatus, isConnected, wsRef]);

    return {
        changedFiles,
        gitBranch,
        branches,
        isSwitchingBranch,
        historyCommits,
        historyFiles,
        historyHasMore,
        isHistoryLoading,
        isHistoryLoaded,
        historyFilesLoading,
        fetchGitStatus,
        fetchBranches,
        fetchHistory,
        searchHistory,
        clearHistorySearch,
        cancelHistorySearch,
        refreshHistory,
        loadMoreHistory,
        fetchHistoryFiles,
        fetchHistoryFileContent,
        handleGitStatusUpdate,
        handleHistorySearchResults,
        commit,
        push,
        pull,
        revert,
        checkoutBranch,
        stage,
        unstage,
    };
};

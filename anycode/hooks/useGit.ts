import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { GitActionState } from '../components/ChangesPanel';
import type { ChangedFile } from '../components/ChangesPanel';

interface ProjectGitUiState {
    gitAvailable: boolean | null;
    branch: string;
    branches: GitBranch[];
    isSwitchingBranch: boolean;
    pushStatus: { state: GitActionState; message?: string };
    lastCommit?: GitLastCommit | null;
}

export type GitLastCommit = {
    timestamp: number;
    authorName: string;
};

type UseGitParams = {
    wsRef: React.RefObject<Socket | null>;
    isConnected: boolean;
    projectId?: string | null;
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
    project_id?: string;
    files: ChangedFile[];
    branch: string;
    head_hash?: string;
};

type GitStatusPatchUpdate = {
    kind: 'patch';
    project_id?: string;
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

const mergeProjectGitFiles = (previous: ChangedFile[], update: GitStatusUpdate): ChangedFile[] => {
    if (update.kind !== 'patch') return sortChangedFiles(update.files || []);
    const next = new Map(previous.map((file) => [file.path, file]));
    for (const item of update.files || []) {
        if (item.status === 'removed') {
            next.delete(item.path);
        } else {
            next.set(item.path, {
                path: item.path,
                project_id: update.project_id,
                status: item.status,
                staged: item.staged,
                unstaged: item.unstaged,
                conflicted: item.conflicted,
                added: item.added,
                removed: item.removed,
            });
        }
    }
    return sortChangedFiles(Array.from(next.values()));
};

export const useGit = ({ wsRef, isConnected, projectId }: UseGitParams) => {
    const activeProjectIdRef = useRef(projectId);
    activeProjectIdRef.current = projectId;
    const [changedFiles, setChangedFiles] = useState<ChangedFile[]>([]);
    const [changedFilesByProject, setChangedFilesByProject] = useState<Record<string, ChangedFile[]>>({});
    const [gitUiByProject, setGitUiByProject] = useState<Record<string, ProjectGitUiState>>({});
    const [gitBranch, setGitBranch] = useState<string>('');
    const [branches, setBranches] = useState<GitBranch[]>([]);
    const [isSwitchingBranch, setIsSwitchingBranch] = useState(false);
    const [pushStatus, setPushStatus] = useState<{ state: GitActionState; message?: string }>({ state: GitActionState.Idle });
    const pushStatusTimersRef = useRef(new Map<string, number>());
    const updateProjectGitUi = useCallback((
        targetProjectId: string | undefined,
        update: Partial<ProjectGitUiState>,
    ) => {
        if (!targetProjectId) return;
        setGitUiByProject((previous) => ({
            ...previous,
            [targetProjectId]: {
                gitAvailable: previous[targetProjectId]?.gitAvailable ?? null,
                branch: previous[targetProjectId]?.branch ?? '',
                branches: previous[targetProjectId]?.branches ?? [],
                isSwitchingBranch: previous[targetProjectId]?.isSwitchingBranch ?? false,
                pushStatus: previous[targetProjectId]?.pushStatus ?? { state: GitActionState.Idle },
                ...update,
            },
        }));
        if (activeProjectIdRef.current !== targetProjectId) return;
        if (update.branch !== undefined) setGitBranch(update.branch);
        if (update.branches !== undefined) setBranches(update.branches);
        if (update.isSwitchingBranch !== undefined) setIsSwitchingBranch(update.isSwitchingBranch);
        if (update.pushStatus !== undefined) setPushStatus(update.pushStatus);
    }, []);
    const showGitStatus = useCallback((
        targetProjectId: string | undefined,
        state: GitActionState,
        message: string,
        timeout = 4000,
    ) => {
        const status = { state, message };
        updateProjectGitUi(targetProjectId, { pushStatus: status });
        if (!targetProjectId || activeProjectIdRef.current === targetProjectId) setPushStatus(status);

        const timerKey = targetProjectId ?? '__active__';
        const existingTimer = pushStatusTimersRef.current.get(timerKey);
        if (existingTimer !== undefined) window.clearTimeout(existingTimer);
        pushStatusTimersRef.current.delete(timerKey);
        if (state !== GitActionState.InProgress) {
            const timer = window.setTimeout(() => {
                updateProjectGitUi(targetProjectId, { pushStatus: { state: GitActionState.Idle } });
                if (!targetProjectId || activeProjectIdRef.current === targetProjectId) {
                    setPushStatus({ state: GitActionState.Idle });
                }
                pushStatusTimersRef.current.delete(timerKey);
            }, timeout);
            pushStatusTimersRef.current.set(timerKey, timer);
        }
    }, [updateProjectGitUi]);
    const [historyCommits, setHistoryCommits] = useState<GitHistoryCommit[]>([]);
    const [historyFiles, setHistoryFiles] = useState<Record<string, GitHistoryFile[]>>({});
    const [historyHasMore, setHistoryHasMore] = useState(false);
    const [isHistoryLoading, setIsHistoryLoading] = useState(false);
    const [isHistoryLoaded, setIsHistoryLoaded] = useState(false);
    const [historyPath, setHistoryPath] = useState<string | null>(null);
    const [historyFilesLoading, setHistoryFilesLoading] = useState<Record<string, boolean>>({});
    const [historyProjectId, setHistoryProjectId] = useState<string | null>(projectId ?? null);
    const isHistoryLoadingRef = useRef(false);
    const historyFilesLoadingRef = useRef(new Set<string>());
    const historyCommitsRef = useRef<GitHistoryCommit[]>([]);
    const historySearchRef = useRef<{ mode: GitHistorySearchMode; query: string } | null>(null);
    const historyPathRef = useRef<string | null>(null);
    const historyProjectIdRef = useRef<string | null>(projectId ?? null);
    const historyResetTimerRef = useRef<number | null>(null);
    const historyRequestIdRef = useRef(0);
    const activeHistorySearchRequestIdRef = useRef<number | null>(null);
    const gitHeadHashRef = useRef<string | undefined>(undefined);
    const statusRequestGenerationRef = useRef(new Map<string, number>());
    const removedProjectIdsRef = useRef(new Set<string>());

    useEffect(() => () => {
        for (const timer of pushStatusTimersRef.current.values()) window.clearTimeout(timer);
        pushStatusTimersRef.current.clear();
    }, []);

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

    const requestHistoryPage = useCallback((
        reset: boolean,
        search: { mode: GitHistorySearchMode; query: string } | null,
        targetProjectId = historyProjectIdRef.current ?? projectId,
    ) => {
        const projectChanged = targetProjectId !== historyProjectIdRef.current;
        if (projectChanged && historySearchRef.current) {
            const nextSearch = search;
            cancelHistorySearch();
            historySearchRef.current = nextSearch;
        }
        if (projectChanged) {
            historyProjectIdRef.current = targetProjectId ?? null;
            setHistoryProjectId(targetProjectId ?? null);
            historyCommitsRef.current = [];
            setHistoryCommits([]);
            setHistoryFiles({});
            setHistoryFilesLoading({});
            historyFilesLoadingRef.current.clear();
            setHistoryHasMore(false);
            setIsHistoryLoaded(false);
            isHistoryLoadingRef.current = false;
            setIsHistoryLoading(false);
            if (historyResetTimerRef.current !== null) {
                window.clearTimeout(historyResetTimerRef.current);
                historyResetTimerRef.current = null;
            }
        }
        if (!targetProjectId) return;
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
            if (historyResetTimerRef.current !== null) {
                window.clearTimeout(historyResetTimerRef.current);
                historyResetTimerRef.current = null;
            }
            historyCommitsRef.current = [];
            setHistoryHasMore(false);
            if (!projectChanged) {
                historyResetTimerRef.current = window.setTimeout(() => {
                    historyResetTimerRef.current = null;
                    if (requestId === historyRequestIdRef.current) {
                        setHistoryCommits([]);
                        setHistoryFiles({});
                    }
                }, 180);
            }
        }
        const event = search ? 'git:history-search' : 'git:history';
        const payload = search
            ? {
                mode: search.mode,
                query: search.query,
                request_id: requestId,
                offset,
                limit: HISTORY_PAGE_SIZE,
                project_id: targetProjectId,
            }
            : {
                offset,
                limit: HISTORY_PAGE_SIZE,
                path: historyPathRef.current || undefined,
                project_id: targetProjectId,
            };
        wsRef.current.emit(event, payload, (response: any) => {
            if (requestId !== historyRequestIdRef.current
                || historyProjectIdRef.current !== targetProjectId) return;
            if (search && response.request_id !== requestId) return;
            if (activeHistorySearchRequestIdRef.current === requestId) {
                activeHistorySearchRequestIdRef.current = null;
            }
            if (historyResetTimerRef.current !== null) {
                window.clearTimeout(historyResetTimerRef.current);
                historyResetTimerRef.current = null;
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
    }, [cancelHistorySearch, isConnected, wsRef, projectId]);

    const handleHistorySearchResults = useCallback((data: { request_id?: number; commits?: GitHistoryCommit[] }) => {
        if (data.request_id !== historyRequestIdRef.current || !activeHistorySearchRequestIdRef.current) return;
        const commits = data.commits || [];
        if (!commits.length) return;
        const nextCommits = [...historyCommitsRef.current, ...commits];
        historyCommitsRef.current = nextCommits;
        setHistoryCommits(nextCommits);
    }, []);

    const fetchHistory = useCallback((reset = true, targetProjectId?: string | null) => {
        if (reset && historySearchRef.current) cancelHistorySearch();
        if (reset) historySearchRef.current = null;
        requestHistoryPage(reset, null, targetProjectId);
    }, [cancelHistorySearch, requestHistoryPage]);

    const showFileHistory = useCallback((path: string, targetProjectId?: string | null) => {
        cancelHistorySearch();
        historySearchRef.current = null;
        historyPathRef.current = path;
        setHistoryPath(path);
        requestHistoryPage(true, null, targetProjectId);
    }, [cancelHistorySearch, requestHistoryPage]);

    const showRepositoryHistory = useCallback((
        targetProjectId = historyProjectIdRef.current ?? projectId,
    ) => {
        cancelHistorySearch();
        historySearchRef.current = null;
        historyPathRef.current = null;
        setHistoryPath(null);
        requestHistoryPage(true, null, targetProjectId);
    }, [cancelHistorySearch, projectId, requestHistoryPage]);

    const searchHistory = useCallback((
        mode: GitHistorySearchMode,
        query: string,
        targetProjectId?: string | null,
    ) => {
        const trimmedQuery = query.trim();
        if (!trimmedQuery) {
            cancelHistorySearch();
            historySearchRef.current = null;
            requestHistoryPage(true, null, targetProjectId);
            return;
        }
        const search = { mode, query: trimmedQuery };
        historySearchRef.current = search;
        requestHistoryPage(true, search, targetProjectId);
    }, [cancelHistorySearch, requestHistoryPage]);

    const clearHistorySearch = useCallback((targetProjectId?: string | null) => {
        cancelHistorySearch();
        historySearchRef.current = null;
        requestHistoryPage(true, null, targetProjectId);
    }, [cancelHistorySearch, requestHistoryPage]);

    const refreshHistory = useCallback((targetProjectId?: string | null) => {
        const current = historySearchRef.current;
        if (!current) {
            requestHistoryPage(true, null, targetProjectId);
            return;
        }
        requestHistoryPage(true, current, targetProjectId);
    }, [requestHistoryPage]);

    const loadMoreHistory = useCallback((targetProjectId?: string | null) => {
        requestHistoryPage(false, historySearchRef.current, targetProjectId);
    }, [requestHistoryPage]);

    const fetchHistoryFiles = useCallback((
        hash: string,
        targetProjectId = historyProjectIdRef.current ?? projectId,
    ) => {
        if (!targetProjectId || !wsRef.current || !isConnected
            || historyFiles[hash]
            || historyFilesLoadingRef.current.has(`${targetProjectId}:${hash}`)) return;
        const requestKey = `${targetProjectId}:${hash}`;
        historyFilesLoadingRef.current.add(requestKey);
        setHistoryFilesLoading((prev) => ({ ...prev, [hash]: true }));
        wsRef.current.emit('git:history-files', { hash, project_id: targetProjectId }, (response: any) => {
            historyFilesLoadingRef.current.delete(requestKey);
            if (historyProjectIdRef.current !== targetProjectId) return;
            setHistoryFilesLoading((prev) => ({ ...prev, [hash]: false }));
            if (response.success) {
                setHistoryFiles((prev) => ({ ...prev, [hash]: response.files || [] }));
            }
        });
    }, [historyFiles, isConnected, wsRef, projectId]);

    const fetchHistoryFileContent = useCallback((
        hash: string,
        file: GitHistoryFile,
        targetProjectId = historyProjectIdRef.current ?? projectId,
    ): Promise<GitHistoryFileContent | null> => (
        new Promise((resolve) => {
            if (!targetProjectId || !wsRef.current || !isConnected) return resolve(null);
            wsRef.current.emit('git:history-file', {
                hash,
                path: file.path,
                old_path: file.old_path || undefined,
                project_id: targetProjectId,
            }, (response: any) => {
                if (historyProjectIdRef.current !== targetProjectId) {
                    resolve(null);
                    return;
                }
                if (!response.success) {
                    alert('Failed to open historical diff: ' + response.error);
                    resolve(null);
                    return;
                }
                resolve(response as GitHistoryFileContent);
            });
        })
    ), [isConnected, wsRef, projectId]);

    // Time and author of the HEAD commit come from the history list (a single commit), not from git status.
    const fetchLastCommit = useCallback((targetProjectId: string | undefined) => {
        if (!targetProjectId || !wsRef.current || !isConnected) return;
        wsRef.current.emit('git:history', { offset: 0, limit: 1, project_id: targetProjectId }, (response: any) => {
            if (!response?.success || removedProjectIdsRef.current.has(targetProjectId)) return;
            const commit = response.commits?.[0];
            updateProjectGitUi(targetProjectId, {
                lastCommit: commit ? { timestamp: commit.timestamp, authorName: commit.author_name ?? '' } : null,
            });
        });
    }, [wsRef, isConnected, updateProjectGitUi]);

    const fetchGitStatus = useCallback((targetProjectId = projectId) => {
        if (!wsRef.current || !isConnected) return;
        if (targetProjectId && removedProjectIdsRef.current.has(targetProjectId)) return;
        const requestedActiveProjectId = activeProjectIdRef.current;
        const requestGeneration = targetProjectId
            ? statusRequestGenerationRef.current.get(targetProjectId) ?? 0
            : undefined;

        wsRef.current.emit('git:status', { project_id: targetProjectId }, (response: any) => {
            if (targetProjectId && (
                removedProjectIdsRef.current.has(targetProjectId)
                || (statusRequestGenerationRef.current.get(targetProjectId) ?? 0) !== requestGeneration
            )) return;
            if (response.success) {
                const responseProjectId = response.project_id ?? targetProjectId ?? undefined;
                if (responseProjectId && removedProjectIdsRef.current.has(responseProjectId)) return;
                const files: ChangedFile[] = sortChangedFiles(response.files || []).map((file) => ({
                    ...file,
                    project_id: responseProjectId,
                }));
                if (responseProjectId) {
                    setChangedFilesByProject((previous) => ({ ...previous, [responseProjectId]: files }));
                    updateProjectGitUi(responseProjectId, {
                        gitAvailable: true,
                        branch: response.branch || '',
                    });
                    fetchLastCommit(responseProjectId);
                }
                if (
                    activeProjectIdRef.current === requestedActiveProjectId
                    && (!responseProjectId || responseProjectId === activeProjectIdRef.current)
                ) {
                    setChangedFiles(files);
                    setGitBranch(response.branch || '');
                    gitHeadHashRef.current = response.head_hash;
                }
            } else {
                if (targetProjectId && removedProjectIdsRef.current.has(targetProjectId)) return;
                if (targetProjectId) {
                    setChangedFilesByProject((previous) => ({ ...previous, [targetProjectId]: [] }));
                    updateProjectGitUi(targetProjectId, {
                        gitAvailable: false,
                        branch: '',
                        branches: [],
                        lastCommit: null,
                    });
                }
                if (
                    activeProjectIdRef.current === requestedActiveProjectId
                    && (!targetProjectId || targetProjectId === activeProjectIdRef.current)
                ) {
                    setChangedFiles([]);
                    setGitBranch('');
                    gitHeadHashRef.current = undefined;
                }
            }
        });
    }, [wsRef, isConnected, projectId, updateProjectGitUi, fetchLastCommit]);

    const fetchOriginalFileContent = useCallback((path: string, targetProjectId = projectId): Promise<string | null> => (
        new Promise((resolve) => {
            if (!wsRef.current || !isConnected) {
                resolve(null);
                return;
            }

            wsRef.current.emit('git:file-original', { path, project_id: targetProjectId }, (response: any) => {
                if (response?.success === false || typeof response?.content !== 'string') {
                    resolve(null);
                    return;
                }
                resolve(response.content);
            });
        })
    ), [isConnected, wsRef, projectId]);

    const branchesRequestIdRef = useRef(new Map<string, number>());
    const fetchBranches = useCallback((targetProjectId = projectId) => {
        if (!wsRef.current || !isConnected) return;
        const requestKey = targetProjectId ?? '__active__';
        const requestId = (branchesRequestIdRef.current.get(requestKey) ?? 0) + 1;
        branchesRequestIdRef.current.set(requestKey, requestId);

        wsRef.current.emit('git:branches', { project_id: targetProjectId }, (response: any) => {
            if (requestId !== branchesRequestIdRef.current.get(requestKey)) return;
            const nextBranches = response.success ? response.branches || [] : [];
            updateProjectGitUi(targetProjectId ?? undefined, { branches: nextBranches });
            if (response.success) {
                if (!targetProjectId || activeProjectIdRef.current === targetProjectId) {
                    setBranches(nextBranches);
                }
            } else if (!targetProjectId || activeProjectIdRef.current === targetProjectId) {
                setBranches([]);
            }
        });
    }, [wsRef, isConnected, projectId, updateProjectGitUi]);

    const handleGitStatusUpdate = useCallback((data: GitStatusUpdate) => {
        if (data.project_id && removedProjectIdsRef.current.has(data.project_id)) return;
        if (data.project_id) {
            setChangedFilesByProject((previous) => ({
                ...previous,
                [data.project_id!]: mergeProjectGitFiles(
                    previous[data.project_id!] || [],
                    data,
                ),
            }));
            updateProjectGitUi(data.project_id, {
                gitAvailable: true,
                branch: data.branch || '',
            });
        }
        const activeProjectId = activeProjectIdRef.current;
        if (activeProjectId && data.project_id && data.project_id !== activeProjectId) return;

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

        const statusProjectId = data.project_id ?? activeProjectId;
        fetchLastCommit(statusProjectId ?? undefined);
        if (headChanged && statusProjectId === historyProjectIdRef.current) {
            refreshHistory(statusProjectId);
        }
    }, [projectId, refreshHistory, updateProjectGitUi, fetchLastCommit]);

    const commit = useCallback((message: string, targetProjectId = projectId): Promise<boolean> => {
        return new Promise((resolve) => {
            if (!wsRef.current || !isConnected) {
                resolve(false);
                return;
            }

            showGitStatus(targetProjectId ?? undefined, GitActionState.InProgress, 'Committing…');
            wsRef.current.emit('git:commit', { message, project_id: targetProjectId }, (response: any) => {
                if (response.success) {
                    showGitStatus(targetProjectId ?? undefined, GitActionState.Success, 'Committed');
                    fetchGitStatus(targetProjectId);
                    if (targetProjectId === historyProjectIdRef.current) refreshHistory(targetProjectId);
                    resolve(true);
                } else {
                    showGitStatus(targetProjectId ?? undefined, GitActionState.Error, 'Commit failed: ' + response.error, 6000);
                    resolve(false);
                }
            });
        });
    }, [wsRef, isConnected, fetchGitStatus, refreshHistory, showGitStatus, projectId]);

    const push = useCallback((targetProjectId = projectId) => {
        const projectPushStatus = targetProjectId
            ? gitUiByProject[targetProjectId]?.pushStatus
            : pushStatus;
        if (!wsRef.current || !isConnected || projectPushStatus?.state === GitActionState.InProgress) return;

        showGitStatus(targetProjectId ?? undefined, GitActionState.InProgress, 'Pushing…');

        wsRef.current.emit('git:push', { project_id: targetProjectId }, (response: any) => {
            if (response.success) {
                showGitStatus(
                    targetProjectId ?? undefined,
                    GitActionState.Success,
                    response.status === 'up_to_date'
                        ? 'Everything up-to-date'
                        : `Pushed ${gitUiByProject[targetProjectId ?? '']?.branch || gitBranch || 'changes'}`,
                );
                fetchGitStatus(targetProjectId);
            } else {
                showGitStatus(targetProjectId ?? undefined, GitActionState.Error, `Push failed: ${response.error}`, 6000);
            }
        });
    }, [wsRef, isConnected, fetchGitStatus, gitBranch, gitUiByProject, pushStatus, showGitStatus, projectId]);

    const pull = useCallback((targetProjectId = projectId) => {
        if (!wsRef.current || !isConnected) return;

        const projectPushStatus = targetProjectId
            ? gitUiByProject[targetProjectId]?.pushStatus
            : pushStatus;
        if (projectPushStatus?.state === GitActionState.InProgress) return;
        showGitStatus(targetProjectId ?? undefined, GitActionState.InProgress, 'Pulling…');
        wsRef.current.emit('git:pull', { project_id: targetProjectId }, (response: any) => {
            if (response.success) {
                const status = response.status;

                if (status === 'up_to_date') {
                    showGitStatus(targetProjectId ?? undefined, GitActionState.Success, 'Already up to date');
                } else if (status === 'fast_forward') {
                    showGitStatus(targetProjectId ?? undefined, GitActionState.Success, 'Fast-forwarded');
                } else if (status === 'merged') {
                    showGitStatus(targetProjectId ?? undefined, GitActionState.Success, 'Merged successfully');
                } else if (status === 'conflict') {
                    const files = response.files || [];
                    showGitStatus(
                        targetProjectId ?? undefined,
                        GitActionState.Error,
                        `Merge conflicts: ${files.join(', ')}. Resolve and commit.`,
                        8000,
                    );
                }

                fetchGitStatus(targetProjectId);
                if (status !== 'conflict' && targetProjectId === historyProjectIdRef.current) {
                    refreshHistory(targetProjectId);
                }
            } else {
                showGitStatus(targetProjectId ?? undefined, GitActionState.Error, 'Pull failed: ' + response.error, 6000);
            }
        });
    }, [wsRef, isConnected, fetchGitStatus, refreshHistory, pushStatus, gitUiByProject, showGitStatus, projectId]);

    const fetchRemote = useCallback((targetProjectId = projectId) => {
        if (!wsRef.current || !isConnected) return;

        const projectPushStatus = targetProjectId
            ? gitUiByProject[targetProjectId]?.pushStatus
            : pushStatus;
        if (projectPushStatus?.state === GitActionState.InProgress) return;
        showGitStatus(targetProjectId ?? undefined, GitActionState.InProgress, 'Fetching…');
        wsRef.current.emit('git:fetch', { project_id: targetProjectId }, (response: any) => {
            if (response.success) {
                showGitStatus(targetProjectId ?? undefined, GitActionState.Success, 'Fetched from origin');
                fetchGitStatus(targetProjectId);
                if (targetProjectId === historyProjectIdRef.current) refreshHistory(targetProjectId);
            } else {
                showGitStatus(targetProjectId ?? undefined, GitActionState.Error, 'Fetch failed: ' + response.error, 6000);
            }
        });
    }, [wsRef, isConnected, fetchGitStatus, refreshHistory, pushStatus, gitUiByProject, showGitStatus, projectId]);


    const revert = useCallback((path: string, targetProjectId = projectId) => {
        if (!wsRef.current || !isConnected) return;

        wsRef.current.emit('git:revert', { path, project_id: targetProjectId }, (response: any) => {
            if (response.success) {
                fetchGitStatus(targetProjectId);
            } else {
                alert('Revert failed: ' + response.error);
            }
        });
    }, [wsRef, isConnected, fetchGitStatus, projectId]);

    const checkoutBranch = useCallback((branch: string, targetProjectId = projectId): Promise<boolean> => {
        return new Promise((resolve) => {
            if (!wsRef.current || !isConnected || !branch || !targetProjectId) {
                resolve(false);
                return;
            }

            updateProjectGitUi(targetProjectId, { isSwitchingBranch: true });
            wsRef.current.emit('git:checkout', { branch, project_id: targetProjectId }, (response: any) => {
                updateProjectGitUi(targetProjectId, { isSwitchingBranch: false });
                if (response.success) {
                    fetchGitStatus(targetProjectId);
                    fetchBranches(targetProjectId);
                    if (targetProjectId === historyProjectIdRef.current) refreshHistory(targetProjectId);
                    resolve(true);
                } else {
                    alert(response.error || 'Failed to change branch');
                    resolve(false);
                }
            });
        });
    }, [wsRef, isConnected, fetchGitStatus, fetchBranches, refreshHistory, projectId, updateProjectGitUi]);

    const stage = useCallback((path: string, targetProjectId = projectId) => {
        if (!wsRef.current || !isConnected) return;
        wsRef.current.emit('git:stage', { path, project_id: targetProjectId }, (response: any) => {
            if (response.success) {
                fetchGitStatus(targetProjectId);
            } else {
                alert('Stage failed: ' + response.error);
            }
        });
    }, [fetchGitStatus, isConnected, wsRef, projectId]);

    const unstage = useCallback((path: string, targetProjectId = projectId) => {
        if (!wsRef.current || !isConnected) return;
        wsRef.current.emit('git:unstage', { path, project_id: targetProjectId }, (response: any) => {
            if (response.success) {
                fetchGitStatus(targetProjectId);
            } else {
                alert('Unstage failed: ' + response.error);
            }
        });
    }, [fetchGitStatus, isConnected, wsRef, projectId]);

    const createBranch = useCallback((branch: string, targetProjectId = projectId): Promise<boolean> => {
        return new Promise((resolve) => {
            const trimmed = branch.trim();
            if (!wsRef.current || !isConnected || !trimmed || !targetProjectId) {
                resolve(false);
                return;
            }

            updateProjectGitUi(targetProjectId, { isSwitchingBranch: true });
            wsRef.current.emit('git:create_branch', { branch: trimmed, project_id: targetProjectId }, (response: any) => {
                updateProjectGitUi(targetProjectId, { isSwitchingBranch: false });
                if (response.success) {
                    fetchGitStatus(targetProjectId);
                    fetchBranches(targetProjectId);
                    if (targetProjectId === historyProjectIdRef.current) refreshHistory(targetProjectId);
                    resolve(true);
                } else {
                    alert(response.error || 'Failed to create branch');
                    resolve(false);
                }
            });
        });
    }, [wsRef, isConnected, fetchGitStatus, fetchBranches, refreshHistory, projectId, updateProjectGitUi]);

    const resetGitState = useCallback(() => {
        cancelHistorySearch();
        setChangedFiles([]);
        setGitBranch('');
        setBranches([]);
        setPushStatus({ state: GitActionState.Idle });
        setHistoryCommits([]);
        setHistoryFiles({});
        setHistoryHasMore(false);
        setIsHistoryLoading(false);
        setIsHistoryLoaded(false);
        setHistoryPath(null);
        setHistoryFilesLoading({});
        isHistoryLoadingRef.current = false;
        historyFilesLoadingRef.current.clear();
        historyProjectIdRef.current = null;
        setHistoryProjectId(null);
        historyRequestIdRef.current += 1;
        historyCommitsRef.current = [];
        historySearchRef.current = null;
        historyPathRef.current = null;
        if (historyResetTimerRef.current !== null) {
            window.clearTimeout(historyResetTimerRef.current);
            historyResetTimerRef.current = null;
        }
        gitHeadHashRef.current = undefined;
    }, [cancelHistorySearch]);

    const restoreProjectStatus = useCallback((targetProjectId: string) => {
        removedProjectIdsRef.current.delete(targetProjectId);
        statusRequestGenerationRef.current.set(
            targetProjectId,
            (statusRequestGenerationRef.current.get(targetProjectId) ?? 0) + 1,
        );
    }, []);

    const removeProjectStatus = useCallback((targetProjectId: string) => {
        removedProjectIdsRef.current.add(targetProjectId);
        statusRequestGenerationRef.current.set(
            targetProjectId,
            (statusRequestGenerationRef.current.get(targetProjectId) ?? 0) + 1,
        );
        if (historyProjectIdRef.current === targetProjectId) {
            cancelHistorySearch();
            historySearchRef.current = null;
            historyProjectIdRef.current = null;
            setHistoryProjectId(null);
            historyCommitsRef.current = [];
            setHistoryCommits([]);
            setHistoryFiles({});
            setHistoryHasMore(false);
            setIsHistoryLoaded(false);
            setHistoryPath(null);
            historyPathRef.current = null;
            setHistoryFilesLoading({});
            historyFilesLoadingRef.current.clear();
            if (historyResetTimerRef.current !== null) {
                window.clearTimeout(historyResetTimerRef.current);
                historyResetTimerRef.current = null;
            }
        }
        setChangedFilesByProject((previous) => {
            if (!(targetProjectId in previous)) return previous;
            const next = { ...previous };
            delete next[targetProjectId];
            return next;
        });
        setGitUiByProject((previous) => {
            if (!(targetProjectId in previous)) return previous;
            const next = { ...previous };
            delete next[targetProjectId];
            return next;
        });
        const timer = pushStatusTimersRef.current.get(targetProjectId);
        if (timer !== undefined) window.clearTimeout(timer);
        pushStatusTimersRef.current.delete(targetProjectId);
        if (activeProjectIdRef.current === targetProjectId) {
            setGitBranch('');
            setBranches([]);
            setIsSwitchingBranch(false);
            setPushStatus({ state: GitActionState.Idle });
        }
    }, [cancelHistorySearch]);

    return {
        changedFiles,
        changedFilesByProject,
        gitUiByProject,
        gitBranch,
        pushStatus,
        branches,
        isSwitchingBranch,
        historyCommits,
        historyFiles,
        historyHasMore,
        isHistoryLoading,
        isHistoryLoaded,
        historyProjectId,
        historyFilesLoading,
        historyPath,
        fetchGitStatus,
        fetchOriginalFileContent,
        fetchBranches,
        fetchHistory,
        showFileHistory,
        showRepositoryHistory,
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
        fetchRemote,
        revert,
        checkoutBranch,
        createBranch,
        stage,
        unstage,
        resetGitState,
        restoreProjectStatus,
        removeProjectStatus,
    };
};

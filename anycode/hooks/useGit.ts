import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { GitActionState } from '../components/ChangesPanel';
import type { ChangedFile } from '../components';
import { getFileName, joinPath } from '../utils';

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

const STATUS_NAMES: Array<ChangedFile['status'] | 'removed'> = [
    'modified',
    'added',
    'deleted',
    'renamed',
    'conflict',
    'removed',
];

export const normalizeGitFileItem = (item: any, dirs?: string[]): ChangedFile => {
    if (Array.isArray(item)) {
        if (dirs && typeof item[0] === 'number') {
            const dir = dirs[item[0]] || '';
            const path = dir ? joinPath(dir, item[1]) : item[1];
            const status = typeof item[2] === 'number' ? (STATUS_NAMES[item[2]] || 'modified') : item[2];
            return {
                path,
                status: status === 'removed' ? 'deleted' : status,
                staged: Boolean(item[3]),
                unstaged: Boolean(item[4]),
                conflicted: Boolean(item[5]),
                added: item[6] || 0,
                removed: item[7] || 0,
            };
        }
        return {
            path: item[0],
            status: item[1],
            staged: Boolean(item[2]),
            unstaged: Boolean(item[3]),
            conflicted: Boolean(item[4]),
            added: item[5] || 0,
            removed: item[6] || 0,
        };
    }
    return item;
};

export const normalizeGitPatchItem = (item: any, dirs?: string[]): GitPatchItem => {
    if (Array.isArray(item)) {
        if (dirs && typeof item[0] === 'number') {
            const dir = dirs[item[0]] || '';
            const path = dir ? joinPath(dir, item[1]) : item[1];
            const status = typeof item[2] === 'number' ? (STATUS_NAMES[item[2]] || 'modified') : item[2];
            return {
                path,
                status,
                staged: Boolean(item[3]),
                unstaged: Boolean(item[4]),
                conflicted: Boolean(item[5]),
                added: item[6] || 0,
                removed: item[7] || 0,
            };
        }
        return {
            path: item[0],
            status: item[1],
            staged: Boolean(item[2]),
            unstaged: Boolean(item[3]),
            conflicted: Boolean(item[4]),
            added: item[5] || 0,
            removed: item[6] || 0,
        };
    }
    return item;
};

const sortChangedFiles = (files: any[], dirs?: string[]): ChangedFile[] => {
    const list = (files || []).map((f) => normalizeGitFileItem(f, dirs));
    return list.sort((a, b) => {
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

export function parseGitPorcelainV2(rawText: string): {
    branch: string;
    headHash?: string;
    files: ChangedFile[];
} {
    const lines = rawText.split('\n');
    let branch = '';
    let headHash: string | undefined;
    const files: ChangedFile[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        if (line.startsWith('# branch.head ')) {
            branch = line.slice(14).trim();
        } else if (line.startsWith('# branch.oid ')) {
            const oid = line.slice(13).trim();
            if (oid && oid !== '(initial)') {
                headHash = oid;
            }
        } else if (line.startsWith('1 ')) {
            const space1 = line.indexOf(' ', 2);
            if (space1 === -1) continue;
            const xy = line.slice(2, space1);

            let pathIdx = space1;
            for (let s = 0; s < 7; s++) {
                pathIdx = line.indexOf(' ', pathIdx + 1);
                if (pathIdx === -1) break;
            }
            if (pathIdx === -1) continue;
            const path = line.slice(pathIdx + 1).trim();

            const staged = xy[0] !== '.';
            const unstaged = xy[1] !== '.';
            const status: ChangedFile['status'] = xy.includes('A')
                ? 'added'
                : xy.includes('D')
                ? 'deleted'
                : 'modified';

            files.push({
                path,
                status,
                staged,
                unstaged,
                conflicted: false,
                added: 0,
                removed: 0,
            });
        } else if (line.startsWith('2 ')) {
            const parts = line.split('\t');
            const mainParts = parts[0].split(' ');
            const xy = mainParts[1] || 'R.';
            const path = mainParts.slice(8).join(' ');
            files.push({
                path,
                status: 'renamed',
                staged: xy[0] !== '.',
                unstaged: xy[1] !== '.',
                conflicted: false,
                added: 0,
                removed: 0,
            });
        } else if (line.startsWith('u ')) {
            const parts = line.split(' ');
            const path = parts.slice(10).join(' ');
            files.push({
                path,
                status: 'conflict',
                staged: false,
                unstaged: true,
                conflicted: true,
                added: 0,
                removed: 0,
            });
        } else if (line.startsWith('? ')) {
            files.push({
                path: line.slice(2).trim(),
                status: 'added',
                staged: false,
                unstaged: true,
                conflicted: false,
                added: 0,
                removed: 0,
            });
        }
    }

    return { branch, headHash, files: sortChangedFiles(files) };
}

export const useGit = ({ wsRef, isConnected }: UseGitParams) => {
    const [changedFiles, setChangedFiles] = useState<ChangedFile[]>([]);
    const [gitBranch, setGitBranch] = useState<string>('');
    const [branches, setBranches] = useState<GitBranch[]>([]);
    const [isSwitchingBranch, setIsSwitchingBranch] = useState(false);
    const [pushStatus, setPushStatus] = useState<{ state: GitActionState; message?: string }>({ state: GitActionState.Idle });
    const showGitStatus = useCallback((state: GitActionState, message: string, timeout = 4000) => {
        setPushStatus({ state, message });
        if (state !== GitActionState.InProgress) window.setTimeout(() => setPushStatus({ state: GitActionState.Idle }), timeout);
    }, []);
    const [historyCommits, setHistoryCommits] = useState<GitHistoryCommit[]>([]);
    const [historyFiles, setHistoryFiles] = useState<Record<string, GitHistoryFile[]>>({});
    const [historyHasMore, setHistoryHasMore] = useState(false);
    const [isHistoryLoading, setIsHistoryLoading] = useState(false);
    const [isHistoryLoaded, setIsHistoryLoaded] = useState(false);
    const [historyPath, setHistoryPath] = useState<string | null>(null);
    const [historyFilesLoading, setHistoryFilesLoading] = useState<Record<string, boolean>>({});
    const isHistoryLoadingRef = useRef(false);
    const historyFilesLoadingRef = useRef(new Set<string>());
    const historyCommitsRef = useRef<GitHistoryCommit[]>([]);
    const historySearchRef = useRef<{ mode: GitHistorySearchMode; query: string } | null>(null);
    const historyPathRef = useRef<string | null>(null);
    const historyResetTimerRef = useRef<number | null>(null);
    const historyRequestIdRef = useRef(0);
    const activeHistorySearchRequestIdRef = useRef<number | null>(null);
    const gitHeadHashRef = useRef<string | undefined>(undefined);
    const gitDiffRequestIdRef = useRef(0);

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
            if (historyResetTimerRef.current !== null) {
                window.clearTimeout(historyResetTimerRef.current);
                historyResetTimerRef.current = null;
            }
            historyCommitsRef.current = [];
            setHistoryHasMore(false);
            historyResetTimerRef.current = window.setTimeout(() => {
                historyResetTimerRef.current = null;
                if (requestId === historyRequestIdRef.current) {
                    setHistoryCommits([]);
                    setHistoryFiles({});
                }
            }, 180);
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
            : { offset, limit: HISTORY_PAGE_SIZE, path: historyPathRef.current || undefined };
        wsRef.current.emit(event, payload, (response: any) => {
            if (requestId !== historyRequestIdRef.current) return;
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

    const showFileHistory = useCallback((path: string) => {
        cancelHistorySearch();
        historySearchRef.current = null;
        historyPathRef.current = path;
        setHistoryPath(path);
        requestHistoryPage(true, null);
    }, [cancelHistorySearch, requestHistoryPage]);

    const showRepositoryHistory = useCallback(() => {
        historyPathRef.current = null;
        setHistoryPath(null);
        requestHistoryPage(true, null);
    }, [requestHistoryPage]);

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

    const streamRawDiff = useCallback((
        staged?: boolean,
        onProgress?: (partialDiff: string) => void,
    ): Promise<string> => {
        return new Promise((resolve) => {
            const socket = wsRef.current;
            if (!socket || !isConnected) {
                resolve('');
                return;
            }

            const decoder = new TextDecoder('utf-8', { fatal: false });
            let textAcc = '';
            let isFirstChunk = true;
            let lastFlushTime = 0;
            let throttleTimer: ReturnType<typeof setTimeout> | null = null;
            let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
            let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
            let isDone = false;
            const requestId = ++gitDiffRequestIdRef.current;

            const flushProgress = (diff: string) => {
                lastFlushTime = Date.now();
                onProgress?.(diff);
            };

            const finish = () => {
                if (isDone) return;
                isDone = true;
                cleanup();
                textAcc += decoder.decode();
                resolve(textAcc);
            };

            const resetInactivityTimer = () => {
                if (inactivityTimer) clearTimeout(inactivityTimer);
                inactivityTimer = setTimeout(() => finish(), 1000);
            };

            const onChunk = (payload: ArrayBuffer | Uint8Array | string | { request_id?: number; chunk?: string }) => {
                if (isDone) return;
                let chunk: ArrayBuffer | Uint8Array | string = payload;
                if (
                    typeof payload === 'object'
                    && payload !== null
                    && !(payload instanceof ArrayBuffer)
                    && !(payload instanceof Uint8Array)
                ) {
                    if (payload.request_id !== requestId) return;
                    chunk = payload.chunk ?? '';
                }
                resetInactivityTimer();
                if (typeof chunk === 'string') {
                    textAcc += chunk;
                } else {
                    const u8 = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
                    textAcc += decoder.decode(u8, { stream: true });
                }

                if (isFirstChunk) {
                    isFirstChunk = false;
                    flushProgress(textAcc);
                } else {
                    const now = Date.now();
                    if (now - lastFlushTime >= 100) {
                        if (throttleTimer) {
                            clearTimeout(throttleTimer);
                            throttleTimer = null;
                        }
                        flushProgress(textAcc);
                    } else if (!throttleTimer) {
                        throttleTimer = setTimeout(() => {
                            throttleTimer = null;
                            flushProgress(textAcc);
                        }, 100 - (now - lastFlushTime));
                    }
                }
            };

            const onEnd = (payload?: { request_id?: number }) => {
                if (payload?.request_id !== undefined && payload.request_id !== requestId) return;
                finish();
            };

            const onDisconnect = () => {
                finish();
            };

            const cleanup = () => {
                if (inactivityTimer) {
                    clearTimeout(inactivityTimer);
                    inactivityTimer = null;
                }
                if (timeoutTimer) {
                    clearTimeout(timeoutTimer);
                    timeoutTimer = null;
                }
                if (throttleTimer) {
                    clearTimeout(throttleTimer);
                    throttleTimer = null;
                }
                socket.off('git:diff:chunk', onChunk);
                socket.off('git:diff:end', onEnd);
                socket.off('disconnect', onDisconnect);
            };

            socket.on('git:diff:chunk', onChunk);
            socket.on('git:diff:end', onEnd);
            socket.on('disconnect', onDisconnect);

            socket.emit('git:diff:stream', { staged, request_id: requestId }, () => {
                finish();
            });

            timeoutTimer = setTimeout(() => {
                finish();
            }, 10000);
        });
    }, [isConnected, wsRef]);

    const streamGitStatus = useCallback((): Promise<ChangedFile[]> => {
        return new Promise((resolve) => {
            const socket = wsRef.current;
            if (!socket || !isConnected) {
                resolve([]);
                return;
            }

            const decoder = new TextDecoder('utf-8', { fatal: false });
            let textAcc = '';
            let isDone = false;
            let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

            const finish = () => {
                if (isDone) return;
                isDone = true;
                cleanup();
                textAcc += decoder.decode();
                const parsed = parseGitPorcelainV2(textAcc);
                setChangedFiles(parsed.files);
                if (parsed.branch) setGitBranch(parsed.branch);
                if (parsed.headHash) gitHeadHashRef.current = parsed.headHash;
                resolve(parsed.files);
            };

            const onChunk = (chunk: ArrayBuffer | Uint8Array | string) => {
                if (isDone) return;
                if (typeof chunk === 'string') {
                    textAcc += chunk;
                } else {
                    const u8 = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
                    textAcc += decoder.decode(u8, { stream: true });
                }
                const parsed = parseGitPorcelainV2(textAcc);
                if (parsed.files.length > 0) {
                    setChangedFiles(parsed.files);
                }
                if (parsed.branch) {
                    setGitBranch(parsed.branch);
                }
            };

            const onEnd = () => {
                finish();
            };

            const cleanup = () => {
                if (timeoutTimer) {
                    clearTimeout(timeoutTimer);
                    timeoutTimer = null;
                }
                socket.off('git:status:chunk', onChunk);
                socket.off('git:status:end', onEnd);
            };

            socket.on('git:status:chunk', onChunk);
            socket.on('git:status:end', onEnd);

            socket.emit('git:status:stream', () => {
                finish();
            });

            timeoutTimer = setTimeout(() => {
                finish();
            }, 10000);
        });
    }, [isConnected, wsRef]);

    const fetchGitStatus = useCallback(() => {
        if (!wsRef.current || !isConnected) return;

        wsRef.current.emit('git:status', {}, (response: any) => {
            if (response.success) {
                setChangedFiles(sortChangedFiles(response.files || [], response.dirs));
                setGitBranch(response.branch || '');
                gitHeadHashRef.current = response.head_hash;
            } else {
                setChangedFiles([]);
                setGitBranch('');
                gitHeadHashRef.current = undefined;
            }
        });
    }, [wsRef, isConnected]);

    const fetchOriginalFileContent = useCallback((path: string): Promise<string | null> => (
        new Promise((resolve) => {
            if (!wsRef.current || !isConnected) {
                resolve(null);
                return;
            }

            wsRef.current.emit('git:file-original', { path }, (response: any) => {
                if (response?.success === false || typeof response?.content !== 'string') {
                    resolve(null);
                    return;
                }
                resolve(response.content);
            });
        })
    ), [isConnected, wsRef]);

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
        const dirs = (data as any).dirs;
        if (data.kind === 'patch') {
            setGitBranch(data.branch || '');
            setChangedFiles((prev) => {
                const next = new Map(prev.map((file) => [file.path, file]));
                let structurallyChanged = false;
                for (const rawItem of (data.files as any[]) || []) {
                    const item = normalizeGitPatchItem(rawItem, dirs);
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
                                ...existing,
                                added: item.added ?? existing.added,
                                removed: item.removed ?? existing.removed,
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
            const nextFiles = sortChangedFiles(data.files || [], dirs);
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

            showGitStatus(GitActionState.InProgress, 'Committing…');
            wsRef.current.emit('git:commit', { message }, (response: any) => {
                if (response.success) {
                    showGitStatus(GitActionState.Success, 'Committed');
                    fetchGitStatus();
                    refreshHistory();
                    resolve(true);
                } else {
                    showGitStatus(GitActionState.Error, 'Commit failed: ' + response.error, 6000);
                    resolve(false);
                }
            });
        });
    }, [wsRef, isConnected, fetchGitStatus, refreshHistory, showGitStatus]);

    const push = useCallback(() => {
        if (!wsRef.current || !isConnected || pushStatus.state === GitActionState.InProgress) return;

            showGitStatus(GitActionState.InProgress, 'Pushing…');

        wsRef.current.emit('git:push', {}, (response: any) => {
            if (response.success) {
                showGitStatus(
                    GitActionState.Success,
                    response.status === 'up_to_date' ? 'Everything up-to-date' : `Pushed ${gitBranch || 'changes'}`,
                );
                fetchGitStatus();
            } else {
                showGitStatus(GitActionState.Error, `Push failed: ${response.error}`, 6000);
            }
        });
    }, [wsRef, isConnected, fetchGitStatus, gitBranch, pushStatus.state, showGitStatus]);

    const pull = useCallback(() => {
        if (!wsRef.current || !isConnected) return;

        if (pushStatus.state === GitActionState.InProgress) return;
        showGitStatus(GitActionState.InProgress, 'Pulling…');
        wsRef.current.emit('git:pull', {}, (response: any) => {
            if (response.success) {
                const status = response.status;

                if (status === 'up_to_date') {
                    showGitStatus(GitActionState.Success, 'Already up to date');
                } else if (status === 'fast_forward') {
                    showGitStatus(GitActionState.Success, 'Fast-forwarded');
                } else if (status === 'merged') {
                    showGitStatus(GitActionState.Success, 'Merged successfully');
                } else if (status === 'conflict') {
                    const files = response.files || [];
                    showGitStatus(
                        GitActionState.Error,
                        `Merge conflicts: ${files.join(', ')}. Resolve and commit.`,
                        8000,
                    );
                }

                fetchGitStatus();
                if (status !== 'conflict') refreshHistory();
            } else {
                showGitStatus(GitActionState.Error, 'Pull failed: ' + response.error, 6000);
            }
        });
    }, [wsRef, isConnected, fetchGitStatus, refreshHistory, pushStatus.state, showGitStatus]);

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

    const fetchRawDiff = useCallback((
        staged?: boolean,
        onProgress?: (partialDiff: string) => void,
    ): Promise<string> => {
        return streamRawDiff(staged, onProgress);
    }, [streamRawDiff]);

    const fetchCommitRawDiff = useCallback((hash: string): Promise<string> => {
        return new Promise((resolve) => {
            if (!wsRef.current || !isConnected) {
                resolve('');
                return;
            }
            wsRef.current.emit('git:commit-diff-raw', { hash }, (response: any) => {
                if (response?.success && typeof response.diff === 'string') {
                    resolve(response.diff);
                } else {
                    resolve('');
                }
            });
        });
    }, [isConnected, wsRef]);

    return {
        changedFiles,
        gitBranch,
        pushStatus,
        branches,
        isSwitchingBranch,
        historyCommits,
        historyFiles,
        historyHasMore,
        isHistoryLoading,
        isHistoryLoaded,
        historyFilesLoading,
        historyPath,
        fetchGitStatus,
        streamGitStatus,
        fetchRawDiff,
        streamRawDiff,
        fetchCommitRawDiff,
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
        revert,
        checkoutBranch,
        stage,
        unstage,
    };
};

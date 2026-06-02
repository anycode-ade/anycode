import { useCallback, useState } from 'react';
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

export const useGit = ({ wsRef, isConnected }: UseGitParams) => {
    const [changedFiles, setChangedFiles] = useState<ChangedFile[]>([]);
    const [gitBranch, setGitBranch] = useState<string>('');
    const [branches, setBranches] = useState<GitBranch[]>([]);
    const [isSwitchingBranch, setIsSwitchingBranch] = useState(false);

    const fetchGitStatus = useCallback(() => {
        if (!wsRef.current || !isConnected) return;

        wsRef.current.emit('git:status', {}, (response: any) => {
            if (response.success) {
                setChangedFiles(response.files || []);
                setGitBranch(response.branch || '');
            } else {
                setChangedFiles([]);
                setGitBranch('');
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
                        if (
                            !existing ||
                            existing.status !== item.status ||
                            existing.staged !== item.staged ||
                            existing.unstaged !== item.unstaged ||
                            existing.conflicted !== item.conflicted ||
                            existing.added !== item.added ||
                            existing.removed !== item.removed
                        ) {
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
                        }
                    }
                }
                if (!structurallyChanged) {
                    return prev;
                }
                return Array.from(next.values());
            });
            return;
        }

        setGitBranch(data.branch || '');
        setChangedFiles((prev) => {
            const nextFiles = data.files || [];
            if (prev.length !== nextFiles.length) {
                return nextFiles;
            }
            let isDifferent = false;
            for (let i = 0; i < prev.length; i++) {
                const a = prev[i];
                const b = nextFiles[i];
                if (
                    a.path !== b.path ||
                    a.status !== b.status ||
                    a.staged !== b.staged ||
                    a.unstaged !== b.unstaged ||
                    a.conflicted !== b.conflicted ||
                    a.added !== b.added ||
                    a.removed !== b.removed
                ) {
                    isDifferent = true;
                    break;
                }
            }
            if (isDifferent) {
                return nextFiles;
            }
            return prev;
        });
    }, []);

    const commit = useCallback((message: string): Promise<boolean> => {
        return new Promise((resolve) => {
            if (!wsRef.current || !isConnected) {
                resolve(false);
                return;
            }

            wsRef.current.emit('git:commit', { message }, (response: any) => {
                if (response.success) {
                    fetchGitStatus();
                    resolve(true);
                } else {
                    alert('Commit failed: ' + response.error);
                    resolve(false);
                }
            });
        });
    }, [wsRef, isConnected, fetchGitStatus]);

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
            } else {
                alert('Pull failed: ' + response.error);
            }
        });
    }, [wsRef, isConnected, fetchGitStatus]);

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
                    resolve(true);
                } else {
                    alert(response.error || 'Failed to change branch');
                    resolve(false);
                }
            });
        });
    }, [wsRef, isConnected, fetchGitStatus, fetchBranches]);

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
        fetchGitStatus,
        fetchBranches,
        handleGitStatusUpdate,
        commit,
        push,
        pull,
        revert,
        checkoutBranch,
        stage,
        unstage,
    };
};

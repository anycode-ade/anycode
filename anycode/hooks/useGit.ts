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
    added?: number;
    removed?: number;
};

type GitStatusFullUpdate = {
    kind?: 'full';
    files: ChangedFile[];
    branch: string;
};

type GitStatusPatchUpdate = {
    kind: 'patch';
    branch: string;
    files: GitPatchItem[];
};

type GitStatusUpdate = GitStatusFullUpdate | GitStatusPatchUpdate;

export const useGit = ({ wsRef, isConnected }: UseGitParams) => {
    const [changedFiles, setChangedFiles] = useState<ChangedFile[]>([]);
    const [gitBranch, setGitBranch] = useState<string>('');

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

    const handleGitStatusUpdate = useCallback((data: GitStatusUpdate) => {
        if (data.kind === 'patch') {
            setGitBranch(data.branch || '');
            setChangedFiles((prev) => {
                const next = new Map(prev.map((file) => [file.path, file]));
                for (const item of data.files || []) {
                    if (item.status === 'removed') {
                        next.delete(item.path);
                    } else {
                        next.set(item.path, {
                            path: item.path,
                            status: item.status,
                            added: item.added,
                            removed: item.removed,
                        });
                    }
                }
                return Array.from(next.values());
            });
            return;
        }

        setChangedFiles(data.files || []);
        setGitBranch(data.branch || '');
    }, []);

    const commit = useCallback((files: string[], message: string): Promise<boolean> => {
        return new Promise((resolve) => {
            if (!wsRef.current || !isConnected) {
                resolve(false);
                return;
            }

            wsRef.current.emit('git:commit', { files, message }, (response: any) => {
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

    return {
        changedFiles,
        gitBranch,
        fetchGitStatus,
        handleGitStatusUpdate,
        commit,
        push,
        pull,
        revert,
    };
};

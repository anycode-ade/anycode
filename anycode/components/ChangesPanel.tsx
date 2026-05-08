import React, { useState, useEffect } from 'react';
import { Icons } from './Icons';
import './ChangesPanel.css';

const COMMIT_MESSAGE_STORAGE_KEY = 'commitMessage';

export interface ChangedFile {
    path: string;
    status: 'modified' | 'added' | 'deleted' | 'renamed' | 'conflict';
    added?: number;
    removed?: number;
}

interface ChangesPanelProps {
    files: ChangedFile[];
    branch: string;
    branches: { name: string; is_current: boolean }[];
    isSwitchingBranch: boolean;
    onFileClick: (path: string) => void;
    onRefresh: () => void;
    onBranchChange: (branch: string) => Promise<boolean>;
    onCommit: (files: string[], message: string) => Promise<boolean>;
    onPush: () => void;
    onPull: () => void;
    onRevert: (path: string) => void;
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

export const ChangesPanel: React.FC<ChangesPanelProps> = ({ 
    files, 
    branch,
    branches,
    isSwitchingBranch,
    onFileClick,
    onRefresh,
    onBranchChange,
    onCommit,
    onPush,
    onPull,
    onRevert
}) => {
    const [message, setMessage] = useState(() => {
        if (typeof window === 'undefined') return '';
        return localStorage.getItem(COMMIT_MESSAGE_STORAGE_KEY) ?? '';
    });
    const [excludedFiles, setExcludedFiles] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (message) {
            localStorage.setItem(COMMIT_MESSAGE_STORAGE_KEY, message);
        } else {
            localStorage.removeItem(COMMIT_MESSAGE_STORAGE_KEY);
        }
    }, [message]);

    // Sync exclude set with current files (remove deleted files)
    useEffect(() => {
        setExcludedFiles(prev => {
            const newExcluded = new Set(prev);
            const currentPaths = new Set(files.map(f => f.path));
            
            for (const path of newExcluded) {
                if (!currentPaths.has(path)) {
                    newExcluded.delete(path);
                }
            }

            return newExcluded;
        });
    }, [files]);

    const toggleExcludedFile = (path: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setExcludedFiles(prev => {
            const next = new Set(prev);
            if (next.has(path)) {
                next.delete(path);
            } else {
                next.add(path);
            }
            return next;
        });
    };

    const filesToCommit = files
        .map((file) => file.path)
        .filter((path) => !excludedFiles.has(path));
    const totalAdded = files.reduce((acc, file) => acc + (file.added ?? 0), 0);
    const totalRemoved = files.reduce((acc, file) => acc + (file.removed ?? 0), 0);

    const handleCommit = async () => {
        if (message.trim() && filesToCommit.length > 0) {
            const success = await onCommit(filesToCommit, message);
            if (success) {
                setMessage('');
            }
        }
    };

    const isAllExcluded = files.length > 0 && excludedFiles.size === files.length;

    const toggleAllExcluded = () => {
        if (isAllExcluded) {
            setExcludedFiles(new Set());
            return;
        }

        setExcludedFiles(new Set(files.map((file) => file.path)));
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
                        disabled={!message.trim() || filesToCommit.length === 0}
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
                        <button
                            className={`changes-exclude-btn changes-exclude-all-btn ${isAllExcluded ? 'excluded' : ''}`}
                            onClick={toggleAllExcluded}
                            title={isAllExcluded ? 'Include all in commit' : 'Exclude all from commit'}
                            aria-label={isAllExcluded ? 'Include all in commit' : 'Exclude all from commit'}
                        >
                            {isAllExcluded ? '+' : '−'}
                        </button>
                    </div>
                </div>
            </div>

            <div className="changes-list">
                {files.length === 0 ? (
                    <div className="changes-empty">
                        No changes
                    </div>
                ) : (
                    files.map((file) => (
                        <div 
                            key={file.path}
                            className={`changes-item ${excludedFiles.has(file.path) ? 'excluded' : ''}`}
                            onClick={() => onFileClick(file.path)}
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
                                        onClick={(e) => {
                                    e.stopPropagation();
                                    const confirmed = window.confirm(
                                        `Revert changes for "${file.path}"? This cannot be undone.`
                                    );
                                    if (confirmed) {
                                        onRevert(file.path);
                                    }
                                }}
                                title="Revert Changes"
                            >
                                ↩
                            </button>
                                    <button
                                        className={`changes-exclude-btn ${excludedFiles.has(file.path) ? 'excluded' : ''}`}
                                        onClick={(e) => toggleExcludedFile(file.path, e)}
                                        title={excludedFiles.has(file.path) ? 'Include in commit' : 'Exclude from commit'}
                                        aria-label={excludedFiles.has(file.path) ? 'Include in commit' : 'Exclude from commit'}
                                    >
                                        {excludedFiles.has(file.path) ? '+' : '−'}
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
                    ))
                )}
            </div>
        </div>
    );
};

import React, { useState, useEffect } from 'react';
import './ChangesPanel.css';

export interface ChangedFile {
    path: string;
    status: 'modified' | 'added' | 'deleted' | 'renamed' | 'conflict';
}

interface ChangesPanelProps {
    files: ChangedFile[];
    branch: string;
    onFileClick: (path: string) => void;
    onRefresh: () => void;
    onCommit: (files: string[], message: string) => void;
    onPush: () => void;
    onPull: () => void;
    onRevert: (path: string) => void;
}

const statusIcons: Record<string, string> = {
    modified: 'M',
    added: 'A',
    deleted: 'D',
    renamed: 'R',
    conflict: '!',
};

const statusColors: Record<string, string> = {
    modified: 'status-modified',
    added: 'status-added',
    deleted: 'status-deleted',
    renamed: 'status-renamed',
    conflict: 'status-conflict',
};

const getDirectory = (path: string): string => {
    const parts = path.split('/');
    if (parts.length <= 1) return '';
    return parts.slice(0, -1).join('/');
};

const getDisplayName = (path: string): string => {
    const normalized = path.replace(/\\/g, '/');
    const parts = normalized.split('/');
    return parts[parts.length - 1] || path;
};

export const ChangesPanel: React.FC<ChangesPanelProps> = ({ 
    files, 
    branch,
    onFileClick,
    onRefresh,
    onCommit,
    onPush,
    onPull,
    onRevert
}) => {
    const [message, setMessage] = useState('');
    const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

    // Initialize selection behavior
    useEffect(() => {
        // If we have files but no selection, select all (initial load scenario)
        // We only do this if the selection is empty to avoid overwriting user choice
        // But we need to handle the case where user deliberately deselected all.
        // Let's just add any *new* files to selection by default?
        // Simpler approach: On mount/files change, ensure we track all files.
        // For now: Just default select all on first load of files.
    }, []);

    // Sync selection with current files (remove deleted files from selection)
    useEffect(() => {
        setSelectedFiles(prev => {
            const newSelection = new Set(prev);
            const currentPaths = new Set(files.map(f => f.path));
            
            // Remove files that are no longer present
            for (const path of newSelection) {
                if (!currentPaths.has(path)) {
                    newSelection.delete(path);
                }
            }
            
            // If previous selection was empty (or we want to default to all), select all
            // This is a bit aggressive, maybe only if size was 0?
            if (prev.size === 0 && files.length > 0) {
                return new Set(files.map(f => f.path));
            }
            
            return newSelection;
        });
    }, [files]);

    const toggleFile = (path: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setSelectedFiles(prev => {
            const next = new Set(prev);
            if (next.has(path)) {
                next.delete(path);
            } else {
                next.add(path);
            }
            return next;
        });
    };

    const handleCommit = () => {
        if (message.trim() && selectedFiles.size > 0) {
            onCommit(Array.from(selectedFiles), message);
            setMessage('');
        }
    };

    const isAllSelected = files.length > 0 && selectedFiles.size === files.length;
    
    const toggleAll = () => {
        if (isAllSelected) {
            setSelectedFiles(new Set());
        } else {
            setSelectedFiles(new Set(files.map(f => f.path)));
        }
    };

    return (
        <div className="changes-panel">
            <div className="changes-panel-title">SOURCE CONTROL</div>
            <div className="changes-header">
                <div className="changes-title">
                    <span className="changes-branch-icon"></span>
                    <span className="changes-branch">{branch || 'HEAD'}</span>
                </div>
                <div className="changes-actions-right">
                    <button 
                        className="changes-action-btn" 
                        onClick={handleCommit}
                        disabled={!message.trim() || selectedFiles.size === 0}
                        title="Commit"
                    >
                        Commit
                    </button>
                    <button className="changes-action-btn" onClick={onPull} title="Pull">
                        Pull
                    </button>
                    <button className="changes-action-btn" onClick={onPush} title="Push">
                        Push
                    </button>
                    <button className="changes-action-btn" onClick={onRefresh} title="Refresh">
                        Refresh
                    </button>
                </div>
            </div>

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
            
            <div className="changes-list-header">
                <div className="changes-list-title">
                     <span className="changes-count">
                        {files.length} changed
                    </span>
                </div>
                <div 
                    className={`changes-checkbox ${isAllSelected ? 'checked' : ''}`} 
                    onClick={toggleAll}
                    title={isAllSelected ? 'Unselect All' : 'Select All'}
                >
                    {isAllSelected && '✓'}
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
                            className={`changes-item ${selectedFiles.has(file.path) ? 'selected' : ''}`}
                            onClick={() => onFileClick(file.path)}
                        >
                            <span className={`changes-status ${statusColors[file.status]}`}>
                                {statusIcons[file.status]}
                            </span>
                            <div className="changes-file-info">
                                <span className="changes-filename">
                                    {getDisplayName(file.path)}
                                </span>
                                <span className="changes-directory">
                                    {getDirectory(file.path)}
                                </span>
                            </div>
                            <button
                                className="changes-revert-btn"
                                onClick={(e) => { e.stopPropagation(); onRevert(file.path); }}
                                title="Discard Changes"
                            >
                                ↩
                            </button>
                            <div 
                                className={`changes-checkbox ${selectedFiles.has(file.path) ? 'checked' : ''}`}
                                onClick={(e) => toggleFile(file.path, e)}
                            >
                                {selectedFiles.has(file.path) && '✓'}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

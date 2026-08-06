import React, { useEffect, useMemo, useState } from 'react';
import { AnycodeEditorReact } from 'anycode-react';
import type { AnycodeEditor } from 'anycode-base';
import { FileIcon } from '../../components/FileIcon';
import type { FileState } from '../../types';
import './MultibufferPanel.css';

export type MultibufferFile = {
    id: string;
    path: string;
    added?: number;
    removed?: number;
    status?: string;
};

type MultibufferPanelProps = {
    panelKey: string;
    files: MultibufferFile[];
    openFiles: FileState[];
    editorStates: ReadonlyMap<string, AnycodeEditor>;
    activeFileId: string | null;
    onSelectFile: (fileId: string, paneId: string) => void;
    onClose: () => void;
    title?: string;
};

const getFileName = (path: string): string => {
    const normalized = path.replace(/\\/g, '/');
    return normalized.split('/').pop() || path;
};

const getFileDirectory = (path: string): string => {
    const normalized = path.replace(/\\/g, '/');
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash >= 0 ? normalized.slice(0, lastSlash) : '';
};

const MultibufferPanel: React.FC<MultibufferPanelProps> = ({
    panelKey,
    files,
    openFiles,
    editorStates,
    activeFileId,
    onSelectFile,
    onClose,
    title = 'Review changes',
}) => {
    const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
    const [layoutVersion, setLayoutVersion] = useState(0);

    const fileById = useMemo(() => new Map(openFiles.map((file) => [file.id, file])), [openFiles]);
    const reviewFiles = useMemo(() => files.filter((file) => file.status !== 'deleted'), [files]);

    useEffect(() => {
        for (const file of reviewFiles) {
            editorStates.get(file.id)?.setDiffMode('diff');
        }

        const frame = requestAnimationFrame(() => setLayoutVersion((version) => version + 1));
        return () => cancelAnimationFrame(frame);
    }, [editorStates, reviewFiles]);

    const toggleCollapsed = (path: string) => {
        setCollapsed((current) => {
            const next = new Set(current);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });
    };

    return (
        <div className="multibuffer-panel">
            <div className="multibuffer-toolbar">
                <div className="multibuffer-toolbar-title">
                    <span className="multibuffer-toolbar-icon">▤</span>
                    <span>{title}</span>
                    <span className="multibuffer-toolbar-count">{files.length} files</span>
                </div>
                <button className="multibuffer-close" onClick={onClose} title="Close multibuffer">
                    Close review
                </button>
            </div>

            <div className="multibuffer-scroll">
                {files.length === 0 ? (
                    <div className="multibuffer-empty">No changes</div>
                ) : reviewFiles.map((file) => {
                    const editor = editorStates.get(file.id);
                    const fileState = fileById.get(file.id);
                    const isCollapsed = collapsed.has(file.id);
                    const isActive = activeFileId === file.id;
                    const contentHeight = editor?.getContentHeight() ?? 0;
                    const editorHeight = Math.max(120, contentHeight + 8);

                    return (
                        <section
                            className={`multibuffer-section${isActive ? ' is-active' : ''}${isCollapsed ? ' is-collapsed' : ''}`}
                            key={file.id}
                        >
                            <button
                                className="multibuffer-file-header"
                                onClick={() => {
                                    toggleCollapsed(file.id);
                                    if (fileState) onSelectFile(file.id, panelKey);
                                }}
                                type="button"
                            >
                                <span className="multibuffer-chevron">{isCollapsed ? '›' : '⌄'}</span>
                                <FileIcon path={file.path} styleType="colored" className="multibuffer-file-icon" />
                                <span className="multibuffer-file-name">{getFileName(file.path)}</span>
                                <span className="multibuffer-file-path">{getFileDirectory(file.path)}</span>
                                <span className="multibuffer-file-stats">
                                    <span className="multibuffer-added">+{file.added ?? 0}</span>
                                    <span className="multibuffer-removed">−{file.removed ?? 0}</span>
                                </span>
                            </button>

                            {!isCollapsed && (
                                editor ? (
                                    <div className="multibuffer-editor-shell" style={{ height: `${editorHeight}px` }}>
                                        <AnycodeEditorReact
                                            id={`multibuffer-${file.path}`}
                                            editorState={editor}
                                            forceUpdateTrigger={layoutVersion}
                                        />
                                    </div>
                                ) : (
                                    <div className="multibuffer-file-loading">Loading file…</div>
                                )
                            )}
                        </section>
                    );
                })}
                {files.some((file) => file.status === 'deleted') && (
                    <section className="multibuffer-section multibuffer-deleted-section">
                        <div className="multibuffer-file-header multibuffer-file-header-static">
                            <span className="multibuffer-chevron">›</span>
                            <span className="multibuffer-file-name">Deleted files</span>
                            <span className="multibuffer-file-path">not available in workspace</span>
                        </div>
                        <div className="multibuffer-file-loading">
                            {files.filter((file) => file.status === 'deleted').map((file) => file.path).join(', ')}
                        </div>
                    </section>
                )}
            </div>
        </div>
    );
};

export default MultibufferPanel;

import React, { useEffect, useState, useCallback } from 'react';
import { Icons } from './Icons';
import {
    getWorkspaceState,
    getCachedWorkspaceState,
    openFolderDialog,
    openWorkspace,
    removeRecentWorkspace,
    type RecentWorkspace,
} from '../workspace';
import { announceWarp, formatRelativeTime } from '../utils';
import { isTauri } from '../constants';
import { DynamicBackground } from './DynamicBackground';
import type { DynamicBackgroundSettings } from '../hooks/useSettings';
import './WelcomeScreen.css';

interface WelcomeScreenProps {
    onOpenFolder?: () => void;
    onSelectWorkspace?: (path: string) => void;
    backgroundSettings?: DynamicBackgroundSettings;
    hideBackground?: boolean;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
    onOpenFolder,
    onSelectWorkspace,
    backgroundSettings,
    hideBackground = false,
}) => {
    const screenRef = React.useRef<HTMLDivElement | null>(null);
    const contentRef = React.useRef<HTMLDivElement | null>(null);
    const [recentProjects, setRecentProjects] = useState<RecentWorkspace[]>(() => {
        return getCachedWorkspaceState()?.recent_workspaces || [];
    });
    const [isLoading, setIsLoading] = useState<boolean>(() => {
        return !getCachedWorkspaceState();
    });

    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (!screenRef.current) return;
        const rect = screenRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        screenRef.current.style.setProperty('--mouse-x', `${x}px`);
        screenRef.current.style.setProperty('--mouse-y', `${y}px`);
    }, []);

    const handleMouseLeave = useCallback(() => {
        if (!screenRef.current) return;
        screenRef.current.style.setProperty('--mouse-x', '50%');
        screenRef.current.style.setProperty('--mouse-y', '45%');
    }, []);

    const loadRecent = useCallback(async () => {
        try {
            const state = await getWorkspaceState();
            setRecentProjects(state.recent_workspaces || []);
        } catch (e) {
            console.error('Failed to load recent projects:', e);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        loadRecent();
    }, [loadRecent]);

    const handleOpenFolder = useCallback(async () => {
        if (onOpenFolder) {
            onOpenFolder();
        } else {
            await openFolderDialog();
        }
    }, [onOpenFolder]);

    const warpJump = backgroundSettings?.warpJump ?? true;

    const handleSelectRecent = useCallback(async (path: string) => {
        if (warpJump) announceWarp();
        if (onSelectWorkspace) {
            onSelectWorkspace(path);
        } else {
            await openWorkspace(path);
        }
    }, [onSelectWorkspace, warpJump]);

    const handleRemoveRecent = useCallback(async (e: React.MouseEvent, path: string) => {
        e.stopPropagation();
        const updated = await removeRecentWorkspace(path);
        setRecentProjects(updated.recent_workspaces || []);
    }, []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'o') {
                e.preventDefault();
                handleOpenFolder();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleOpenFolder]);

    useEffect(() => {
        const handleWarpPop = () => {
            if (contentRef.current) {
                contentRef.current.style.transform = 'scale(1.08) translateZ(24px)';
                setTimeout(() => {
                    if (contentRef.current) {
                        contentRef.current.style.transform = 'scale(1) translateZ(0px)';
                    }
                }, 400);
            }
        };

        window.addEventListener('anycode:warp-speed', handleWarpPop);
        return () => window.removeEventListener('anycode:warp-speed', handleWarpPop);
    }, []);

    const isDynamicEnabled = backgroundSettings?.enabled ?? true;

    return (
        <div
            ref={screenRef}
            className="welcome-screen"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
        >
            {!hideBackground && (isDynamicEnabled && backgroundSettings ? (
                <DynamicBackground
                    settings={backgroundSettings}
                    tiltTargetRef={contentRef}
                />
            ) : (
                <div className="welcome-dots" />
            ))}
            <div ref={contentRef} className="welcome-container">
                <div className="welcome-header">
                    <h1 className="welcome-title">ANYCODE</h1>
                </div>

                <div className="welcome-recent-section">
                    <div className="welcome-recent-header">
                        <div className="welcome-recent-header-left">
                            <span className="welcome-recent-title">Recent Projects</span>
                            {recentProjects.length > 0 && (
                                <span className="welcome-recent-count">{recentProjects.length}</span>
                            )}
                        </div>
                        <button
                            type="button"
                            className="welcome-btn-native"
                            onClick={handleOpenFolder}
                            title="Open folder (⌘O)"
                        >
                            <Icons.FolderOpen size={13} />
                            <span>Open</span>
                            <span className="welcome-shortcut">⌘O</span>
                        </button>
                    </div>

                    {isLoading ? (
                        <div className="welcome-loading">Loading projects...</div>
                    ) : recentProjects.length === 0 ? (
                        <div className="welcome-empty">
                            <p>No recent projects yet.</p>
                            <p className="welcome-empty-hint">Open a folder to start working with your code.</p>
                        </div>
                    ) : (
                        <div className="welcome-recent-list">
                            {recentProjects.map((project) => (
                                <div
                                    key={project.path}
                                    className="welcome-recent-item"
                                    onClick={() => handleSelectRecent(project.path)}
                                    role="button"
                                    tabIndex={0}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            handleSelectRecent(project.path);
                                        }
                                    }}
                                >
                                    <div className="welcome-recent-icon">
                                        <Icons.Folder size={16} />
                                    </div>
                                    <div className="welcome-recent-info">
                                        <div className="welcome-recent-name">{project.name}</div>
                                        <div className="welcome-recent-path" title={project.path}>
                                            {project.path}
                                        </div>
                                    </div>
                                    <div className="welcome-recent-meta">
                                        {project.last_opened > 0 && (
                                            <span className="welcome-recent-time">
                                                {formatRelativeTime(project.last_opened)}
                                            </span>
                                        )}
                                        <button
                                            type="button"
                                            className="welcome-recent-remove"
                                            onClick={(e) => handleRemoveRecent(e, project.path)}
                                            title="Remove from recent"
                                        >
                                            <Icons.CloseSmall size={14} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

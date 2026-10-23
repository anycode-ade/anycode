import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import 'dockview-react/dist/styles/dockview.css';
import { ChangesPanel, HistoryPanel, type ChangedFile, SettingsPanel, DynamicBackground } from './components';
import Search from './components/Search';
import { Layout, type LayoutActions, type PanelId } from './components/layout/Layout';
import { Toolbar } from './components/toolbar/Toolbar';
import {
    getAllAgents,
    getDefaultAgentId,
    ensureDefaultAgents,
    updateAgents,
} from './agents';
import { AcpAgent, type SearchMatch } from './types';
import './App.css';
import {
    saveItem,
} from './storage';
import { useSocket } from './hooks/useSocket';
import { useGit, type GitHistoryFile } from './hooks/useGit';
import { useSearch } from './hooks/useSearch';
import { useFileTree } from './hooks/useFileTree';
import { useTerminals } from './hooks/useTerminals';
import { getHistoricalFileId, useEditors, type EditorSelectionRange } from './hooks/useEditors';
import { useAgents } from './hooks/useAgents';
import { useLayout } from './hooks/useLayout';
import { useTheme } from './hooks/useTheme';
import { useZoom } from './hooks/useZoom';
import { useEvent } from './hooks/useEvent';
import { useTerminalPanes } from './features/terminal/useTerminalPanes';
import { useAgentPanes } from './features/agents/useAgentPanes';
import { FilesPanel } from './features/files/FilesPanel';
import { EditorPanel } from './features/editor/EditorPanel';
import type { MultibufferFile } from './features/editor/MultibufferPanel';
import { TerminalPanel } from './features/terminal/TerminalPanel';
import { AgentPanel } from './features/agents/AgentPanel';
import { BrowserPanel } from './features/browser/BrowserPanel';
import { type DiffMode } from './types/diffMode';
import { announceWarp, getLanguageFromFileName, normalizePath, uriToFilePath } from './utils';
import { useSettings } from './hooks/useSettings';
import { isTauri, warpCssVars, warpSwapMs } from './constants';
import { WelcomeScreen } from './components/WelcomeScreen';
import {
    addRemoteProject,
    closeRemoteWorkspace,
    getRemoteWorkspaceState,
    openFolderDialog,
    openWorkspace,
    removeRemoteRecentWorkspace,
    removeRemoteProject,
    selectRemoteProject,
    type WorkspaceState,
    type WorkspaceProject,
} from './workspace';
import { ServerFolderPicker } from './components/ServerFolderPicker';

const toMultibufferFiles = (files: ChangedFile[]): MultibufferFile[] => files.map((file) => ({
    id: file.path,
    path: file.path,
    added: file.added,
    removed: file.removed,
    status: file.status,
}));

const pathBelongsToProject = (path: string, root: string) => {
    const normalizedPath = normalizePath(path);
    const normalizedRoot = normalizePath(root).replace(/\/+$/, '');
    return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
};

type ReviewSession = {
    projectId: string;
    files: MultibufferFile[];
    title: string;
    ignoreEdits: boolean;
    openedByReview: string[];
    activeFileId: string | null;
    focusRequest?: { path: string; line?: number; column?: number; token: number };
};

const ACTIVE_PROJECT_SESSION_KEY = 'anycode.activeProjectId';
const SEARCH_PROJECT_SESSION_KEY = 'anycode.searchProjectId';
const CHANGES_PROJECT_SESSION_KEY = 'anycode.changesProjectId';
const HISTORY_PROJECT_SESSION_KEY = 'anycode.historyProjectId';

/** Project selection for a panel, restored from sessionStorage so it survives a page reload. */
function usePanelProjectId(storageKey: string) {
    const [projectId, setProjectIdState] = useState<string | null>(() => sessionStorage.getItem(storageKey));
    const setProjectId = useCallback((next: string | null) => {
        setProjectIdState(next);
        if (next) sessionStorage.setItem(storageKey, next);
        else sessionStorage.removeItem(storageKey);
    }, [storageKey]);
    return [projectId, setProjectId] as const;
}

interface AppProps {
    /** Active workspace path reported by the backend; null shows the Welcome screen. */
    initialWorkspace: string | null;
}

const App: React.FC<AppProps> = ({ initialWorkspace }) => {
    const { wsRef, isConnected, connectionStatus, connectToBackend } = useSocket({});
    const [showConnectionBanner, setShowConnectionBanner] = React.useState(false);
    const settings = useSettings();
    const [workspacePath, setWorkspacePath] = useState<string | null>(initialWorkspace);
    const [workspaceState, setWorkspaceState] = useState<WorkspaceState>({
        projects: [],
        active_project_id: null,
        recent_workspaces: [],
    });
    const [changesProjectId, setChangesProjectId] = usePanelProjectId(CHANGES_PROJECT_SESSION_KEY);
    const [historyProjectId, setHistoryProjectId] = usePanelProjectId(HISTORY_PROJECT_SESSION_KEY);
    const [searchProjectId, setSearchProjectId] = usePanelProjectId(SEARCH_PROJECT_SESSION_KEY);
    const [folderPicker, setFolderPicker] = useState<{ anchor: HTMLElement | null } | null>(null);
    const [warpDirection, setWarpDirection] = useState<'closing' | null>(null);
    const isWarping = warpDirection !== null;
    const activeProjectId = workspaceState.active_project_id;
    const selectedSearchProjectId = workspaceState.projects.some(
        (project) => project.id === searchProjectId,
    )
        ? searchProjectId
        : workspaceState.projects.find((project) => project.id === activeProjectId)?.id
            ?? workspaceState.projects[0]?.id
            ?? null;
    const isWorkspaceOpen = workspaceState.projects.length > 0 || Boolean(workspacePath);
    // Projects load asynchronously after a reload; don't drop a restored selection while the list is empty.
    useEffect(() => {
        if (
            changesProjectId
            && workspaceState.projects.length > 0
            && !workspaceState.projects.some((project) => project.id === changesProjectId)
        ) {
            setChangesProjectId(null);
        }
    }, [changesProjectId, workspaceState.projects]);
    useEffect(() => {
        if (
            historyProjectId
            && workspaceState.projects.length > 0
            && !workspaceState.projects.some((project) => project.id === historyProjectId)
        ) {
            setHistoryProjectId(null);
        }
    }, [historyProjectId, workspaceState.projects]);
    const projectLifecycleVersionsRef = useRef(new Map<string, number>());
    const bumpProjectLifecycleVersion = useCallback((projectId: string) => {
        const version = (projectLifecycleVersionsRef.current.get(projectId) ?? 0) + 1;
        projectLifecycleVersionsRef.current.set(projectId, version);
        return version;
    }, []);
    const isCurrentProjectLifecycleVersion = useCallback((projectId: string, version: number) => (
        projectLifecycleVersionsRef.current.get(projectId) === version
    ), []);

    const [fileIconsStyle, setFileIconsStyle] = React.useState<'colored' | 'monochrome' | 'disabled'>(() => {
        if (typeof window === 'undefined') return 'colored';
        return (localStorage.getItem('fileIconsStyle') as any) || 'colored';
    });

    const [fileIconsOpacity, setFileIconsOpacity] = React.useState<number>(() => {
        if (typeof window === 'undefined') return 0.85;
        const saved = localStorage.getItem('fileIconsOpacity');
        return saved !== null ? parseFloat(saved) : 0.85;
    });

    const fileTree = useFileTree({ wsRef, isConnected });
    const editors = useEditors({ wsRef, isConnected });
    const terminals = useTerminals({ wsRef, isConnected });
    const  terminalPanes = useTerminalPanes({
        terminals: terminals.terminals,
        addTerminal: terminals.addTerminal,
        closeTerminal: terminals.closeTerminal,
    });
    const git = useGit({ wsRef, isConnected, projectId: activeProjectId });
    const search = useSearch({ wsRef, isConnected, projectId: selectedSearchProjectId });
    const agents = useAgents({ wsRef, isConnected, projectId: activeProjectId });
    const refreshProjectGit = useEvent((projectId: string, restoreStatus = false) => {
        if (restoreStatus) git.restoreProjectStatus(projectId);
        git.fetchGitStatus(projectId);
        git.fetchBranches(projectId);
    });
    const refreshProjectGitStatus = useEvent((projectId: string, restoreStatus = false) => {
        if (restoreStatus) git.restoreProjectStatus(projectId);
        git.fetchGitStatus(projectId);
        git.fetchBranches(projectId);
    });
    const { currentThemeId, handleThemeChange } = useTheme({ wsRef, isConnected });
    useZoom();
    const layoutActionsRef = useRef<LayoutActions | null>(null);
    const [multibufferReviews, setMultibufferReviews] = React.useState<Record<string, ReviewSession>>({});
    const [markdownPreviews, setMarkdownPreviews] = React.useState<Record<string, boolean>>({});
    const activeReview = multibufferReviews[editors.activeEditorPaneId];
    const activeReviewFile = activeReview?.files.find((file) => file.id === activeReview.activeFileId);
    const activeContextFileId = activeReviewFile?.id ?? editors.activeFileId;
    const activeContextFilePath = activeReviewFile?.path ?? editors.activeFileId;

    useEffect(() => {
        if (connectionStatus === 'connected') {
            setShowConnectionBanner(false);
            return;
        }

        const timeout = window.setTimeout(() => {
            setShowConnectionBanner(true);
        }, 750);

        return () => window.clearTimeout(timeout);
    }, [connectionStatus]);

    const handleWatcherRemove = useEvent((data: { path: string; isFile: boolean; project_id?: string }) => {
        const project = workspaceState.projects.find((item) => (
            data.project_id ? item.id === data.project_id : pathBelongsToProject(data.path, item.root)
        ));
        if (!project) return;
        fileTree.handleWatcherRemove(data);
        if (data.isFile) editors.closeFile(data.path);
        else editors.closeFilesUnderPath(data.path);
        git.fetchGitStatus(project.id);

        setMultibufferReviews((previous) => {
            let changed = false;
            const next = { ...previous };
            for (const [paneId, review] of Object.entries(previous)) {
                if (review.ignoreEdits) continue;
                const files = review.files.filter((file) => file.id !== data.path);
                if (files.length === review.files.length) continue;
                next[paneId] = {
                    ...review,
                    files,
                    openedByReview: review.openedByReview.filter((fileId) => fileId !== data.path),
                    activeFileId: review.activeFileId === data.path
                        ? (files[0]?.id ?? null)
                        : review.activeFileId,
                };
                changed = true;
            }
            return changed ? next : previous;
        });
    });

    const handleWatcherCreate = useEvent((data: { path: string; isFile: boolean; project_id?: string }) => {
        const project = workspaceState.projects.find((item) => (
            data.project_id ? item.id === data.project_id : pathBelongsToProject(data.path, item.root)
        ));
        if (!project) return;
        fileTree.handleWatcherCreate(data);
        if (!data.isFile) return;

        setMultibufferReviews((previous) => {
            let changed = false;
            const next = { ...previous };
            for (const [paneId, review] of Object.entries(previous)) {
                if (
                    review.ignoreEdits
                    || review.projectId !== project.id
                    || review.files.some((file) => file.id === data.path)
                ) continue;
                next[paneId] = {
                    ...review,
                    files: [...review.files, {
                        id: data.path,
                        path: data.path,
                        status: 'added',
                        added: 0,
                        removed: 0,
                    }],
                    openedByReview: editors.editorStates.has(data.path)
                        ? review.openedByReview
                        : [...review.openedByReview, data.path],
                };
                changed = true;
            }
            return changed ? next : previous;
        });
    });

    const handleFileRenamed = useEvent((data: { old: string; new: string; project_id?: string }) => {
        if (!workspaceState.projects.some((project) => (
            data.project_id
                ? project.id === data.project_id
                : pathBelongsToProject(data.old, project.root) || pathBelongsToProject(data.new, project.root)
        ))) return;
        fileTree.handleFileRenamed(data);
        editors.renameFilesUnderPath(data.old, data.new);
    });

    const discardReviewFilesUnderProject = useCallback((root: string) => {
        setMultibufferReviews((previous) => {
            let changed = false;
            const next = { ...previous };
            for (const [paneId, review] of Object.entries(previous)) {
                const files = review.files.filter((file) => !pathBelongsToProject(file.path, root));
                if (files.length === review.files.length) continue;
                changed = true;
                if (files.length === 0) {
                    delete next[paneId];
                    continue;
                }
                next[paneId] = {
                    ...review,
                    files,
                    openedByReview: review.openedByReview.filter((path) => !pathBelongsToProject(path, root)),
                    activeFileId: files.some((file) => file.id === review.activeFileId)
                        ? review.activeFileId
                        : files[0].id,
                };
            }
            return changed ? next : previous;
        });
    }, []);

    const clearProjectUiState = useCallback((
        projects: WorkspaceProject[],
        projectIds = projects.map((project) => project.id),
    ) => {
        const knownProjectIds = new Set(projects.map((project) => project.id));
        for (const project of projects) {
            fileTree.removeProjectRoot(project.id);
            git.removeProjectStatus(project.id);
            terminals.removeProjectTerminals(project.id);
            agents.removeProjectSessions(project.id);
            editors.closeFilesUnderPath(project.root);
            discardReviewFilesUnderProject(project.root);
        }
        for (const projectId of projectIds) {
            if (knownProjectIds.has(projectId)) continue;
            git.removeProjectStatus(projectId);
            terminals.removeProjectTerminals(projectId);
            agents.removeProjectSessions(projectId);
        }
        if (projectIds.includes(activeProjectId ?? '')) {
            search.cancelSearch();
            search.clearResults();
        }
    }, [
        fileTree.removeProjectRoot,
        git.removeProjectStatus,
        terminals.removeProjectTerminals,
        agents.removeProjectSessions,
        editors.closeFilesUnderPath,
        discardReviewFilesUnderProject,
        activeProjectId,
        search.cancelSearch,
        search.clearResults,
    ]);

    useEffect(() => {
        const ws = wsRef.current;
        if (!ws || !isConnected) return;

        const events = [
            ['lsp:diagnostics', editors.handleDiagnostics],
            ['watcher:edits', editors.handleWatcherEdits],
            ['watcher:create', handleWatcherCreate],
            ['watcher:remove', handleWatcherRemove],
            ['file:renamed', handleFileRenamed],
            ['git:update', git.handleGitStatusUpdate],
            ['git:history-search:results', git.handleHistorySearchResults],
            ['git:update', editors.handleGitUpdate],
            ['acp:message', agents.handleAcpMessage],
            ['acp:history', agents.handleAcpHistory],
            ['acp:queue', agents.handleAcpQueue],
            ['search:results', search.handleSearchResults],
            ['search:end', search.handleSearchEnd],
        ] as const;

        events.forEach(([event, handler]) => ws.on(event, handler));
        return () => {
            events.forEach(([event, handler]) => ws.off(event, handler));
        };
    }, [
        wsRef,
        isConnected,
        editors.handleDiagnostics,
        editors.handleWatcherEdits,
        editors.handleGitUpdate,
        handleWatcherCreate,
        handleWatcherRemove,
        handleFileRenamed,
        git.handleGitStatusUpdate,
        git.handleHistorySearchResults,
        agents.handleAcpMessage,
        agents.handleAcpHistory,
        agents.handleAcpQueue,
        search.handleSearchResults,
        search.handleSearchEnd,
    ]);

    const acceptWorkspaceState = useCallback((next: WorkspaceState) => {
        setWorkspaceState(next);
        const selected = next.projects.find((project) => project.id === next.active_project_id);
        setWorkspacePath(selected?.root ?? next.projects[0]?.root ?? null);
        if (next.active_project_id) {
            sessionStorage.setItem(ACTIVE_PROJECT_SESSION_KEY, next.active_project_id);
        } else {
            sessionStorage.removeItem(ACTIVE_PROJECT_SESSION_KEY);
        }
    }, []);

    const handleAddProjectPath = useCallback(async (path: string) => {
        const socket = wsRef.current;
        if (!socket || !isConnected) return;
        try {
            const next = await addRemoteProject(socket, path);
            acceptWorkspaceState(next);
            const project = next.projects.find((item) => item.id === next.active_project_id)
                ?? next.projects.find((item) => item.root === path);
            if (project) {
                bumpProjectLifecycleVersion(project.id);
                fileTree.openFolder(project.root);
                refreshProjectGit(project.id, true);
            }
        } catch (error) {
            console.error('Failed to add project folder:', error);
            window.alert(error instanceof Error ? error.message : 'Failed to add project folder.');
        }
    }, [wsRef, isConnected, acceptWorkspaceState, fileTree.openFolder, refreshProjectGit, bumpProjectLifecycleVersion]);

    // Web builds pop the server folder picker out of the element that opened it; Tauri uses the native dialog.
    const openFolderPicker = useCallback(async (anchor: HTMLElement | null) => {
        if (isTauri) {
            const picked = await openFolderDialog();
            if (picked) await handleAddProjectPath(picked);
            return;
        }
        setFolderPicker({ anchor });
    }, [handleAddProjectPath]);

    const handleOpenFolderClick = useCallback(() => openFolderPicker(null), [openFolderPicker]);

    const handleSelectWorkspace = useCallback(async (path: string) => {
        if (!wsRef.current || !isConnected) return;
        try {
            const selectedPath = isTauri ? await openWorkspace(path) : path;
            if (selectedPath) await handleAddProjectPath(selectedPath);
        } catch (error) {
            window.alert(error instanceof Error ? error.message : 'Failed to open project folder.');
        }
    }, [wsRef, isConnected, handleAddProjectPath]);

    // Closing the workspace swaps the project view for the welcome screen. With warp jump on, the project view
    // warps out while the close request runs, and the welcome screen warps in once the new state is accepted.
    const runWithCloseWarp = useCallback(async (
        closesWorkspace: boolean,
        request: () => Promise<WorkspaceState>,
    ): Promise<WorkspaceState> => {
        const { warpJump, warpDurationMs } = settings.backgroundSettings;
        if (!closesWorkspace || !warpJump) return request();
        announceWarp();
        setWarpDirection('closing');
        window.setTimeout(() => {
            (window as any).__ANYCODE_IS_WARPING__ = false;
            setWarpDirection(null);
        }, warpDurationMs);
        const swapped = new Promise<void>((resolve) => window.setTimeout(resolve, warpSwapMs(warpDurationMs)));
        const [next] = await Promise.all([request(), swapped]);
        return next;
    }, [settings.backgroundSettings]);

    const handleRemoveProject = useCallback(async (projectId: string) => {
        const socket = wsRef.current;
        if (!socket || !isConnected) return;
        try {
            const removed = workspaceState.projects.find((project) => project.id === projectId);
            // Removing the last project leaves no workspace, so it shows the welcome screen.
            const next = await runWithCloseWarp(
                workspaceState.projects.length === 1,
                () => removeRemoteProject(socket, projectId),
            );
            bumpProjectLifecycleVersion(projectId);
            acceptWorkspaceState(next);
            clearProjectUiState(removed ? [removed] : [], [projectId]);
        } catch (error) {
            window.alert(error instanceof Error ? error.message : 'Failed to remove project.');
        }
    }, [wsRef, isConnected, workspaceState.projects, acceptWorkspaceState, clearProjectUiState,
        bumpProjectLifecycleVersion, runWithCloseWarp]);

    const handleSelectProject = useCallback(async (projectId: string) => {
        if (!wsRef.current || !isConnected) return;
        try {
            const next = await selectRemoteProject(wsRef.current, projectId);
            acceptWorkspaceState(next);
            refreshProjectGit(projectId);
        } catch (error) {
            console.error('Failed to select project:', error);
        }
    }, [wsRef, isConnected, acceptWorkspaceState, refreshProjectGit]);

    const handleCloseWorkspace = useCallback(async () => {
        const socket = wsRef.current;
        if (!socket || !isConnected) return;
        try {
            const closingProjects = workspaceState.projects;
            const next = await runWithCloseWarp(true, () => closeRemoteWorkspace(socket));
            for (const project of closingProjects) bumpProjectLifecycleVersion(project.id);
            clearProjectUiState(closingProjects);
            acceptWorkspaceState(next);
        } catch (error) {
            window.alert(error instanceof Error ? error.message : 'Failed to close workspace.');
        }
    }, [wsRef, isConnected, workspaceState.projects, clearProjectUiState, acceptWorkspaceState,
        bumpProjectLifecycleVersion, runWithCloseWarp]);

    const handleRemoveRecentWorkspace = useCallback(async (path: string) => {
        if (!wsRef.current || !isConnected) {
            throw new Error('Server unavailable. Try again after reconnecting.');
        }
        const recent = await removeRemoteRecentWorkspace(wsRef.current, path);
        setWorkspaceState((previous) => ({ ...previous, recent_workspaces: recent }));
        return recent;
    }, [wsRef, isConnected]);

    useEffect(() => {
        if (!isConnected) return;
        for (const project of workspaceState.projects) {
            git.fetchGitStatus(project.id);
            git.fetchBranches(project.id);
        }
    }, [isConnected, workspaceState.projects, git.fetchGitStatus, git.fetchBranches]);

    useEffect(() => {
        const socket = wsRef.current;
        if (!socket || !isConnected) return;
        const handleProjectAdded = (project: WorkspaceProject) => {
            const lifecycleVersion = bumpProjectLifecycleVersion(project.id);
            void getRemoteWorkspaceState(socket).then((next) => {
                if (!isCurrentProjectLifecycleVersion(project.id, lifecycleVersion)
                    || !next.projects.some((item) => item.id === project.id)) return;
                acceptWorkspaceState(next);
                fileTree.openFolder(project.root);
                refreshProjectGitStatus(project.id, true);
            }).catch((error) => {
                console.error('Failed to refresh workspace after project addition:', error);
            });
        };
        const handleProjectRemoved = (data: { project_id: string }) => {
            bumpProjectLifecycleVersion(data.project_id);
            const removed = workspaceState.projects.find((project) => project.id === data.project_id);
            clearProjectUiState(removed ? [removed] : [], [data.project_id]);
            void getRemoteWorkspaceState(socket).then(acceptWorkspaceState).catch((error) => {
                console.error('Failed to refresh workspace after project removal:', error);
            });
        };
        const handleWorkspaceClosed = (data: { project_ids: string[] }) => {
            for (const projectId of data.project_ids) bumpProjectLifecycleVersion(projectId);
            const removedProjects = workspaceState.projects.filter((project) => data.project_ids.includes(project.id));
            clearProjectUiState(removedProjects, data.project_ids);
            void getRemoteWorkspaceState(socket).then(acceptWorkspaceState).catch((error) => {
                console.error('Failed to refresh workspace after close:', error);
            });
        };
        socket.on('workspace:project-added', handleProjectAdded);
        socket.on('workspace:project-removed', handleProjectRemoved);
        socket.on('workspace:closed', handleWorkspaceClosed);
        return () => {
            socket.off('workspace:project-added', handleProjectAdded);
            socket.off('workspace:project-removed', handleProjectRemoved);
            socket.off('workspace:closed', handleWorkspaceClosed);
        };
    }, [
        wsRef, isConnected, workspaceState.projects, activeProjectId,
        clearProjectUiState, bumpProjectLifecycleVersion, isCurrentProjectLifecycleVersion,
        acceptWorkspaceState, fileTree.openFolder, refreshProjectGitStatus,
    ]);

    useEffect(() => {
        if (!isConnected || !wsRef.current) return;
        const socket = wsRef.current;
        socket.emit('workspace:state', (response: WorkspaceState & { success?: boolean; error?: string }) => {
            if (!response?.success) {
                console.error('Failed to restore workspace state:', response?.error);
                return;
            }
            const preferredProjectId = sessionStorage.getItem(ACTIVE_PROJECT_SESSION_KEY);
            if (preferredProjectId && response.projects.some((project) => project.id === preferredProjectId)) {
                void selectRemoteProject(socket, preferredProjectId)
                    .then((next) => {
                        acceptWorkspaceState(next);
                        refreshProjectGit(preferredProjectId);
                    })
                    .catch((error) => {
                        console.error('Failed to restore active project:', error);
                        acceptWorkspaceState(response);
                        if (response.active_project_id) refreshProjectGit(response.active_project_id);
                    });
            } else {
                acceptWorkspaceState(response);
                if (response.active_project_id) refreshProjectGit(response.active_project_id);
            }
            for (const project of response.projects) {
                fileTree.openFolder(project.root);
            }
        });
        terminals.reconnectTerminals();
        agents.reconnectToAcpAgents();
    }, [isConnected, wsRef, acceptWorkspaceState, fileTree.openFolder, refreshProjectGit,
        terminals.reconnectTerminals, agents.reconnectToAcpAgents]);

    useEffect(() => {
        if (!isTauri) return;
        let cancelled = false;
        let unlistenFolder: (() => void) | undefined;
    let unlistenClose: (() => void) | undefined;
        import('@tauri-apps/api/event').then(({ listen }) => {
            void listen<string>('workspace_folder_selected', (event) => {
                void handleAddProjectPath(event.payload);
            }).then((unlisten) => {
                if (cancelled) unlisten();
                else unlistenFolder = unlisten;
            });
            void listen('workspace_close_requested', () => {
                void handleCloseWorkspace();
            }).then((unlisten) => {
                if (cancelled) unlisten();
                else unlistenClose = unlisten;
            });
        });
        return () => {
            cancelled = true;
            unlistenFolder?.();
            unlistenClose?.();
        };
    }, [handleAddProjectPath, handleCloseWorkspace]);

    useEffect(() => {
        return () => {
            editors.flushAllPendingChanges();
        };
    }, [editors.flushAllPendingChanges]);

    useEffect(() => {
        fileTree.setActiveNode(activeContextFilePath);
    }, [activeContextFilePath, fileTree.setActiveNode]);

    useEffect(() => {
        if (!activeContextFilePath) {
            fileTree.clearFileSelection();
            return;
        }

        const node = fileTree.findNodeByPath(fileTree.fileTree, activeContextFilePath);
        if (!node) {
            fileTree.clearFileSelection();
            return;
        }

        if (node.isSelected) {
            return;
        }

        fileTree.selectNode(node.id);
    }, [activeContextFilePath, fileTree.fileTree,
        fileTree.findNodeByPath, fileTree.selectNode, fileTree.clearFileSelection]);

    useEffect(() => {
        saveItem('terminals', terminals.terminals);
    }, [terminals.terminals]);

    const handleSearch = ({ pattern }: { id: string; pattern: string }) => {
        if (!isConnected) return;
        search.startSearch(pattern);
    };

    const resolveEditorPaneId = useEvent(() => {
        return layoutActionsRef.current?.ensureEditorPanel(editors.activeEditorPaneId);
    });

    const handleOpenFile = useEvent((
        path: string,
        line?: number,
        column?: number,
        mode?: DiffMode,
        selection?: EditorSelectionRange,
    ) => {
        const keepPreviousEditor = layoutActionsRef.current
            ?.isEditorPanelVisible(editors.activeEditorPaneId) ?? false;
        const paneId = resolveEditorPaneId();
        if (!paneId) return;
        editors.openFile(path, line, column, paneId, mode, keepPreviousEditor, true, undefined, selection);
    });

    const closeReview = useEvent((paneId: string) => {
        const review = multibufferReviews[paneId];
        if (!review) return;

        const usedByOtherReview = new Set(
            Object.entries(multibufferReviews)
                .filter(([otherPaneId]) => otherPaneId !== paneId)
                .flatMap(([, otherReview]) => otherReview.files.map((file) => file.id)),
        );

        for (const fileId of review.openedByReview) {
            if (usedByOtherReview.has(fileId)) continue;
            if (editors.getPaneIdsForFile(fileId).some((otherPaneId) => otherPaneId !== paneId)) continue;
            editors.closeFile(fileId);
        }

        setMultibufferReviews((previous) => {
            if (!previous[paneId]) return previous;
            const next = { ...previous };
            delete next[paneId];
            return next;
        });
        editors.setEditorDiffMode(paneId, 'plain');
    });

    const workspaceChangedFiles = useMemo<ChangedFile[]>(() => (
        workspaceState.projects.flatMap((project) => (
            git.changedFilesByProject[project.id] || []
        ).map((file) => {
            const path = /^[A-Za-z]:[\\/]|^\//.test(file.path)
                ? file.path
                : `${project.root.replace(/[\\/]+$/, '')}/${file.path.replace(/^[\\/]+/, '')}`;
            return {
                ...file,
                path: normalizePath(path),
                project_id: project.id,
            };
        }))
    ), [workspaceState.projects, git.changedFilesByProject]);
    const selectedChangesProjectId = workspaceState.projects.some(
        (project) => project.id === changesProjectId,
    )
        ? changesProjectId
        : workspaceState.projects.find((project) => project.id === activeProjectId)?.id
            ?? workspaceState.projects[0]?.id
            ?? null;
    const selectedChangesProjectFiles = useMemo(
        () => workspaceChangedFiles.filter((file) => file.project_id === selectedChangesProjectId),
        [selectedChangesProjectId, workspaceChangedFiles],
    );
    const selectedHistoryProjectId = workspaceState.projects.some(
        (project) => project.id === historyProjectId,
    )
        ? historyProjectId
        : workspaceState.projects.find((project) => project.id === activeProjectId)?.id
            ?? workspaceState.projects[0]?.id
            ?? null;
    const selectedHistoryProject = workspaceState.projects.find(
        (project) => project.id === selectedHistoryProjectId,
    ) ?? null;
    const refreshSelectedHistory = useCallback(
        () => git.refreshHistory(selectedHistoryProjectId),
        [git.refreshHistory, isConnected, selectedHistoryProjectId],
    );
    useEffect(() => {
        if (!selectedHistoryProjectId || git.historyProjectId === selectedHistoryProjectId) return;
        git.showRepositoryHistory(selectedHistoryProjectId);
    }, [selectedHistoryProjectId, git.historyProjectId, git.showRepositoryHistory]);
    const refreshWorkspaceGitStatus = useCallback((projectId: string) => {
        git.fetchGitStatus(projectId);
        git.fetchBranches(projectId);
    }, [git.fetchGitStatus, git.fetchBranches]);

    const handleOpenMultibuffer = useEvent(() => {
        if (!selectedChangesProjectId || selectedChangesProjectFiles.length === 0) return;

        const paneId = layoutActionsRef.current?.ensureEditorPanel(editors.activeEditorPaneId);
        if (!paneId) return;

        closeReview(paneId);
        editors.setActiveEditorPaneId(paneId);
        editors.setEditorDiffMode(paneId, 'diff');
        const files = toMultibufferFiles(selectedChangesProjectFiles);
        setMultibufferReviews((previous) => ({
            ...previous,
            [paneId]: {
                projectId: selectedChangesProjectId,
                files,
                title: 'Review changes',
                ignoreEdits: false,
                activeFileId: files.find((file) => file.id === editors.activeFileId)?.id
                    ?? files[0]?.id
                    ?? null,
                openedByReview: files
                    .filter((file) => !editors.editorStates.has(file.id))
                    .map((file) => file.id),
            },
        }));
    });

    useEffect(() => {
        for (const [paneId, review] of Object.entries(multibufferReviews)) {
            if (review.ignoreEdits) continue;
            const paths = review.files
                .filter((file) => file.status !== 'deleted' && !editors.editorStates.has(file.id))
                .map((file) => file.path);
            if (paths.length > 0) {
                void editors.openFiles(paths, { paneId, diffMode: 'diff', keepPreviousEditor: true });
            }
        }
    }, [editors.openFiles, multibufferReviews]);

    useEffect(() => {
        setMultibufferReviews((previous) => {
            let changed = false;
            const next = { ...previous };

            for (const [paneId, review] of Object.entries(previous)) {
                if (review.ignoreEdits) continue;
                const nextFiles = toMultibufferFiles(
                    workspaceChangedFiles.filter((file) => file.project_id === review.projectId),
                );
                const sameFiles = review.files.length === nextFiles.length
                    && review.files.every((file, index) => {
                        const nextFile = nextFiles[index];
                        return nextFile
                            && file.id === nextFile.id
                            && file.added === nextFile.added
                            && file.removed === nextFile.removed
                            && file.status === nextFile.status;
                    });
                if (!sameFiles) {
                    next[paneId] = {
                        ...review,
                        files: nextFiles,
                        activeFileId: nextFiles.some((file) => file.id === review.activeFileId)
                            ? review.activeFileId
                            : (nextFiles[0]?.id ?? null),
                    };
                    changed = true;
                }
            }

            return changed ? next : previous;
        });
    }, [workspaceChangedFiles]);

    const focusReviewFile = useEvent((paneId: string, pathOrId: string, line?: number, column?: number) => {
        const review = multibufferReviews[paneId];
        const file = review?.files.find((f) => (
            f.id === pathOrId || f.path === pathOrId || pathOrId.endsWith('/' + f.id) || pathOrId.endsWith('/' + f.path)
        ));
        if (!file) return false;

        setMultibufferReviews((prev) => ({
            ...prev,
            [paneId]: {
                ...prev[paneId],
                activeFileId: file.id,
                focusRequest: { path: file.id, line, column, token: Date.now() },
            },
        }));
        return true;
    });

    const handleReviewActiveFileChange = useEvent((paneId: string, fileId: string) => {
        setMultibufferReviews((previous) => {
            const review = previous[paneId];
            if (!review || review.activeFileId === fileId || !review.files.some((file) => file.id === fileId)) {
                return previous;
            }
            return {
                ...previous,
                [paneId]: { ...review, activeFileId: fileId },
            };
        });
    });

    const handleGoToDefinition = useEvent(async (
        request: Parameters<typeof editors.handleGoToDefinition>[0],
    ) => {
        const paneId = editors.activeEditorPaneId;
        const response = await editors.handleGoToDefinition(request);
        const definition = Array.isArray(response) ? response[0] : response;
        if (definition && definition.uri && definition.range) {
            const filePath = uriToFilePath(definition.uri);
            const line = definition.range.start.line;
            const column = definition.range.start.character;
            focusReviewFile(paneId, filePath, line, column);
        }
        return response;
    });

    const handleSelectFile = useEvent((fileId: string) => {
        const paneId = resolveEditorPaneId();
        if (!paneId) return;
        if (focusReviewFile(paneId, fileId)) return;
        editors.setActiveFileId(fileId, paneId);
    });

    const handleSearchResultClick = (filePath: string, match: SearchMatch, pattern: string) => {
        const patternLines = pattern.split(/\r?\n/);
        const lastPatternLine = patternLines[patternLines.length - 1] ?? '';
        const selection: EditorSelectionRange = {
            startLine: match.line,
            startColumn: match.column,
            endLine: match.line + patternLines.length - 1,
            endColumn: patternLines.length === 1
                ? match.column + Array.from(pattern).length
                : Array.from(lastPatternLine).length,
        };

        handleOpenFile(filePath, match.line, match.column, undefined, selection);
    };

    const handleOpenFileDiff = useEvent((
        path: string, line?: number, column?: number,
    ) => {
        const paneId = editors.activeEditorPaneId;
        if (focusReviewFile(paneId, path)) return;

        const mode = editors.getEditorDiffMode(paneId);
        handleOpenFile(path, line, column, mode);
    });

    const handleOpenHistoryDiff = useEvent(async (hash: string, file: GitHistoryFile) => {
        const targetProjectId = selectedHistoryProjectId;
        if (!targetProjectId) return;
        const paneId = editors.activeEditorPaneId;
        if (focusReviewFile(paneId, getHistoricalFileId(hash, file.path, targetProjectId))) return;

        const content = await git.fetchHistoryFileContent(hash, file, targetProjectId);
        if (selectedHistoryProjectId !== targetProjectId) return;
        if (!content) return;
        if (content.old_binary || content.new_binary || content.old_content === null || content.new_content === null) {
            window.alert(`Cannot display a text diff for binary file "${file.path}".`);
            return;
        }
        editors.openHistoricalDiff(
            hash,
            file.path,
            content.old_content,
            content.new_content,
            editors.activeEditorPaneId,
            true,
            targetProjectId,
        );
    });

    const handleOpenHistoryMultibuffer = useEvent(async (hash: string, files: GitHistoryFile[]) => {
        const targetProjectId = selectedHistoryProjectId;
        if (!targetProjectId) return;
        const paneId = layoutActionsRef.current?.ensureEditorPanel(editors.activeEditorPaneId);
        if (!paneId || files.length === 0) return;

        const contents = await Promise.all(files.map(async (file) => {
            if (file.binary) return null;
            const content = await git.fetchHistoryFileContent(hash, file, targetProjectId);
            if (!content || content.old_binary || content.new_binary) return null;
            return { file, content };
        }));
        if (selectedHistoryProjectId !== targetProjectId) return;
        const textFiles = contents.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
        if (textFiles.length === 0) {
            window.alert('This commit has no text diffs to review.');
            return;
        }

        closeReview(paneId);
        editors.setActiveEditorPaneId(paneId);
        for (const { file, content } of textFiles) {
            editors.openHistoricalDiff(
                hash,
                file.path,
                content.old_content ?? '',
                content.new_content ?? '',
                paneId,
                false,
                targetProjectId,
            );
        }
        const reviewFiles = textFiles.map(({ file }) => ({
            id: getHistoricalFileId(hash, file.path, targetProjectId),
            path: file.path,
            added: file.added,
            removed: file.removed,
            status: file.status,
        }));
        setMultibufferReviews((previous) => ({
            ...previous,
            [paneId]: {
                projectId: targetProjectId,
                files: reviewFiles,
                title: `Review ${hash.slice(0, 7)}`,
                ignoreEdits: true,
                activeFileId: reviewFiles[0]?.id ?? null,
                openedByReview: textFiles
                    .map(({ file }) => getHistoricalFileId(hash, file.path, targetProjectId))
                    .filter((fileId) => !editors.editorStates.has(fileId)),
            },
        }));
    });

    const activeChangedFile = useMemo<ChangedFile | null>(() => {
        if (!activeContextFilePath) {
            return null;
        }
        const normalizedActivePath = normalizePath(activeContextFilePath).replace(/^\.\/+/, '');
        return workspaceChangedFiles.find((file) => normalizePath(file.path).replace(/^\.\/+/, '') === normalizedActivePath) ?? null;
    }, [activeContextFilePath, workspaceChangedFiles]);

    const isEditorDiffEnabled = useCallback((panelKey: string) => {
        return editors.getEditorDiffMode(panelKey) !== 'plain';
    }, [editors]);

    const handleCycleEditorDiffMode = useCallback((panelKey: string) => {
        const changed = editors.cycleEditorDiffMode(panelKey);
        if (changed) {
            editors.focusEditorInPane(panelKey);
        }
    }, [editors]);

    const isEditorMarkdown = useCallback((panelKey: string) => {
        const fileId = editors.getActiveFileIdForPane(panelKey);
        if (!fileId) return false;
        const file = editors.files.find((f) => f.id === fileId);
        if (!file) return false;
        const filePath = file.source?.path || file.name || file.id;
        return file.language === 'markdown' || getLanguageFromFileName(filePath) === 'markdown';
    }, [editors.files, editors.getActiveFileIdForPane]);

    const isEditorMarkdownPreviewOpen = useCallback((panelKey: string) => {
        return Boolean(markdownPreviews[panelKey]);
    }, [markdownPreviews]);

    const handleToggleEditorMarkdownPreview = useCallback((panelKey: string) => {
        setMarkdownPreviews((prev) => ({
            ...prev,
            [panelKey]: !prev[panelKey],
        }));
    }, []);

    const sessionsArray = useMemo(() => Array.from(agents.acpSessions.values()), [agents.acpSessions]);
    const availableAgents = useMemo<AcpAgent[]>(() => getAllAgents(), [agents.agentsVersion]);
    const settingsAgents = useMemo<AcpAgent[]>(() => (
        agents.isAgentSettingsOpen ? getAllAgents() : []
    ), [agents.isAgentSettingsOpen, agents.agentsVersion]);
    const settingsDefaultAgentId = useMemo(
        () => (agents.isAgentSettingsOpen ? getDefaultAgentId() : null),
        [agents.isAgentSettingsOpen, agents.agentsVersion],
    );

    const agentPanes = useAgentPanes({
        sessions: sessionsArray,
        selectedAgentId: agents.selectedAgentId,
        setSelectedAgentId: agents.setSelectedAgentId,
    });

    const layout = useLayout({
        activeEditorPaneId: editors.activeEditorPaneId,
        activeTerminalPaneId: terminalPanes.activePaneId,
        activeAgentPaneId: agentPanes.activePaneId,
        onFocusEditorPane: editors.focusEditorInPane,
        onActivateTerminalPane: terminalPanes.setActivePaneId,
        onActivateAgentPane: agentPanes.setActivePaneId,
    });

    const handleGlobalKeyDown = useEvent((e: KeyboardEvent) => {
            const target = e.target;
            if (target instanceof Element) {
                const isFilesTreeFocused = target.closest('.file-tree') !== null;
                if (isFilesTreeFocused && !e.metaKey && !e.ctrlKey) {
                    return;
                }
            }
    
            const activePaneId = editors.activeEditorPaneId;
            if (activePaneId && editors.handleReferencesPeekKeyDown(activePaneId, e)) {
                return;
            }

    
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
                e.preventDefault();
                const selectedText = editors.getActiveEditorSelectedText().trim();
                layoutActionsRef.current?.ensurePanel('search');
                if (selectedText) {
                    search.setSearchInput(selectedText);
                    search.startSearch(selectedText);
                }
                layout.requestPanelFocus('search');
                return;
            }
    
            if (isTauri && (e.metaKey || e.ctrlKey) && (e.key === 'o' || e.key === 'O' || e.code === 'KeyO')) {
                e.preventDefault();
                handleOpenFolderClick();
                return;
            }

            if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyS' || e.key.toLowerCase() === 's')) {
                e.preventDefault();
                if (editors.activeFileId) {
                    editors.saveFile(editors.activeFileId);
                }
            }
    
            if (layout.handleCtrlFocusShortcut(e)) {
                return;
            }
    
            if (e.ctrlKey && e.key === '-') {
                e.preventDefault();
                editors.undoCursor();
            } else if (e.ctrlKey && e.key === '_') {
                e.preventDefault();
                editors.redoCursor();
            }
    });

    useEffect(() => {
        document.addEventListener('keydown', handleGlobalKeyDown, true);
        return () => {
            document.removeEventListener('keydown', handleGlobalKeyDown, true);
        };
    }, [handleGlobalKeyDown]);

    const handleStartSpecificAgent = useCallback((agent: AcpAgent, projectId?: string) => {
        return agents.startAgent(agent, { projectId });
    }, [agents.startAgent]);
    const handleOpenAgentSettings = useCallback(() => {
        ensureDefaultAgents();
        agents.setIsAgentSettingsOpen(true);
    }, [agents.setIsAgentSettingsOpen]);
    const handleCloseAgentSettings = useCallback(() => {
        agents.setIsAgentSettingsOpen(false);
    }, [agents.setIsAgentSettingsOpen]);
    const handleResumeSettingsSession = useCallback((agent: AcpAgent, sessionId: string, projectId?: string) => {
        agents.setIsAgentSettingsOpen(false);
        agents.resumeSession(agent, sessionId, projectId);
    }, [agents.resumeSession, agents.setIsAgentSettingsOpen]);

    const handleSaveAgents = useCallback((agentList: AcpAgent[], defaultAgentId: string | null) => {
        updateAgents(agentList, defaultAgentId);
        agents.setAgentsVersion((prev) => prev + 1);
    }, [agents.setAgentsVersion]);

    const handleFileIconsStyleChange = useCallback((style: 'colored' | 'monochrome' | 'disabled') => {
        localStorage.setItem('fileIconsStyle', style);
        setFileIconsStyle(style);
    }, []);

    const handleFileIconsOpacityChange = useCallback((opacity: number) => {
        localStorage.setItem('fileIconsOpacity', opacity.toString());
        setFileIconsOpacity(opacity);
    }, []);

    const activeTerminalId = useMemo(() => {
        const paneId = terminalPanes.activePaneId || 'terminal';
        return terminalPanes.getSelectedId(paneId);
    }, [terminalPanes]);

    const handleTerminalTabSelect = useCallback((terminalId: string) => {
        const paneId = layoutActionsRef.current?.ensurePanel('terminal', terminalPanes.activePaneId)
            ?? (terminalPanes.activePaneId || 'terminal');
        terminalPanes.setActivePaneId(paneId);
        terminalPanes.setSelectedForPane(paneId, terminalId);
        layout.requestPanelFocus('terminal', paneId);
    }, [terminalPanes, layout]);

    const handleTerminalTabClose = useCallback((terminalId: string) => {
        terminalPanes.closeTab(terminalId);
    }, [terminalPanes]);

    const activeToolbarAgentId = (
        agentPanes.getSelectedId(agentPanes.activePaneId || 'agent')
        ?? agents.selectedAgentId
    );

    const renderPanel = (panelId: PanelId, panelKey: string) => {
        switch (panelId) {
            case 'files':
                return (
                    <FilesPanel
                        fileTree={fileTree.fileTree}
                        projects={workspaceState.projects}
                        activeProjectId={activeProjectId}
                        onSelectProject={handleSelectProject}
                        onAddProject={openFolderPicker}
                        isAddingProject={folderPicker !== null}
                        onRemoveProject={handleRemoveProject}
                        activeNodeId={fileTree.activeNodeId}
                        changedFiles={workspaceChangedFiles}
                        focusRequestToken={layout.getFocusRequestToken('files')}
                        onActivateNode={fileTree.setActiveNode}
                        onToggle={fileTree.toggleNode}
                        onSelect={fileTree.selectNode}
                        onOpenFile={handleOpenFile}
                        onLoadFolder={fileTree.openFolder}
                        onFocusEditor={() => editors.focusEditorInPane(editors.activeEditorPaneId)}
                        onNavigateByKey={fileTree.navigateByKey}
                        fileIconsStyle={fileIconsStyle}
                        onDeleteNode={fileTree.deleteNode}
                        onRenameNode={fileTree.renameNodeOnDisk}
                        onCreateNode={fileTree.createNodeOnDisk}
                    />
                );
            case 'search':
                return (
                    <Search
                        id="search"
                        wsRef={wsRef}
                        isConnected={isConnected}
                        projects={workspaceState.projects}
                        projectId={selectedSearchProjectId}
                        onProjectChange={setSearchProjectId}
                        focusRequestToken={layout.getFocusRequestToken('search')}
                        inputValue={search.searchInput}
                        onInputValueChange={search.setSearchInput}
                        onEnter={handleSearch}
                        onInputChange={search.cancelSearch}
                        onCancel={search.cancelSearch}
                        onClear={search.clearResults}
                        results={search.searchResults}
                        searchEnded={search.searchEnded}
                        onMatchClick={handleSearchResultClick}
                        onFileClick={handleOpenFile}
                        fileIconsStyle={fileIconsStyle}
                    />
                );
            case 'changes': {
                const changesProjectGitUi = selectedChangesProjectId
                    ? git.gitUiByProject[selectedChangesProjectId]
                    : undefined;
                return (
                    <ChangesPanel
                        files={selectedChangesProjectFiles}
                        projects={workspaceState.projects}
                        selectedProjectId={selectedChangesProjectId}
                        onProjectChange={(projectId) => {
                            setChangesProjectId(projectId);
                            refreshWorkspaceGitStatus(projectId);
                        }}
                        active={activeChangedFile?.project_id === selectedChangesProjectId ? activeChangedFile : null}
                        branch={changesProjectGitUi?.branch ?? git.gitBranch}
                        branches={changesProjectGitUi?.branches ?? git.branches}
                        isSwitchingBranch={changesProjectGitUi?.isSwitchingBranch ?? git.isSwitchingBranch}
                        onFileClick={handleOpenFileDiff}
                        onRefresh={() => {
                            if (selectedChangesProjectId) refreshWorkspaceGitStatus(selectedChangesProjectId);
                        }}
                        onBranchChange={(branch) => selectedChangesProjectId
                            ? git.checkoutBranch(branch, selectedChangesProjectId)
                            : Promise.resolve(false)}
                        onCreateBranch={(branch) => selectedChangesProjectId
                            ? git.createBranch(branch, selectedChangesProjectId)
                            : Promise.resolve(false)}
                        onCommit={(message) => selectedChangesProjectId
                            ? git.commit(message, selectedChangesProjectId)
                            : Promise.resolve(false)}
                        onPush={() => {
                            if (selectedChangesProjectId) git.push(selectedChangesProjectId);
                        }}
                        pushStatus={changesProjectGitUi?.pushStatus ?? git.pushStatus}
                        onFetch={() => {
                            if (selectedChangesProjectId) git.fetchRemote(selectedChangesProjectId);
                        }}
                        onPull={() => {
                            if (selectedChangesProjectId) git.pull(selectedChangesProjectId);
                        }}
                        onRevert={(path) => {
                            if (selectedChangesProjectId) git.revert(path, selectedChangesProjectId);
                        }}
                        onStage={(path) => {
                            if (selectedChangesProjectId) git.stage(path, selectedChangesProjectId);
                        }}
                        onUnstage={(path) => {
                            if (selectedChangesProjectId) git.unstage(path, selectedChangesProjectId);
                        }}
                        onOpenMultibuffer={handleOpenMultibuffer}
                        fileIconsStyle={fileIconsStyle}
                    />
                );
            }
            case 'history':
                return (
                    <HistoryPanel
                        projects={workspaceState.projects}
                        selectedProjectId={selectedHistoryProjectId}
                        historyProjectId={git.historyProjectId}
                        onProjectChange={(projectId) => {
                            setHistoryProjectId(projectId);
                            git.showRepositoryHistory(projectId);
                        }}
                        commits={git.historyCommits}
                        filesByCommit={git.historyFiles}
                        hasMore={git.historyHasMore}
                        loading={git.isHistoryLoading}
                        loaded={git.isHistoryLoaded}
                        filesLoading={git.historyFilesLoading}
                        historyPath={git.historyPath}
                        activeFilePath={
                            editors.activeFile?.source?.type === 'filesystem'
                            && selectedHistoryProject
                            && pathBelongsToProject(editors.activeFile.source.path, selectedHistoryProject.root)
                                ? editors.activeFile.source.path
                                : null
                        }
                        onRefresh={refreshSelectedHistory}
                        onLoadMore={() => git.loadMoreHistory(selectedHistoryProjectId)}
                        onSearch={(mode, query) => git.searchHistory(mode, query, selectedHistoryProjectId)}
                        onClearSearch={() => git.clearHistorySearch(selectedHistoryProjectId)}
                        onCancelSearch={git.cancelHistorySearch}
                        onCommitExpand={(hash) => git.fetchHistoryFiles(hash, selectedHistoryProjectId)}
                        onFileClick={handleOpenHistoryDiff}
                        onReviewCommit={handleOpenHistoryMultibuffer}
                        onShowRepository={() => git.showRepositoryHistory(selectedHistoryProjectId)}
                        onShowFile={(path) => git.showFileHistory(path, selectedHistoryProjectId)}
                        fileIconsStyle={fileIconsStyle}
                    />
                );
            case 'editor':
                const multibufferReview = multibufferReviews[panelKey];
                return (
                    <EditorPanel
                        panelKey={panelKey}
                        editors={editors}
                        multibufferOpen={multibufferReview !== undefined}
                        multibufferFiles={multibufferReview?.files ?? []}
                        multibufferTitle={multibufferReview?.title}
                        multibufferIgnoreEdits={multibufferReview?.ignoreEdits ?? false}
                        multibufferFocusRequest={multibufferReview?.focusRequest}
                        onCloseMultibuffer={() => closeReview(panelKey)}
                        onMultibufferActiveFileChange={handleReviewActiveFileChange}
                        onGoToDefinition={handleGoToDefinition}
                        onLoadDeletedFile={git.fetchOriginalFileContent}
                        markdownPreviewOpen={Boolean(markdownPreviews[panelKey])}
                        onOpenFile={handleOpenFile}
                    />
                );
            case 'terminal':
                return (
                    <TerminalPanel
                        panelKey={panelKey}
                        focusRequestToken={layout.getFocusRequestToken('terminal', panelKey)}
                        isConnected={isConnected}
                        terminals={terminals.terminals}
                        projects={workspaceState.projects}
                        activeProjectId={activeProjectId}
                        onCreateTerminal={(projectId) => (
                            terminalPanes.createTerminalForActivePane(projectId, panelKey)
                        )}
                        terminalPanes={terminalPanes}
                        onTerminalData={terminals.handleTerminalData}
                        onTerminalMessage={terminals.handleTerminalDataCallback}
                        onTerminalResize={terminals.handleTerminalResize}
                        onIsTerminalClosing={terminals.isTerminalClosing}
                        onUploadFile={terminals.uploadFile}
                        fontConfig={settings.fontSettings.terminal}
                    />
                );
            case 'agent':
                return (
                    <AgentPanel
                        panelKey={panelKey}
                        focusRequestToken={layout.getFocusRequestToken('agent', panelKey)}
                        isConnected={isConnected}
                        wsRef={wsRef}
                        agentPanes={agentPanes}
                        agents={agents}
                        sessions={sessionsArray}
                        projects={workspaceState.projects}
                        activeProjectId={activeProjectId}
                        availableAgents={availableAgents}
                        settingsAgents={settingsAgents}
                        settingsDefaultAgentId={settingsDefaultAgentId}
                        getOpenFiles={editors.getOpenFiles}
                        getRootFiles={fileTree.getRootFiles}
                        onSearchFiles={search.searchFiles}
                        onSaveAgents={handleSaveAgents}
                        onCloseSettings={handleCloseAgentSettings}
                        onResumeSettingsSession={handleResumeSettingsSession}
                        onStartSpecificAgent={handleStartSpecificAgent}
                        onOpenSettings={handleOpenAgentSettings}
                        onOpenFile={handleOpenFile}
                        onOpenFileDiff={handleOpenFileDiff}
                    />
                );
            case 'browser':
                return <BrowserPanel panelKey={panelKey} />;
            case 'toolbar':
                return (
                    <Toolbar
                        files={editors.files}
                        activeFileId={activeContextFileId}
                        terminals={terminals.terminals}
                        activeTerminalId={activeTerminalId}
                        agentSessions={sessionsArray}
                        activeAgentId={activeToolbarAgentId}
                        availableAgents={availableAgents}
                        onSelectFile={handleSelectFile}
                        onCloseFile={editors.closeFile}
                        onSelectTerminal={handleTerminalTabSelect}
                        onCloseTerminal={handleTerminalTabClose}
                        onSelectAgent={agentPanes.selectFromToolbar}
                        onCloseAgent={agents.closeAgent}
                        fileIconsStyle={fileIconsStyle}
                        showConnectionStatus={showConnectionBanner}
                        connectionStatus={connectionStatus}
                        onReconnect={connectToBackend}
                    />
                );
            case 'settings':
                return (
                    <SettingsPanel
                        wsRef={wsRef}
                        isConnected={isConnected}
                        currentThemeId={currentThemeId}
                        onThemeChange={handleThemeChange}
                        fileIconsStyle={fileIconsStyle}
                        onFileIconsStyleChange={handleFileIconsStyleChange}
                        fileIconsOpacity={fileIconsOpacity}
                        onFileIconsOpacityChange={handleFileIconsOpacityChange}
                        fontSettings={settings.fontSettings}
                        onFontSettingsChange={settings.updateFontSettings}
                        scrollbarSettings={settings.scrollbarSettings}
                        onScrollbarSettingsChange={settings.updateScrollbarSettings}
                        backgroundSettings={settings.backgroundSettings}
                        onBackgroundSettingsChange={settings.updateBackgroundSettings}
                    />
                );
            default:
                return null;
        }
    };

    const handlePanelAdded = useEvent((panelId: PanelId, panelKey: string) => {
        layout.handlePanelAdded(panelId, panelKey);

        if (panelId === 'changes') {
            git.fetchGitStatus();
            git.fetchBranches();
            return;
        }
        if (panelId === 'history') {
            git.fetchGitStatus();
            git.fetchHistory(true);
            return;
        }
        if (panelId === 'editor') {
            editors.registerEditorPane(panelKey);
            editors.setActiveEditorPaneId(panelKey);
            return;
        }
        if (panelId === 'agent') {
            agentPanes.registerPane(panelKey);
            return;
        }
        if (panelId === 'terminal') {
            terminalPanes.registerPane(panelKey);
        }
    });

    const handlePanelRemoved = useEvent((panelId: PanelId, panelKey: string) => {
        layout.handlePanelRemoved(panelId, panelKey);

        if (panelId === 'editor') {
            closeReview(panelKey);
            setMarkdownPreviews((prev) => {
                if (!prev[panelKey]) return prev;
                const next = { ...prev };
                delete next[panelKey];
                return next;
            });
            editors.unregisterEditorPane(panelKey);
            return;
        }
        if (panelId === 'agent') {
            agentPanes.unregisterPane(panelKey);
            return;
        }
        if (panelId === 'terminal') {
            terminalPanes.unregisterPane(panelKey);
        }
    });

    const handlePanelActivated = useEvent((panelId: PanelId, panelKey: string) => {
        layout.handlePanelActivated(panelId, panelKey);

        if (panelId === 'editor') {
            editors.setActiveEditorPaneId(panelKey);

            const paneFileId = editors.getActiveFileIdForPane(panelKey);
            if (!paneFileId) {
                return;
            }

            const editorState = editors.getEditorState(paneFileId);
            if (editorState) {
                editorState.restoreScroll();
                editorState.renderCursorOrSelection();
            }
            return;
        }
        if (panelId === 'agent') {
            agentPanes.setActivePaneId(panelKey);
            return;
        }
        if (panelId === 'terminal') {
            terminalPanes.setActivePaneId(panelKey);
            layout.requestPanelFocus('terminal', panelKey);
        }
    });

    const canResetPanel = useCallback((panelKey: string, panelId: PanelId) => {
        if (panelId === 'terminal') {
            return terminalPanes.getSelectedId(panelKey) !== null;
        }
        if (panelId === 'agent') {
            return agentPanes.getSelectedId(panelKey) !== null;
        }
        return false;
    }, [terminalPanes, agentPanes]);

    const handleResetPanel = useCallback((panelKey: string, panelId: PanelId) => {
        if (panelId === 'terminal') {
            terminalPanes.setSelectedForPane(panelKey, null);
        } else if (panelId === 'agent') {
            agentPanes.selectForPane(panelKey, null);
        }
    }, [terminalPanes, agentPanes]);

    return (
        <div
            className={`app-container toolbar-header-compact ${settings.backgroundSettings.enabled ? 'app-with-dynamic-bg' : ''} ${isWarping ? 'is-warping' : ''}`}
            data-dynamic-bg={settings.backgroundSettings.enabled ? "global" : undefined}
            style={{ '--file-icon-opacity': fileIconsOpacity, ...warpCssVars(settings.backgroundSettings.warpDurationMs) } as React.CSSProperties}
        >
            {settings.backgroundSettings.enabled && (
                <DynamicBackground
                    settings={settings.backgroundSettings}
                    className="app-global-dynamic-bg"
                />
            )}
            {!isWorkspaceOpen ? (
                <div className={`warp-screen-wrapper ${warpDirection === 'closing' ? 'warping-in' : ''}`}>
                    <WelcomeScreen
                        onOpenFolder={handleOpenFolderClick}
                        onSelectWorkspace={handleSelectWorkspace}
                        onRemoveRecent={handleRemoveRecentWorkspace}
                        recentProjects={workspaceState.recent_workspaces}
                        backgroundSettings={settings.backgroundSettings}
                        hideBackground={settings.backgroundSettings.enabled}
                    />
                </div>
            ) : (
                <div
                    className={`main-content warp-screen-wrapper ${warpDirection === 'closing' ? 'warping-out' : ''}`}
                    style={{ flex: 1, display: 'flex', position: 'relative', zIndex: 1, background: 'transparent' }}
                >
                    <Layout
                        renderPanel={renderPanel}
                        onPanelAdded={handlePanelAdded}
                        onPanelRemoved={handlePanelRemoved}
                        onPanelActivated={handlePanelActivated}
                        onCycleEditorDiffMode={handleCycleEditorDiffMode}
                        isEditorDiffEnabled={isEditorDiffEnabled}
                        getEditorDiffMode={editors.getEditorDiffMode}
                        onActionsReady={(actions) => {
                            layoutActionsRef.current = actions;
                        }}
                        canResetPanel={canResetPanel}
                        onResetPanel={handleResetPanel}
                        isEditorMarkdown={isEditorMarkdown}
                        isEditorMarkdownPreviewOpen={isEditorMarkdownPreviewOpen}
                        onToggleEditorMarkdownPreview={handleToggleEditorMarkdownPreview}
                    />
                </div>
            )}
            {folderPicker && (
                <ServerFolderPicker
                    socket={wsRef.current}
                    isConnected={isConnected}
                    recentProjects={workspaceState.recent_workspaces}
                    anchor={folderPicker.anchor}
                    onClose={() => setFolderPicker(null)}
                    onAdded={(next) => {
                        acceptWorkspaceState(next);
                        const project = next.projects.find((item) => item.id === next.active_project_id)
                            ?? next.projects[0];
                        if (project) {
                            bumpProjectLifecycleVersion(project.id);
                            fileTree.openFolder(project.root);
                            refreshProjectGit(project.id, true);
                        }
                    }}
                />
            )}
        </div>
    );
};

export default App;

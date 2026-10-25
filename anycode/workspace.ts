import { isTauri } from './constants';
import type { Socket } from 'socket.io-client';

export type RecentWorkspace = {
    path: string;
    name: string;
    last_opened: number;
};

export type WorkspaceConfig = {
    current_workspace: string | null;
    recent_workspaces: RecentWorkspace[];
    projects?: string[];
};

export type WorkspaceProject = {
    id: string;
    name: string;
    root: string;
};

export type WorkspaceState = {
    projects: WorkspaceProject[];
    active_project_id: string | null;
    recent_workspaces: RecentWorkspace[];
};

export type ServerDirectory = {
    name: string;
    path: string;
};

export type ServerDirectoryListing = {
    path: string;
    name: string;
    parent: string | null;
    directories: ServerDirectory[];
};

let cachedWorkspaceConfig: WorkspaceConfig | null = null;

export function getCachedWorkspaceState(): WorkspaceConfig | null {
    return cachedWorkspaceConfig;
}

export async function getWorkspaceState(): Promise<WorkspaceConfig> {
    if (isTauri) {
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const state = await invoke<WorkspaceConfig>('get_workspace_state');
            cachedWorkspaceConfig = state;
            return state;
        } catch (e) {
            console.error('Failed to get workspace state from Tauri:', e);
        }
    }
    const fallback: WorkspaceConfig = {
        current_workspace: null,
        recent_workspaces: cachedWorkspaceConfig?.recent_workspaces || [],
    };
    cachedWorkspaceConfig = fallback;
    return fallback;
}

export async function openFolderDialog(): Promise<string | null> {
    if (isTauri) {
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            return await invoke<string | null>('open_folder_dialog');
        } catch (e) {
            console.error('Failed to open folder dialog:', e);
        }
    }
    return null;
}

export async function openWorkspace(path: string): Promise<string | null> {
    if (isTauri) {
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            return await invoke<string>('open_workspace', { path });
        } catch (e) {
            console.error('Failed to open workspace:', e);
        }
    }
    return path;
}

const emitAck = <T,>(socket: Socket, event: string, payload?: unknown): Promise<T> => (
    new Promise((resolve, reject) => {
        socket.emit(event, payload ?? {}, (response: any) => {
            if (!response?.success) {
                reject(new Error(response?.error || `Request ${event} failed`));
                return;
            }
            resolve(response as T);
        });
    })
);

export const getRemoteWorkspaceState = (
    socket: Socket,
): Promise<WorkspaceState> => emitAck<WorkspaceState>(socket, 'workspace:state');

export const removeRemoteRecentWorkspace = async (
    socket: Socket,
    path: string,
): Promise<RecentWorkspace[]> => {
    const response = await emitAck<{ recent_workspaces: RecentWorkspace[] }>(
        socket,
        'workspace:remove-recent',
        { path },
    );
    return response.recent_workspaces;
};

export const browseServerDirectory = (
    socket: import('socket.io-client').Socket,
    path?: string,
): Promise<ServerDirectoryListing> => emitAck<ServerDirectoryListing>(
    socket,
    'workspace:browse',
    { path },
);

export const addRemoteProject = (
    socket: import('socket.io-client').Socket,
    path: string,
): Promise<WorkspaceState> => emitAck<WorkspaceState>(
    socket,
    'workspace:add-project',
    { path },
);

export const removeRemoteProject = (
    socket: import('socket.io-client').Socket,
    projectId: string,
): Promise<WorkspaceState> => emitAck<WorkspaceState>(
    socket,
    'workspace:remove-project',
    { project_id: projectId },
);

export const selectRemoteProject = (
    socket: import('socket.io-client').Socket,
    projectId: string,
): Promise<WorkspaceState> => emitAck<WorkspaceState>(
    socket,
    'workspace:select-project',
    { project_id: projectId },
);

export const closeRemoteWorkspace = (
    socket: import('socket.io-client').Socket,
): Promise<WorkspaceState> => emitAck<WorkspaceState>(socket, 'workspace:close');

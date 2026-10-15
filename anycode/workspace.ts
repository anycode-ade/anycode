import { isTauri } from './constants';

export type RecentWorkspace = {
    path: string;
    name: string;
    last_opened: number;
};

export type WorkspaceConfig = {
    current_workspace: string | null;
    recent_workspaces: RecentWorkspace[];
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

export async function removeRecentWorkspace(path: string): Promise<WorkspaceConfig> {
    if (isTauri) {
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            return await invoke<WorkspaceConfig>('remove_recent_workspace', { path });
        } catch (e) {
            console.error('Failed to remove recent workspace:', e);
        }
    }
    return { current_workspace: null, recent_workspaces: [] };
}

export async function closeWorkspace(): Promise<void> {
    if (isTauri) {
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('close_workspace');
        } catch (e) {
            console.error('Failed to close workspace:', e);
        }
    }
}

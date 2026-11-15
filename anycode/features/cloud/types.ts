import type { AcpQueuedMessage, AcpSession } from '../../types';

export type ServerConnectionStatus = 'connecting' | 'online' | 'offline' | 'auth_error';

export interface NodeServerInfo {
    name: string;
    os: string;
    arch: string;
    version: string;
}

export interface CloudProjectInfo {
    id: string;
    name: string;
    root: string;
}

export interface NodeAgentSummary {
    id: string;
    project_id?: string | null;
    name: string;
    session_id?: string | null;
    is_processing: boolean;
    queue: AcpQueuedMessage[];
    worktree_path?: string | null;
    worktree_branch?: string | null;
    diff_added?: number;
    diff_removed?: number;
    diff_files?: number;
}

export interface CloudServerView {
    id: string;
    name: string;
    url: string;
    open_url?: string | null;
    is_local: boolean;
    status: ServerConnectionStatus;
    error?: string | null;
    ping_ms?: number | null;
    info?: NodeServerInfo | null;
    projects: CloudProjectInfo[];
    agents: NodeAgentSummary[];
}

export interface CloudBrowseEntry {
    name: string;
    path: string;
}

export interface CloudBrowseResponse {
    path: string;
    name: string;
    parent?: string | null;
    directories: CloudBrowseEntry[];
}

export interface RemoteGitSyncMeta {
    base_sha: string;
    branch?: string | null;
    source_root?: string | null;
    source_name?: string | null;
    synced_at_epoch?: number;
}

export interface RemoteGitStateInfo {
    is_git_repo: boolean;
    is_worktree?: boolean;
    has_commits: boolean;
    head_sha?: string | null;
    branch?: string | null;
    branches?: string[];
    dirty_count: number;
    dirty_files: string[];
    commits_ahead: number;
    commits_summary: string[];
    sync_meta?: RemoteGitSyncMeta | null;
}

export interface CreateWorktreeResult {
    worktree_path?: string;
    branch?: string;
    project?: CloudProjectInfo;
    already_present?: boolean;
}

export interface RemoteWorktreeEntry {
    id: string;
    path: string;
    branch?: string | null;
    head_sha?: string | null;
    short_sha?: string | null;
    commits_ahead: number;
    dirty_count: number;
    is_dirty: boolean;
    base_sha?: string | null;
    is_main: boolean;
    diff_added?: number;
    diff_removed?: number;
    diff_files?: number;
}

export interface WorktreeDiffHunkLine {
    kind: 'context' | 'add' | 'del';
    text: string;
}

export interface WorktreeDiffHunk {
    old_start: number;
    new_start: number;
    lines: WorktreeDiffHunkLine[];
}

export interface WorktreeDiffFile {
    path: string;
    status: string;
    added: number;
    removed: number;
    is_binary: boolean;
    hunks: WorktreeDiffHunk[];
}

export interface WorktreeDiffResponse {
    worktree_path: string;
    base_sha?: string | null;
    branch?: string | null;
    added: number;
    removed: number;
    truncated: boolean;
    files: WorktreeDiffFile[];
}

export interface CloudDiffStatsEvent {
    server_id: string;
    agent_id: string;
    worktree_path?: string;
    diff_added: number;
    diff_removed: number;
    diff_files: number;
}

export interface PullProjectResult {
    success: boolean;
    changed: boolean;
    worktree_path?: string;
    branch?: string | null;
    project?: CloudProjectInfo;
    head_sha?: string;
    has_wip?: boolean;
    commits_count: number;
    dirty_count: number;
    commits_summary: string[];
    dirty_files: string[];
}

export type CloudAgentSession = AcpSession & {
    key: string;
    serverId: string;
    worktreePath?: string;
    worktreeBranch?: string;
    diffAdded?: number;
    diffRemoved?: number;
    diffFiles?: number;
};

export type CloudSelection =
    | { kind: 'server'; serverId: string }
    | { kind: 'project'; serverId: string; projectId: string }
    | { kind: 'agent'; serverId: string; agentId: string };

export const CLOUD_KEY_SEPARATOR = '::';

export const makeCloudSessionKey = (serverId: string, agentId: string): string =>
    `${serverId}${CLOUD_KEY_SEPARATOR}${agentId}`;

export const parseCloudSessionKey = (
    key: string,
): { serverId: string; agentId: string } | null => {
    const idx = key.indexOf(CLOUD_KEY_SEPARATOR);
    if (idx <= 0) return null;
    return {
        serverId: key.slice(0, idx),
        agentId: key.slice(idx + CLOUD_KEY_SEPARATOR.length),
    };
};

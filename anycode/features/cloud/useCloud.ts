import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type {
    AcpAgent,
    AcpMessage,
    AcpPromptAttachment,
    AcpQueuedMessage,
    AcpRegistryAgentSummary,
    AcpSelectOption,
    AcpSessionSummary,
} from '../../types';
import { getProfileEnvForAgent } from '../../agents';
import { generateUUID } from '../../utils';
import { applyAcpHistory, applyAcpMessageItem, mergeCloudQueue } from './acpReducer';
import {
    type CloudAgentSession,
    type CloudBrowseResponse,
    type CloudDiffStatsEvent,
    type CloudServerView,
    type CreateWorktreeResult,
    type PullProjectResult,
    type RemoteGitStateInfo,
    type RemoteWorktreeEntry,
    type WorktreeDiffResponse,
    makeCloudSessionKey,
} from './types';

const MESSAGE_FLUSH_MS = 25;

interface UseCloudParams {
    wsRef: React.RefObject<Socket | null>;
    isConnected: boolean;
}

type PendingCloudEvent = {
    server_id: string;
    agent_id: string;
    item: AcpMessage;
};

const emitWithAck = <T = any>(
    socket: Socket | null,
    event: string,
    payload: unknown,
): Promise<T> => {
    return new Promise((resolve, reject) => {
        if (!socket) {
            reject(new Error('Not connected to Anycode backend'));
            return;
        }
        socket.emit(event, payload, (response: any) => {
            if (!response || response.success === false) {
                reject(new Error(response?.error ?? `Request failed: ${event}`));
                return;
            }
            resolve(response as T);
        });
    });
};

export const useCloud = ({ wsRef, isConnected }: UseCloudParams) => {
    const [servers, setServers] = useState<CloudServerView[]>([]);
    const [sessions, setSessions] = useState<Map<string, CloudAgentSession>>(new Map());
    const [availableAgentsByServer, setAvailableAgentsByServer] = useState<Record<string, AcpAgent[]>>({});
    const [registryAgentsByServer, setRegistryAgentsByServer] = useState<Record<string, AcpRegistryAgentSummary[]>>({});
    const [isLoading, setIsLoading] = useState(false);

    const sessionsRef = useRef(sessions);
    sessionsRef.current = sessions;
    const pendingEventsRef = useRef<PendingCloudEvent[]>([]);
    const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const agentCountersRef = useRef<Record<string, number>>({});
    const reconnectedKeysRef = useRef<Set<string>>(new Set());
    const toolOutputCacheRef = useRef<Map<string, string>>(new Map());
    const diffStatsListenersRef = useRef<Set<(event: CloudDiffStatsEvent) => void>>(new Set());

    const updateSession = useCallback((
        key: string,
        updater: (session: CloudAgentSession | undefined) => CloudAgentSession | undefined,
    ) => {
        setSessions((prev) => {
            const next = updater(prev.get(key));
            const copy = new Map(prev);
            if (next === undefined) {
                copy.delete(key);
            } else {
                copy.set(key, next);
            }
            return copy;
        });
    }, []);

    const cloudRpc = useCallback(async <T = any>(
        serverId: string,
        method: string,
        params: Record<string, unknown> | null = {},
    ): Promise<T> => {
        const res = await emitWithAck<{ success: true; data: T }>(
            wsRef.current,
            'cloud:rpc',
            { server_id: serverId, method, params: params ?? {} },
        );
        return res.data;
    }, [wsRef]);

    const reconcileSessionsFromServers = useCallback((serverList: CloudServerView[]) => {
        // Compute reconnect targets synchronously outside React's state updater:
        // React 19 batches setSessions(prev => ...) inside async callbacks, so an
        // array mutated inside the updater would still be empty right after it.
        const reconnectByServer = new Map<string, string[]>();
        for (const srv of serverList) {
            if (srv.status !== 'online') continue;
            for (const agent of srv.agents) {
                const key = makeCloudSessionKey(srv.id, agent.id);
                if (!reconnectedKeysRef.current.has(key)) {
                    reconnectedKeysRef.current.add(key);
                    const keys = reconnectByServer.get(srv.id) ?? [];
                    keys.push(key);
                    reconnectByServer.set(srv.id, keys);
                }
            }
        }

        setSessions((prev) => {
            const copy = new Map(prev);
            const activeKeys = new Set<string>();

            for (const srv of serverList) {
                if (srv.status !== 'online') continue;
                for (const agent of srv.agents) {
                    const key = makeCloudSessionKey(srv.id, agent.id);
                    activeKeys.add(key);
                    const existing = copy.get(key);
                    if (existing) {
                        copy.set(key, {
                            ...existing,
                            agentName: agent.name || existing.agentName,
                            projectId: agent.project_id ?? existing.projectId,
                            sessionId: agent.session_id ?? existing.sessionId,
                            worktreePath: agent.worktree_path ?? existing.worktreePath,
                            worktreeBranch: agent.worktree_branch ?? existing.worktreeBranch,
                            diffAdded: agent.diff_added ?? existing.diffAdded,
                            diffRemoved: agent.diff_removed ?? existing.diffRemoved,
                            diffFiles: agent.diff_files ?? existing.diffFiles,
                            isActive: true,
                            isProcessing: agent.is_processing,
                            queue: mergeCloudQueue(existing.queue, agent.queue),
                        });
                    } else {
                        copy.set(key, {
                            key,
                            serverId: srv.id,
                            agentId: agent.id,
                            agentName: agent.name || agent.id,
                            projectId: agent.project_id ?? undefined,
                            sessionId: agent.session_id ?? undefined,
                            worktreePath: agent.worktree_path ?? undefined,
                            worktreeBranch: agent.worktree_branch ?? undefined,
                            diffAdded: agent.diff_added,
                            diffRemoved: agent.diff_removed,
                            diffFiles: agent.diff_files,
                            messages: [],
                            isActive: true,
                            isProcessing: agent.is_processing,
                            queue: agent.queue,
                        });
                    }
                }
            }

            for (const [key, sess] of copy.entries()) {
                if (!activeKeys.has(key) && !sess.isStarting && sess.isActive) {
                    copy.set(key, { ...sess, isActive: false, isProcessing: false });
                }
            }
            return copy;
        });

        for (const [serverId, keys] of reconnectByServer.entries()) {
            cloudRpc(serverId, 'acp:reconnect', {}).catch(() => {
                for (const key of keys) {
                    reconnectedKeysRef.current.delete(key);
                }
            });
        }
    }, [cloudRpc]);

    const refreshServers = useCallback(async () => {
        if (!wsRef.current || !isConnected) return;
        setIsLoading(true);
        try {
            const res = await emitWithAck<{ success: true; servers: CloudServerView[] }>(
                wsRef.current,
                'cloud:servers:list',
                {},
            );
            setServers(res.servers);
            reconcileSessionsFromServers(res.servers);
        } finally {
            setIsLoading(false);
        }
    }, [wsRef, isConnected, reconcileSessionsFromServers]);

    const flushPendingMessages = useCallback(() => {
        if (flushTimerRef.current) {
            clearTimeout(flushTimerRef.current);
            flushTimerRef.current = null;
        }
        const pending = pendingEventsRef.current;
        if (pending.length === 0) return;
        pendingEventsRef.current = [];
        for (const evt of pending) {
            const key = makeCloudSessionKey(evt.server_id, evt.agent_id);
            updateSession(key, (existing) =>
                applyAcpMessageItem(existing, key, evt.server_id, evt.agent_id, evt.item),
            );
        }
    }, [updateSession]);

    useEffect(() => {
        const socket = wsRef.current;
        if (!socket || !isConnected) return;

        const handleServersUpdated = (data: { servers: CloudServerView[] }) => {
            if (!Array.isArray(data?.servers)) return;
            setServers(data.servers);
            reconcileSessionsFromServers(data.servers);
        };

        const handleCloudAcpMessage = (data: PendingCloudEvent) => {
            if (!data?.server_id || !data?.agent_id || !data?.item) return;
            pendingEventsRef.current.push(data);
            if (!flushTimerRef.current) {
                flushTimerRef.current = setTimeout(flushPendingMessages, MESSAGE_FLUSH_MS);
            }
        };

        const handleCloudAcpHistory = (data: {
            server_id: string;
            agent_id: string;
            history: AcpMessage[];
        }) => {
            if (!data?.server_id || !data?.agent_id || !Array.isArray(data?.history)) return;
            flushPendingMessages();
            const key = makeCloudSessionKey(data.server_id, data.agent_id);
            updateSession(key, (existing) =>
                applyAcpHistory(existing, key, data.server_id, data.agent_id, data.history),
            );
        };

        const handleCloudAcpQueue = (data: {
            server_id: string;
            agent_id: string;
            queue: AcpQueuedMessage[];
        }) => {
            if (!data?.server_id || !data?.agent_id || !Array.isArray(data?.queue)) return;
            const key = makeCloudSessionKey(data.server_id, data.agent_id);
            updateSession(key, (existing) => {
                if (!existing) {
                    return {
                        key,
                        serverId: data.server_id,
                        agentId: data.agent_id,
                        agentName: data.agent_id,
                        messages: [],
                        isActive: true,
                        queue: data.queue,
                    };
                }
                return { ...existing, queue: mergeCloudQueue(existing.queue, data.queue) };
            });
        };

        const handleCloudAcpDiffStats = (data: CloudDiffStatsEvent) => {
            if (!data?.server_id || !data?.agent_id) return;
            const key = makeCloudSessionKey(data.server_id, data.agent_id);
            updateSession(key, (existing) => {
                if (!existing) return existing;
                return {
                    ...existing,
                    diffAdded: data.diff_added,
                    diffRemoved: data.diff_removed,
                    diffFiles: data.diff_files,
                };
            });
            setServers((prev) =>
                prev.map((srv) => {
                    if (srv.id !== data.server_id) return srv;
                    const idx = srv.agents.findIndex((a) => a.id === data.agent_id);
                    if (idx < 0) return srv;
                    const nextAgents = [...srv.agents];
                    nextAgents[idx] = {
                        ...nextAgents[idx],
                        diff_added: data.diff_added,
                        diff_removed: data.diff_removed,
                        diff_files: data.diff_files,
                    };
                    return { ...srv, agents: nextAgents };
                }),
            );
            for (const listener of diffStatsListenersRef.current) {
                listener(data);
            }
        };

        socket.on('cloud:servers:updated', handleServersUpdated);
        socket.on('cloud:acp:message', handleCloudAcpMessage);
        socket.on('cloud:acp:history', handleCloudAcpHistory);
        socket.on('cloud:acp:queue', handleCloudAcpQueue);
        socket.on('cloud:acp:diff_stats', handleCloudAcpDiffStats);

        refreshServers().catch(() => {});

        return () => {
            socket.off('cloud:servers:updated', handleServersUpdated);
            socket.off('cloud:acp:message', handleCloudAcpMessage);
            socket.off('cloud:acp:history', handleCloudAcpHistory);
            socket.off('cloud:acp:queue', handleCloudAcpQueue);
            socket.off('cloud:acp:diff_stats', handleCloudAcpDiffStats);
            reconnectedKeysRef.current.clear();
            if (flushTimerRef.current) {
                clearTimeout(flushTimerRef.current);
                flushTimerRef.current = null;
            }
        };
    }, [wsRef, isConnected, refreshServers, reconcileSessionsFromServers, flushPendingMessages, updateSession]);

    const addServer = useCallback(async (name: string, url: string, token?: string) => {
        const res = await emitWithAck<{ success: true; server: CloudServerView }>(
            wsRef.current,
            'cloud:servers:add',
            { name, url, token: token?.trim() || null },
        );
        return res.server;
    }, [wsRef]);

    const removeServer = useCallback(async (serverId: string) => {
        await emitWithAck(wsRef.current, 'cloud:servers:remove', { server_id: serverId });
        setSessions((prev) => {
            const copy = new Map(prev);
            for (const key of copy.keys()) {
                if (key.startsWith(`${serverId}::`)) copy.delete(key);
            }
            return copy;
        });
    }, [wsRef]);

    const reconnectServer = useCallback(async (serverId: string) => {
        await emitWithAck(wsRef.current, 'cloud:servers:reconnect', { server_id: serverId });
    }, [wsRef]);

    const browseDir = useCallback(async (serverId: string, path?: string): Promise<CloudBrowseResponse> => {
        return cloudRpc<CloudBrowseResponse>(serverId, 'workspace:browse', path ? { path } : {});
    }, [cloudRpc]);

    const addProject = useCallback(async (serverId: string, path: string) => {
        return cloudRpc(serverId, 'workspace:add-project', { path });
    }, [cloudRpc]);

    const syncProject = useCallback(async (
        serverId: string,
        path: string,
        name?: string,
        options?: { targetDir?: string; forceSync?: boolean },
    ) => {
        return cloudRpc(serverId, 'cloud:sync_project', {
            path,
            name: name?.trim() || null,
            target_dir: options?.targetDir?.trim() || null,
            force_sync: options?.forceSync ?? false,
        });
    }, [cloudRpc]);

    const cloneProject = useCallback(async (
        serverId: string,
        url: string,
        targetDir?: string,
        branch?: string,
    ) => {
        return cloudRpc(serverId, 'workspace:clone', {
            url,
            target_dir: targetDir?.trim() || null,
            branch: branch?.trim() || null,
        });
    }, [cloudRpc]);

    const removeProject = useCallback(async (serverId: string, projectId: string) => {
        return cloudRpc(serverId, 'workspace:remove-project', { project_id: projectId });
    }, [cloudRpc]);

    const getProjectGitInfo = useCallback(async (
        serverId: string,
        projectId?: string,
        remotePath?: string,
    ): Promise<RemoteGitStateInfo> => {
        return cloudRpc<RemoteGitStateInfo>(serverId, 'workspace:git-info', {
            project_id: projectId?.trim() || null,
            path: remotePath?.trim() || null,
        });
    }, [cloudRpc]);

    const pullProject = useCallback(async (
        serverId: string,
        options: {
            remoteProjectId?: string;
            remotePath?: string;
            localProjectPath: string;
            branch?: string;
            worktreeDir?: string;
        },
    ): Promise<PullProjectResult> => {
        return cloudRpc<PullProjectResult>(serverId, 'cloud:pull_project', {
            remote_project_id: options.remoteProjectId?.trim() || null,
            remote_path: options.remotePath?.trim() || null,
            local_project_path: options.localProjectPath,
            branch: options.branch?.trim() || null,
            worktree_dir: options.worktreeDir?.trim() || null,
        });
    }, [cloudRpc]);

    const createWorktree = useCallback(async (
        serverId: string,
        options: {
            projectId: string;
            branch?: string;
            includeDirty?: boolean;
            registerInWorkspace?: boolean;
        },
    ): Promise<CreateWorktreeResult> => {
        return cloudRpc<CreateWorktreeResult>(serverId, 'workspace:worktree:create', {
            project_id: options.projectId,
            branch: options.branch?.trim() || null,
            include_dirty: options.includeDirty ?? true,
            register_in_workspace: options.registerInWorkspace ?? false,
        });
    }, [cloudRpc]);

    const listWorktrees = useCallback(async (
        serverId: string,
        projectId?: string,
        remotePath?: string,
    ): Promise<RemoteWorktreeEntry[]> => {
        const res = await cloudRpc<{ worktrees?: RemoteWorktreeEntry[] }>(
            serverId,
            'workspace:worktree:list',
            {
                project_id: projectId?.trim() || null,
                path: remotePath?.trim() || null,
            },
        );
        return Array.isArray(res?.worktrees) ? res.worktrees : [];
    }, [cloudRpc]);

    const removeWorktree = useCallback(async (
        serverId: string,
        projectId: string,
        worktreePath: string,
    ): Promise<{ removed?: string }> => {
        return cloudRpc<{ removed?: string }>(serverId, 'workspace:worktree:remove', {
            project_id: projectId,
            worktree_path: worktreePath,
        });
    }, [cloudRpc]);

    const getWorktreeDiff = useCallback(async (
        serverId: string,
        worktreePath: string,
        projectId?: string,
    ): Promise<WorktreeDiffResponse> => {
        return cloudRpc<WorktreeDiffResponse>(serverId, 'workspace:worktree:diff', {
            project_id: projectId?.trim() || null,
            worktree_path: worktreePath,
        });
    }, [cloudRpc]);

    const subscribeDiffStats = useCallback((listener: (event: CloudDiffStatsEvent) => void) => {
        diffStatsListenersRef.current.add(listener);
        return () => {
            diffStatsListenersRef.current.delete(listener);
        };
    }, []);

    const loadAvailableAgents = useCallback(async (serverId: string, forceRefresh = false) => {
        const [cfgRes, regRes] = await Promise.allSettled([
            cloudRpc<{ agents: AcpAgent[] }>(serverId, 'acp:agents:get', {}),
            cloudRpc<{ agents: AcpRegistryAgentSummary[] }>(serverId, 'acp:registry:list', {
                force_refresh: forceRefresh,
            }),
        ]);
        const configured = cfgRes.status === 'fulfilled' && Array.isArray(cfgRes.value?.agents)
            ? cfgRes.value.agents
            : [];
        const registry = regRes.status === 'fulfilled' && Array.isArray(regRes.value?.agents)
            ? regRes.value.agents
            : [];

        setAvailableAgentsByServer((prev) => ({ ...prev, [serverId]: configured }));
        setRegistryAgentsByServer((prev) => ({ ...prev, [serverId]: registry }));
        return { configured, registry };
    }, [cloudRpc]);

    const installRegistryAgent = useCallback(async (serverId: string, agentId: string): Promise<AcpAgent> => {
        const res = await cloudRpc<{ preset: AcpAgent }>(serverId, 'acp:registry:install', {
            agent_id: agentId,
        });
        const installedAgent: AcpAgent = {
            ...res.preset,
            args: res.preset.args ?? [],
        };
        setAvailableAgentsByServer((prev) => {
            const list = prev[serverId] ?? [];
            const next = list.some((a) => a.id === installedAgent.id)
                ? list.map((a) => (a.id === installedAgent.id ? installedAgent : a))
                : [...list, installedAgent];
            return { ...prev, [serverId]: next };
        });
        return installedAgent;
    }, [cloudRpc]);

    const syncAgent = useCallback(async (serverId: string, agentId: string): Promise<AcpAgent> => {
        const res = await cloudRpc<{
            agent: AcpAgent;
            agents?: AcpAgent[];
            installed_from_registry?: boolean;
        }>(serverId, 'cloud:sync_agent', {
            agent_id: agentId,
        });
        const synced = res.agent;
        setAvailableAgentsByServer((prev) => {
            if (Array.isArray(res.agents)) {
                return { ...prev, [serverId]: res.agents };
            }
            const list = prev[serverId] ?? [];
            const next = list.some((a) => a.id === synced.id)
                ? list.map((a) => (a.id === synced.id ? synced : a))
                : [...list, synced];
            return { ...prev, [serverId]: next };
        });
        if (res.installed_from_registry) {
            loadAvailableAgents(serverId).catch(() => {});
        }
        return synced;
    }, [cloudRpc, loadAvailableAgents]);

    const removeConfiguredAgent = useCallback(async (
        serverId: string,
        agentId: string,
        removeProfile = true,
    ) => {
        const res = await cloudRpc<{
            removed: boolean;
            agents?: AcpAgent[];
        }>(serverId, 'acp:agent:remove', {
            agent_id: agentId,
            remove_profile: removeProfile,
        });
        setAvailableAgentsByServer((prev) => {
            if (Array.isArray(res.agents)) {
                return { ...prev, [serverId]: res.agents };
            }
            return {
                ...prev,
                [serverId]: (prev[serverId] ?? []).filter((a) => a.id !== agentId),
            };
        });
    }, [cloudRpc]);

    const listAgentSessions = useCallback(async (
        serverId: string,
        projectId: string,
        agent: AcpAgent,
    ): Promise<AcpSessionSummary[]> => {
        const res = await cloudRpc<{ sessions: AcpSessionSummary[] }>(serverId, 'acp:sessions_list', {
            command: agent.command,
            args: agent.args,
            project_id: projectId,
        });
        return res.sessions ?? [];
    }, [cloudRpc]);

    const sendPrompt = useCallback(async (
        serverId: string,
        agentId: string,
        prompt: string,
        attachments: AcpPromptAttachment[] = [],
    ) => {
        const key = makeCloudSessionKey(serverId, agentId);
        const session = sessionsRef.current.get(key);
        const normalizedAttachments = attachments.length > 0 ? attachments : undefined;

        if (session?.isProcessing) {
            const tempId = `queued-optimistic-${generateUUID()}`;
            const optimisticItem: AcpQueuedMessage = {
                id: tempId,
                prompt,
                attachments: normalizedAttachments,
                created_at: Math.floor(Date.now() / 1000),
            };
            updateSession(key, (existing) => existing ? {
                ...existing,
                queue: [...(existing.queue ?? []), optimisticItem],
            } : existing);
            try {
                const res = await cloudRpc<{ id?: string }>(serverId, 'acp:prompt', {
                    agent_id: agentId,
                    prompt,
                    attachments,
                });
                if (res?.id) {
                    updateSession(key, (existing) => existing ? {
                        ...existing,
                        queue: existing.queue?.map((q) => (q.id === tempId ? { ...q, id: res.id! } : q)),
                    } : existing);
                }
            } catch (err) {
                updateSession(key, (existing) => existing ? {
                    ...existing,
                    queue: existing.queue?.filter((q) => q.id !== tempId),
                } : existing);
                throw err;
            }
            return;
        }

        const clientId = generateUUID();
        updateSession(key, (existing) => existing ? {
            ...existing,
            isProcessing: true,
            messages: [
                ...existing.messages,
                { role: 'user', content: prompt, attachments: normalizedAttachments, client_id: clientId },
            ],
        } : existing);

        try {
            await cloudRpc(serverId, 'acp:prompt', {
                agent_id: agentId,
                prompt,
                attachments,
            });
        } catch (err) {
            updateSession(key, (existing) => existing ? {
                ...existing,
                isProcessing: false,
                messages: existing.messages.filter((m) => !('client_id' in m && m.client_id === clientId)),
            } : existing);
            throw err;
        }
    }, [cloudRpc, updateSession]);

    const startAgent = useCallback((params: {
        serverId: string;
        projectId: string;
        agent: AcpAgent;
        initialPrompt?: string;
        resumeSessionId?: string;
        createWorktree?: boolean;
        worktreeBranch?: string;
        worktreeName?: string;
        baseRef?: string;
        worktreePath?: string;
        includeDirty?: boolean;
    }): string => {
        const {
            serverId,
            projectId,
            agent,
            initialPrompt,
            resumeSessionId,
            createWorktree,
            worktreeBranch,
            worktreeName,
            baseRef,
            worktreePath,
            includeDirty,
        } = params;
        const countKey = `${serverId}::${agent.id}`;
        const nextNum = (agentCountersRef.current[countKey] ?? 0) + 1;
        agentCountersRef.current[countKey] = nextNum;
        const agentId = `${agent.id}-${nextNum}`;
        const key = makeCloudSessionKey(serverId, agentId);
        const profileEnv = agent.profile ? getProfileEnvForAgent(agent, agentId) : {};
        const mergedEnv = { ...profileEnv, ...(agent.env ?? {}) };

        const existingWorktree = worktreePath?.trim() || undefined;
        const shouldIsolate = Boolean(createWorktree && !resumeSessionId && !existingWorktree);
        const desiredBranch = worktreeBranch?.trim() || undefined;
        const cleanWorktreeName = worktreeName?.trim() || undefined;
        const optimisticBranch = desiredBranch ?? (shouldIsolate && cleanWorktreeName ? `agent/${cleanWorktreeName}` : undefined);

        updateSession(key, () => ({
            key,
            serverId,
            agentId,
            agentName: agent.name,
            agentConfigId: agent.id,
            projectId,
            profile: agent.profile,
            worktreePath: existingWorktree,
            worktreeBranch: optimisticBranch,
            messages: [],
            isActive: false,
            isStarting: true,
            isProcessing: false,
        }));

        (async () => {
            try {
                const res = await cloudRpc<{
                    agent_id: string;
                    project_id: string;
                    session_id?: string;
                    worktree_path?: string | null;
                    worktree_branch?: string | null;
                    diff_added?: number;
                    diff_removed?: number;
                    diff_files?: number;
                    auth_required?: boolean;
                    auth_methods?: Array<{ id: string; name: string; description?: string }>;
                }>(serverId, 'acp:start', {
                    agent_id: agentId,
                    agent_name: agent.name,
                    command: agent.command,
                    args: agent.args,
                    env: mergedEnv,
                    project_id: projectId,
                    resume_session_id: resumeSessionId ?? null,
                    isolate_worktree: shouldIsolate,
                    worktree_branch: desiredBranch ?? null,
                    worktree_name: worktreeName?.trim() || null,
                    base_ref: baseRef?.trim() || null,
                    worktree_path: existingWorktree ?? null,
                    include_dirty: includeDirty ?? true,
                });

                const authRequired = Boolean(res.auth_required);
                updateSession(key, (existing) => existing ? {
                    ...existing,
                    projectId: res.project_id ?? existing.projectId,
                    worktreePath: res.worktree_path ?? existing.worktreePath,
                    worktreeBranch: res.worktree_branch ?? existing.worktreeBranch,
                    diffAdded: res.diff_added ?? existing.diffAdded,
                    diffRemoved: res.diff_removed ?? existing.diffRemoved,
                    diffFiles: res.diff_files ?? existing.diffFiles,
                    isActive: !authRequired,
                    isStarting: false,
                    sessionId: res.session_id ?? existing.sessionId,
                    authRequired: authRequired ? { methods: res.auth_methods ?? [] } : undefined,
                } : existing);

                if (!authRequired && initialPrompt?.trim()) {
                    await sendPrompt(serverId, agentId, initialPrompt.trim(), []);
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                updateSession(key, (existing) => existing ? {
                    ...existing,
                    isStarting: false,
                    isActive: false,
                    startError: msg,
                } : existing);
            }
        })();

        return agentId;
    }, [cloudRpc, updateSession, sendPrompt]);

    const authenticateAgent = useCallback(async (serverId: string, agentId: string, methodId: string) => {
        const key = makeCloudSessionKey(serverId, agentId);
        updateSession(key, (existing) => existing ? {
            ...existing,
            isAuthenticating: true,
            pendingAuthMethod: methodId,
        } : existing);
        try {
            const res = await cloudRpc<{ session_id?: string }>(serverId, 'acp:authenticate', {
                agent_id: agentId,
                method_id: methodId,
            });
            updateSession(key, (existing) => existing ? {
                ...existing,
                isActive: true,
                isAuthenticating: false,
                pendingAuthMethod: undefined,
                authRequired: undefined,
                sessionId: res?.session_id ?? existing.sessionId,
            } : existing);
        } catch (err) {
            updateSession(key, (existing) => existing ? {
                ...existing,
                isAuthenticating: false,
                pendingAuthMethod: undefined,
            } : existing);
            throw err;
        }
    }, [cloudRpc, updateSession]);

    const cancelPrompt = useCallback((serverId: string, agentId: string) => {
        cloudRpc(serverId, 'acp:cancel', { agent_id: agentId }).catch(() => {});
    }, [cloudRpc]);

    const stopAgent = useCallback(async (serverId: string, agentId: string) => {
        const key = makeCloudSessionKey(serverId, agentId);
        await cloudRpc(serverId, 'acp:stop', { agent_id: agentId }).catch(() => {});
        reconnectedKeysRef.current.delete(key);
        updateSession(key, () => undefined);
    }, [cloudRpc, updateSession]);

    const undoPrompt = useCallback(async (
        serverId: string,
        agentId: string,
        checkpointId?: string,
        prompt?: string,
    ) => {
        const key = makeCloudSessionKey(serverId, agentId);
        await cloudRpc(serverId, 'acp:undo', {
            agent_id: agentId,
            checkpoint_id: checkpointId,
            prompt,
        });
        updateSession(key, (existing) => {
            if (!existing) return existing;
            if (checkpointId) {
                const idx = existing.messages.findIndex(
                    (m) => m.role === 'user' && m.checkpoint_id === checkpointId,
                );
                if (idx !== -1) {
                    return { ...existing, messages: existing.messages.slice(0, idx) };
                }
            }
            const lastUserIdx = existing.messages.map((m) => m.role).lastIndexOf('user');
            if (lastUserIdx !== -1) {
                return { ...existing, messages: existing.messages.slice(0, lastUserIdx) };
            }
            return existing;
        });
    }, [cloudRpc, updateSession]);

    const setSessionModel = useCallback((serverId: string, agentId: string, option: AcpSelectOption) => {
        const key = makeCloudSessionKey(serverId, agentId);
        updateSession(key, (existing) => existing?.modelSelector ? {
            ...existing,
            modelSelector: { ...existing.modelSelector, current_value: option.value },
        } : existing);
        cloudRpc(serverId, 'acp:set_model', { agent_id: agentId, option }).catch(() => {});
    }, [cloudRpc, updateSession]);

    const setSessionReasoning = useCallback((serverId: string, agentId: string, option: AcpSelectOption) => {
        const key = makeCloudSessionKey(serverId, agentId);
        updateSession(key, (existing) => existing?.reasoningSelector ? {
            ...existing,
            reasoningSelector: { ...existing.reasoningSelector, current_value: option.value },
        } : existing);
        cloudRpc(serverId, 'acp:set_reasoning', { agent_id: agentId, option }).catch(() => {});
    }, [cloudRpc, updateSession]);

    const updateQueuedPrompt = useCallback((serverId: string, agentId: string, itemId: string, prompt: string) => {
        cloudRpc(serverId, 'acp:queue:update', { agent_id: agentId, item_id: itemId, prompt }).catch(() => {});
    }, [cloudRpc]);

    const removeQueuedPrompt = useCallback((serverId: string, agentId: string, itemId: string) => {
        cloudRpc(serverId, 'acp:queue:remove', { agent_id: agentId, item_id: itemId }).catch(() => {});
    }, [cloudRpc]);

    const moveQueuedPrompt = useCallback((serverId: string, agentId: string, itemId: string, direction: 'up' | 'down') => {
        cloudRpc(serverId, 'acp:queue:move', { agent_id: agentId, item_id: itemId, direction }).catch(() => {});
    }, [cloudRpc]);

    const sendQueuedPromptNow = useCallback((serverId: string, agentId: string, itemId: string) => {
        cloudRpc(serverId, 'acp:queue:send_now', { agent_id: agentId, item_id: itemId }).catch(() => {});
    }, [cloudRpc]);

    const getToolOutput = useCallback(async (
        serverId: string,
        toolId: string,
        sessionId?: string,
    ): Promise<string | null> => {
        const cacheKey = `${serverId}::${sessionId ?? ''}::${toolId}`;
        const cached = toolOutputCacheRef.current.get(cacheKey);
        if (cached !== undefined) return cached;
        try {
            const res = await cloudRpc<{ output?: string }>(serverId, 'acp:get_tool_output', {
                tool_id: toolId,
                session_id: sessionId,
            });
            const out = res?.output ?? null;
            if (out !== null) toolOutputCacheRef.current.set(cacheKey, out);
            return out;
        } catch {
            return null;
        }
    }, [cloudRpc]);

    return {
        servers,
        sessions,
        availableAgentsByServer,
        registryAgentsByServer,
        isLoading,
        refreshServers,
        cloudRpc,
        addServer,
        removeServer,
        reconnectServer,
        browseDir,
        addProject,
        syncProject,
        cloneProject,
        removeProject,
        getProjectGitInfo,
        pullProject,
        createWorktree,
        listWorktrees,
        removeWorktree,
        getWorktreeDiff,
        subscribeDiffStats,
        loadAvailableAgents,
        installRegistryAgent,
        syncAgent,
        removeConfiguredAgent,
        listAgentSessions,
        startAgent,
        authenticateAgent,
        sendPrompt,
        cancelPrompt,
        stopAgent,
        undoPrompt,
        setSessionModel,
        setSessionReasoning,
        updateQueuedPrompt,
        removeQueuedPrompt,
        moveQueuedPrompt,
        sendQueuedPromptNow,
        getToolOutput,
    };
};

export type UseCloudReturn = ReturnType<typeof useCloud>;

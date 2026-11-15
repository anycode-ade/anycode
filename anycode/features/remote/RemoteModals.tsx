import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AcpAgent, AcpRegistryAgentSummary } from '../../types';
import { resolveAgentDisplay } from '../../agents';
import { Icons } from '../../components/Icons';
import { FileIcon } from '../../components/FileIcon';
import { AcpAvatar } from '../../components/agent/AcpAvatar';
import { AcpStartCard, groupAvailableAgents } from '../../components/agent/AcpStartCard';
import { loadSelectedProfiles, saveSelectedProfiles } from '../../storage';
import type {
    RemoteProjectInfo,
    RemoteServerView,
    CreateWorktreeResult,
    PullProjectResult,
    RemoteGitStateInfo,
    RemoteWorktreeEntry,
} from './types';

const VIEWPORT_MARGIN = 8;

const getRemotePopoverStyle = (anchor: HTMLElement | null, width: number): React.CSSProperties => {
    if (!anchor || !anchor.isConnected) {
        return {
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: Math.min(width, window.innerWidth - VIEWPORT_MARGIN * 2),
            maxHeight: window.innerHeight - VIEWPORT_MARGIN * 2,
        };
    }

    const rect = anchor.getBoundingClientRect();
    const effectiveWidth = Math.min(width, window.innerWidth - VIEWPORT_MARGIN * 2);
    const preferredLeft = rect.left + effectiveWidth <= window.innerWidth - VIEWPORT_MARGIN
        ? rect.left
        : rect.right - effectiveWidth;
    const left = Math.min(
        Math.max(preferredLeft, VIEWPORT_MARGIN),
        window.innerWidth - effectiveWidth - VIEWPORT_MARGIN,
    );

    const spaceBelow = window.innerHeight - rect.bottom - 6 - VIEWPORT_MARGIN;
    const spaceAbove = rect.top - 6 - VIEWPORT_MARGIN;
    if (spaceBelow >= 280 || spaceBelow >= spaceAbove) {
        return {
            top: rect.bottom + 6,
            left,
            width: effectiveWidth,
            maxHeight: Math.max(220, spaceBelow),
        };
    }
    return {
        bottom: window.innerHeight - rect.top + 6,
        left,
        width: effectiveWidth,
        maxHeight: Math.max(220, spaceAbove),
    };
};

interface RemotePopoverProps {
    title: string;
    subtitle?: string;
    anchor?: HTMLElement | null;
    width?: number;
    onClose: () => void;
    onSubmit?: (e: React.FormEvent) => void;
    children: React.ReactNode;
}

const RemotePopover: React.FC<RemotePopoverProps> = ({
    title,
    subtitle,
    anchor = null,
    width = 380,
    onClose,
    onSubmit,
    children,
}) => {
    const popoverRef = useRef<HTMLDivElement>(null);
    const [popoverStyle] = useState<React.CSSProperties>(() => getRemotePopoverStyle(anchor, width));

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };
        const handleMouseDown = (event: MouseEvent) => {
            const target = event.target as Node;
            if (popoverRef.current?.contains(target)) return;
            if (anchor && anchor.contains(target)) return;
            onClose();
        };
        const handleScroll = (event: Event) => {
            if (popoverRef.current?.contains(event.target as Node)) return;
            onClose();
        };

        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('mousedown', handleMouseDown, true);
        window.addEventListener('scroll', handleScroll, true);
        window.addEventListener('resize', onClose);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('mousedown', handleMouseDown, true);
            window.removeEventListener('scroll', handleScroll, true);
            window.removeEventListener('resize', onClose);
        };
    }, [anchor, onClose]);

    const header = (
        <div className="remote-popover-header">
            <div className="remote-popover-heading">
                <h3 className="remote-modal-title">{title}</h3>
                {subtitle && <span className="remote-popover-subtitle">{subtitle}</span>}
            </div>
            <button
                type="button"
                className="remote-header-btn"
                aria-label="Close"
                title="Close"
                onClick={onClose}
            >
                <Icons.CloseSmall size={14} />
            </button>
        </div>
    );

    const content = onSubmit ? (
        <div ref={popoverRef} className="remote-popover" style={popoverStyle} role="dialog" aria-label={title}>
            <form className="remote-popover-form" onSubmit={onSubmit}>
                {header}
                {children}
            </form>
        </div>
    ) : (
        <div ref={popoverRef} className="remote-popover" style={popoverStyle} role="dialog" aria-label={title}>
            {header}
            {children}
        </div>
    );

    return createPortal(content, document.body);
};

interface AddServerModalProps {
    anchor?: HTMLElement | null;
    onClose: () => void;
    onAdd: (name: string, url: string, token?: string) => Promise<void>;
}

export const AddServerModal: React.FC<AddServerModalProps> = ({ anchor = null, onClose, onAdd }) => {
    const [name, setName] = useState('');
    const [url, setUrl] = useState('http://127.0.0.1:3001');
    const [token, setToken] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const cliSnippet = useMemo(() => {
        const safeName = name.trim() || 'node-3001';
        const safeToken = token.trim() || 'mysecret';
        return `anycode -p 3001 --profile ${safeName.toLowerCase().replace(/[^a-z0-9_-]/g, '-')} --name "${safeName}" --token ${safeToken}`;
    }, [name, token]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
            await onAdd(name.trim(), url.trim(), token.trim() || undefined);
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <RemotePopover
            title="Connect Anycode Server"
            anchor={anchor}
            width={400}
            onClose={onClose}
            onSubmit={handleSubmit}
        >
                <div className="remote-field">
                    <label>Display Name (optional)</label>
                    <input
                        className="remote-input"
                        placeholder="e.g. EU-Worker or Port 3001"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                </div>
                <div className="remote-field">
                    <label>Server URL</label>
                    <input
                        className="remote-input"
                        placeholder="http://127.0.0.1:3001 or https://my-server.example.com"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        required
                    />
                </div>
                <div className="remote-field">
                    <label>Access Token (--token)</label>
                    <input
                        className="remote-input"
                        type="password"
                        placeholder="Leave empty if server runs without --token"
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                    />
                </div>
                <div className="remote-field">
                    <label>Run another instance on this machine or remote host</label>
                    <div className="remote-code-box">
                        <span>{cliSnippet}</span>
                        <button
                            type="button"
                            className="remote-btn"
                            onClick={() => {
                                navigator.clipboard?.writeText(cliSnippet);
                                setCopied(true);
                                setTimeout(() => setCopied(false), 1500);
                            }}
                        >
                            {copied ? 'Copied' : 'Copy'}
                        </button>
                    </div>
                </div>
                {error && <div className="remote-error-banner">{error}</div>}
                <div className="remote-modal-footer">
                    <button type="button" className="remote-btn" onClick={onClose}>Cancel</button>
                    <button type="submit" className="remote-btn primary" disabled={busy || !url.trim()}>
                        {busy ? 'Connecting...' : 'Connect Server'}
                    </button>
                </div>
        </RemotePopover>
    );
};

interface AddProjectModalProps {
    server: RemoteServerView;
    projects: RemoteProjectInfo[];
    anchor?: HTMLElement | null;
    onClose: () => void;
    onSyncProject: (
        serverId: string,
        path: string,
        name?: string,
        options?: { targetDir?: string; forceSync?: boolean },
    ) => Promise<void>;
}

const normalizeRootPath = (p: string): string => p.replace(/[\\/]+$/, '');

export const AddProjectModal: React.FC<AddProjectModalProps> = ({
    server,
    projects,
    anchor = null,
    onClose,
    onSyncProject,
}) => {
    const [busyProjectId, setBusyProjectId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleSync = async (
        proj: RemoteProjectInfo,
        options?: { targetDir?: string; forceSync?: boolean },
    ) => {
        setBusyProjectId(proj.id);
        setError(null);
        try {
            await onSyncProject(server.id, proj.root, proj.name, options);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusyProjectId(null);
        }
    };

    return (
        <RemotePopover
            title={`Add Project on ${server.name}`}
            anchor={anchor}
            width={420}
            onClose={onClose}
        >
            <div className="remote-field">
                <label>Projects from Projects panel</label>
                <div className="remote-sync-project-list">
                    {projects.length === 0 ? (
                        <div className="remote-empty-hint">
                            No projects added to the Projects panel yet.
                        </div>
                    ) : (
                        projects.map((proj) => {
                            const normRoot = normalizeRootPath(proj.root);
                            const exactMatch = server.projects.find(
                                (sp) => normalizeRootPath(sp.root) === normRoot,
                            );
                            const nameMatch = !exactMatch
                                ? server.projects.find((sp) => sp.name === proj.name)
                                : undefined;
                            const isBusy = busyProjectId === proj.id;

                            return (
                                <div key={proj.id} className="remote-sync-project-row">
                                    <span className="remote-sync-project-icon" aria-hidden="true">
                                        <FileIcon path={proj.root} isDirectory />
                                    </span>
                                    <div className="remote-sync-project-info">
                                        <div className="remote-sync-project-name">{proj.name}</div>
                                        <div className="remote-sync-project-path" title={proj.root}>
                                            {proj.root}
                                        </div>
                                    </div>
                                    <div className="remote-sync-project-actions">
                                        {exactMatch ? (
                                            <span className="remote-badge ok">Added</span>
                                        ) : nameMatch && !server.is_local ? (
                                            <>
                                                <span className="remote-badge ok">Synced</span>
                                                <button
                                                    type="button"
                                                    className="remote-btn"
                                                    disabled={busyProjectId !== null}
                                                    onClick={() =>
                                                        void handleSync(proj, {
                                                            targetDir: nameMatch.root,
                                                            forceSync: true,
                                                        })
                                                    }
                                                >
                                                    {isBusy ? 'Syncing...' : 'Sync'}
                                                </button>
                                            </>
                                        ) : (
                                            <button
                                                type="button"
                                                className="remote-btn"
                                                disabled={busyProjectId !== null}
                                                onClick={() => void handleSync(proj)}
                                            >
                                                {isBusy
                                                    ? server.is_local
                                                        ? 'Adding...'
                                                        : 'Syncing...'
                                                    : server.is_local
                                                      ? 'Add'
                                                      : 'Sync'}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
            {error && <div className="remote-error-banner">{error}</div>}
        </RemotePopover>
    );
};

interface SyncAgentsListProps {
    serverName: string;
    localAgents: AcpAgent[];
    remoteAgents: AcpAgent[];
    loading?: boolean;
    onSyncAgent: (agentId: string) => Promise<AcpAgent>;
    onRemoveAgent?: (agentId: string) => Promise<void>;
    onSyncedOne?: (agent: AcpAgent) => void;
    onSyncedAll?: () => void;
}

const getAgentSyncSubtext = (agent: AcpAgent): string => {
    const profilePath = agent.env
        ? Object.values(agent.env).find((v) => v.includes('.anycode/profiles/'))
        : undefined;
    if (profilePath) return profilePath;
    const cmd = agent.command?.trim() || agent.id;
    const slashIdx = Math.max(cmd.lastIndexOf('/'), cmd.lastIndexOf('\\'));
    const cmdName = slashIdx >= 0 ? cmd.slice(slashIdx + 1) : cmd;
    return `${cmdName} · ${agent.id}`;
};

const SyncAgentsList: React.FC<SyncAgentsListProps> = ({
    serverName,
    localAgents,
    remoteAgents,
    loading = false,
    onSyncAgent,
    onRemoveAgent,
    onSyncedOne,
    onSyncedAll,
}) => {
    const [busyAgentId, setBusyAgentId] = useState<string | null>(null);
    const [busyAction, setBusyAction] = useState<'sync' | 'remove' | null>(null);
    const [syncAllProgress, setSyncAllProgress] = useState<{ done: number; total: number } | null>(null);
    const [error, setError] = useState<string | null>(null);

    const localIds = useMemo(() => new Set(localAgents.map((a) => a.id)), [localAgents]);
    const remoteIds = useMemo(() => new Set(remoteAgents.map((a) => a.id)), [remoteAgents]);
    const remoteOnlyAgents = useMemo(
        () => (onRemoveAgent ? remoteAgents.filter((a) => !localIds.has(a.id)) : []),
        [remoteAgents, localIds, onRemoveAgent],
    );
    const isBusy = busyAgentId !== null || syncAllProgress !== null;

    const handleSyncOne = async (agentId: string) => {
        setBusyAgentId(agentId);
        setBusyAction('sync');
        setError(null);
        try {
            const synced = await onSyncAgent(agentId);
            onSyncedOne?.(synced);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusyAgentId(null);
            setBusyAction(null);
        }
    };

    const handleRemoveOne = async (agentId: string) => {
        if (!onRemoveAgent) return;
        setBusyAgentId(agentId);
        setBusyAction('remove');
        setError(null);
        try {
            await onRemoveAgent(agentId);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusyAgentId(null);
            setBusyAction(null);
        }
    };

    const handleSyncAll = async () => {
        if (localAgents.length === 0) return;
        setError(null);
        setBusyAction('sync');
        setSyncAllProgress({ done: 0, total: localAgents.length });
        try {
            for (let i = 0; i < localAgents.length; i++) {
                setSyncAllProgress({ done: i + 1, total: localAgents.length });
                setBusyAgentId(localAgents[i].id);
                await onSyncAgent(localAgents[i].id);
            }
            onSyncedAll?.();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusyAgentId(null);
            setBusyAction(null);
            setSyncAllProgress(null);
        }
    };

    return (
        <div className="remote-registry-box">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span className="remote-agent-row-sub">
                    {loading
                        ? 'Loading local agents...'
                        : `Local agents -> ${serverName} (installs missing binaries natively)`}
                </span>
                {localAgents.length > 0 && (
                    <button
                        type="button"
                        className="remote-btn accent-soft"
                        disabled={isBusy}
                        onClick={() => void handleSyncAll()}
                    >
                        {syncAllProgress
                            ? `Syncing ${syncAllProgress.done}/${syncAllProgress.total}...`
                            : 'Sync All'}
                    </button>
                )}
            </div>

            <div className="remote-sync-project-list">
                {localAgents.length === 0 && remoteOnlyAgents.length === 0 && !loading ? (
                    <div className="remote-empty-hint">
                        No configured agents found on Local yet.
                    </div>
                ) : (
                    <>
                        {localAgents.map((agent) => {
                            const { baseName, accountName } = resolveAgentDisplay(agent, localAgents);
                            const isSynced = remoteIds.has(agent.id);
                            const rowSyncing = busyAgentId === agent.id && busyAction === 'sync';
                            const rowRemoving = busyAgentId === agent.id && busyAction === 'remove';
                            return (
                                <div key={agent.id} className="remote-sync-project-row">
                                    <AcpAvatar type="agent" agentId={agent.id} agentTitle={agent.name} size={20} />
                                    <div className="remote-sync-project-info">
                                        <div className="remote-agent-row-head">
                                            <span className="remote-sync-project-name">{baseName}</span>
                                            {accountName && <span className="remote-badge">{accountName}</span>}
                                        </div>
                                        <div className="remote-sync-project-path" title={getAgentSyncSubtext(agent)}>
                                            {getAgentSyncSubtext(agent)}
                                        </div>
                                    </div>
                                    <div className="remote-sync-project-actions">
                                        {isSynced && <span className="remote-badge ok">Synced</span>}
                                        <button
                                            type="button"
                                            className="remote-btn"
                                            disabled={isBusy}
                                            onClick={() => void handleSyncOne(agent.id)}
                                        >
                                            {rowSyncing ? 'Syncing...' : 'Sync'}
                                        </button>
                                        {isSynced && onRemoveAgent && (
                                            <button
                                                type="button"
                                                className="remote-btn danger"
                                                disabled={isBusy}
                                                title={`Remove ${agent.id} and its profile from ${serverName}`}
                                                onClick={() => void handleRemoveOne(agent.id)}
                                            >
                                                {rowRemoving ? '...' : '×'}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                        {remoteOnlyAgents.map((agent) => {
                            const { baseName, accountName } = resolveAgentDisplay(agent, remoteAgents);
                            const rowRemoving = busyAgentId === agent.id && busyAction === 'remove';
                            return (
                                <div key={`remote-${agent.id}`} className="remote-sync-project-row">
                                    <AcpAvatar type="agent" agentId={agent.id} agentTitle={agent.name} size={20} />
                                    <div className="remote-sync-project-info">
                                        <div className="remote-agent-row-head">
                                            <span className="remote-sync-project-name">{baseName}</span>
                                            {accountName && <span className="remote-badge">{accountName}</span>}
                                            <span className="remote-badge">Remote only</span>
                                        </div>
                                        <div className="remote-sync-project-path" title={getAgentSyncSubtext(agent)}>
                                            {getAgentSyncSubtext(agent)}
                                        </div>
                                    </div>
                                    <div className="remote-sync-project-actions">
                                        <button
                                            type="button"
                                            className="remote-btn danger"
                                            disabled={isBusy}
                                            title={`Remove ${agent.id} and its profile from ${serverName}`}
                                            onClick={() => void handleRemoveOne(agent.id)}
                                        >
                                            {rowRemoving ? 'Removing...' : 'Remove'}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </>
                )}
            </div>
            {error && <div className="remote-error-banner">{error}</div>}
        </div>
    );
};

interface SyncAgentsModalProps {
    server: RemoteServerView;
    anchor?: HTMLElement | null;
    availableAgentsByServer: Record<string, AcpAgent[]>;
    onLoadAvailableAgents: (serverId: string) => Promise<{
        configured: AcpAgent[];
        registry: AcpRegistryAgentSummary[];
    }>;
    onSyncAgent: (serverId: string, agentId: string) => Promise<AcpAgent>;
    onRemoveAgent?: (serverId: string, agentId: string) => Promise<void>;
    onClose: () => void;
}

export const SyncAgentsModal: React.FC<SyncAgentsModalProps> = ({
    server,
    anchor = null,
    availableAgentsByServer,
    onLoadAvailableAgents,
    onSyncAgent,
    onRemoveAgent,
    onClose,
}) => {
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        setLoading(true);
        Promise.allSettled([
            onLoadAvailableAgents('local'),
            onLoadAvailableAgents(server.id),
        ]).finally(() => setLoading(false));
    }, [server.id, onLoadAvailableAgents]);

    return (
        <RemotePopover
            title={`Sync Agents to ${server.name}`}
            anchor={anchor}
            width={450}
            onClose={onClose}
        >
            <SyncAgentsList
                serverName={server.name}
                localAgents={availableAgentsByServer.local ?? []}
                remoteAgents={availableAgentsByServer[server.id] ?? []}
                loading={loading}
                onSyncAgent={(agentId) => onSyncAgent(server.id, agentId)}
                onRemoveAgent={onRemoveAgent ? (agentId) => onRemoveAgent(server.id, agentId) : undefined}
            />
        </RemotePopover>
    );
};

interface StartAgentModalProps {
    servers: RemoteServerView[];
    initialServerId: string;
    initialProjectId?: string;
    initialWorktreePath?: string;
    initialWorktreeBranch?: string;
    anchor?: HTMLElement | null;
    availableAgentsByServer: Record<string, AcpAgent[]>;
    registryAgentsByServer: Record<string, AcpRegistryAgentSummary[]>;
    onLoadAvailableAgents: (serverId: string) => Promise<{
        configured: AcpAgent[];
        registry: AcpRegistryAgentSummary[];
    }>;
    onInstallRegistryAgent: (serverId: string, agentId: string) => Promise<AcpAgent>;
    onSyncAgent?: (serverId: string, agentId: string) => Promise<AcpAgent>;
    onRemoveAgent?: (serverId: string, agentId: string) => Promise<void>;
    onLoadGitInfo?: (serverId: string, projectId: string) => Promise<RemoteGitStateInfo>;
    onLoadWorktrees?: (serverId: string, projectId: string) => Promise<RemoteWorktreeEntry[]>;
    onStartAgent: (params: {
        serverId: string;
        projectId: string;
        agent: AcpAgent;
        createWorktree?: boolean;
        worktreeBranch?: string;
        worktreeName?: string;
        baseRef?: string;
        worktreePath?: string;
        includeDirty?: boolean;
    }) => string;
    onClose: () => void;
    onStarted: (serverId: string, agentId: string) => void;
}

const generateWorktreeHash = (len = 8): string => {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    const bytes = new Uint8Array(len);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
};

const installedRegistryItemToAgent = (item: AcpRegistryAgentSummary): AcpAgent | null => {
    if (item.is_installed && item.installed_path && item.binary_target) {
        return {
            id: item.id,
            name: item.name,
            command: item.installed_path,
            args: item.binary_target.args ?? [],
            description: item.description,
            icon: item.icon,
            version: item.installed_version ?? item.version,
            authors: item.authors,
            env: item.binary_target.env,
        };
    }
    return null;
};

export const StartAgentModal: React.FC<StartAgentModalProps> = ({
    servers,
    initialServerId,
    initialProjectId,
    initialWorktreePath,
    initialWorktreeBranch,
    anchor = null,
    availableAgentsByServer,
    registryAgentsByServer,
    onLoadAvailableAgents,
    onInstallRegistryAgent,
    onSyncAgent,
    onRemoveAgent,
    onLoadGitInfo,
    onLoadWorktrees,
    onStartAgent,
    onClose,
    onStarted,
}) => {
    const serverId = initialServerId || servers.find((s) => s.status === 'online')?.id || 'local';
    const selectedServer = useMemo(
        () => servers.find((s) => s.id === serverId),
        [servers, serverId],
    );
    const projectId = useMemo(() => {
        if (initialProjectId && selectedServer?.projects.some((p) => p.id === initialProjectId)) {
            return initialProjectId;
        }
        return initialProjectId || selectedServer?.projects[0]?.id || '';
    }, [initialProjectId, selectedServer]);
    const [worktreeMode, setWorktreeMode] = useState<'new' | 'existing'>(() =>
        initialWorktreePath ? 'existing' : 'new',
    );
    const [worktreeName, setWorktreeName] = useState(() => generateWorktreeHash(8));
    const [baseRef, setBaseRef] = useState('');
    const [includeDirty, setIncludeDirty] = useState(true);
    const [availableWorktrees, setAvailableWorktrees] = useState<RemoteWorktreeEntry[]>([]);
    const [selectedWorktreePath, setSelectedWorktreePath] = useState(initialWorktreePath || '');
    const [projectGitInfo, setProjectGitInfo] = useState<RemoteGitStateInfo | null>(null);
    const [selectedProfileByGroup, setSelectedProfileByGroup] = useState<Record<string, string>>(
        () => loadSelectedProfiles(),
    );
    const [loadingAgents, setLoadingAgents] = useState(false);
    const [loadingLocalAgents, setLoadingLocalAgents] = useState(false);
    const [panelMode, setPanelMode] = useState<'configured' | 'sync'>('configured');
    const [error, setError] = useState<string | null>(null);

    const canSyncFromLocal = Boolean(onSyncAgent && selectedServer && !selectedServer.is_local);

    useEffect(() => {
        if (!canSyncFromLocal && panelMode === 'sync') {
            setPanelMode('configured');
        }
    }, [canSyncFromLocal, panelMode]);

    useEffect(() => {
        if (!serverId) return;
        setLoadingAgents(true);
        onLoadAvailableAgents(serverId)
            .catch(() => {})
            .finally(() => setLoadingAgents(false));
    }, [serverId, onLoadAvailableAgents]);

    useEffect(() => {
        if (!serverId || !projectId || !onLoadGitInfo) {
            setProjectGitInfo(null);
            return;
        }
        let cancelled = false;
        onLoadGitInfo(serverId, projectId)
            .then((info) => {
                if (cancelled) return;
                setProjectGitInfo(info);
                const defBranch = info.branch || info.branches?.[0] || '';
                setBaseRef((prev) => prev || defBranch);
            })
            .catch(() => {
                if (cancelled) return;
                setProjectGitInfo(null);
            });
        return () => {
            cancelled = true;
        };
    }, [serverId, projectId, onLoadGitInfo, initialWorktreePath]);

    useEffect(() => {
        if (!serverId || !projectId || !onLoadWorktrees) {
            setAvailableWorktrees([]);
            return;
        }
        let cancelled = false;
        onLoadWorktrees(serverId, projectId)
            .then((list) => {
                if (cancelled) return;
                setAvailableWorktrees(list);
                setSelectedWorktreePath((prev) => {
                    if (initialWorktreePath && initialWorktreePath === prev) return prev;
                    if (prev && list.some((w) => w.path === prev)) return prev;
                    return list[0]?.path ?? '';
                });
            })
            .catch(() => {
                if (!cancelled) setAvailableWorktrees([]);
            });
        return () => {
            cancelled = true;
        };
    }, [serverId, projectId, onLoadWorktrees, initialWorktreePath]);

    useEffect(() => {
        if (panelMode !== 'sync') return;
        setLoadingLocalAgents(true);
        onLoadAvailableAgents('local')
            .catch(() => {})
            .finally(() => setLoadingLocalAgents(false));
    }, [panelMode, onLoadAvailableAgents]);

    const candidateAgents = useMemo(() => {
        const configured = availableAgentsByServer[serverId] ?? [];
        const byId = new Map<string, AcpAgent>();
        for (const a of configured) byId.set(a.id, a);
        const registry = registryAgentsByServer[serverId] ?? [];
        for (const item of registry) {
            if (!item.is_supported || !item.is_installed || byId.has(item.id)) continue;
            const converted = installedRegistryItemToAgent(item);
            if (converted) byId.set(converted.id, converted);
        }
        return Array.from(byId.values());
    }, [availableAgentsByServer, registryAgentsByServer, serverId]);

    const agentGroups = useMemo(() => groupAvailableAgents(candidateAgents), [candidateAgents]);

    const handleSelectProfile = (baseName: string, agentId: string) => {
        setSelectedProfileByGroup((prev) => {
            const next = { ...prev, [baseName]: agentId };
            saveSelectedProfiles(next);
            return next;
        });
    };

    const selectedProjectName = selectedServer?.projects.find((p) => p.id === projectId)?.name;
    const branchOptions = useMemo(() => {
        const list = projectGitInfo?.branches ?? [];
        if (list.length > 0) return list;
        return projectGitInfo?.branch ? [projectGitInfo.branch] : [];
    }, [projectGitInfo]);
    const effectiveBaseRef = baseRef || projectGitInfo?.branch || branchOptions[0] || '';
    const isCurrentBranch = !projectGitInfo?.branch || effectiveBaseRef === projectGitInfo.branch;
    const dirtyCount = projectGitInfo?.dirty_count ?? 0;

    const handleStartCard = (agent: AcpAgent) => {
        if (!projectId) {
            setError('Add or select a project before starting an agent.');
            return;
        }
        const canIsolate = projectGitInfo
            ? Boolean(projectGitInfo.is_git_repo && projectGitInfo.has_commits && !projectGitInfo.is_worktree)
            : true;
        const chosenExisting = worktreeMode === 'existing'
            ? (availableWorktrees.find((w) => w.path === selectedWorktreePath)
                ?? (initialWorktreePath
                    ? { path: initialWorktreePath, branch: initialWorktreeBranch }
                    : undefined))
            : undefined;
        if (worktreeMode === 'existing' && !chosenExisting) {
            setError('Select an existing worktree or switch to New worktree.');
            return;
        }
        const createNewWorktree = worktreeMode === 'new' && canIsolate;
        const aid = onStartAgent({
            serverId,
            projectId,
            agent,
            createWorktree: createNewWorktree,
            worktreeBranch: chosenExisting?.branch ?? undefined,
            worktreeName: createNewWorktree ? (worktreeName.trim() || undefined) : undefined,
            baseRef: createNewWorktree ? (baseRef.trim() || undefined) : undefined,
            worktreePath: chosenExisting?.path,
            includeDirty: createNewWorktree ? (isCurrentBranch && includeDirty) : undefined,
        });
        onStarted(serverId, aid);
        onClose();
    };

    return (
        <RemotePopover
            title="Start Agent"
            subtitle={[selectedServer?.name, selectedProjectName].filter(Boolean).join(' · ') || undefined}
            anchor={anchor}
            width={460}
            onClose={onClose}
        >

                {(!projectGitInfo || (projectGitInfo.is_git_repo && projectGitInfo.has_commits && !projectGitInfo.is_worktree)) && (
                    worktreeMode === 'new' ? (
                        <>
                            <div className="remote-modal-row-2col">
                                <div className="remote-field">
                                    <label>Worktree name</label>
                                    <input
                                        className="remote-input remote-wt-name-input"
                                        value={worktreeName}
                                        onChange={(e) => setWorktreeName(e.target.value)}
                                        placeholder="auto"
                                    />
                                </div>
                                <div className="remote-field">
                                    <label>From branch</label>
                                    <select
                                        className="remote-select"
                                        value={effectiveBaseRef}
                                        disabled={branchOptions.length === 0}
                                        onChange={(e) => {
                                            const next = e.target.value;
                                            setBaseRef(next);
                                            if (projectGitInfo?.branch) {
                                                setIncludeDirty(next === projectGitInfo.branch);
                                            }
                                        }}
                                    >
                                        {branchOptions.length === 0 ? (
                                            <option value="">HEAD</option>
                                        ) : (
                                            branchOptions.map((b) => (
                                                <option key={b} value={b}>
                                                    {b}
                                                    {b === projectGitInfo?.branch ? ' (current)' : ''}
                                                </option>
                                            ))
                                        )}
                                    </select>
                                </div>
                            </div>

                            {isCurrentBranch && (
                                <div className="remote-wt-meta-row">
                                    {!projectGitInfo || dirtyCount > 0 ? (
                                        <label className="remote-checkbox-row">
                                            <input
                                                type="checkbox"
                                                checked={includeDirty}
                                                onChange={(e) => setIncludeDirty(e.target.checked)}
                                            />
                                            <span>
                                                {dirtyCount > 0
                                                    ? `Include +${dirtyCount} uncommitted`
                                                    : 'Include uncommitted'}
                                            </span>
                                        </label>
                                    ) : (
                                        <span className="remote-hint-muted">Working tree clean</span>
                                    )}
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="remote-wt-target-row">
                            <div className="remote-wt-target-info">
                                <span className="remote-agent-wt-badge">
                                    {(selectedWorktreePath || initialWorktreePath || '')
                                        .split(/[\\/]/)
                                        .filter(Boolean)
                                        .pop() || 'worktree'}
                                </span>
                                {availableWorktrees.length > 1 || (!initialWorktreePath && availableWorktrees.length > 0) ? (
                                    <select
                                        className="remote-select"
                                        value={selectedWorktreePath}
                                        onChange={(e) => setSelectedWorktreePath(e.target.value)}
                                    >
                                        {availableWorktrees.map((wt) => (
                                            <option key={wt.path} value={wt.path}>
                                                {wt.id} · {wt.branch || 'detached'}
                                                {wt.commits_ahead > 0 ? ` (+${wt.commits_ahead})` : ''}
                                                {wt.dirty_count > 0 ? ` · ${wt.dirty_count} dirty` : ''}
                                            </option>
                                        ))}
                                    </select>
                                ) : (
                                    <span className="remote-wt-target-branch">
                                        {availableWorktrees[0]?.branch || initialWorktreeBranch || 'detached'}
                                    </span>
                                )}
                            </div>
                            <button
                                type="button"
                                className="remote-link-btn"
                                onClick={() => setWorktreeMode('new')}
                            >
                                New worktree
                            </button>
                        </div>
                    )
                )}

                <div className="remote-field">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <label>Agent {loadingAgents ? '(loading...)' : ''}</label>
                        {canSyncFromLocal && (
                            <button
                                type="button"
                                className="remote-link-btn"
                                onClick={() =>
                                    setPanelMode((m) => (m === 'sync' ? 'configured' : 'sync'))
                                }
                            >
                                {panelMode === 'sync' ? 'Back to configured' : 'Sync'}
                            </button>
                        )}
                    </div>

                    {panelMode === 'sync' && canSyncFromLocal ? (
                        <SyncAgentsList
                            serverName={selectedServer?.name ?? serverId}
                            localAgents={availableAgentsByServer.local ?? []}
                            remoteAgents={availableAgentsByServer[serverId] ?? []}
                            loading={loadingLocalAgents}
                            onSyncAgent={(agentId) => onSyncAgent!(serverId, agentId)}
                            onRemoveAgent={onRemoveAgent ? (agentId) => onRemoveAgent(serverId, agentId) : undefined}
                            onSyncedOne={(synced) => {
                                const { baseName } = resolveAgentDisplay(synced, [...candidateAgents, synced]);
                                handleSelectProfile(baseName, synced.id);
                                setPanelMode('configured');
                            }}
                            onSyncedAll={() => setPanelMode('configured')}
                        />
                    ) : (
                        <div className="remote-agent-picker">
                            {agentGroups.length === 0 && !loadingAgents ? (
                                <div className="remote-empty-hint">
                                    {canSyncFromLocal
                                        ? 'No agents configured on this server yet. Use "Sync".'
                                        : 'No agents configured on this server yet.'}
                                </div>
                            ) : (
                                agentGroups.map((group) => (
                                    <AcpStartCard
                                        key={group.baseName}
                                        group={group}
                                        selectedAgentId={selectedProfileByGroup[group.baseName]}
                                        onSelectProfile={handleSelectProfile}
                                        onStart={handleStartCard}
                                        disabled={!projectId}
                                        title={
                                            projectId
                                                ? `Start ${group.baseName} in ${selectedProjectName ?? 'selected project'}`
                                                : 'Add or select a project before starting an agent'
                                        }
                                    />
                                ))
                            )}
                        </div>
                    )}
                </div>

                {error && <div className="remote-error-banner">{error}</div>}
        </RemotePopover>
    );
};

interface PullWorktreeModalProps {
    server: RemoteServerView;
    remoteProject: RemoteProjectInfo;
    remotePath?: string;
    remoteLabel?: string;
    localProjects: RemoteProjectInfo[];
    anchor?: HTMLElement | null;
    onLoadGitInfo: (
        serverId: string,
        projectId?: string,
        remotePath?: string,
    ) => Promise<RemoteGitStateInfo>;
    onPullProject: (
        serverId: string,
        options: {
            remoteProjectId?: string;
            remotePath?: string;
            localProjectPath: string;
            branch?: string;
        },
    ) => Promise<PullProjectResult>;
    onOpenPulledProject?: (projectId: string) => void;
    onClose: () => void;
}

const sanitizeBranchSlug = (s: string): string =>
    s
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'node';

export const PullWorktreeModal: React.FC<PullWorktreeModalProps> = ({
    server,
    remoteProject,
    remotePath,
    remoteLabel,
    localProjects,
    anchor = null,
    onLoadGitInfo,
    onPullProject,
    onOpenPulledProject,
    onClose,
}) => {
    const [gitInfo, setGitInfo] = useState<RemoteGitStateInfo | null>(null);
    const [loadingInfo, setLoadingInfo] = useState(true);
    const [localPath, setLocalPath] = useState('');
    const [branch, setBranch] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<PullProjectResult | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoadingInfo(true);
        setError(null);
        onLoadGitInfo(server.id, remotePath ? undefined : remoteProject.id, remotePath)
            .then((info) => {
                if (cancelled) return;
                setGitInfo(info);
                const now = new Date();
                const stamp = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
                const serverSlug = sanitizeBranchSlug(server.name);
                const targetLabel = sanitizeBranchSlug(info.branch || remoteLabel || remoteProject.name);
                setBranch((prev) => prev || `remote/${serverSlug}/${targetLabel}-${stamp}`);
            })
            .catch((err) => {
                if (cancelled) return;
                setError(err instanceof Error ? err.message : String(err));
            })
            .finally(() => {
                if (!cancelled) setLoadingInfo(false);
            });
        return () => {
            cancelled = true;
        };
    }, [server.id, server.name, remoteProject.id, remoteProject.name, onLoadGitInfo]);

    useEffect(() => {
        if (localProjects.length === 0) {
            setLocalPath('');
            return;
        }
        const sourceRoot = gitInfo?.sync_meta?.source_root
            ? normalizeRootPath(gitInfo.sync_meta.source_root)
            : '';
        const byRoot = sourceRoot
            ? localProjects.find((p) => normalizeRootPath(p.root) === sourceRoot)
            : undefined;
        const byName = localProjects.find((p) => p.name === remoteProject.name);
        const preferred = byRoot ?? byName ?? localProjects[0];
        setLocalPath((prev) => {
            if (prev && localProjects.some((p) => p.root === prev)) return prev;
            return preferred?.root ?? '';
        });
    }, [localProjects, remoteProject.name, gitInfo]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!localPath) return;
        setBusy(true);
        setError(null);
        try {
            const res = await onPullProject(server.id, {
                remoteProjectId: remotePath ? undefined : remoteProject.id,
                remotePath,
                localProjectPath: localPath,
                branch: branch.trim() || undefined,
            });
            setResult(res);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    };

    const previewItems = useMemo(() => {
        if (!gitInfo) return [];
        const lines: string[] = [];
        for (const c of gitInfo.commits_summary) lines.push(`commit ${c}`);
        for (const d of gitInfo.dirty_files) lines.push(d);
        return lines;
    }, [gitInfo]);

    return (
        <RemotePopover
            title={`Pull Worktree from ${server.name}`}
            anchor={anchor}
            width={450}
            onClose={onClose}
            onSubmit={!result ? handleSubmit : undefined}
        >
            {result ? (
                result.changed ? (
                    <>
                        <div className="remote-field">
                            <label>Worktree Created Locally</label>
                            <div className="remote-code-box">
                                <span>
                                    {result.branch}
                                    {result.worktree_path ? `\n${result.worktree_path}` : ''}
                                </span>
                            </div>
                        </div>
                        <div className="remote-field">
                            <label>Pulled Changes</label>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                <span className="remote-badge ok">
                                    {result.commits_count} commit{result.commits_count === 1 ? '' : 's'}
                                </span>
                                {result.dirty_count > 0 && (
                                    <span className="remote-badge warn">
                                        {result.dirty_count} unstaged file{result.dirty_count === 1 ? '' : 's'}
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="remote-empty-hint" style={{ padding: 0 }}>
                            Added to your local Projects panel & Changes tab for review.
                        </div>
                        <div className="remote-modal-footer">
                            <button type="button" className="remote-btn" onClick={onClose}>
                                Close
                            </button>
                            {result.project?.id && onOpenPulledProject && (
                                <button
                                    type="button"
                                    className="remote-btn accent-soft"
                                    onClick={() => {
                                        onOpenPulledProject(result.project!.id);
                                        onClose();
                                    }}
                                >
                                    Open Project
                                </button>
                            )}
                        </div>
                    </>
                ) : (
                    <>
                        <div className="remote-empty-hint" style={{ padding: 0 }}>
                            Remote project has no new commits or uncommitted edits to pull.
                        </div>
                        <div className="remote-modal-footer">
                            <button type="button" className="remote-btn" onClick={onClose}>
                                Close
                            </button>
                        </div>
                    </>
                )
            ) : (
                <>
                    <div className="remote-field">
                        <label>
                            Remote Repository ({remoteLabel || remoteProject.name})
                        </label>
                        {loadingInfo ? (
                            <div className="remote-empty-hint" style={{ padding: 0 }}>
                                Inspecting remote git state...
                            </div>
                        ) : gitInfo && !gitInfo.is_git_repo ? (
                            <div className="remote-error-banner">
                                Remote folder has no <code>.git</code> directory yet. Re-sync it via
                                {' '}<strong>+ Project → Sync</strong> so it uses Git bundles.
                            </div>
                        ) : gitInfo ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                                    {gitInfo.is_worktree && (
                                        <span className="remote-badge accent">worktree</span>
                                    )}
                                    <span className="remote-badge">
                                        {gitInfo.branch || 'detached'}
                                        {gitInfo.head_sha ? ` @ ${gitInfo.head_sha.slice(0, 7)}` : ''}
                                    </span>
                                    <span className={`remote-badge ${gitInfo.commits_ahead > 0 ? 'ok' : ''}`}>
                                        {gitInfo.commits_ahead} commit{gitInfo.commits_ahead === 1 ? '' : 's'} ahead
                                    </span>
                                    <span className={`remote-badge ${gitInfo.dirty_count > 0 ? 'warn' : ''}`}>
                                        {gitInfo.dirty_count} modified/untracked
                                    </span>
                                </div>
                                {previewItems.length > 0 && (
                                    <div
                                        className="remote-code-box"
                                        style={{
                                            maxHeight: 110,
                                            overflowY: 'auto',
                                            whiteSpace: 'pre',
                                            display: 'block',
                                        }}
                                    >
                                        {previewItems.slice(0, 30).join('\n')}
                                    </div>
                                )}
                            </div>
                        ) : null}
                    </div>

                    <div className="remote-field">
                        <label>Target Local Repository</label>
                        {localProjects.length === 0 ? (
                            <div className="remote-empty-hint" style={{ padding: 0 }}>
                                Add a matching local Git project to the Projects panel first.
                            </div>
                        ) : (
                            <select
                                className="remote-select"
                                value={localPath}
                                onChange={(e) => setLocalPath(e.target.value)}
                                disabled={busy}
                            >
                                {localProjects.map((p) => (
                                    <option key={p.id} value={p.root}>
                                        {p.name} ({p.root})
                                    </option>
                                ))}
                            </select>
                        )}
                    </div>

                    <div className="remote-field">
                        <label>New Worktree Branch</label>
                        <input
                            className="remote-input"
                            value={branch}
                            onChange={(e) => setBranch(e.target.value)}
                            placeholder="remote/node/branch"
                            disabled={busy}
                        />
                    </div>

                    <div className="remote-empty-hint" style={{ padding: 0 }}>
                        Creates a local <code>git worktree</code> without touching your current branch.
                        Uncommitted remote edits stay unstaged for review.
                    </div>

                    {error && <div className="remote-error-banner">{error}</div>}

                    <div className="remote-modal-footer">
                        <button type="button" className="remote-btn" onClick={onClose} disabled={busy}>
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="remote-btn accent-soft"
                            disabled={
                                busy
                                || loadingInfo
                                || !localPath
                                || (gitInfo ? !gitInfo.is_git_repo : false)
                            }
                        >
                            {busy ? 'Pulling...' : 'Pull into Worktree'}
                        </button>
                    </div>
                </>
            )}
        </RemotePopover>
    );
};

interface CreateWorktreeModalProps {
    anchor: HTMLElement | null;
    server: RemoteServerView;
    project: RemoteProjectInfo;
    onCreateWorktree: (
        serverId: string,
        options: { projectId: string; branch?: string; includeDirty?: boolean },
    ) => Promise<CreateWorktreeResult>;
    onCreated?: (serverId: string, projectId: string) => void;
    onClose: () => void;
}

export const CreateWorktreeModal: React.FC<CreateWorktreeModalProps> = ({
    anchor,
    server,
    project,
    onCreateWorktree,
    onCreated,
    onClose,
}) => {
    const [branch, setBranch] = useState('');
    const [includeDirty, setIncludeDirty] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            const res = await onCreateWorktree(server.id, {
                projectId: project.id,
                branch: branch.trim() || undefined,
                includeDirty,
            });
            onCreated?.(server.id, res.project?.id ?? project.id);
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <RemotePopover
            title={`New Worktree on ${server.name}`}
            anchor={anchor}
            width={410}
            onClose={onClose}
            onSubmit={handleSubmit}
        >
            <div className="remote-field">
                <label>Base Project</label>
                <div className="remote-code-box">
                    <span>
                        {project.name} ({project.root})
                    </span>
                </div>
            </div>

            <div className="remote-field">
                <label>Branch Name (optional)</label>
                <input
                    className="remote-input"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    placeholder="agent/task-..."
                    autoFocus
                    disabled={busy}
                />
            </div>

            <label
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 12,
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                }}
            >
                <input
                    type="checkbox"
                    checked={includeDirty}
                    onChange={(e) => setIncludeDirty(e.target.checked)}
                    disabled={busy}
                />
                <span>Copy uncommitted edits from base project</span>
            </label>

            <div className="remote-empty-hint" style={{ padding: 0 }}>
                Creates an isolated <code>git worktree</code> with full commit history so agents can
                commit work without touching the base checkout.
            </div>

            {error && <div className="remote-error-banner">{error}</div>}

            <div className="remote-modal-footer">
                <button type="button" className="remote-btn" onClick={onClose} disabled={busy}>
                    Cancel
                </button>
                <button type="submit" className="remote-btn accent-soft" disabled={busy}>
                    {busy ? 'Creating...' : 'Create Worktree'}
                </button>
            </div>
        </RemotePopover>
    );
};

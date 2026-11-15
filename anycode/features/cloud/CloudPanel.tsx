import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Icons } from '../../components/Icons';
import { FileIcon } from '../../components/FileIcon';
import { Split } from '../../components/layout/Layout';
import { AnycodeAgentSession } from '../../components/agent/AnycodeAgentSession';
import { AcpAvatar } from '../../components/agent/AcpAvatar';
import { AcpOpenedAgentCard } from '../../components/agent/AcpOpenedAgentCard';
import {
    AddProjectModal,
    AddServerModal,
    CreateWorktreeModal,
    PullWorktreeModal,
    StartAgentModal,
    SyncAgentsModal,
} from './CloudModals';
import {
    type CloudAgentSession,
    type CloudProjectInfo,
    type CloudSelection,
    type CloudServerView,
    type RemoteGitStateInfo,
    type RemoteWorktreeEntry,
    makeCloudSessionKey,
} from './types';
import type { UseCloudReturn } from './useCloud';
import './CloudPanel.css';

interface CloudPanelProps {
    cloud: UseCloudReturn;
    isConnected: boolean;
    workspaceProjects?: CloudProjectInfo[];
    onOpenWorktreeDiff?: (params: {
        serverId: string;
        worktreePath: string;
        projectId?: string;
        title?: string;
    }) => Promise<void> | void;
}

const statusLabel: Record<CloudServerView['status'], string> = {
    online: 'Online',
    connecting: 'Connecting',
    offline: 'Offline',
    auth_error: 'Auth error',
};

const statusBadgeClass: Record<CloudServerView['status'], string> = {
    online: 'ok',
    connecting: 'warn',
    offline: '',
    auth_error: 'err',
};

export const CloudPanel: React.FC<CloudPanelProps> = ({
    cloud,
    isConnected,
    workspaceProjects,
    onOpenWorktreeDiff,
}) => {
    const [selection, setSelection] = useState<CloudSelection>({
        kind: 'server',
        serverId: 'local',
    });
    const [collapsedServers, setCollapsedServers] = useState<Record<string, boolean>>({});
    const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});
    const [addServerAnchor, setAddServerAnchor] = useState<HTMLElement | null>(null);
    const [addProjectState, setAddProjectState] = useState<{
        server: CloudServerView;
        anchor: HTMLElement | null;
    } | null>(null);
    const [syncAgentsState, setSyncAgentsState] = useState<{
        server: CloudServerView;
        anchor: HTMLElement | null;
    } | null>(null);
    const [startAgentTarget, setStartAgentTarget] = useState<{
        serverId: string;
        projectId?: string;
        worktreePath?: string;
        worktreeBranch?: string;
        anchor: HTMLElement | null;
    } | null>(null);
    const [worktrees, setWorktrees] = useState<RemoteWorktreeEntry[]>([]);
    const [projectGitInfo, setProjectGitInfo] = useState<RemoteGitStateInfo | null>(null);
    const [worktreesLoading, setWorktreesLoading] = useState(false);
    const [removingWorktreePath, setRemovingWorktreePath] = useState<string | null>(null);
    const [worktreesRefreshTick, setWorktreesRefreshTick] = useState(0);
    const [pullWorktreeState, setPullWorktreeState] = useState<{
        server: CloudServerView;
        project: CloudProjectInfo;
        remotePath?: string;
        remoteLabel?: string;
        anchor: HTMLElement | null;
    } | null>(null);
    const [createWorktreeState, setCreateWorktreeState] = useState<{
        server: CloudServerView;
        project: CloudProjectInfo;
        anchor: HTMLElement | null;
    } | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [armedRemoveKey, setArmedRemoveKey] = useState<string | null>(null);

    useEffect(() => {
        if (!armedRemoveKey) return;
        const timer = window.setTimeout(() => setArmedRemoveKey(null), 3000);
        return () => window.clearTimeout(timer);
    }, [armedRemoveKey]);

    const renderArmedRemoveButton = (options: {
        confirmKey: string;
        title: string;
        confirmTitle: string;
        disabled?: boolean;
        className?: string;
        children?: React.ReactNode;
        onConfirm: () => void;
    }) => {
        const armed = !options.disabled && armedRemoveKey === options.confirmKey;
        return (
            <button
                type="button"
                className={`${options.className || 'cloud-icon-btn'}${armed ? ' is-armed' : ''}`}
                disabled={options.disabled}
                title={armed ? options.confirmTitle : options.title}
                aria-label={armed ? options.confirmTitle : options.title}
                onClick={(e) => {
                    e.stopPropagation();
                    if (options.disabled) return;
                    if (armed) {
                        setArmedRemoveKey(null);
                        options.onConfirm();
                    } else {
                        setArmedRemoveKey(options.confirmKey);
                    }
                }}
                onBlur={() => {
                    setArmedRemoveKey((cur) => (cur === options.confirmKey ? null : cur));
                }}
            >
                {options.children ?? '×'}
            </button>
        );
    };

    useEffect(() => {
        if (cloud.servers.length === 0) return;
        const exists = cloud.servers.some((s) => s.id === selection.serverId);
        if (!exists) {
            setSelection({ kind: 'server', serverId: cloud.servers[0].id });
        }
    }, [cloud.servers, selection.serverId]);

    const selectedServer = useMemo(
        () => cloud.servers.find((s) => s.id === selection.serverId) ?? cloud.servers[0],
        [cloud.servers, selection.serverId],
    );

    const selectedProject = useMemo(() => {
        if (!selectedServer) return undefined;
        if (selection.kind === 'project') {
            return selectedServer.projects.find((p) => p.id === selection.projectId);
        }
        if (selection.kind === 'agent') {
            const key = makeCloudSessionKey(selection.serverId, selection.agentId);
            const sess = cloud.sessions.get(key);
            if (sess?.projectId) {
                return selectedServer.projects.find((p) => p.id === sess.projectId);
            }
        }
        return undefined;
    }, [selectedServer, selection, cloud.sessions]);

    const selectedSession = useMemo(() => {
        if (selection.kind !== 'agent') return undefined;
        return cloud.sessions.get(makeCloudSessionKey(selection.serverId, selection.agentId));
    }, [selection, cloud.sessions]);

    const sessionsByServer = useMemo(() => {
        const grouped = new Map<string, CloudAgentSession[]>();
        for (const sess of cloud.sessions.values()) {
            const list = grouped.get(sess.serverId) ?? [];
            list.push(sess);
            grouped.set(sess.serverId, list);
        }
        return grouped;
    }, [cloud.sessions]);

    const selectedProjectAgentKey = useMemo(() => {
        if (selection.kind !== 'project' || !selectedServer || !selectedProject) return '';
        return (sessionsByServer.get(selectedServer.id) ?? [])
            .filter((a) => a.projectId === selectedProject.id)
            .map((a) => `${a.agentId}:${a.worktreePath ?? ''}:${a.isActive ? '1' : '0'}`)
            .sort()
            .join('|');
    }, [selection.kind, selectedServer, selectedProject, sessionsByServer]);

    useEffect(() => {
        if (
            selection.kind !== 'project'
            || !selectedServer
            || selectedServer.status !== 'online'
            || !selectedProject
        ) {
            setWorktrees([]);
            setProjectGitInfo(null);
            setWorktreesLoading(false);
            return;
        }
        let cancelled = false;
        setWorktreesLoading(true);
        setProjectGitInfo(null);
        cloud
            .listWorktrees(selectedServer.id, selectedProject.id)
            .then((entries) => {
                if (!cancelled) setWorktrees(entries);
            })
            .catch(() => {
                if (!cancelled) setWorktrees([]);
            })
            .finally(() => {
                if (!cancelled) setWorktreesLoading(false);
            });
        cloud
            .getProjectGitInfo(selectedServer.id, selectedProject.id)
            .then((info) => {
                if (!cancelled) setProjectGitInfo(info);
            })
            .catch(() => {
                if (!cancelled) setProjectGitInfo(null);
            });
        return () => {
            cancelled = true;
        };
    }, [
        selection.kind,
        selectedServer?.id,
        selectedServer?.status,
        selectedProject?.id,
        selectedProjectAgentKey,
        worktreesRefreshTick,
        cloud.listWorktrees,
        cloud.getProjectGitInfo,
    ]);

    const handleRemoveWorktree = async (
        serverId: string,
        projectId: string,
        worktreePath: string,
    ) => {
        setActionError(null);
        setRemovingWorktreePath(worktreePath);
        try {
            await cloud.removeWorktree(serverId, projectId, worktreePath);
            setWorktrees((prev) => prev.filter((w) => w.path !== worktreePath));
            setWorktreesRefreshTick((t) => t + 1);
        } catch (err) {
            setActionError(err instanceof Error ? err.message : String(err));
        } finally {
            setRemovingWorktreePath((cur) => (cur === worktreePath ? null : cur));
        }
    };

    const toggleServerCollapsed = (serverId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setCollapsedServers((prev) => ({ ...prev, [serverId]: !prev[serverId] }));
    };

    const toggleProjectCollapsed = (serverId: string, projectId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const key = `${serverId}::${projectId}`;
        setCollapsedProjects((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    const handleRemoveProject = async (serverId: string, projectId: string) => {
        setActionError(null);
        try {
            await cloud.removeProject(serverId, projectId);
            setSelection({ kind: 'server', serverId });
        } catch (err) {
            setActionError(err instanceof Error ? err.message : String(err));
        }
    };

    const handleStopAgent = async (serverId: string, agentId: string, e?: React.MouseEvent) => {
        e?.stopPropagation();
        await cloud.stopAgent(serverId, agentId);
        if (
            selection.kind === 'agent'
            && selection.serverId === serverId
            && selection.agentId === agentId
        ) {
            const sess = cloud.sessions.get(makeCloudSessionKey(serverId, agentId));
            if (sess?.projectId) {
                setSelection({ kind: 'project', serverId, projectId: sess.projectId });
            } else {
                setSelection({ kind: 'server', serverId });
            }
        }
    };

    const formatWorktreeBadge = (agent: CloudAgentSession): string | undefined => {
        if (agent.worktreePath) {
            const name = agent.worktreePath.split(/[\\/]/).filter(Boolean).pop();
            if (name) return name;
        }
        return agent.worktreeBranch ? agent.worktreeBranch.replace(/^agent\//, '') : undefined;
    };

    const triggerOpenWorktreeDiff = useCallback(
        (params: {
            serverId: string;
            worktreePath: string;
            projectId?: string;
            title?: string;
        }) => {
            if (!onOpenWorktreeDiff) return;
            Promise.resolve(onOpenWorktreeDiff(params)).catch((err) => {
                setActionError(err instanceof Error ? err.message : String(err));
            });
        },
        [onOpenWorktreeDiff],
    );

    const renderSidebarAgentRow = (serverId: string, agent: CloudAgentSession) => {
        const agentSelected =
            selection.kind === 'agent'
            && selection.serverId === serverId
            && selection.agentId === agent.agentId;
        const wtBadge = formatWorktreeBadge(agent);
        const diffAdded = agent.diffAdded ?? 0;
        const diffRemoved = agent.diffRemoved ?? 0;
        const diffFiles = agent.diffFiles ?? 0;
        const hasDiffStats = Boolean(
            agent.worktreePath && (diffAdded > 0 || diffRemoved > 0 || diffFiles > 0),
        );
        const showSubRow = Boolean(wtBadge || hasDiffStats);
        const srv = cloud.servers.find((s) => s.id === serverId);
        const proj = srv?.projects.find((p) => p.id === agent.projectId);

        return (
            <div
                key={agent.key}
                className={`cloud-agent-row${agentSelected ? ' active' : ''}${agent.isProcessing ? ' is-working' : ''}${agent.isStarting ? ' is-starting' : ''}`}
                onClick={() =>
                    setSelection({
                        kind: 'agent',
                        serverId,
                        agentId: agent.agentId,
                    })
                }
            >
                <span className="cloud-agent-avatar">
                    <AcpAvatar
                        type="agent"
                        agentId={agent.agentConfigId ?? agent.agentId}
                        agentTitle={agent.agentName}
                        size={showSubRow ? 24 : 16}
                    />
                </span>
                <div className="cloud-agent-main">
                    <div className="cloud-agent-top-row">
                        <span className="cloud-agent-name">
                            {agent.agentName || agent.agentId}
                        </span>
                        <div className="cloud-agent-top-right">
                            {agent.isStarting ? (
                                <span className="cloud-agent-spinner" title="Starting agent..." />
                            ) : agent.startError ? (
                                <span className="cloud-agent-state error" title={agent.startError} />
                            ) : (
                                <span
                                    className={`cloud-agent-state ${agent.isProcessing ? 'busy' : ''}`}
                                    title={agent.isProcessing ? 'Working...' : 'Ready'}
                                />
                            )}
                            {renderArmedRemoveButton({
                                confirmKey: `agent:${agent.key}`,
                                className: 'cloud-icon-btn danger cloud-agent-remove-btn',
                                title: 'Stop agent',
                                confirmTitle: 'Click again to stop agent',
                                onConfirm: () => void handleStopAgent(serverId, agent.agentId),
                            })}
                        </div>
                    </div>
                    {showSubRow && (
                        <div className="cloud-agent-sub-row">
                            {wtBadge && (
                                <span
                                    className="cloud-agent-wt-badge"
                                    title={agent.worktreePath ? `${agent.worktreeBranch} · ${agent.worktreePath}` : agent.worktreeBranch}
                                >
                                    {wtBadge}
                                </span>
                            )}
                            {hasDiffStats && agent.worktreePath && (
                                <button
                                    type="button"
                                    className="cloud-diff-pill"
                                    title={`Open worktree diff (${diffFiles} ${diffFiles === 1 ? 'file' : 'files'})`}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        triggerOpenWorktreeDiff({
                                            serverId,
                                            worktreePath: agent.worktreePath!,
                                            projectId: agent.projectId,
                                            title: `${proj?.name ? `${proj.name} · ` : ''}${wtBadge ?? 'Diff'}`,
                                        });
                                    }}
                                >
                                    {diffAdded > 0 && (
                                        <span className="cloud-diff-added">+{diffAdded}</span>
                                    )}
                                    {diffRemoved > 0 && (
                                        <span className="cloud-diff-removed">-{diffRemoved}</span>
                                    )}
                                    {diffAdded === 0 && diffRemoved === 0 && (
                                        <span className="cloud-diff-neutral">{diffFiles}f</span>
                                    )}
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    const renderOpenedAgentsSection = (
        server: CloudServerView,
        agents: CloudAgentSession[],
        emptyText: string,
    ) => {
        const availableAgents = cloud.availableAgentsByServer[server.id] ?? [];
        return (
            <div className="cloud-section">
                <div className="cloud-section-header">
                    <span className="cloud-section-title">
                        Active Agents ({agents.length})
                    </span>
                </div>
                {agents.length === 0 ? (
                    <div className="cloud-empty-detail">{emptyText}</div>
                ) : (
                    <div className="cloud-opened-agents-grid">
                        {agents.map((a) => (
                            <AcpOpenedAgentCard
                                key={a.key}
                                session={a}
                                availableAgents={availableAgents}
                                projects={server.projects}
                                onSelectAgent={(agentId) =>
                                    setSelection({
                                        kind: 'agent',
                                        serverId: server.id,
                                        agentId,
                                    })
                                }
                                onCloseAgent={(agentId) => void handleStopAgent(server.id, agentId)}
                            />
                        ))}
                    </div>
                )}
            </div>
        );
    };

    useEffect(() => {
        if (!selectedServer || selectedServer.status !== 'online') return;
        if (cloud.availableAgentsByServer[selectedServer.id]) return;
        cloud.loadAvailableAgents(selectedServer.id).catch(() => {});
    }, [selectedServer, cloud.availableAgentsByServer, cloud.loadAvailableAgents]);

    const handleTreeMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        const origin = e.target as HTMLElement;
        const targets = [
            origin.closest('.cloud-server-group'),
            origin.closest('.cloud-project-row, .cloud-agent-row'),
        ];
        for (const el of targets) {
            if (el instanceof HTMLElement) {
                const rect = el.getBoundingClientRect();
                el.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
                el.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
            }
        }
    }, []);

    const sidebarPane = (
        <aside className="cloud-sidebar">
            <div className="cloud-sidebar-header">
                <span className="cloud-sidebar-title">Servers ({cloud.servers.length})</span>
                <div className="cloud-sidebar-actions">
                    <button
                        type="button"
                        className="cloud-header-btn"
                        title="Refresh servers"
                        aria-label="Refresh servers"
                        onClick={() => cloud.refreshServers()}
                        disabled={!isConnected}
                    >
                        <Icons.Refresh size={14} />
                    </button>
                    <button
                        type="button"
                        className="cloud-header-btn"
                        title="Add server"
                        aria-label="Add server"
                        onClick={(e) => {
                            const anchor = e.currentTarget;
                            setAddServerAnchor((prev) => (prev === anchor ? null : anchor));
                        }}
                        disabled={!isConnected}
                    >
                        <Icons.Plus size={14} />
                    </button>
                </div>
            </div>

            <div className="cloud-tree" onMouseMove={handleTreeMouseMove}>
                {cloud.servers.map((srv) => {
                    const isCollapsed = Boolean(collapsedServers[srv.id]);
                    const serverSelected = selection.kind === 'server' && selection.serverId === srv.id;
                    const serverSessions = sessionsByServer.get(srv.id) ?? [];
                    const projectIds = new Set(srv.projects.map((p) => p.id));
                    const orphanAgents = serverSessions.filter(
                        (a) => !a.projectId || !projectIds.has(a.projectId),
                    );

                    return (
                        <div
                            key={srv.id}
                            className={`cloud-server-group ${serverSelected ? 'selected' : ''}`}
                        >
                            <div
                                className={`cloud-server-row ${serverSelected ? 'active' : ''}`}
                                onClick={() => setSelection({ kind: 'server', serverId: srv.id })}
                            >
                                <button
                                    type="button"
                                    className={`cloud-caret-btn ${isCollapsed ? 'collapsed' : ''}`}
                                    onClick={(e) => toggleServerCollapsed(srv.id, e)}
                                    aria-label={isCollapsed ? 'Expand server' : 'Collapse server'}
                                >
                                    <Icons.ChevronDown size={15} />
                                </button>
                                <span
                                    className={`cloud-status-dot ${srv.status}${srv.error && srv.status !== 'online' ? ' has-error' : ''}`}
                                />
                                <div className="cloud-server-meta">
                                    <div className="cloud-server-name-line">
                                        <span className="cloud-server-name">{srv.name}</span>
                                        {srv.is_local && <span className="cloud-badge">local</span>}
                                        {srv.status === 'online' ? (
                                            srv.ping_ms != null && (
                                                <span className="cloud-badge ok">{srv.ping_ms}ms</span>
                                            )
                                        ) : (
                                            <span className={`cloud-badge ${statusBadgeClass[srv.status] || 'err'}`}>
                                                {statusLabel[srv.status]}
                                            </span>
                                        )}
                                    </div>
                                    <span
                                        className={`cloud-server-sub${srv.error ? ' is-error' : ''}`}
                                        title={srv.error || (srv.info ? `${srv.info.os}/${srv.info.arch}` : srv.url)}
                                    >
                                        {srv.error || (srv.info ? `${srv.info.os}/${srv.info.arch}` : srv.url)}
                                    </span>
                                </div>
                                <div className="cloud-row-actions">
                                    {srv.status === 'online' && (
                                        <button
                                            type="button"
                                            className="cloud-icon-btn"
                                            title="Add project"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                const anchor = e.currentTarget;
                                                setAddProjectState((prev) =>
                                                    prev?.anchor === anchor
                                                        ? null
                                                        : { server: srv, anchor }
                                                );
                                            }}
                                        >
                                            +
                                        </button>
                                    )}
                                    {!srv.is_local && srv.status !== 'online' && (
                                        <button
                                            type="button"
                                            className="cloud-icon-btn"
                                            title="Reconnect"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                cloud.reconnectServer(srv.id);
                                            }}
                                        >
                                            ↻
                                        </button>
                                    )}
                                    {!srv.is_local && renderArmedRemoveButton({
                                        confirmKey: `server:${srv.id}`,
                                        title: 'Disconnect & remove server',
                                        confirmTitle: 'Click again to remove server',
                                        onConfirm: () => cloud.removeServer(srv.id),
                                    })}
                                </div>
                            </div>

                            {!isCollapsed && (
                                <div className="cloud-server-children">
                                    {srv.projects.length === 0 ? (
                                        <div className="cloud-empty-hint">
                                            {srv.status === 'online' ? 'No projects yet' : statusLabel[srv.status]}
                                        </div>
                                    ) : (
                                        srv.projects.map((proj) => {
                                            const projectSelected =
                                                selection.kind === 'project'
                                                && selection.serverId === srv.id
                                                && selection.projectId === proj.id;
                                            const projectCollapsed = Boolean(
                                                collapsedProjects[`${srv.id}::${proj.id}`],
                                            );
                                            const projAgents = serverSessions.filter(
                                                (a) => a.projectId === proj.id,
                                            );

                                            return (
                                                <div key={proj.id} className="cloud-project-block">
                                                    <div
                                                        className={`cloud-project-row ${projectSelected ? 'active' : ''}`}
                                                        onClick={() =>
                                                            setSelection({
                                                                kind: 'project',
                                                                serverId: srv.id,
                                                                projectId: proj.id,
                                                            })
                                                        }
                                                    >
                                                        <button
                                                            type="button"
                                                            className={`cloud-caret-btn ${projectCollapsed ? 'collapsed' : ''}`}
                                                            onClick={(e) => toggleProjectCollapsed(srv.id, proj.id, e)}
                                                            aria-label={projectCollapsed ? 'Expand project' : 'Collapse project'}
                                                        >
                                                            <Icons.ChevronDown size={15} />
                                                        </button>
                                                        <span className="cloud-project-icon" aria-hidden="true">
                                                            <FileIcon
                                                                path={proj.root}
                                                                isDirectory
                                                                isExpanded={!projectCollapsed}
                                                            />
                                                        </span>
                                                        <span className="cloud-project-name" title={proj.root}>
                                                            {proj.name}
                                                        </span>
                                                        <div className="cloud-row-actions">
                                                            <button
                                                                type="button"
                                                                className="cloud-icon-btn"
                                                                title="Start agent in project"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    const anchor = e.currentTarget;
                                                                    setStartAgentTarget((prev) =>
                                                                        prev?.anchor === anchor
                                                                            ? null
                                                                            : {
                                                                                  serverId: srv.id,
                                                                                  projectId: proj.id,
                                                                                  anchor,
                                                                              }
                                                                    );
                                                                }}
                                                            >
                                                                +
                                                            </button>
                                                            {renderArmedRemoveButton({
                                                                confirmKey: `project:${srv.id}::${proj.id}`,
                                                                title: 'Remove project',
                                                                confirmTitle: 'Click again to remove project',
                                                                onConfirm: () => void handleRemoveProject(srv.id, proj.id),
                                                            })}
                                                        </div>
                                                    </div>

                                                    {!projectCollapsed && projAgents.length > 0 && (
                                                        <div className="cloud-agent-list">
                                                            {projAgents.map((agent) => renderSidebarAgentRow(srv.id, agent))}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })
                                    )}

                                    {orphanAgents.length > 0 && (
                                        <div className="cloud-agent-list">
                                            {orphanAgents.map((agent) => renderSidebarAgentRow(srv.id, agent))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </aside>
    );

    const mainPane = (
        <main className="cloud-main">
                {actionError && (
                    <div style={{ padding: '8px 14px 0' }}>
                        <div className="cloud-error-banner">{actionError}</div>
                    </div>
                )}

                {selection.kind === 'agent' && selectedSession ? (
                    <div className="cloud-agent-pane">
                        <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
                        <AnycodeAgentSession
                            key={selectedSession.key}
                            agentId={selectedSession.agentId}
                            title={selectedSession.agentName || selectedSession.agentId}
                            projectName={selectedProject?.name}
                            projectPath={selectedSession.worktreePath ?? selectedProject?.root}
                            worktreeLabel={formatWorktreeBadge(selectedSession)}
                            diffStats={
                                selectedSession.worktreePath
                                && (
                                    (selectedSession.diffAdded ?? 0) > 0
                                    || (selectedSession.diffRemoved ?? 0) > 0
                                    || (selectedSession.diffFiles ?? 0) > 0
                                )
                                    ? {
                                          added: selectedSession.diffAdded ?? 0,
                                          removed: selectedSession.diffRemoved ?? 0,
                                          files: selectedSession.diffFiles ?? 0,
                                      }
                                    : null
                            }
                            onOpenDiff={
                                selectedSession.worktreePath && onOpenWorktreeDiff
                                    ? () =>
                                          triggerOpenWorktreeDiff({
                                              serverId: selectedSession.serverId,
                                              worktreePath: selectedSession.worktreePath!,
                                              projectId: selectedSession.projectId,
                                              title: `${selectedProject?.name ? `${selectedProject.name} · ` : ''}${formatWorktreeBadge(selectedSession) ?? 'Diff'}`,
                                          })
                                    : undefined
                            }
                            isConnected={Boolean(
                                (selectedSession.isActive || selectedSession.isStarting)
                                && isConnected
                                && selectedServer?.status === 'online',
                            )}
                            isProcessing={selectedSession.isProcessing || false}
                            isStarting={selectedSession.isStarting}
                            startError={selectedSession.startError}
                            messages={selectedSession.messages}
                            queue={selectedSession.queue}
                            onUpdateQueueItem={(aid, itemId, prompt) =>
                                cloud.updateQueuedPrompt(selectedSession.serverId, aid, itemId, prompt)
                            }
                            onRemoveQueueItem={(aid, itemId) =>
                                cloud.removeQueuedPrompt(selectedSession.serverId, aid, itemId)
                            }
                            onMoveQueueItem={(aid, itemId, dir) =>
                                cloud.moveQueuedPrompt(selectedSession.serverId, aid, itemId, dir)
                            }
                            onSendQueueItemNow={(aid, itemId) =>
                                cloud.sendQueuedPromptNow(selectedSession.serverId, aid, itemId)
                            }
                            modelSelector={selectedSession.modelSelector}
                            reasoningSelector={selectedSession.reasoningSelector}
                            contextUsage={selectedSession.contextUsage}
                            availableCommands={selectedSession.availableCommands}
                            authRequired={selectedSession.authRequired}
                            isAuthenticating={selectedSession.isAuthenticating}
                            pendingAuthMethod={selectedSession.pendingAuthMethod}
                            onAuthenticate={(aid, methodId) => {
                                cloud.authenticateAgent(selectedSession.serverId, aid, methodId).catch((err) => {
                                    setActionError(err instanceof Error ? err.message : String(err));
                                });
                            }}
                            onFocusPane={() => {}}
                            onSendPrompt={(aid, prompt, attachments) => {
                                cloud.sendPrompt(selectedSession.serverId, aid, prompt, attachments).catch((err) => {
                                    setActionError(err instanceof Error ? err.message : String(err));
                                });
                            }}
                            onCancelPrompt={(aid) => cloud.cancelPrompt(selectedSession.serverId, aid)}
                            onUndoPrompt={(aid, checkpointId, prompt) => {
                                cloud.undoPrompt(selectedSession.serverId, aid, checkpointId, prompt).catch((err) => {
                                    setActionError(err instanceof Error ? err.message : String(err));
                                });
                            }}
                            onCloseAgent={(aid) => handleStopAgent(selectedSession.serverId, aid)}
                            onSelectModel={(aid, opt) =>
                                cloud.setSessionModel(selectedSession.serverId, aid, opt)
                            }
                            onSelectReasoning={(aid, opt) =>
                                cloud.setSessionReasoning(selectedSession.serverId, aid, opt)
                            }
                            onGetToolOutput={(toolId, sessionId) =>
                                cloud.getToolOutput(selectedSession.serverId, toolId, sessionId)
                            }
                        />
                        </div>
                    </div>
                ) : selection.kind === 'project' && selectedServer && selectedProject ? (
                    <div className="cloud-detail">
                        <div className="cloud-card">
                            <div className="cloud-card-header">
                                <div className="cloud-detail-heading">
                                    <div className="cloud-card-title-row">
                                        <h2 className="cloud-card-title">{selectedProject.name}</h2>
                                        {projectGitInfo?.is_git_repo && (
                                            <>
                                                <span className="cloud-project-branch">
                                                    {projectGitInfo.branch || (projectGitInfo.head_sha ? 'detached' : 'unborn')}
                                                </span>
                                                {projectGitInfo.head_sha && (
                                                    <span className="cloud-worktree-sha">
                                                        {projectGitInfo.head_sha.slice(0, 7)}
                                                    </span>
                                                )}
                                                {projectGitInfo.commits_ahead > 0 && (
                                                    <span className="cloud-badge ok">
                                                        +{projectGitInfo.commits_ahead} commit
                                                        {projectGitInfo.commits_ahead === 1 ? '' : 's'}
                                                    </span>
                                                )}
                                                {projectGitInfo.dirty_count > 0 && (
                                                    <span className="cloud-badge warn">
                                                        {projectGitInfo.dirty_count} dirty
                                                    </span>
                                                )}
                                            </>
                                        )}
                                    </div>
                                    <div className="cloud-card-sub">
                                        {selectedServer.name} · {selectedProject.root}
                                    </div>
                                </div>
                                <div className="cloud-card-actions">
                                    <button
                                        type="button"
                                        className="cloud-btn subtle"
                                        title="Create an isolated git worktree from this project"
                                        onClick={(e) => {
                                            const anchor = e.currentTarget;
                                            setCreateWorktreeState((prev) =>
                                                prev?.anchor === anchor
                                                    ? null
                                                    : {
                                                          server: selectedServer,
                                                          project: selectedProject,
                                                          anchor,
                                                      }
                                            );
                                        }}
                                    >
                                        <Icons.Plus size={12} />
                                        <span>Worktree</span>
                                    </button>
                                    {!selectedServer.is_local && (
                                        <button
                                            type="button"
                                            className="cloud-btn subtle"
                                            title="Pull commits & changes into a local git worktree"
                                            onClick={(e) => {
                                                const anchor = e.currentTarget;
                                                setPullWorktreeState((prev) =>
                                                    prev?.anchor === anchor
                                                        ? null
                                                        : {
                                                              server: selectedServer,
                                                              project: selectedProject,
                                                              anchor,
                                                          }
                                                );
                                            }}
                                        >
                                            <span>Pull Worktree</span>
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        className="cloud-btn subtle"
                                        onClick={(e) => {
                                            const anchor = e.currentTarget;
                                            setStartAgentTarget((prev) =>
                                                prev?.anchor === anchor
                                                    ? null
                                                    : {
                                                          serverId: selectedServer.id,
                                                          projectId: selectedProject.id,
                                                          anchor,
                                                      }
                                            );
                                        }}
                                    >
                                        <Icons.Plus size={12} />
                                        <span>Start Agent</span>
                                    </button>
                                </div>
                            </div>
                        </div>

                        {renderOpenedAgentsSection(
                            selectedServer,
                            (sessionsByServer.get(selectedServer.id) ?? []).filter(
                                (a) => a.projectId === selectedProject.id,
                            ),
                            'No running agents in this project yet.',
                        )}

                        <section className="cloud-section">
                            <div className="cloud-section-header">
                                <span className="cloud-section-title">
                                    Worktrees ({worktrees.length})
                                </span>
                                <button
                                    type="button"
                                    className="cloud-icon-btn"
                                    onClick={() => setWorktreesRefreshTick((t) => t + 1)}
                                    title="Refresh worktrees"
                                    disabled={worktreesLoading}
                                >
                                    <Icons.Refresh size={12} />
                                </button>
                            </div>

                            {worktreesLoading && worktrees.length === 0 ? (
                                <div className="cloud-empty-detail">Loading worktrees...</div>
                            ) : worktrees.length === 0 ? (
                                <div className="cloud-empty-detail">
                                    No worktrees created for this project yet.
                                </div>
                            ) : (
                                <div className="cloud-worktree-list">
                                    {worktrees.map((wt) => {
                                        const linkedAgent = (
                                            sessionsByServer.get(selectedServer.id) ?? []
                                        ).find((s) => s.worktreePath === wt.path);
                                        const wtAdded = linkedAgent?.diffAdded ?? wt.diff_added ?? 0;
                                        const wtRemoved = linkedAgent?.diffRemoved ?? wt.diff_removed ?? 0;
                                        const wtFiles = linkedAgent?.diffFiles ?? wt.diff_files ?? 0;
                                        const isRemoving = removingWorktreePath === wt.path;
                                        return (
                                            <div key={wt.path} className="cloud-worktree-card">
                                                <div className="cloud-worktree-main">
                                                    <div className="cloud-worktree-top">
                                                        <span className="cloud-agent-wt-badge">
                                                            {wt.id}
                                                        </span>
                                                        <span className="cloud-worktree-branch">
                                                            {wt.branch || 'detached'}
                                                        </span>
                                                        {wt.short_sha && (
                                                            <span className="cloud-worktree-sha">
                                                                {wt.short_sha}
                                                            </span>
                                                        )}
                                                        {wt.commits_ahead > 0 && (
                                                            <span className="cloud-badge ok">
                                                                +{wt.commits_ahead} commit
                                                                {wt.commits_ahead === 1 ? '' : 's'}
                                                            </span>
                                                        )}
                                                        {wt.dirty_count > 0 && (
                                                            <span className="cloud-badge warn">
                                                                {wt.dirty_count} dirty
                                                            </span>
                                                        )}
                                                        {(wtAdded > 0 || wtRemoved > 0 || wtFiles > 0) && (
                                                            <button
                                                                type="button"
                                                                className="cloud-diff-pill"
                                                                title={`Open worktree diff (${wtFiles} changed files)`}
                                                                onClick={() =>
                                                                    triggerOpenWorktreeDiff({
                                                                        serverId: selectedServer.id,
                                                                        worktreePath: wt.path,
                                                                        projectId: selectedProject.id,
                                                                        title: `${selectedProject.name} · ${wt.branch || wt.id}`,
                                                                    })
                                                                }
                                                            >
                                                                {wtAdded > 0 && (
                                                                    <span className="cloud-diff-added">+{wtAdded}</span>
                                                                )}
                                                                {wtRemoved > 0 && (
                                                                    <span className="cloud-diff-removed">-{wtRemoved}</span>
                                                                )}
                                                                {wtAdded === 0 && wtRemoved === 0 && (
                                                                    <span className="cloud-diff-neutral">{wtFiles}f</span>
                                                                )}
                                                            </button>
                                                        )}
                                                        {linkedAgent && (
                                                            <button
                                                                type="button"
                                                                className="cloud-badge accent cloud-badge-btn"
                                                                title={`Open ${linkedAgent.agentName || linkedAgent.agentId}`}
                                                                onClick={() =>
                                                                    setSelection({
                                                                        kind: 'agent',
                                                                        serverId: selectedServer.id,
                                                                        agentId: linkedAgent.agentId,
                                                                    })
                                                                }
                                                            >
                                                                {linkedAgent.agentName || linkedAgent.agentId}
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div className="cloud-item-path" title={wt.path}>
                                                        {wt.path}
                                                    </div>
                                                </div>

                                                <div className="cloud-worktree-actions">
                                                    {onOpenWorktreeDiff && (
                                                        <button
                                                            type="button"
                                                            className="cloud-btn subtle"
                                                            title="View worktree diff in editor"
                                                            onClick={() =>
                                                                triggerOpenWorktreeDiff({
                                                                    serverId: selectedServer.id,
                                                                    worktreePath: wt.path,
                                                                    projectId: selectedProject.id,
                                                                    title: `${selectedProject.name} · ${wt.branch || wt.id}`,
                                                                })
                                                            }
                                                        >
                                                            <span>Diff</span>
                                                        </button>
                                                    )}
                                                    <button
                                                        type="button"
                                                        className="cloud-btn subtle"
                                                        title="Start an agent in this worktree"
                                                        onClick={(e) => {
                                                            const anchor = e.currentTarget;
                                                            setStartAgentTarget((prev) =>
                                                                prev?.anchor === anchor
                                                                    ? null
                                                                    : {
                                                                          serverId: selectedServer.id,
                                                                          projectId: selectedProject.id,
                                                                          worktreePath: wt.path,
                                                                          worktreeBranch: wt.branch ?? undefined,
                                                                          anchor,
                                                                      }
                                                            );
                                                        }}
                                                    >
                                                        <Icons.Plus size={12} />
                                                        <span>Agent</span>
                                                    </button>
                                                    {!selectedServer.is_local && (
                                                        <button
                                                            type="button"
                                                            className="cloud-btn subtle"
                                                            title="Pull commits & changes from this worktree into a local worktree"
                                                            onClick={(e) => {
                                                                const anchor = e.currentTarget;
                                                                setPullWorktreeState((prev) =>
                                                                    prev?.anchor === anchor
                                                                        ? null
                                                                        : {
                                                                              server: selectedServer,
                                                                              project: selectedProject,
                                                                              remotePath: wt.path,
                                                                              remoteLabel: wt.branch
                                                                                  ? `${selectedProject.name} · ${wt.branch}`
                                                                                  : wt.id,
                                                                              anchor,
                                                                          }
                                                                );
                                                            }}
                                                        >
                                                            <span>Pull</span>
                                                        </button>
                                                    )}
                                                    {renderArmedRemoveButton({
                                                        confirmKey: `worktree:${selectedServer.id}::${wt.path}`,
                                                        className: 'cloud-icon-btn danger',
                                                        disabled: isRemoving || Boolean(linkedAgent),
                                                        title: linkedAgent
                                                            ? `Stop active agent (${linkedAgent.agentName || linkedAgent.agentId}) before removing worktree`
                                                            : 'Remove git worktree',
                                                        confirmTitle: 'Click again to remove worktree',
                                                        children: <Icons.Close size={12} />,
                                                        onConfirm: () =>
                                                            handleRemoveWorktree(
                                                                selectedServer.id,
                                                                selectedProject.id,
                                                                wt.path,
                                                            ),
                                                    })}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </section>
                    </div>
                ) : selectedServer ? (
                    <div className="cloud-detail">
                        <div className="cloud-card">
                            <div className="cloud-card-header">
                                <div className="cloud-detail-heading">
                                    <h2 className="cloud-card-title">{selectedServer.name}</h2>
                                    <div className="cloud-card-sub">
                                        {selectedServer.open_url ? (
                                            <a
                                                className="cloud-server-link"
                                                href={selectedServer.open_url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                title="Open Anycode Web UI"
                                            >
                                                {selectedServer.open_url.split('?')[0].replace(/\/$/, '')} ↗
                                            </a>
                                        ) : (
                                            selectedServer.url
                                        )}
                                        {selectedServer.info
                                            ? ` · ${selectedServer.info.os}/${selectedServer.info.arch} · Anycode ${selectedServer.info.version}`
                                            : ''}
                                    </div>
                                </div>
                                <div className="cloud-card-actions">
                                    <span className={`cloud-badge ${statusBadgeClass[selectedServer.status]}`}>
                                        {statusLabel[selectedServer.status]}
                                        {selectedServer.ping_ms != null ? ` (${selectedServer.ping_ms}ms)` : ''}
                                    </span>
                                    {!selectedServer.is_local && selectedServer.status === 'online' && (
                                        <button
                                            type="button"
                                            className="cloud-btn subtle"
                                            onClick={(e) => {
                                                const anchor = e.currentTarget;
                                                setSyncAgentsState((prev) =>
                                                    prev?.anchor === anchor
                                                        ? null
                                                        : { server: selectedServer, anchor }
                                                );
                                            }}
                                        >
                                            Sync Agents
                                        </button>
                                    )}
                                    {!selectedServer.is_local && (
                                        <button
                                            type="button"
                                            className="cloud-btn subtle"
                                            onClick={() => cloud.reconnectServer(selectedServer.id)}
                                        >
                                            Reconnect
                                        </button>
                                    )}
                                </div>
                            </div>
                            {selectedServer.error && (
                                <div className="cloud-error-banner">{selectedServer.error}</div>
                            )}
                        </div>

                        <div className="cloud-section">
                            <div className="cloud-section-header">
                                <span className="cloud-section-title">
                                    Projects ({selectedServer.projects.length})
                                </span>
                                {selectedServer.status === 'online' && (
                                    <button
                                        type="button"
                                        className="cloud-btn subtle"
                                        onClick={(e) => {
                                            const anchor = e.currentTarget;
                                            setAddProjectState((prev) =>
                                                prev?.anchor === anchor
                                                    ? null
                                                    : { server: selectedServer, anchor }
                                            );
                                        }}
                                    >
                                        <Icons.Plus size={12} />
                                        <span>Project</span>
                                    </button>
                                )}
                            </div>
                            {selectedServer.projects.length === 0 ? (
                                <div className="cloud-empty-detail">
                                    No projects registered on {selectedServer.name}.
                                </div>
                            ) : (
                                <div className="cloud-grid">
                                    {selectedServer.projects.map((proj) => (
                                        <div
                                            key={proj.id}
                                            className="cloud-item-card"
                                            onClick={() =>
                                                setSelection({
                                                    kind: 'project',
                                                    serverId: selectedServer.id,
                                                    projectId: proj.id,
                                                })
                                            }
                                        >
                                            <div className="cloud-item-title">
                                                <span className="cloud-item-name">
                                                    <FileIcon path={proj.root} isDirectory />
                                                    <span className="cloud-item-name-label">{proj.name}</span>
                                                </span>
                                                <div className="cloud-item-actions">
                                                    <button
                                                        type="button"
                                                        className="cloud-btn subtle"
                                                        title="Create git worktree from this project"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            const anchor = e.currentTarget;
                                                            setCreateWorktreeState((prev) =>
                                                                prev?.anchor === anchor
                                                                    ? null
                                                                    : {
                                                                          server: selectedServer,
                                                                          project: proj,
                                                                          anchor,
                                                                      }
                                                            );
                                                        }}
                                                    >
                                                        <span>Worktree</span>
                                                    </button>
                                                    {!selectedServer.is_local && (
                                                        <button
                                                            type="button"
                                                            className="cloud-btn subtle"
                                                            title="Pull into local git worktree"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                const anchor = e.currentTarget;
                                                                setPullWorktreeState((prev) =>
                                                                    prev?.anchor === anchor
                                                                        ? null
                                                                        : {
                                                                              server: selectedServer,
                                                                              project: proj,
                                                                              anchor,
                                                                          }
                                                                );
                                                            }}
                                                        >
                                                            <span>Pull</span>
                                                        </button>
                                                    )}
                                                    <button
                                                        type="button"
                                                        className="cloud-btn subtle"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            const anchor = e.currentTarget;
                                                            setStartAgentTarget((prev) =>
                                                                prev?.anchor === anchor
                                                                    ? null
                                                                    : {
                                                                          serverId: selectedServer.id,
                                                                          projectId: proj.id,
                                                                          anchor,
                                                                      }
                                                            );
                                                        }}
                                                    >
                                                        <Icons.Plus size={11} />
                                                        <span>Agent</span>
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="cloud-item-path">{proj.root}</div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {renderOpenedAgentsSection(
                            selectedServer,
                            sessionsByServer.get(selectedServer.id) ?? [],
                            `No active agents on ${selectedServer.name}.`,
                        )}
                    </div>
                ) : (
                    <div className="cloud-detail">
                        <div className="cloud-card-sub">Waiting for backend connection...</div>
                    </div>
                )}
        </main>
    );

    const panes = useMemo(
        () => [
            {
                id: 'cloud-sidebar',
                size: 276,
                minSize: 180,
                maxSize: 520,
                content: sidebarPane,
            },
            {
                id: 'cloud-main',
                minSize: 200,
                content: mainPane,
            },
        ],
        [sidebarPane, mainPane],
    );

    return (
        <div className="cloud-panel">
            <Split direction="row" className="cloud-split" panes={panes} />

            {addServerAnchor && (
                <AddServerModal
                    anchor={addServerAnchor}
                    onClose={() => setAddServerAnchor(null)}
                    onAdd={async (name, url, token) => {
                        const srv = await cloud.addServer(name, url, token);
                        setSelection({ kind: 'server', serverId: srv.id });
                    }}
                />
            )}

            {addProjectState && (
                <AddProjectModal
                    anchor={addProjectState.anchor}
                    server={
                        cloud.servers.find((s) => s.id === addProjectState.server.id)
                        ?? addProjectState.server
                    }
                    projects={
                        cloud.servers.find((s) => s.is_local)?.projects
                        ?? workspaceProjects
                        ?? []
                    }
                    onClose={() => setAddProjectState(null)}
                    onSyncProject={async (sid, path, name, options) => {
                        await cloud.syncProject(sid, path, name, options);
                    }}
                />
            )}

            {syncAgentsState && (
                <SyncAgentsModal
                    anchor={syncAgentsState.anchor}
                    server={
                        cloud.servers.find((s) => s.id === syncAgentsState.server.id)
                        ?? syncAgentsState.server
                    }
                    availableAgentsByServer={cloud.availableAgentsByServer}
                    onLoadAvailableAgents={cloud.loadAvailableAgents}
                    onSyncAgent={cloud.syncAgent}
                    onRemoveAgent={cloud.removeConfiguredAgent}
                    onClose={() => setSyncAgentsState(null)}
                />
            )}

            {startAgentTarget && (
                <StartAgentModal
                    anchor={startAgentTarget.anchor}
                    servers={cloud.servers}
                    initialServerId={startAgentTarget.serverId}
                    initialProjectId={startAgentTarget.projectId}
                    initialWorktreePath={startAgentTarget.worktreePath}
                    initialWorktreeBranch={startAgentTarget.worktreeBranch}
                    availableAgentsByServer={cloud.availableAgentsByServer}
                    registryAgentsByServer={cloud.registryAgentsByServer}
                    onLoadAvailableAgents={cloud.loadAvailableAgents}
                    onInstallRegistryAgent={cloud.installRegistryAgent}
                    onSyncAgent={cloud.syncAgent}
                    onRemoveAgent={cloud.removeConfiguredAgent}
                    onLoadGitInfo={cloud.getProjectGitInfo}
                    onLoadWorktrees={cloud.listWorktrees}
                    onStartAgent={cloud.startAgent}
                    onClose={() => setStartAgentTarget(null)}
                    onStarted={(sid, aid) =>
                        setSelection({ kind: 'agent', serverId: sid, agentId: aid })
                    }
                />
            )}

            {pullWorktreeState && (
                <PullWorktreeModal
                    anchor={pullWorktreeState.anchor}
                    server={
                        cloud.servers.find((s) => s.id === pullWorktreeState.server.id)
                        ?? pullWorktreeState.server
                    }
                    remoteProject={pullWorktreeState.project}
                    remotePath={pullWorktreeState.remotePath}
                    remoteLabel={pullWorktreeState.remoteLabel}
                    localProjects={
                        cloud.servers.find((s) => s.is_local)?.projects
                        ?? workspaceProjects
                        ?? []
                    }
                    onLoadGitInfo={cloud.getProjectGitInfo}
                    onPullProject={cloud.pullProject}
                    onOpenPulledProject={(projectId) =>
                        setSelection({ kind: 'project', serverId: 'local', projectId })
                    }
                    onClose={() => setPullWorktreeState(null)}
                />
            )}

            {createWorktreeState && (
                <CreateWorktreeModal
                    anchor={createWorktreeState.anchor}
                    server={
                        cloud.servers.find((s) => s.id === createWorktreeState.server.id)
                        ?? createWorktreeState.server
                    }
                    project={createWorktreeState.project}
                    onCreateWorktree={cloud.createWorktree}
                    onCreated={(serverId, projectId) => {
                        setWorktreesRefreshTick((t) => t + 1);
                        setSelection({ kind: 'project', serverId, projectId });
                    }}
                    onClose={() => setCreateWorktreeState(null)}
                />
            )}
        </div>
    );
};

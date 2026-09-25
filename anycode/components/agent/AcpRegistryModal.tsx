import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import {
    AcpAgent,
    AcpRegistryAgentSummary,
    AcpRegistryProgressEvent,
    ResolvedAgentPreset,
} from '../../types';
import {
    addOrUpdateAgent,
    removeAgent,
    getAllAgents,
    KNOWN_PROFILE_TEMPLATES,
    GENERIC_PROFILE_TEMPLATE,
} from '../../agents';
import { AgentIcon, hasBuiltinAgentIcon } from './AgentIcon';
import { AcpIcons } from './AcpIcons';
import './AcpRegistryModal.css';

export const getAgentBrandColor = (id: string = '', name: string = ''): string => {
    const s = `${id} ${name}`.toLowerCase();
    if (s.includes('claude') || s.includes('anthropic')) return '#d97757';
    if (s.includes('gemini') || s.includes('google') || s.includes('antigravity')) return '#3186ff';
    if (s.includes('codex') || s.includes('openai') || s.includes('chatgpt')) return '#10a37f';
    if (s.includes('qwen') || s.includes('alibaba')) return '#6f69f7';
    if (s.includes('deepseek')) return '#4d6bfe';
    if (s.includes('amp')) return '#a855f7';
    if (s.includes('cline')) return '#06b6d4';
    if (s.includes('auggie') || s.includes('augment')) return '#8b5cf6';
    if (s.includes('goose')) return '#00b4d8';
    if (s.includes('autohand')) return '#ec4899';
    if (s.includes('agoragentic')) return '#f59e0b';
    if (s.includes('copilot') || s.includes('github')) return '#3b82f6';
    if (s.includes('cursor')) return '#0ea5e9';
    if (s.includes('grok')) return '#e2e8f0';
    if (s.includes('opencode') || s.includes('coder')) return '#00f2fe';
    if (s.includes('devin') || s.includes('cognition')) return '#10b981';
    if (s.includes('factory')) return '#f97316';
    if (s.includes('kimi') || s.includes('moonshot')) return '#6366f1';
    return '#58a6ff';
};

interface AcpRegistryModalProps {
    wsRef: React.RefObject<Socket | null>;
    isConnected: boolean;
    onClose: () => void;
    onStartAgent: (agent: AcpAgent) => void;
    onAgentsChanged?: () => void;
}

export const AcpRegistryModal: React.FC<AcpRegistryModalProps> = ({
    wsRef,
    isConnected,
    onClose,
    onStartAgent,
    onAgentsChanged,
}) => {
    const [agents, setAgents] = useState<AcpRegistryAgentSummary[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [searchText, setSearchText] = useState<string>('');
    const [isSearchVisible, setIsSearchVisible] = useState<boolean>(false);
    const [selectedFilter, setSelectedFilter] = useState<'all' | 'installed'>('all');
    const [installingAgents, setInstallingAgents] = useState<Record<string, number>>({});
    const [iconLoadErrors, setIconLoadErrors] = useState<Record<string, boolean>>({});

    const installedAgentIds = useMemo(() => {
        const local = getAllAgents();
        return new Set(local.map(a => a.id));
    }, [agents]);

    const loadRegistry = useCallback((forceRefresh: boolean = false) => {
        const socket = wsRef.current;
        if (!socket || !isConnected) {
            setIsLoading(false);
            setError('Backend is not connected');
            return;
        }

        setIsLoading(true);
        setError(null);

        socket.emit('acp:registry:list', { force_refresh: forceRefresh }, (response: any) => {
            setIsLoading(false);
            if (response && response.success && Array.isArray(response.agents)) {
                setAgents(response.agents);
            } else {
                setError(response?.error || 'Failed to fetch ACP registry');
            }
        });
    }, [wsRef, isConnected]);

    useEffect(() => {
        loadRegistry(false);
    }, [loadRegistry]);

    // Handle progress events
    useEffect(() => {
        const socket = wsRef.current;
        if (!socket) return;

        const handleProgress = (event: AcpRegistryProgressEvent) => {
            if (!event || !event.agent_id) return;

            setInstallingAgents(prev => {
                if (event.status === 'completed' || event.status === 'failed') {
                    const next = { ...prev };
                    delete next[event.agent_id];
                    return next;
                }
                return {
                    ...prev,
                    [event.agent_id]: Math.max(0, Math.min(1, event.progress || 0)),
                };
            });
        };

        socket.on('acp:registry:progress', handleProgress);
        return () => {
            socket.off('acp:registry:progress', handleProgress);
        };
    }, [wsRef]);

    const handleInstall = (agent: AcpRegistryAgentSummary) => {
        const socket = wsRef.current;
        if (!socket || !isConnected) return;

        setInstallingAgents(prev => ({ ...prev, [agent.id]: 0.0 }));

        socket.emit('acp:registry:install', { agent_id: agent.id }, (response: any) => {
            setInstallingAgents(prev => {
                const next = { ...prev };
                delete next[agent.id];
                return next;
            });

            if (response && response.success && response.preset) {
                const preset: ResolvedAgentPreset = response.preset;
                const newAgent: AcpAgent = {
                    id: preset.id,
                    name: preset.name,
                    command: preset.command,
                    args: preset.args,
                    description: preset.description,
                    icon: preset.icon,
                    version: preset.version,
                    env: preset.env,
                    profileEnv: KNOWN_PROFILE_TEMPLATES[preset.id] ?? GENERIC_PROFILE_TEMPLATE,
                };
                addOrUpdateAgent(newAgent);
                onAgentsChanged?.();

                setAgents(prev =>
                    prev.map(a =>
                        a.id === agent.id
                            ? {
                                  ...a,
                                  is_installed: true,
                                  installed_version: preset.version,
                                  has_update: false,
                              }
                            : a
                    )
                );
            } else {
                const err = response?.error;
                if (err && !err.toLowerCase().includes('cancel')) {
                    alert(err);
                }
            }
        });
    };

    const handleCancelInstall = (agentId: string) => {
        const socket = wsRef.current;
        if (socket) {
            socket.emit('acp:registry:cancel', { agent_id: agentId });
        }
        setInstallingAgents(prev => {
            const next = { ...prev };
            delete next[agentId];
            return next;
        });
    };

    const handleRemove = (agentId: string) => {
        const socket = wsRef.current;
        if (socket) {
            socket.emit('acp:registry:uninstall', { agent_id: agentId });
        }
        removeAgent(agentId);
        onAgentsChanged?.();
        setAgents(prev =>
            prev.map(a =>
                a.id === agentId
                    ? {
                          ...a,
                          is_installed: false,
                          installed_version: undefined,
                          installed_path: undefined,
                          has_update: false,
                      }
                    : a
            )
        );
    };

    const handleStart = (summary: AcpRegistryAgentSummary) => {
        const local = getAllAgents();
        let agent = local.find(a => a.id === summary.id);
        if (!agent) {
            const isInstalledBinary = Boolean(summary.installed_path);
            const command = summary.installed_path || (summary.npx ? 'npx' : (summary.binary_target?.cmd || summary.id));
            const baseArgs = isInstalledBinary
                ? (summary.binary_target?.args || [])
                : summary.npx
                    ? ['-y', summary.npx.package, ...(summary.npx.args || [])]
                    : (summary.binary_target?.args || []);
            const env = isInstalledBinary
                ? summary.binary_target?.env
                : (summary.npx?.env || summary.binary_target?.env);

            agent = {
                id: summary.id,
                name: summary.name,
                command,
                args: baseArgs,
                description: summary.description,
                icon: summary.icon,
                version: summary.version,
                env,
                profileEnv: KNOWN_PROFILE_TEMPLATES[summary.id] ?? GENERIC_PROFILE_TEMPLATE,
            };
            addOrUpdateAgent(agent);
            onAgentsChanged?.();
        }

        onClose();
        onStartAgent(agent);
    };

    const installedCount = useMemo(() => {
        return agents.filter(a => a.is_installed || installedAgentIds.has(a.id)).length;
    }, [agents, installedAgentIds]);

    const filteredAgents = useMemo(() => {
        return agents.filter(agent => {
            const isInstalled = agent.is_installed || installedAgentIds.has(agent.id);
            if (selectedFilter === 'installed' && !isInstalled) {
                return false;
            }

            if (!searchText.trim()) {
                return true;
            }

            const q = searchText.toLowerCase().trim();
            const matchesName = agent.name.toLowerCase().includes(q);
            const matchesId = agent.id.toLowerCase().includes(q);
            const matchesDesc = agent.description.toLowerCase().includes(q);
            const matchesAuthor = agent.authors?.some(a => a.toLowerCase().includes(q)) ?? false;

            return matchesName || matchesId || matchesDesc || matchesAuthor;
        });
    }, [agents, selectedFilter, searchText, installedAgentIds]);

    return (
        <div className="acp-registry-view">
            {/* Header */}
            <div className="acp-registry-header">
                <div className="acp-registry-header-left">
                    <div className="acp-registry-title-wrap">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="acp-registry-globe-icon">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="2" y1="12" x2="22" y2="12" />
                            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                        </svg>
                        <span className="acp-registry-title">ACP Registry</span>

                        {agents.length > 0 && (
                            <button
                                className={`acp-registry-filter-badge ${selectedFilter === 'installed' ? 'active' : ''}`}
                                onClick={() => setSelectedFilter(f => (f === 'installed' ? 'all' : 'installed'))}
                                title={
                                    selectedFilter === 'installed'
                                        ? `Showing ${installedCount} installed. Click for all.`
                                        : `Filter installed (${installedCount}/${agents.length})`
                                }
                                type="button"
                            >
                                {installedCount > 0 ? `${installedCount}/${agents.length}` : `${agents.length}`}
                            </button>
                        )}
                    </div>
                </div>

                <div className="acp-registry-header-actions">
                    <button
                        className={`acp-registry-action-icon-btn ${isSearchVisible ? 'active' : ''}`}
                        onClick={() => {
                            setIsSearchVisible(v => !v);
                            if (isSearchVisible) setSearchText('');
                        }}
                        title="Search agents (Cmd+F)"
                        type="button"
                    >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="11" cy="11" r="8" />
                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                    </button>

                    <button
                        className="acp-registry-action-icon-btn"
                        onClick={() => loadRegistry(true)}
                        disabled={isLoading}
                        title="Refresh registry from CDN"
                        type="button"
                    >
                        <svg
                            width="13"
                            height="13"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className={isLoading ? 'acp-registry-spin' : ''}
                        >
                            <polyline points="23 4 23 10 17 10" />
                            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                        </svg>
                    </button>

                    <button
                        className="acp-registry-action-icon-btn acp-registry-close-btn"
                        onClick={onClose}
                        title="Close (Esc)"
                        type="button"
                    >
                        <AcpIcons.CloseMedium />
                    </button>
                </div>
            </div>

            {/* Optional search bar */}
            {isSearchVisible && (
                <div className="acp-registry-search-bar">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <input
                        autoFocus
                        type="text"
                        placeholder="Search agents by name, description, author..."
                        value={searchText}
                        onChange={e => setSearchText(e.target.value)}
                    />
                    {searchText && (
                        <button
                            className="acp-registry-search-clear"
                            onClick={() => setSearchText('')}
                            type="button"
                        >
                            ✕
                        </button>
                    )}
                </div>
            )}

            {/* Content view */}
            <div className="acp-registry-content">
                {isLoading && agents.length === 0 ? (
                    <div className="acp-registry-state-container">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="acp-registry-spin">
                            <line x1="12" y1="2" x2="12" y2="6" />
                            <line x1="12" y1="18" x2="12" y2="22" />
                            <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
                            <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
                            <line x1="2" y1="12" x2="6" y2="12" />
                            <line x1="18" y1="12" x2="22" y2="12" />
                            <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
                            <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
                        </svg>
                        <span>Loading ACP Registry from CDN...</span>
                    </div>
                ) : error && agents.length === 0 ? (
                    <div className="acp-registry-state-container">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f85149" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                            <line x1="12" y1="9" x2="12" y2="13" />
                            <line x1="12" y1="17" x2="12.01" y2="17" />
                        </svg>
                        <span style={{ color: '#fff', fontWeight: 600 }}>Failed to load registry</span>
                        <span>{error}</span>
                        <button className="acp-registry-state-btn" onClick={() => loadRegistry(true)} type="button">
                            Retry
                        </button>
                    </div>
                ) : filteredAgents.length === 0 ? (
                    <div className="acp-registry-state-container">
                        <span>{searchText ? `No agents matching "${searchText}"` : 'No agents found'}</span>
                        {selectedFilter === 'installed' && (
                            <button
                                className="acp-registry-state-btn"
                                onClick={() => setSelectedFilter('all')}
                                type="button"
                            >
                                Show all agents
                            </button>
                        )}
                    </div>
                ) : (
                    filteredAgents.map(agent => {
                        const isInstalled = agent.is_installed || installedAgentIds.has(agent.id);
                        const progress = installingAgents[agent.id];
                        const isInstalling = progress !== undefined;
                        const hasIconError = iconLoadErrors[agent.id];
                        const brandColor = getAgentBrandColor(agent.id, agent.name);
                        const hasBuiltin = hasBuiltinAgentIcon(agent.id, agent.name);

                        return (
                            <div key={agent.id} className="acp-registry-card">
                                <div className="acp-registry-card-left">
                                    <div
                                        className="acp-registry-icon-box"
                                        style={{
                                            backgroundColor: `${brandColor}18`,
                                            borderColor: `${brandColor}38`,
                                        }}
                                    >
                                        {hasBuiltin ? (
                                            <AgentIcon name={agent.name} id={agent.id} size={22} />
                                        ) : agent.icon && !hasIconError ? (
                                            <img
                                                src={agent.icon}
                                                alt={agent.name}
                                                className="acp-registry-icon-img"
                                                onError={() => {
                                                    setIconLoadErrors(prev => ({ ...prev, [agent.id]: true }));
                                                }}
                                            />
                                        ) : (
                                            <AgentIcon name={agent.name} id={agent.id} size={22} />
                                        )}
                                    </div>

                                    <div className="acp-registry-info-stack">
                                        <div className="acp-registry-card-title-row">
                                            <span className="acp-registry-agent-name" title={agent.name}>
                                                {agent.name}
                                            </span>
                                            <span className="acp-registry-badge acp-registry-badge-version">
                                                v{agent.version}
                                            </span>
                                            {agent.distribution_type !== 'unsupported' && (
                                                <span className="acp-registry-badge acp-registry-badge-type">
                                                    {agent.distribution_type === 'both'
                                                        ? 'native / npx'
                                                        : agent.distribution_type}
                                                </span>
                                            )}
                                            {agent.has_update && isInstalled && (
                                                <span className="acp-registry-badge acp-registry-badge-update">
                                                    update available
                                                </span>
                                            )}
                                        </div>

                                        <div className="acp-registry-agent-desc" title={agent.description}>
                                            {agent.description}
                                        </div>

                                        <div className="acp-registry-meta-row">
                                            {agent.authors && agent.authors.length > 0 && (
                                                <span>by {agent.authors.join(', ')}</span>
                                            )}
                                            {(agent.website || agent.repository) && (
                                                <a
                                                    href={agent.website || agent.repository}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="acp-registry-meta-link"
                                                    onClick={e => e.stopPropagation()}
                                                    title={agent.website || agent.repository}
                                                >
                                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                                        <polyline points="15 3 21 3 21 9" />
                                                        <line x1="10" y1="14" x2="21" y2="3" />
                                                    </svg>
                                                    <span>Docs</span>
                                                </a>
                                            )}
                                            {agent.license && <span>({agent.license})</span>}
                                        </div>
                                    </div>
                                </div>

                                <div className="acp-registry-card-actions">
                                    {isInstalling ? (
                                        <div
                                            className="acp-registry-progress-pill"
                                            onClick={() => handleCancelInstall(agent.id)}
                                            title="Click to cancel download"
                                        >
                                            <div
                                                className="acp-registry-progress-fill"
                                                style={{ width: `${Math.round(progress * 100)}%` }}
                                            />
                                            <span className="acp-registry-progress-label">
                                                <span className="acp-registry-progress-pct">
                                                    {Math.round(progress * 100)}% ✕
                                                </span>
                                                <span className="acp-registry-progress-cancel-text">
                                                    Cancel ✕
                                                </span>
                                            </span>
                                        </div>
                                    ) : isInstalled ? (
                                        <>
                                            <button
                                                className="acp-registry-pill-btn acp-registry-btn-start"
                                                onClick={() => handleStart(agent)}
                                                type="button"
                                            >
                                                Start
                                            </button>
                                            <button
                                                className="acp-registry-pill-btn acp-registry-btn-remove"
                                                onClick={() => handleRemove(agent.id)}
                                                type="button"
                                            >
                                                Remove
                                            </button>
                                        </>
                                    ) : !agent.is_supported ? (
                                        <button
                                            className="acp-registry-pill-btn acp-registry-btn-unsupported"
                                            disabled
                                            type="button"
                                        >
                                            Unsupported
                                        </button>
                                    ) : (
                                        <button
                                            className="acp-registry-pill-btn acp-registry-btn-install"
                                            onClick={() => handleInstall(agent)}
                                            type="button"
                                        >
                                            Install
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};

import React, { useState } from 'react';
import { type AcpAgent, type AcpSession, type AcpSessionSummary } from '../../types';
import { parseAgentDisplayName, resolveAgentDisplay } from '../../agents';
import { AgentIcon } from './AgentIcon';
import { Icons } from '../Icons';
import { loadSelectedProfiles, saveSelectedProfiles } from '../../storage';
import { AcpOpenedAgentCard } from './AcpOpenedAgentCard';
import { AcpSessionsView } from './AcpSessionsView';
import './AcpEmptyPane.css';

export { parseAgentDisplayName };

interface AcpEmptyPaneProps {
  agents: AcpSession[];
  availableAgents: AcpAgent[];
  onSelectAgent: (agentId: string) => void;
  onCloseAgent: (agentId: string) => void;
  onStartAgent: (agent: AcpAgent) => string | null | undefined;
  onOpenSettings?: () => void;
  onOpenRegistry?: () => void;
  onLoadSessions?: (agent: AcpAgent) => Promise<AcpSessionSummary[]>;
  onResumeSession?: (agent: AcpAgent, sessionId: string) => void;
}

export const AcpEmptyPane: React.FC<AcpEmptyPaneProps> = ({
  agents,
  availableAgents,
  onSelectAgent,
  onCloseAgent,
  onStartAgent,
  onOpenSettings,
  onOpenRegistry,
  onLoadSessions,
  onResumeSession,
}) => {
  const openedSessions = agents.filter((item) => item.isActive || item.isStarting);
  const [selectedProfiles, setSelectedProfiles] = useState<Record<string, string>>(() => loadSelectedProfiles());
  const [activeSessionsAgent, setActiveSessionsAgent] = useState<{ agent: AcpAgent; baseName: string } | null>(null);

  const handleSelectProfile = (baseName: string, agentId: string) => {
    setSelectedProfiles((prev) => {
      const next = { ...prev, [baseName]: agentId };
      saveSelectedProfiles(next);
      return next;
    });
  };

  if (activeSessionsAgent && onLoadSessions && onResumeSession) {
    return (
      <AcpSessionsView
        agent={activeSessionsAgent.agent}
        baseName={activeSessionsAgent.baseName}
        onClose={() => setActiveSessionsAgent(null)}
        onLoadSessions={onLoadSessions}
        onResumeSession={onResumeSession}
      />
    );
  }

  return (
    <div className="acp-pane-empty">
      {openedSessions.length > 0 && (
        <div className="acp-pane-opened-agents">
          <div className="acp-pane-opened-agents-title">Opened agents</div>
          <div className="acp-pane-opened-agents-list">
            {openedSessions.map((openedSession) => (
              <AcpOpenedAgentCard
                key={openedSession.agentId}
                session={openedSession}
                availableAgents={availableAgents}
                onSelectAgent={onSelectAgent}
                onCloseAgent={onCloseAgent}
              />
            ))}
          </div>
        </div>
      )}
      {availableAgents.length > 0 ? (
        <div className="acp-pane-start-agents">
          <div className="acp-pane-start-agents-title">Start a new agent</div>
          <div className="acp-pane-empty-actions">
            {(() => {
              // Group available agents by baseName
              interface AgentGroup {
                baseName: string;
                defaultAgent: AcpAgent;
                profiles: { agent: AcpAgent; profileName: string }[];
              }
              const groupsMap = new Map<string, AgentGroup>();

              availableAgents.forEach((agent) => {
                const { baseName, accountName } = resolveAgentDisplay(agent, availableAgents);
                let group = groupsMap.get(baseName);
                if (!group) {
                  group = {
                    baseName,
                    defaultAgent: agent,
                    profiles: [],
                  };
                  groupsMap.set(baseName, group);
                }
                const profileLabel = accountName || 'Default';
                group.profiles.push({ agent, profileName: profileLabel });
              });

              return Array.from(groupsMap.values()).map((group) => {
                const hasMultipleProfiles = group.profiles.length > 1;
                const hasSingleProfileWithAccount = group.profiles.length === 1 && group.profiles[0].profileName !== 'Default';
                const selectedAgent = selectedProfiles[group.baseName]
                  ? group.profiles.find((p) => p.agent.id === selectedProfiles[group.baseName])?.agent || group.defaultAgent
                  : group.defaultAgent;

                const authorsLabel = selectedAgent.authors?.filter((author) => author.trim()).join(', ');
                const baseLower = group.baseName.toLowerCase();

                const rawDescription =
                  selectedAgent.description ||
                  (baseLower.includes('antigravity')
                    ? "Google's AI coding agent"
                    : baseLower.includes('codex')
                    ? "OpenAI's coding assistant"
                    : baseLower.includes('claude')
                    ? "Anthropic's coding assistant"
                    : null);
                const descriptionText = rawDescription
                  ? rawDescription.replace(/\s*\[Profile:[^\]]*\]/gi, '').trim()
                  : null;

                return (
                  <div
                    key={group.baseName}
                    className="acp-start-card"
                    onClick={(event) => {
                      event.stopPropagation();
                      const startedAgentId = onStartAgent(selectedAgent);
                      if (startedAgentId) {
                        onSelectAgent(startedAgentId);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        const startedAgentId = onStartAgent(selectedAgent);
                        if (startedAgentId) {
                          onSelectAgent(startedAgentId);
                        }
                      }
                    }}
                    title={`Start ${group.baseName}`}
                  >
                    <div className="acp-start-card-icon-box">
                      <AgentIcon
                        name={group.baseName}
                        id={group.defaultAgent.id}
                        size={18}
                        className="acp-start-card-icon"
                      />
                    </div>

                    <div className="acp-start-card-content">
                      <div className="acp-start-card-title-row">
                        <span className="acp-start-card-title">{group.baseName}</span>
                        {authorsLabel && (
                          <span className="acp-start-card-authors" title={`Authors: ${authorsLabel}`}>by {authorsLabel}</span>
                        )}
                      </div>

                      {descriptionText && (
                        <div className="acp-start-card-desc" title={descriptionText}>
                          {descriptionText}
                        </div>
                      )}

                      <div className="acp-start-card-footer">
                        {hasMultipleProfiles ? (
                          <div
                            className="acp-start-card-profile-wrap"
                            onClick={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                          >
                            <svg className="acp-start-card-meta-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="8" r="4" />
                              <path d="M20 21a8 8 0 1 0-16 0" />
                            </svg>
                            {(() => {
                              const currentProfileName = group.profiles.find((p) => p.agent.id === selectedAgent.id)?.profileName || selectedAgent.profile || 'Default';
                              return (
                                <>
                                  <span className="acp-start-card-profile-label">{currentProfileName}</span>
                                  <span className="acp-start-card-profile-arrow">▾</span>
                                  <select
                                    className="acp-start-card-profile-select"
                                    value={selectedAgent.id}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      handleSelectProfile(group.baseName, e.target.value);
                                    }}
                                    title="Select profile"
                                  >
                                    {group.profiles.map((p) => (
                                      <option key={p.agent.id} value={p.agent.id}>
                                        {p.profileName}
                                      </option>
                                    ))}
                                  </select>
                                </>
                              );
                            })()}
                          </div>
                        ) : hasSingleProfileWithAccount ? (
                          <div className="acp-start-card-profile-static">
                            <svg className="acp-start-card-meta-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="8" r="4" />
                              <path d="M20 21a8 8 0 1 0-16 0" />
                            </svg>
                            <span>{group.profiles[0].profileName}</span>
                          </div>
                        ) : null}

                        {onLoadSessions && onResumeSession && (
                          <button
                            className="acp-start-card-sessions-btn"
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveSessionsAgent({
                                agent: selectedAgent,
                                baseName: group.baseName,
                              });
                            }}
                            title={`Browse ${group.baseName} sessions`}
                          >
                            <svg className="acp-start-card-meta-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="12" r="10" />
                              <polyline points="12 6 12 12 16 14" />
                            </svg>
                            <span>Sessions</span>
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="acp-start-card-arrow">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </div>
                  </div>
                );
              });
            })()}
          </div>
          {(onOpenSettings || onOpenRegistry) && (
            <div className="acp-pane-settings-wrap">
              {onOpenRegistry && (
                <button
                  className="acp-pane-settings-btn"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenRegistry();
                  }}
                  title="Explore and install agents from ACP Registry"
                  type="button"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="acp-settings-icon">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                  <span>ACP Registry</span>
                </button>
              )}
              {onOpenSettings && (
                <button
                  className="acp-pane-settings-btn"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenSettings();
                  }}
                  type="button"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="acp-settings-icon">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  <span>Settings</span>
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="acp-pane-start-agents">
          <div className="acp-pane-start-agents-title">No agents configured</div>
          <div style={{ color: 'var(--theme-muted-foreground, #888)', fontSize: '0.86em', marginBottom: '14px', maxWidth: '360px', margin: '0 auto 16px' }}>
            Install agents from the ACP Registry or configure a custom agent in Settings.
          </div>
          {(onOpenSettings || onOpenRegistry) && (
            <div className="acp-pane-settings-wrap" style={{ marginTop: 0 }}>
              {onOpenRegistry && (
                <button
                  className="acp-pane-settings-btn"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenRegistry();
                  }}
                  title="Explore and install agents from ACP Registry"
                  type="button"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="acp-settings-icon">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                  <span>ACP Registry</span>
                </button>
              )}
              {onOpenSettings && (
                <button
                  className="acp-pane-settings-btn"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenSettings();
                  }}
                  type="button"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="acp-settings-icon">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  <span>Settings</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

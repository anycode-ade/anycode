import React, { useState, useMemo, useEffect } from 'react';
import { type AcpAgent, type AcpSession, type AcpSessionSummary } from '../../types';
import { parseAgentDisplayName } from '../../agents';
import { AgentIcon } from './AgentIcon';
import { AcpStartCard, groupAvailableAgents } from './AcpStartCard';
import { Icons } from '../Icons';
import { loadSelectedProfiles, saveSelectedProfiles } from '../../storage';
import { AcpOpenedAgentCard } from './AcpOpenedAgentCard';
import { AcpSessionsView } from './AcpSessionsView';
import type { WorkspaceProject } from '../../workspace';
import './AcpEmptyPane.css';

export { parseAgentDisplayName };

interface AcpEmptyPaneProps {
  agents: AcpSession[];
  projects: WorkspaceProject[];
  selectedProjectId: string;
  onSelectProject: (projectId: string) => void;
  availableAgents: AcpAgent[];
  onSelectAgent: (agentId: string) => void;
  onCloseAgent: (agentId: string) => void;
  onStartAgent: (agent: AcpAgent, projectId?: string) => string | null | undefined;
  onOpenSettings?: () => void;
  onOpenRegistry?: () => void;
  onLoadSessions?: (agent: AcpAgent, projectId?: string) => Promise<AcpSessionSummary[]>;
  onResumeSession?: (agent: AcpAgent, sessionId: string, projectId?: string) => void;
}

export const AcpEmptyPane: React.FC<AcpEmptyPaneProps> = ({
  agents,
  projects,
  selectedProjectId,
  onSelectProject,
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
  const [openedProjectFilter, setOpenedProjectFilter] = useState<string>('all');
  const selectedProject = projects.find((project) => project.id === selectedProjectId);

  const openedProjectOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of openedSessions) {
      const pid = s.projectId || '__none__';
      counts.set(pid, (counts.get(pid) ?? 0) + 1);
    }

    const opts: { id: string; name: string; count: number; title?: string }[] = [];
    for (const proj of projects) {
      const count = counts.get(proj.id) ?? 0;
      if (count > 0 || projects.length > 1) {
        opts.push({ id: proj.id, name: proj.name, count, title: proj.root });
      }
      counts.delete(proj.id);
    }

    for (const [pid, count] of counts.entries()) {
      opts.push({
        id: pid,
        name: pid === '__none__' ? 'No project' : 'Other',
        count,
      });
    }

    return opts;
  }, [openedSessions, projects]);

  const showProjectFilter = openedProjectOptions.length > 1;

  useEffect(() => {
    if (openedProjectFilter !== 'all' && !openedProjectOptions.some((o) => o.id === openedProjectFilter)) {
      setOpenedProjectFilter('all');
    }
  }, [openedProjectFilter, openedProjectOptions]);

  const filteredOpenedSessions = useMemo(() => {
    if (openedProjectFilter === 'all') return openedSessions;
    return openedSessions.filter((s) => (s.projectId || '__none__') === openedProjectFilter);
  }, [openedSessions, openedProjectFilter]);

  const startAgent = (agent: AcpAgent) => {
    if (!selectedProjectId) return;
    const startedAgentId = onStartAgent(agent, selectedProjectId);
    if (startedAgentId) {
      onSelectAgent(startedAgentId);
    }
  };

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
        onLoadSessions={(agent) => onLoadSessions(agent, selectedProjectId)}
        onResumeSession={onResumeSession}
      />
    );
  }

  return (
    <div className="acp-pane-empty">
      {openedSessions.length > 0 && (
        <div className="acp-pane-opened-agents">
          <div className="acp-pane-opened-agents-header">
            <div className="acp-pane-opened-agents-title">Opened agents</div>
            {showProjectFilter && (
              <div className="acp-pane-project-filter" role="tablist" aria-label="Filter opened agents by project">
                <button
                  type="button"
                  role="tab"
                  aria-selected={openedProjectFilter === 'all'}
                  className={`acp-pane-project-filter-btn ${openedProjectFilter === 'all' ? 'is-active' : ''}`}
                  onClick={() => setOpenedProjectFilter('all')}
                >
                  <span>All</span>
                  <span className="acp-pane-project-filter-count">{openedSessions.length}</span>
                </button>
                {openedProjectOptions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    role="tab"
                    aria-selected={openedProjectFilter === opt.id}
                    className={`acp-pane-project-filter-btn ${openedProjectFilter === opt.id ? 'is-active' : ''}`}
                    onClick={() => setOpenedProjectFilter(opt.id)}
                    title={opt.title ?? opt.name}
                  >
                    <span className="acp-pane-project-filter-label">{opt.name}</span>
                    <span className="acp-pane-project-filter-count">{opt.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {filteredOpenedSessions.length > 0 ? (
            <div className="acp-pane-opened-agents-list">
              {filteredOpenedSessions.map((openedSession) => (
                <AcpOpenedAgentCard
                  key={openedSession.agentId}
                  session={openedSession}
                  availableAgents={availableAgents}
                  projects={projects}
                  onSelectAgent={onSelectAgent}
                  onCloseAgent={onCloseAgent}
                />
              ))}
            </div>
          ) : (
            <div className="acp-pane-opened-empty-filter">
              No opened agents in this project
            </div>
          )}
        </div>
      )}
      {availableAgents.length > 0 ? (
        <div className="acp-pane-start-agents acp-pane-start-agents-wide">
          <div className="acp-pane-start-agents-title">Start a new agent</div>
          <div className="acp-pane-empty-actions">
            {groupAvailableAgents(availableAgents).map((group) => (
              <AcpStartCard
                key={group.baseName}
                group={group}
                selectedAgentId={selectedProfiles[group.baseName]}
                onSelectProfile={handleSelectProfile}
                onStart={startAgent}
                disabled={!selectedProjectId}
                title={
                  selectedProjectId
                    ? `Start ${group.baseName} in ${selectedProject?.name ?? 'selected project'}`
                    : 'Select a project before starting an agent'
                }
                footerExtra={
                  <>
                    {projects.length > 1 ? (
                      <div
                        className="acp-start-card-project-wrap"
                        onClick={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                      >
                        <svg className="acp-start-card-meta-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                        </svg>
                        <span className="acp-start-card-project-label">
                          {selectedProject?.name ?? 'Select project'}
                        </span>
                        <span className="acp-start-card-profile-arrow">▾</span>
                        <select
                          className="acp-start-card-project-select"
                          value={selectedProjectId}
                          onChange={(event) => {
                            event.stopPropagation();
                            onSelectProject(event.target.value);
                          }}
                          title={selectedProject?.root ?? 'Select the project for this agent'}
                          aria-label={`Project for ${group.baseName}`}
                        >
                          {projects.map((project) => (
                            <option key={project.id} value={project.id}>{project.name}</option>
                          ))}
                        </select>
                      </div>
                    ) : projects.length === 1 ? (
                      // A single project has nothing to choose; a static label keeps clicks on the card.
                      <div className="acp-start-card-profile-static">
                        <svg className="acp-start-card-meta-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                        </svg>
                        <span>{selectedProject?.name ?? 'Select project'}</span>
                      </div>
                    ) : null}

                    {onLoadSessions && onResumeSession && (
                      <button
                        className="acp-start-card-sessions-btn"
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const activeAgent = selectedProfiles[group.baseName]
                            ? group.profiles.find((p) => p.agent.id === selectedProfiles[group.baseName])?.agent || group.defaultAgent
                            : group.defaultAgent;
                          setActiveSessionsAgent({
                            agent: activeAgent,
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
                  </>
                }
              />
            ))}
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

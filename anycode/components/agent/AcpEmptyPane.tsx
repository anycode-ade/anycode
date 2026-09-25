import React from 'react';
import { type AcpAgent, type AcpSession } from '../../types';
import { parseAgentDisplayName, resolveAgentDisplay } from '../../agents';
import { AgentIcon } from './AgentIcon';
import { Icons } from '../Icons';
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
}

export const AcpEmptyPane: React.FC<AcpEmptyPaneProps> = ({
  agents,
  availableAgents,
  onSelectAgent,
  onCloseAgent,
  onStartAgent,
  onOpenSettings,
  onOpenRegistry,
}) => {
  const openedSessions = agents.filter((item) => item.isActive);

  return (
    <div className="acp-pane-empty">
      {openedSessions.length > 0 && (
        <div className="acp-pane-opened-agents">
          <div className="acp-pane-opened-agents-title">Opened agents</div>
          <div className="acp-pane-opened-agents-list">
            {openedSessions.map((openedSession) => {
              const { baseName, accountName, fullName } = resolveAgentDisplay(openedSession, availableAgents);
              return (
                <div key={openedSession.agentId} className="acp-pane-opened-agent-item">
                  <button
                    className="tab-close-button acp-pane-close-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onCloseAgent(openedSession.agentId);
                    }}
                    title={`Close ${fullName}`}
                    type="button"
                  >
                    <Icons.Close size={8} />
                  </button>
                  <button
                    className="acp-pane-opened-agent"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectAgent(openedSession.agentId);
                    }}
                    title={fullName}
                    type="button"
                  >
                    <AgentIcon name={baseName} id={openedSession.agentId} size={14} className="acp-agent-btn-icon" />
                    <span className="acp-pane-opened-name" title={baseName}>{baseName}</span>
                    {accountName && (
                      <span className="acp-pane-action-account-badge acp-pane-opened-badge" title={accountName}>
                        {accountName}
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {availableAgents.length > 0 ? (
        <div className="acp-pane-start-agents">
          <div className="acp-pane-start-agents-title">Start a new agent</div>
          <div className="acp-pane-empty-actions">
            {availableAgents.map((agent) => {
              const { baseName, accountName, fullName } = resolveAgentDisplay(agent, availableAgents);
              return (
                <button
                  key={agent.id}
                  className={`acp-pane-empty-action ${accountName ? 'has-account' : ''}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    const startedAgentId = onStartAgent(agent);
                    if (startedAgentId) {
                      onSelectAgent(startedAgentId);
                    }
                  }}
                  title={agent.description || fullName}
                >
                  <AgentIcon name={baseName} id={agent.id} size={22} className="acp-agent-btn-icon" />
                  <div className="acp-pane-action-info">
                    <span className="acp-pane-action-title" title={baseName}>{baseName}</span>
                    {accountName && (
                      <span className="acp-pane-action-account-badge" title={accountName}>
                        {accountName}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
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

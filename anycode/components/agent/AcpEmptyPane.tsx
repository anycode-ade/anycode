import React from 'react';
import { type AcpAgent, type AcpSession } from '../../types';
import { AgentIcon } from './AgentIcon';
import { Icons } from '../Icons';
import './AcpEmptyPane.css';

interface AcpEmptyPaneProps {
  agents: AcpSession[];
  availableAgents: AcpAgent[];
  onSelectAgent: (agentId: string) => void;
  onCloseAgent: (agentId: string) => void;
  onStartAgent: (agent: AcpAgent) => string | null | undefined;
  onOpenSettings?: () => void;
}

export const AcpEmptyPane: React.FC<AcpEmptyPaneProps> = ({
  agents,
  availableAgents,
  onSelectAgent,
  onCloseAgent,
  onStartAgent,
  onOpenSettings,
}) => {
  const openedSessions = agents.filter((item) => item.isActive);

  return (
    <div className="acp-pane-empty">
      {openedSessions.length > 0 && (
        <div className="acp-pane-opened-agents">
          <div className="acp-pane-opened-agents-title">Opened agents</div>
          <div className="acp-pane-opened-agents-list">
            {openedSessions.map((openedSession) => (
              <div key={openedSession.agentId} className="acp-pane-opened-agent-item">
                <button
                  className="tab-close-button acp-pane-close-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseAgent(openedSession.agentId);
                  }}
                  title={`Close ${openedSession.agentName || openedSession.agentId}`}
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
                  title={openedSession.agentName || openedSession.agentId}
                  type="button"
                >
                  <AgentIcon name={openedSession.agentName || openedSession.agentId} size={14} className="acp-agent-btn-icon" />
                  <span>{openedSession.agentName || openedSession.agentId}</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {availableAgents.length > 0 && (
        <div className="acp-pane-start-agents">
          <div className="acp-pane-start-agents-title">Start a new agent</div>
          <div className="acp-pane-empty-actions">
            {availableAgents.map((agent) => (
              <button
                key={agent.id}
                className="acp-pane-empty-action"
                onClick={(event) => {
                  event.stopPropagation();
                  const startedAgentId = onStartAgent(agent);
                  if (startedAgentId) {
                    onSelectAgent(startedAgentId);
                  }
                }}
                title={agent.description || agent.name}
              >
                <AgentIcon name={agent.name} id={agent.id} size={18} className="acp-agent-btn-icon" />
                <span>{agent.name}</span>
              </button>
            ))}
          </div>
          {onOpenSettings && (
            <div className="acp-pane-settings-wrap">
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
            </div>
          )}
        </div>
      )}
    </div>
  );
};

import React from 'react';
import { type AcpAgent, type AcpSession } from '../../types';
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
                  className="acp-pane-empty-action acp-pane-opened-agent"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectAgent(openedSession.agentId);
                  }}
                  title={openedSession.agentName || openedSession.agentId}
                  type="button"
                >
                  {openedSession.agentName || openedSession.agentId}
                </button>
                <button
                  className="tab-close-button acp-pane-close-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseAgent(openedSession.agentId);
                  }}
                  title={`Close ${openedSession.agentName || openedSession.agentId}`}
                  type="button"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {availableAgents.length > 0 && (
        <div className="acp-pane-start-agents">
          <div className="acp-pane-start-agents-title">Start an new agent</div>
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
                {agent.name}
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
                Settings
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

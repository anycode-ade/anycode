import React, { useRef } from 'react';
import { AcpSession } from '../../types';
import './AcpAgentsList.css';
import { AcpIcons } from './AcpIcons';

interface AcpAgentsListProps {
  agents: AcpSession[];
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
  onCloseAgent: (agentId: string) => void;
}

export const AcpAgentsList: React.FC<AcpAgentsListProps> = ({
  agents,
  selectedAgentId,
  onSelectAgent,
  onCloseAgent,
}) => {
  const agentsListRef = useRef<HTMLDivElement>(null);

  return (
    <div className="acp-agents-list" ref={agentsListRef}>
      {agents.map((agent) => {
        const isSelected = agent.agentId === selectedAgentId;
        const isActive = agent.isActive;
        return (
          <div
            key={agent.agentId}
            className={`acp-agent-item ${isSelected ? 'selected' : ''} ${isActive ? 'active' : 'inactive'}`}
            onClick={() => onSelectAgent(agent.agentId)}
          >
            {agent.isProcessing && (
              <span
                className="acp-agent-working-indicator"
                role="status"
                aria-label={`${agent.agentId} is working`}
                title="Agent is working"
              />
            )}
            <span className="acp-agent-name">{agent.agentId}</span>
            <button
              className="acp-agent-close-btn"
              onClick={(e) => {
                e.stopPropagation();
                onCloseAgent(agent.agentId);
              }}
              title="Close agent"
            >
              <AcpIcons.Close />
            </button>
          </div>
        );
      })}
    </div>
  );
};

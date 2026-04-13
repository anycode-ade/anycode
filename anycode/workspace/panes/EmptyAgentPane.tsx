import React from 'react';
import type { AcpAgent } from '../../types';

type EmptyAgentPaneProps = {
    availableAgents: AcpAgent[];
    onStartAgent: (agent: AcpAgent) => string | null | undefined;
    onAssignSession: (agentId: string) => void;
    onFocus: () => void;
};

export const EmptyAgentPane: React.FC<EmptyAgentPaneProps> = ({
    availableAgents,
    onStartAgent,
    onAssignSession,
    onFocus,
}) => (
    <div className="acp-pane-empty active" onMouseDown={onFocus}>
        <div className="acp-pane-empty-title">Empty agent pane</div>
        <div className="acp-pane-empty-subtitle">Start a session here or attach an existing one.</div>
        <div className="acp-pane-empty-actions">
            {availableAgents.map((agent) => (
                <button
                    key={agent.id}
                    className="acp-pane-empty-action"
                    onClick={() => {
                        const startedAgentId = onStartAgent(agent);
                        if (startedAgentId) {
                            onAssignSession(startedAgentId);
                        }
                    }}
                    title={agent.description || agent.name}
                >
                    {agent.name}
                </button>
            ))}
        </div>
    </div>
);

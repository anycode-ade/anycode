import React from 'react';
import { type IDockviewPanelProps } from 'dockview';
import { AcpSessionView } from '../../agent/AcpSessionView';
import { AgentPanelContext, useRequiredContext } from '../contexts';

const EmptyAgentPanel: React.FC<{ paneId: string }> = ({ paneId }) => {
    const ctx = useRequiredContext(AgentPanelContext, 'AgentPanelContext');

    const runningSessions = Array.from(ctx.agents.acpSessions.values());

    return (
        <div className="empty-pane empty-agent-pane">
            <div className="empty-pane-title">Agent Pane</div>
            <div className="empty-agent-section">
                <div className="empty-agent-section-title">Running agents</div>
                <ul className="empty-pane-list empty-agent-list">
                    {runningSessions.length === 0 ? (
                        <li className="empty-agent-empty">No running agents</li>
                    ) : (
                        runningSessions.map((session) => (
                            <li key={session.agentId}>
                                <button
                                    type="button"
                                    className="empty-pane-item-btn"
                                    onClick={() => ctx.bindAgentToPane(paneId, session.agentId)}
                                >
                                    {session.agentName || session.agentId}
                                </button>
                            </li>
                        ))
                    )}
                </ul>
            </div>

            <div className="empty-agent-section">
                <div className="empty-agent-section-title">Start new agent</div>
                <ul className="empty-pane-list empty-agent-list">
                    {ctx.availableAgents.length === 0 ? (
                        <li className="empty-agent-empty">No configured agents</li>
                    ) : (
                        ctx.availableAgents.map((agent) => (
                            <li key={agent.id}>
                                <button
                                    type="button"
                                    className="empty-pane-item-btn"
                                    onClick={() => ctx.handleStartSpecificAgentInPane(paneId, agent)}
                                >
                                    {agent.name}
                                </button>
                            </li>
                        ))
                    )}
                </ul>
            </div>
        </div>
    );
};

export const AgentPanel: React.FC<IDockviewPanelProps> = ({ api }) => {
    const ctx = useRequiredContext(AgentPanelContext, 'AgentPanelContext');
    const paneId = api.id;
    const paneAgentId = ctx.agentPaneSessionIds[paneId] ?? null;

    if (!paneAgentId) {
        return <EmptyAgentPanel paneId={paneId} />;
    }

    const paneSession = ctx.agents.acpSessions.get(paneAgentId) ?? null;
    if (!paneSession) {
        return <EmptyAgentPanel paneId={paneId} />;
    }

    return (
        <AcpSessionView
            key={`acp-pane-${paneSession.agentId}`}
            agentId={paneSession.agentId}
            title={paneSession.agentName || paneSession.agentId}
            isActivePane={true}
            isConnected={paneSession.isActive && ctx.isConnected}
            isProcessing={paneSession.isProcessing || false}
            messages={paneSession.messages}
            modelSelector={paneSession.modelSelector}
            reasoningSelector={paneSession.reasoningSelector}
            contextUsage={paneSession.contextUsage}
            onFocusPane={() => {
                ctx.setFocusedAgentPaneId(paneId);
                ctx.agents.setSelectedAgentId(paneSession.agentId);
            }}
            onSendPrompt={ctx.agents.sendPrompt}
            onCancelPrompt={ctx.agents.cancelPrompt}
            onPermissionResponse={ctx.agents.sendPermissionResponse}
            onUndoPrompt={ctx.agents.undoPrompt}
            onCloseAgent={ctx.handleCloseAgentEverywhere}
            onSelectModel={ctx.agents.setSessionModel}
            onSelectReasoning={ctx.agents.setSessionReasoning}
            onOpenFile={ctx.openFileInEditorPane}
            onOpenFileDiff={ctx.openFileDiffInEditorPane}
        />
    );
};

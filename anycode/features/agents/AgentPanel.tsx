import { useEffect, useRef } from 'react';
import { AcpSettings } from '../../components/agent/AcpSettings';
import { AcpSession } from '../../components/agent/AcpSession';
import { AcpEmptyPane } from '../../components/agent/AcpEmptyPane';
import type {
    AcpAgent,
    AcpSession as AcpSessionState,
    AcpSessionSummary,
} from '../../types';

type AgentPanelProps = {
    panelKey: string;
    focusRequestToken: number | null;
    isConnected: boolean;
    agentPanes: {
        activePaneId: string;
        getSelectedId: (paneKey: string) => string | null;
        selectForPane: (paneKey: string, agentId: string) => void;
    };
    agents: {
        acpSessions: Map<string, AcpSessionState>;
        isAgentSettingsOpen: boolean;
        closeAgent: (agentId: string) => void;
        fetchAvailableSessions: (agent: AcpAgent) => Promise<AcpSessionSummary[]>;
        sendPrompt: (...args: any[]) => void;
        cancelPrompt: (...args: any[]) => void;
        sendPermissionResponse: (...args: any[]) => void;
        undoPrompt: (...args: any[]) => void;
        setSessionModel: (...args: any[]) => void;
        setSessionReasoning: (...args: any[]) => void;
    };
    sessions: AcpSessionState[];
    availableAgents: AcpAgent[];
    settingsAgents: AcpAgent[];
    settingsDefaultAgentId: string | null;
    onSaveAgents: (agentList: AcpAgent[], defaultAgentId: string | null) => void;
    onCloseSettings: () => void;
    onResumeSettingsSession: (agent: AcpAgent, sessionId: string) => void;
    onStartSpecificAgent: (agent: AcpAgent) => string | null | undefined;
    onOpenSettings: () => void;
    onOpenFile: (path: string, line?: number, column?: number) => void;
    onOpenFileDiff: (path: string, line?: number, column?: number) => void;
};

export const AgentPanel = ({
    panelKey,
    focusRequestToken,
    isConnected,
    agentPanes,
    agents,
    sessions,
    availableAgents,
    settingsAgents,
    settingsDefaultAgentId,
    onSaveAgents,
    onCloseSettings,
    onResumeSettingsSession,
    onStartSpecificAgent,
    onOpenSettings,
    onOpenFile,
    onOpenFileDiff,
}: AgentPanelProps) => {
    const panelRef = useRef<HTMLDivElement | null>(null);
    const selectedAgentId = agentPanes.getSelectedId(panelKey);
    const selectedSession = selectedAgentId ? agents.acpSessions.get(selectedAgentId) ?? null : null;
    const handleSelectAgentForPane = (agentId: string) => {
        agentPanes.selectForPane(panelKey, agentId);
    };

    useEffect(() => {
        if (focusRequestToken === null) {
            return;
        }

        const root = panelRef.current;
        if (!root) {
            return;
        }

        const promptInput = root.querySelector<HTMLTextAreaElement>('textarea[name="prompt"]');
        if (promptInput) {
            promptInput.focus();
            return;
        }

        root.focus();
    }, [focusRequestToken]);

    if (agents.isAgentSettingsOpen && panelKey === agentPanes.activePaneId) {
        return (
            <div ref={panelRef} tabIndex={-1} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <AcpSettings
                    agents={settingsAgents}
                    defaultAgentId={settingsDefaultAgentId}
                    onSave={onSaveAgents}
                    onClose={onCloseSettings}
                    onLoadSessions={agents.fetchAvailableSessions}
                    onResumeSession={(agent, sessionId) => onResumeSettingsSession(agent, sessionId)}
                />
            </div>
        );
    }

    if (!selectedSession) {
        return (
            <div ref={panelRef} tabIndex={-1} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <div style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                    <AcpEmptyPane
                        agents={sessions}
                        availableAgents={availableAgents}
                        onSelectAgent={handleSelectAgentForPane}
                        onCloseAgent={agents.closeAgent}
                        onStartAgent={onStartSpecificAgent}
                        onOpenSettings={onOpenSettings}
                    />
                </div>
            </div>
        );
    }

    return (
        <div ref={panelRef} tabIndex={-1} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                <AcpSession
                    agentId={selectedSession.agentId}
                    title={selectedSession.agentName || selectedSession.agentId}
                    isConnected={selectedSession.isActive && isConnected}
                    isProcessing={selectedSession.isProcessing || false}
                    messages={selectedSession.messages}
                    modelSelector={selectedSession.modelSelector}
                    reasoningSelector={selectedSession.reasoningSelector}
                    contextUsage={selectedSession.contextUsage}
                    onFocusPane={() => {}}
                    onSendPrompt={agents.sendPrompt}
                    onCancelPrompt={agents.cancelPrompt}
                    onPermissionResponse={agents.sendPermissionResponse}
                    onUndoPrompt={agents.undoPrompt}
                    onCloseAgent={agents.closeAgent}
                    onSelectModel={agents.setSessionModel}
                    onSelectReasoning={agents.setSessionReasoning}
                    onOpenFile={onOpenFile}
                    onOpenFileDiff={onOpenFileDiff}
                />
            </div>
        </div>
    );
};

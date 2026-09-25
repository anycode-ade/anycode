import React, { useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import { AcpSettings } from '../../components/agent/AcpSettings';
import { AcpSession } from '../../components/agent/AcpSession';
import { AcpEmptyPane } from '../../components/agent/AcpEmptyPane';
import { AcpRegistryModal } from '../../components/agent/AcpRegistryModal';
import { resolveAgentDisplay } from '../../agents';
import type {
    AcpAgent,
    AcpSession as AcpSessionState,
    AcpSessionSummary,
    FileSearchResult,
    OpenFileInfo,
    WorkspaceFileInfo,
} from '../../types';

type AgentPanelProps = {
    panelKey: string;
    focusRequestToken: number | null;
    isConnected: boolean;
    wsRef: React.RefObject<Socket | null>;
    getOpenFiles?: () => OpenFileInfo[];
    getRootFiles?: () => WorkspaceFileInfo[];
    onSearchFiles?: (query: string) => Promise<FileSearchResult[]>;
    agentPanes: {
        activePaneId: string;
        getSelectedId: (paneKey: string) => string | null;
        selectForPane: (paneKey: string, agentId: string | null) => void;
    };
    agents: {
        acpSessions: Map<string, AcpSessionState>;
        isAgentSettingsOpen: boolean;
        isRegistryOpen: boolean;
        setIsRegistryOpen: (open: boolean) => void;
        agentsVersion: number;
        setAgentsVersion: React.Dispatch<React.SetStateAction<number>>;
        closeAgent: (agentId: string) => void;
        fetchAvailableSessions: (agent: AcpAgent) => Promise<AcpSessionSummary[]>;
        sendPrompt: (...args: any[]) => void;
        cancelPrompt: (...args: any[]) => void;
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

const AgentPanelComponent = ({
    panelKey,
    focusRequestToken,
    isConnected,
    wsRef,
    getOpenFiles,
    getRootFiles,
    onSearchFiles,
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

    if (agents.isRegistryOpen && panelKey === agentPanes.activePaneId) {
        return (
            <div ref={panelRef} tabIndex={-1} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <AcpRegistryModal
                    wsRef={wsRef}
                    isConnected={isConnected}
                    onClose={() => agents.setIsRegistryOpen(false)}
                    onStartAgent={(agent) => {
                        agents.setIsRegistryOpen(false);
                        const startedAgentId = onStartSpecificAgent(agent);
                        if (startedAgentId) {
                            handleSelectAgentForPane(startedAgentId);
                        }
                    }}
                    onAgentsChanged={() => {
                        agents.setAgentsVersion((v: number) => v + 1);
                    }}
                />
            </div>
        );
    }

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
                    onOpenRegistry={() => agents.setIsRegistryOpen(true)}
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
                        onOpenRegistry={() => agents.setIsRegistryOpen(true)}
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
                    title={resolveAgentDisplay(selectedSession, availableAgents).fullName}
                    isConnected={selectedSession.isActive && isConnected}
                    isProcessing={selectedSession.isProcessing || false}
                    isStarting={selectedSession.isStarting}
                    startError={selectedSession.startError}
                    messages={selectedSession.messages}
                    modelSelector={selectedSession.modelSelector}
                    reasoningSelector={selectedSession.reasoningSelector}
                    contextUsage={selectedSession.contextUsage}
                    availableCommands={selectedSession.availableCommands}
                    getOpenFiles={getOpenFiles}
                    getRootFiles={getRootFiles}
                    onSearchFiles={onSearchFiles}
                    authRequired={selectedSession.authRequired}
                    isAuthenticating={selectedSession.isAuthenticating}
                    pendingAuthMethod={selectedSession.pendingAuthMethod}
                    onAuthenticate={agents.authenticateAgent}
                    onFocusPane={() => {}}
                    onSendPrompt={agents.sendPrompt}
                    onCancelPrompt={agents.cancelPrompt}
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

export const AgentPanel = React.memo(AgentPanelComponent);

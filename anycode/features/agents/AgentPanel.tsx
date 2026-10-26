import React, { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { AcpSettings } from '../../components/agent/AcpSettings';
import { AnycodeAgentSession } from '../../components/agent/AnycodeAgentSession';
import { AcpEmptyPane } from '../../components/agent/AcpEmptyPane';
import { AcpRegistryModal } from '../../components/agent/AcpRegistryModal';
import { resolveAgentDisplay } from '../../agents';
import type {
    AcpAgent,
    AcpSession,
    AcpSessionSummary,
    FileSearchResult,
    OpenFileInfo,
    WorkspaceFileInfo,
} from '../../types';
import type { WorkspaceProject } from '../../workspace';

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
        acpSessions: Map<string, AcpSession>;
        isAgentSettingsOpen: boolean;
        isRegistryOpen: boolean;
        setIsRegistryOpen: (open: boolean) => void;
        agentsVersion: number;
        setAgentsVersion: React.Dispatch<React.SetStateAction<number>>;
        closeAgent: (agentId: string) => void;
        resumeSession: (agent: AcpAgent | undefined, sessionId: string, targetProjectId?: string) => string | null;
        authenticateAgent: (agentId: string, methodId: string) => void;
        fetchAvailableSessions: (agent: AcpAgent, targetProjectId?: string) => Promise<AcpSessionSummary[]>;
        sendPrompt: (...args: any[]) => void;
        updateQueuedPrompt?: (agentId: string, itemId: string, prompt: string) => void;
        removeQueuedPrompt?: (agentId: string, itemId: string) => void;
        moveQueuedPrompt?: (agentId: string, itemId: string, direction: 'up' | 'down') => void;
        sendQueuedPromptNow?: (agentId: string, itemId: string) => void;
        cancelPrompt: (...args: any[]) => void;
        undoPrompt: (...args: any[]) => void;
        setSessionModel: (...args: any[]) => void;
        setSessionReasoning: (...args: any[]) => void;
        getToolOutput?: (toolId: string, sessionId?: string) => Promise<string | null>;
        markSessionAsRead?: (agentId: string) => void;
    };
    sessions: AcpSession[];
    projects: WorkspaceProject[];
    activeProjectId: string | null;
    availableAgents: AcpAgent[];
    settingsAgents: AcpAgent[];
    settingsDefaultAgentId: string | null;
    onSaveAgents: (agentList: AcpAgent[], defaultAgentId: string | null) => void;
    onCloseSettings: () => void;
    onResumeSettingsSession: (agent: AcpAgent, sessionId: string, projectId?: string) => void;
    onStartSpecificAgent: (agent: AcpAgent, projectId?: string) => string | null | undefined;
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
    projects,
    activeProjectId,
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
    const [startProjectId, setStartProjectId] = useState(
        activeProjectId ?? projects[0]?.id ?? '',
    );
    const selectedAgentId = agentPanes.getSelectedId(panelKey);
    const selectedSession = selectedAgentId ? agents.acpSessions.get(selectedAgentId) ?? null : null;
    const selectedSessionDisplay = selectedSession
        ? resolveAgentDisplay(selectedSession, availableAgents)
        : null;
    const selectedSessionProject = selectedSession?.projectId
        ? projects.find((project) => project.id === selectedSession.projectId)
        : undefined;
    const handleSelectAgentForPane = (agentId: string) => {
        agentPanes.selectForPane(panelKey, agentId);
    };
    const handleStartProjectChange = (projectId: string) => {
        setStartProjectId(projectId);
    };

    useEffect(() => {
        if (projects.some((project) => project.id === startProjectId)) {
            return;
        }
        setStartProjectId(
            activeProjectId && projects.some((project) => project.id === activeProjectId)
                ? activeProjectId
                : projects[0]?.id ?? '',
        );
    }, [activeProjectId, projects, startProjectId]);

    useEffect(() => {
        if (selectedSession) {
            agents.markSessionAsRead?.(selectedSession.agentId);
        }
    }, [selectedSession?.agentId, selectedSession?.messages.length, agents.markSessionAsRead]);

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
                        const startedAgentId = onStartSpecificAgent(agent, startProjectId);
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
                        projects={projects}
                        selectedProjectId={startProjectId}
                        onSelectProject={handleStartProjectChange}
                        availableAgents={availableAgents}
                        onSelectAgent={handleSelectAgentForPane}
                        onCloseAgent={agents.closeAgent}
                        onStartAgent={onStartSpecificAgent}
                        onOpenSettings={onOpenSettings}
                        onOpenRegistry={() => agents.setIsRegistryOpen(true)}
                        onLoadSessions={(agent) => agents.fetchAvailableSessions(agent, startProjectId)}
                        onResumeSession={(agent, sessionId, targetProjectId) => {
                            const projectId = targetProjectId ?? startProjectId;
                            const aid = agents.resumeSession(agent, sessionId, projectId);
                            if (aid) {
                                handleSelectAgentForPane(aid);
                            } else {
                                onResumeSettingsSession(agent, sessionId, projectId);
                            }
                        }}
                    />
                </div>
            </div>
        );
    }

    return (
        <div ref={panelRef} tabIndex={-1} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                <AnycodeAgentSession
                    key={selectedSession.agentId}
                    agentId={selectedSession.agentId}
                    title={selectedSessionDisplay?.fullName ?? selectedSession.agentId}
                    agentAuthors={selectedSessionDisplay?.authors}
                    projectName={selectedSessionProject?.name}
                    projectPath={selectedSessionProject?.root}
                    isConnected={selectedSession.isActive && isConnected}
                    isProcessing={selectedSession.isProcessing || false}
                    isStarting={selectedSession.isStarting}
                    startError={selectedSession.startError}
                    messages={selectedSession.messages}
                    queue={selectedSession.queue}
                    onUpdateQueueItem={agents.updateQueuedPrompt}
                    onRemoveQueueItem={agents.removeQueuedPrompt}
                    onMoveQueueItem={agents.moveQueuedPrompt}
                    onSendQueueItemNow={agents.sendQueuedPromptNow}
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
                    onOpenSettings={onOpenSettings}
                    onGetToolOutput={agents.getToolOutput}
                />
            </div>
        </div>
    );
};

export const AgentPanel = React.memo(AgentPanelComponent);

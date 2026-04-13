import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import {
    type AcpAgent,
    type AcpContextUsageMessage,
    type AcpMessage,
    type AcpModelSelectorMessage,
    type AcpOpenFileMessage,
    type AcpPromptStateMessage,
    type AcpReasoningSelectorMessage,
    type AcpSelectOption,
    type AcpSession,
    type AcpSessionSummary,
    type AcpToolCallMessage,
    type AcpToolResultMessage,
} from '../types';

type UseAgentsParams = {
    wsRef: React.RefObject<Socket | null>;
    isConnected: boolean;
    followEnabled: boolean;
    openFile: (path: string, line?: number, column?: number) => void;
    openFileDiff: (path: string, line?: number, column?: number) => void;
    onAgentStarted?: () => void;
};

export const useAgents = ({
    wsRef,
    isConnected,
    followEnabled,
    openFile,
    openFileDiff,
    onAgentStarted,
}: UseAgentsParams) => {
    const [acpSessions, setAcpSessions] = useState<Map<string, AcpSession>>(new Map());
    const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
    const [isAgentSettingsOpen, setIsAgentSettingsOpen] = useState<boolean>(false);
    const [agentsVersion, setAgentsVersion] = useState<number>(0);

    const agentCounterRef = useRef<Map<string, number>>(new Map());
    const acpSessionsRef = useRef<Map<string, AcpSession>>(new Map());
    const followEnabledRef = useRef<boolean>(followEnabled);

    useEffect(() => { acpSessionsRef.current = acpSessions; }, [acpSessions]);
    useEffect(() => { followEnabledRef.current = followEnabled; }, [followEnabled]);

    const sendPermissionResponse = useCallback((agentId: string, permissionId: string, optionId: string) => {
        if (!wsRef.current || !isConnected) return;

        wsRef.current.emit('acp:permission_response', {
            agent_id: agentId,
            permission_id: permissionId,
            option_id: optionId,
        });
    }, [wsRef, isConnected]);

    const updateSession = useCallback((agentId: string, updater: (session: AcpSession | undefined) => AcpSession) => {
        setAcpSessions((prev) => {
            const newSessions = new Map(prev);
            const existing = newSessions.get(agentId);
            newSessions.set(agentId, updater(existing));
            return newSessions;
        });
    }, []);

    const generateAgentId = useCallback((baseAgentId: string): string => {
        const existingSessions = acpSessionsRef.current;
        let uniqueId = baseAgentId;
        let counter = agentCounterRef.current.get(baseAgentId) || 0;

        if (existingSessions.has(baseAgentId)) {
            counter++;
            uniqueId = `${baseAgentId}-${counter}`;
            while (existingSessions.has(uniqueId)) {
                counter++;
                uniqueId = `${baseAgentId}-${counter}`;
            }
        }

        agentCounterRef.current.set(baseAgentId, counter);
        return uniqueId;
    }, []);

    const removeAgentFromSessions = useCallback((agentId: string, wasSelected: boolean) => {
        setAcpSessions((prev) => {
            const newSessions = new Map(prev);
            const sessionToRemove = newSessions.get(agentId);
            newSessions.delete(agentId);

            if (sessionToRemove) {
                const baseAgentId = agentId.split('-')[0];
                const currentCounter = agentCounterRef.current.get(baseAgentId) || 0;
                if (currentCounter > 0) {
                    agentCounterRef.current.set(baseAgentId, currentCounter - 1);
                }
            }

            if (wasSelected) {
                const remainingSessions = Array.from(newSessions.values());
                if (remainingSessions.length > 0) {
                    setSelectedAgentId(remainingSessions[0].agentId);
                } else {
                    setSelectedAgentId(null);
                }
            }

            return newSessions;
        });
    }, []);

    const handleAcpMessage = useCallback((data: { agent_id: string; item: AcpMessage }) => {
        if (data.item.role === 'open_file') {
            const openFileMsg = data.item as AcpOpenFileMessage;
            if (followEnabledRef.current) {
                openFile(openFileMsg.path, openFileMsg.line, 0);
            }
            return;
        }

        if (data.item.role === 'prompt_state') {
            const promptState = data.item as AcpPromptStateMessage;
            updateSession(data.agent_id, (existing) => ({
                agentId: data.agent_id,
                agentName: existing?.agentName ?? '',
                messages: existing?.messages ?? [],
                isActive: true,
                isProcessing: promptState.is_processing,
                sessionId: existing?.sessionId,
                agentConfigId: existing?.agentConfigId,
                modelSelector: existing?.modelSelector,
                reasoningSelector: existing?.reasoningSelector,
                contextUsage: existing?.contextUsage,
            }));
            return;
        }

        if (data.item.role === 'session_model_selector') {
            const selector = data.item as AcpModelSelectorMessage;
            updateSession(data.agent_id, (existing) => ({
                agentId: data.agent_id,
                agentName: existing?.agentName ?? '',
                messages: existing?.messages ?? [],
                isActive: true,
                isProcessing: existing?.isProcessing,
                sessionId: existing?.sessionId,
                agentConfigId: existing?.agentConfigId,
                modelSelector: {
                    current_value: selector.current_value,
                    options: selector.options,
                },
                reasoningSelector: existing?.reasoningSelector,
                contextUsage: existing?.contextUsage,
            }));
            return;
        }

        if (data.item.role === 'session_reasoning_selector') {
            const selector = data.item as AcpReasoningSelectorMessage;
            updateSession(data.agent_id, (existing) => ({
                agentId: data.agent_id,
                agentName: existing?.agentName ?? '',
                messages: existing?.messages ?? [],
                isActive: true,
                isProcessing: existing?.isProcessing,
                sessionId: existing?.sessionId,
                agentConfigId: existing?.agentConfigId,
                modelSelector: existing?.modelSelector,
                reasoningSelector: {
                    current_value: selector.current_value,
                    options: selector.options,
                },
                contextUsage: existing?.contextUsage,
            }));
            return;
        }

        if (data.item.role === 'context_usage') {
            const usage = data.item as AcpContextUsageMessage;
            updateSession(data.agent_id, (existing) => ({
                agentId: data.agent_id,
                agentName: existing?.agentName ?? '',
                messages: existing?.messages ?? [],
                isActive: true,
                isProcessing: existing?.isProcessing,
                sessionId: existing?.sessionId,
                agentConfigId: existing?.agentConfigId,
                modelSelector: existing?.modelSelector,
                reasoningSelector: existing?.reasoningSelector,
                contextUsage: {
                    used: usage.used,
                    size: usage.size,
                },
            }));
            return;
        }

        if (data.item.role === 'error') {
            updateSession(data.agent_id, (existing) => ({
                agentId: data.agent_id,
                agentName: existing?.agentName ?? '',
                messages: [...(existing?.messages ?? []), data.item],
                isActive: true,
                isProcessing: existing?.isProcessing,
                sessionId: existing?.sessionId,
                agentConfigId: existing?.agentConfigId,
                modelSelector: existing?.modelSelector,
                reasoningSelector: existing?.reasoningSelector,
                contextUsage: existing?.contextUsage,
            }));
            return;
        }

        if (data.item.role === 'tool_call' || data.item.role === 'tool_result' || data.item.role === 'tool_update' || data.item.role === 'permission_request') {
            // Follow mode is temporarily disabled.
            // if (data.item.role === 'tool_result' && followEnabledRef.current) {
            //     const toolResult = data.item as AcpToolResultMessage;
            //     const session = acpSessionsRef.current.get(data.agent_id);
            //     if (session) {
            //         const matchingToolCall = session.messages.find(
            //             (m) => m.role === 'tool_call' && (m as AcpToolCallMessage).id === toolResult.id,
            //         ) as AcpToolCallMessage | undefined;
            //         if (matchingToolCall?.locations && matchingToolCall.locations.length > 0) {
            //             const loc = matchingToolCall.locations[0];
            //             openFile(loc.path, loc.line, 0);
            //             openFileDiff(loc.path, loc.line, 0);
            //         }
            //     }
            // }

            updateSession(data.agent_id, (existing) => ({
                agentId: data.agent_id,
                agentName: existing?.agentName ?? '',
                messages: [...(existing?.messages ?? []), data.item],
                isActive: true,
                isProcessing: existing?.isProcessing,
                sessionId: existing?.sessionId,
                agentConfigId: existing?.agentConfigId,
                modelSelector: existing?.modelSelector,
                reasoningSelector: existing?.reasoningSelector,
                contextUsage: existing?.contextUsage,
            }));
            return;
        }

        if (data.item.role !== 'user' && data.item.role !== 'assistant' && data.item.role !== 'thought') {
            return;
        }

        const message = data.item;
        const isChunk = message.is_chunk || false;

        updateSession(data.agent_id, (existing) => {
            if (!existing) {
                return {
                    agentId: data.agent_id,
                    agentName: '',
                    messages: [message],
                    isActive: true,
                };
            }

            if (isChunk && existing.messages.length > 0) {
                const lastMessage = existing.messages[existing.messages.length - 1];
                if (lastMessage.role === message.role && (lastMessage.role === 'assistant' || lastMessage.role === 'thought')) {
                    const updatedMessages = [...existing.messages];
                    updatedMessages[updatedMessages.length - 1] = {
                        ...lastMessage,
                        content: lastMessage.content + message.content,
                    };

                    return {
                        ...existing,
                        messages: updatedMessages,
                    };
                }
            }

            const messageToAdd = isChunk && (message.role === 'thought' || message.role === 'assistant')
                ? { ...message, is_chunk: undefined }
                : message;

            return {
                ...existing,
                messages: [...existing.messages, messageToAdd],
            };
        });
    }, [openFile, openFileDiff, updateSession]);

    const handleAcpHistory = useCallback((data: { agent_id: string; history: AcpMessage[] }) => {
        const reversedHistory = [...data.history].reverse();
        const modelSelector = reversedHistory.find((item): item is AcpModelSelectorMessage => item.role === 'session_model_selector');
        const reasoningSelector = reversedHistory.find((item): item is AcpReasoningSelectorMessage => item.role === 'session_reasoning_selector');
        const contextUsage = reversedHistory.find((item): item is AcpContextUsageMessage => item.role === 'context_usage');
        const visibleMessages = data.history.filter((item) =>
            item.role !== 'session_model_selector'
            && item.role !== 'session_reasoning_selector'
            && item.role !== 'context_usage',
        );

        updateSession(data.agent_id, (existing) => ({
            agentId: data.agent_id,
            agentName: existing?.agentName ?? '',
            messages: visibleMessages,
            isActive: true,
            isProcessing: existing?.isProcessing,
            sessionId: existing?.sessionId,
            agentConfigId: existing?.agentConfigId,
            modelSelector: modelSelector ? {
                current_value: modelSelector.current_value,
                options: modelSelector.options,
            } : existing?.modelSelector,
            reasoningSelector: reasoningSelector ? {
                current_value: reasoningSelector.current_value,
                options: reasoningSelector.options,
            } : existing?.reasoningSelector,
            contextUsage: contextUsage ? {
                used: contextUsage.used,
                size: contextUsage.size,
            } : existing?.contextUsage,
        }));
    }, [updateSession]);

    const setSessionModel = useCallback((agentId: string, option: AcpSelectOption) => {
        if (!wsRef.current || !isConnected) return;

        wsRef.current.emit('acp:set_model', {
            agent_id: agentId,
            option,
        }, (response: any) => {
            if (response.success) return;
            alert('Failed to set model: ' + response.error);
        });
    }, [wsRef, isConnected]);

    const setSessionReasoning = useCallback((agentId: string, option: AcpSelectOption) => {
        if (!wsRef.current || !isConnected) return;

        wsRef.current.emit('acp:set_reasoning', {
            agent_id: agentId,
            option,
        }, (response: any) => {
            if (response.success) return;
            alert('Failed to set thinking: ' + response.error);
        });
    }, [wsRef, isConnected]);

    const reconnectToAcpAgents = useCallback(() => {
        if (!wsRef.current || !isConnected) return;

        wsRef.current.emit('acp:reconnect', {}, (response: any) => {
            if (!response.success) return;

            const activeAgents = response.agents || [];
            setAcpSessions((prev) => {
                const newSessions = new Map(prev);

                activeAgents.forEach((agent: any) => {
                    const existing = newSessions.get(agent.id);
                    if (existing) {
                        newSessions.set(agent.id, { ...existing, isActive: true });
                    } else {
                        newSessions.set(agent.id, {
                            agentId: agent.id,
                            agentName: agent.name,
                            messages: [],
                            isActive: true,
                        });
                    }

                    const baseAgentId = agent.id.split('-')[0];
                    const match = agent.id.match(/-(\d+)$/);
                    if (match) {
                        const counter = parseInt(match[1], 10);
                        const currentCounter = agentCounterRef.current.get(baseAgentId) || 0;
                        agentCounterRef.current.set(baseAgentId, Math.max(currentCounter, counter));
                    } else {
                        const currentCounter = agentCounterRef.current.get(baseAgentId) || 0;
                        if (currentCounter === 0) {
                            agentCounterRef.current.set(baseAgentId, 1);
                        }
                    }
                });

                newSessions.forEach((session, agentId) => {
                    if (!activeAgents.find((a: any) => a.id === agentId)) {
                        newSessions.set(agentId, { ...session, isActive: false });
                    }
                });

                return newSessions;
            });

            if (!selectedAgentId && activeAgents.length > 0) {
                setSelectedAgentId(activeAgents[0].id);
            }
        });
    }, [wsRef, isConnected, selectedAgentId]);

    const startAgent = useCallback((agent: AcpAgent | undefined, options?: { resumeSessionId?: string }) => {
        if (!agent || !wsRef.current || !isConnected) return null;

        const { id, name, command, args } = agent;
        const aid = generateAgentId(id);

        wsRef.current.emit('acp:start', {
            agent_id: aid,
            agent_name: name,
            command,
            args,
            resume_session_id: options?.resumeSessionId ?? null,
        }, (response: any) => {
            if (response.success) {
                setAcpSessions((prev) => {
                    const newSessions = new Map(prev);
                    const existing = newSessions.get(aid);
                    newSessions.set(aid, {
                        ...existing,
                        agentId: aid,
                        agentName: name,
                        agentConfigId: id,
                        sessionId: response.session_id,
                        messages: existing?.messages ?? [],
                        isActive: true,
                        isProcessing: existing?.isProcessing ?? false,
                    });
                    return newSessions;
                });
                setSelectedAgentId(aid);
                onAgentStarted?.();
            } else {
                const errorMessage = response.error || `Failed to start agent ${aid}`;
                alert(errorMessage);
            }
        });
        return aid;
    }, [wsRef, isConnected, generateAgentId, onAgentStarted]);

    const fetchAvailableSessions = useCallback((agent: AcpAgent | undefined): Promise<AcpSessionSummary[]> => {
        return new Promise((resolve, reject) => {
            if (!agent || !wsRef.current || !isConnected) {
                resolve([]);
                return;
            }

            wsRef.current.emit('acp:sessions_list', {
                command: agent.command,
                args: agent.args,
            }, (response: any) => {
                if (!response.success) {
                    reject(new Error(response.error || 'Failed to load ACP sessions'));
                    return;
                }

                const sessions = (response.sessions || []).map((session: any) => ({
                    sessionId: session.session_id,
                    cwd: session.cwd,
                    title: session.title ?? undefined,
                    updatedAt: session.updated_at ?? undefined,
                })) as AcpSessionSummary[];

                resolve(sessions);
            });
        });
    }, [wsRef, isConnected]);

    const resumeSession = useCallback((agent: AcpAgent | undefined, sessionId: string) => {
        startAgent(agent, { resumeSessionId: sessionId });
    }, [startAgent]);

    const sendPrompt = useCallback((agentId: string, prompt: string) => {
        if (!wsRef.current || !isConnected) return;

        wsRef.current.emit('acp:prompt', { agent_id: agentId, prompt }, (response: any) => {
            if (response.success) return;

            alert('Failed to send prompt: ' + response.error);
            setAcpSessions((prev) => {
                const newSessions = new Map(prev);
                const existing = newSessions.get(agentId);
                if (!existing) return newSessions;
                newSessions.set(agentId, { ...existing, isProcessing: false });
                return newSessions;
            });
        });
    }, [wsRef, isConnected]);

    const undoPrompt = useCallback((agentId: string, checkpointId?: string, prompt?: string) => {
        if (!wsRef.current || !isConnected) return;

        wsRef.current.emit('acp:undo', { agent_id: agentId, checkpoint_id: checkpointId, prompt }, (response: any) => {
            if (!response.success) {
                alert('Failed to undo prompt: ' + response.error);
            }
        });
    }, [wsRef, isConnected]);

    const cancelPrompt = useCallback((agentId: string) => {
        if (!wsRef.current || !isConnected) return;

        wsRef.current.emit('acp:cancel', { agent_id: agentId }, (response: any) => {
            if (!response.success) return;

            setAcpSessions((prev) => {
                const newSessions = new Map(prev);
                const existing = newSessions.get(agentId);
                if (!existing) return newSessions;
                newSessions.set(agentId, { ...existing, isProcessing: false });
                return newSessions;
            });
        });
    }, [wsRef, isConnected]);

    const stopAgent = useCallback((agentId: string) => {
        if (!wsRef.current || !isConnected) return;

        wsRef.current.emit('acp:stop', { agent_id: agentId }, (response: any) => {
            if (!response.success) return;

            setAcpSessions((prev) => {
                const newSessions = new Map(prev);
                const existing = newSessions.get(agentId);
                if (!existing) return newSessions;
                newSessions.set(agentId, { ...existing, isActive: false });
                return newSessions;
            });
        });
    }, [wsRef, isConnected]);

    const closeAgent = useCallback((agentId: string) => {
        const wasSelected = selectedAgentId === agentId;
        const session = acpSessionsRef.current.get(agentId);

        if (session && session.isActive && wsRef.current && isConnected) {
            wsRef.current.emit('acp:stop', { agent_id: agentId }, (_response: any) => {
                removeAgentFromSessions(agentId, wasSelected);
            });
            return;
        }

        removeAgentFromSessions(agentId, wasSelected);
    }, [selectedAgentId, wsRef, isConnected, removeAgentFromSessions]);

    useEffect(() => {
        if (selectedAgentId && !acpSessions.has(selectedAgentId)) {
            const remainingSessions = Array.from(acpSessions.values());
            if (remainingSessions.length > 0) {
                setSelectedAgentId(remainingSessions[0].agentId);
            } else {
                setSelectedAgentId(null);
            }
        } else if (!selectedAgentId && acpSessions.size > 0) {
            const firstSession = Array.from(acpSessions.values())[0];
            setSelectedAgentId(firstSession.agentId);
        }
    }, [acpSessions, selectedAgentId]);

    return {
        acpSessions,
        selectedAgentId,
        setSelectedAgentId,
        isAgentSettingsOpen,
        setIsAgentSettingsOpen,
        agentsVersion,
        setAgentsVersion,
        handleAcpMessage,
        handleAcpHistory,
        reconnectToAcpAgents,
        startAgent,
        fetchAvailableSessions,
        resumeSession,
        sendPrompt,
        undoPrompt,
        sendPermissionResponse,
        setSessionModel,
        setSessionReasoning,
        cancelPrompt,
        stopAgent,
        closeAgent,
    };
};

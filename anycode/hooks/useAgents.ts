import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import {
    type AcpAgent,
    type AcpAssistantMessage,
    type AcpContextUsageMessage,
    type AcpMediaMessage,
    type AcpMessage,
    type AcpModelSelectorMessage,
    type AcpPromptStateMessage,
    type AcpPromptAttachment,
    type AcpRawUpdateMessage,
    type AcpReasoningSelectorMessage,
    type AcpSelectOption,
    type AcpSession,
    type AcpSessionSummary,
    type AcpThoughtMessage,
    type AcpToolCallMessage,
    type AcpToolResultMessage,
    type AcpToolUpdateMessage,
    type AcpUserMessage,
} from '../types';

const MESSAGE_FLUSH_MS = 100;

type UseAgentsParams = {
    wsRef: React.RefObject<Socket | null>;
    isConnected: boolean;
    onAgentStarted?: () => void;
};
type PendingAcpEvent = { agent_id: string; item: AcpMessage };

const asRecord = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
};

const asString = (value: unknown): string | undefined => {
    return typeof value === 'string' ? value : undefined;
};

const getAnyField = (record: Record<string, unknown> | null, ...keys: string[]): unknown => {
    if (!record) return undefined;
    for (const key of keys) {
        if (key in record) return record[key];
    }
    return undefined;
};

const getVariant = (update: unknown): { kind: string; payload: unknown } | null => {
    const record = asRecord(update);
    if (!record) return null;

    const taggedKind = asString(record.sessionUpdate) ?? asString(record.session_update);
    if (taggedKind) {
        return { kind: taggedKind, payload: record };
    }

    const entries = Object.entries(record);
    if (entries.length !== 1) return null;
    const [kind, payload] = entries[0];
    return { kind, payload };
};

const normalizeToolStatus = (status: unknown): string | undefined => {
    const s = asString(status);
    return s ? s.toLowerCase() : undefined;
};

const normalizeVariantKind = (kind: string): string => {
    const k = kind.trim();
    if (!k) return k;
    if (k.includes('_')) return k.toLowerCase();
    return k.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
};

const contentBlockToMessages = (
    content: unknown,
    textRole: 'user' | 'assistant' | 'thought',
): AcpMessage[] => {
    const contentRecord = asRecord(content);
    if (!contentRecord) return [];

    const contentType = asString(contentRecord.type)?.toLowerCase();
    if (contentType === 'text') {
        const text = asString(contentRecord.text);
        if (!text) return [];
        if (textRole === 'user') {
            return [{ role: 'user', content: text, is_chunk: true } satisfies AcpUserMessage];
        }
        if (textRole === 'thought') {
            return [{ role: 'thought', content: text, is_chunk: true } satisfies AcpThoughtMessage];
        }
        return [{ role: 'assistant', content: text, is_chunk: true } satisfies AcpAssistantMessage];
    }
    if (contentType === 'image') {
        const message: AcpMediaMessage = {
            role: 'media',
            media_type: 'image',
            mime_type: asString(contentRecord.mime_type) ?? asString(contentRecord.mimeType),
            data: asString(contentRecord.data) ?? asString(contentRecord.base64),
            uri: asString(contentRecord.uri),
            title: asString(contentRecord.title),
        };
        return [message];
    }
    if (contentType === 'audio') {
        const message: AcpMediaMessage = {
            role: 'media',
            media_type: 'audio',
            mime_type: asString(contentRecord.mime_type) ?? asString(contentRecord.mimeType),
            data: asString(contentRecord.data) ?? asString(contentRecord.base64),
            uri: asString(contentRecord.uri),
            title: asString(contentRecord.title),
        };
        return [message];
    }

    if ('Text' in contentRecord) {
        const text = asString(asRecord(contentRecord.Text)?.text);
        if (!text) return [];
        if (textRole === 'user') {
            return [{ role: 'user', content: text, is_chunk: true } satisfies AcpUserMessage];
        }
        if (textRole === 'thought') {
            return [{ role: 'thought', content: text, is_chunk: true } satisfies AcpThoughtMessage];
        }
        return [{ role: 'assistant', content: text, is_chunk: true } satisfies AcpAssistantMessage];
    }

    if ('Image' in contentRecord) {
        const image = asRecord(contentRecord.Image);
        if (!image) return [];
        const message: AcpMediaMessage = {
            role: 'media',
            media_type: 'image',
            mime_type: asString(image.mime_type) ?? asString(image.mimeType),
            data: asString(image.data) ?? asString(image.base64),
            uri: asString(image.uri),
            title: asString(image.title),
        };
        return [message];
    }

    if ('Audio' in contentRecord) {
        const audio = asRecord(contentRecord.Audio);
        if (!audio) return [];
        const message: AcpMediaMessage = {
            role: 'media',
            media_type: 'audio',
            mime_type: asString(audio.mime_type) ?? asString(audio.mimeType),
            data: asString(audio.data) ?? asString(audio.base64),
            uri: asString(audio.uri),
            title: asString(audio.title),
        };
        return [message];
    }

    if ('ResourceLink' in contentRecord) {
        const link = asRecord(contentRecord.ResourceLink);
        const uri = asString(link?.uri);
        if (!uri) return [];
        return [{ role: 'assistant', content: uri } satisfies AcpAssistantMessage];
    }

    return [];
};

const projectRawUpdate = (rawMessage: AcpRawUpdateMessage): AcpMessage[] => {
    const variant = getVariant(rawMessage.update);
    if (!variant) return [];
    const kind = normalizeVariantKind(variant.kind);

    const payload = asRecord(variant.payload);

    if ((kind === 'agent_message_chunk') && payload) {
        return contentBlockToMessages(payload.content, 'assistant');
    }

    if ((kind === 'user_message_chunk') && payload) {
        // Ignored because the user message is already added to history by the backend/client upon sending.
        return [];
    }

    if ((kind === 'agent_thought_chunk') && payload) {
        return contentBlockToMessages(payload.content, 'thought');
    }

    if ((kind === 'tool_call') && payload) {
        const id = asString(getAnyField(payload, 'tool_call_id', 'toolCallId', 'id')) ?? crypto.randomUUID();
        const title = asString(getAnyField(payload, 'title', 'name')) ?? 'tool';
        const rawInput = asRecord(getAnyField(payload, 'raw_input', 'rawInput', 'input', 'arguments'));
        const content = getAnyField(payload, 'content');
        const locations = getAnyField(payload, 'locations');
        const call: AcpToolCallMessage = {
            role: 'tool_call',
            id,
            name: title,
            title,
            command: asString(rawInput?.cmd) ?? asString(rawInput?.command) ?? title,
            arguments: payload,
            kind: asString(getAnyField(payload, 'kind', 'tool_kind')),
            status: normalizeToolStatus(getAnyField(payload, 'status')),
            content: Array.isArray(content) ? content as any : undefined,
            raw_input: rawInput ?? undefined,
            raw_output: getAnyField(payload, 'raw_output', 'rawOutput', 'output'),
            locations: Array.isArray(locations) ? locations as any : undefined,
        };
        return [call];
    }

    if ((kind === 'tool_call_update') && payload) {
        const id = asString(getAnyField(payload, 'tool_call_id', 'toolCallId', 'id')) ?? '';
        if (!id) return [];
        const fields = asRecord(getAnyField(payload, 'fields'));
        const status = normalizeToolStatus(getAnyField(fields, 'status') ?? getAnyField(payload, 'status'));
        const basePayload = fields ?? payload;
        const withId = { tool_call_id: id, ...basePayload };

        if (status === 'completed') {
            const result: AcpToolResultMessage = {
                role: 'tool_result',
                id,
                result: withId,
            };
            return [result];
        }

        const update: AcpToolUpdateMessage = {
            role: 'tool_update',
            id,
            update: withId,
        };
        return [update];
    }

    if ((kind === 'usage_update') && payload) {
        const usage: AcpContextUsageMessage = {
            role: 'context_usage',
            used: Number(payload.used ?? 0),
            size: Number(payload.size ?? 0),
        };
        return [usage];
    }

    return [];
};

export const useAgents = ({
    wsRef,
    isConnected,
    onAgentStarted,
}: UseAgentsParams) => {
    const [acpSessions, setAcpSessions] = useState<Map<string, AcpSession>>(new Map());
    const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
    const [isAgentSettingsOpen, setIsAgentSettingsOpen] = useState<boolean>(false);
    const [agentsVersion, setAgentsVersion] = useState<number>(0);

    const agentCounterRef = useRef<Map<string, number>>(new Map());
    const acpSessionsRef = useRef<Map<string, AcpSession>>(new Map());
    const pendingEventsRef = useRef<PendingAcpEvent[]>([]);
    const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => { acpSessionsRef.current = acpSessions; }, [acpSessions]);

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
    
    const mergeChunkMessages = (messages: AcpMessage[]): AcpMessage[] => {
        const merged: AcpMessage[] = [];

        for (const item of messages) {
            if (item.role === 'user' || item.role === 'assistant' || item.role === 'thought') {
                const isChunk = Boolean(item.is_chunk);
                const last = merged[merged.length - 1];

                if (
                    isChunk
                    && last
                    && last.role === item.role
                    && (last.role === 'user' || last.role === 'assistant' || last.role === 'thought')
                ) {
                    merged[merged.length - 1] = {
                        ...last,
                        content: last.content + item.content,
                    };
                    continue;
                }

                if (isChunk) {
                    merged.push({ ...item, is_chunk: undefined });
                    continue;
                }
            }

            merged.push(item);
        }

        return merged;
    };

    const mergeConsecutiveErrors = (messages: AcpMessage[]): AcpMessage[] => {
        const merged: AcpMessage[] = [];
        for (const message of messages) {
            const last = merged[merged.length - 1];
            if (message.role === 'error' && last?.role === 'error') {
                merged[merged.length - 1] = {
                    ...last,
                    message: `${last.message}\n${message.message}`,
                };
                continue;
            }
            merged.push(message);
        }
        return merged;
    };
    
    const handleAcpMessageImmediate = useCallback((data: { agent_id: string; item: AcpMessage }) => {
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
                messages: mergeConsecutiveErrors([...(existing?.messages ?? []), data.item]),
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

        if (data.item.role === 'raw_update') {
            const projected = projectRawUpdate(data.item);
            if (projected.length === 0) {
                return;
            }

            updateSession(data.agent_id, (existing) => {
                let messages = [...(existing?.messages ?? [])];
                let contextUsage = existing?.contextUsage;

                for (const projectedItem of projected) {
                    if (projectedItem.role === 'context_usage') {
                        contextUsage = {
                            used: projectedItem.used,
                            size: projectedItem.size,
                        };
                        continue;
                    }

                    if (projectedItem.role === 'error') {
                        messages = mergeConsecutiveErrors([...messages, projectedItem]);
                        continue;
                    }

                    messages.push(projectedItem);
                }

                messages = mergeChunkMessages(messages);

                return {
                    agentId: data.agent_id,
                    agentName: existing?.agentName ?? '',
                    messages,
                    isActive: true,
                    isProcessing: existing?.isProcessing,
                    sessionId: existing?.sessionId,
                    agentConfigId: existing?.agentConfigId,
                    modelSelector: existing?.modelSelector,
                    reasoningSelector: existing?.reasoningSelector,
                    contextUsage,
                };
            });
            return;
        }

        if (
            data.item.role === 'tool_call'
            || data.item.role === 'tool_result'
            || data.item.role === 'tool_update'
            || data.item.role === 'media'
        ) {
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
    }, [updateSession]);

    const flushPendingAcpMessages = useCallback(() => {
        if (flushTimerRef.current) {
            clearTimeout(flushTimerRef.current);
            flushTimerRef.current = null;
        }

        const pending = pendingEventsRef.current;
        if (pending.length === 0) return;

        pendingEventsRef.current = [];
        for (const event of pending) {
            handleAcpMessageImmediate(event);
        }
    }, [handleAcpMessageImmediate]);

    const scheduleAcpFlush = useCallback(() => {
        if (flushTimerRef.current) return;
        flushTimerRef.current = setTimeout(() => {
            flushPendingAcpMessages();
        }, MESSAGE_FLUSH_MS);
    }, [flushPendingAcpMessages]);

    const handleAcpMessage = useCallback((data: { agent_id: string; item: AcpMessage }) => {
        pendingEventsRef.current.push(data);
        scheduleAcpFlush();
    }, [scheduleAcpFlush]);

    const handleAcpHistory = useCallback((data: { agent_id: string; history: AcpMessage[] }) => {
        flushPendingAcpMessages();
        const expandedHistory: AcpMessage[] = [];
        for (const item of data.history) {
            if (item.role === 'raw_update') {
                expandedHistory.push(...projectRawUpdate(item));
                continue;
            }
            expandedHistory.push(item);
        }
        const normalizedHistory = mergeChunkMessages(expandedHistory);

        const reversedHistory = [...normalizedHistory].reverse();
        const modelSelector = reversedHistory.find((item): item is AcpModelSelectorMessage => item.role === 'session_model_selector');
        const reasoningSelector = reversedHistory.find((item): item is AcpReasoningSelectorMessage => item.role === 'session_reasoning_selector');
        const contextUsage = reversedHistory.find((item): item is AcpContextUsageMessage => item.role === 'context_usage');
        const visibleMessages = normalizedHistory.filter((item) =>
            item.role !== 'session_model_selector'
            && item.role !== 'session_reasoning_selector'
            && item.role !== 'context_usage'
            && item.role !== 'raw_update',
        );
        const mergedVisibleMessages = mergeConsecutiveErrors(visibleMessages);

        updateSession(data.agent_id, (existing) => ({
            agentId: data.agent_id,
            agentName: existing?.agentName ?? '',
            messages: mergedVisibleMessages,
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
    }, [flushPendingAcpMessages, updateSession]);

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

    const sendPrompt = useCallback((agentId: string, prompt: string, attachments: AcpPromptAttachment[] = []) => {
        if (!wsRef.current || !isConnected) return;

        wsRef.current.emit('acp:prompt', { agent_id: agentId, prompt, attachments }, (response: any) => {
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

    useEffect(() => {
        return () => {
            if (flushTimerRef.current) {
                clearTimeout(flushTimerRef.current);
                flushTimerRef.current = null;
            }
            pendingEventsRef.current = [];
        };
    }, []);

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
        setSessionModel,
        setSessionReasoning,
        cancelPrompt,
        stopAgent,
        closeAgent,
    };
};

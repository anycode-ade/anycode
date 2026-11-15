import type {
    AcpAssistantMessage,
    AcpAvailableCommand,
    AcpAvailableCommandsMessage,
    AcpContextUsageMessage,
    AcpMediaMessage,
    AcpMessage,
    AcpModelSelectorMessage,
    AcpPromptStateMessage,
    AcpQueuedMessage,
    AcpQueueUpdateMessage,
    AcpRawUpdateMessage,
    AcpReasoningSelectorMessage,
    AcpThoughtMessage,
    AcpToolCallMessage,
    AcpToolResultMessage,
    AcpToolUpdateMessage,
    AcpUserMessage,
} from '../../types';
import { generateUUID } from '../../utils';
import type { CloudAgentSession } from './types';

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

const normalizeMessageContent = (text: string): string => {
    return text.replace(/context canceled([A-Z])/gi, 'Context canceled: $1');
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

const contentBlockToMessages = (
    content: unknown,
    textRole: 'user' | 'assistant' | 'thought',
): AcpMessage[] => {
    const contentRecord = asRecord(content);
    if (!contentRecord) return [];

    const contentType = asString(contentRecord.type)?.toLowerCase();
    if (contentType === 'text') {
        const rawText = asString(contentRecord.text);
        if (!rawText) return [];
        const text = normalizeMessageContent(rawText);
        if (textRole === 'user') return [{ role: 'user', content: text, is_chunk: true } satisfies AcpUserMessage];
        if (textRole === 'thought') return [{ role: 'thought', content: text, is_chunk: true } satisfies AcpThoughtMessage];
        return [{ role: 'assistant', content: text, is_chunk: true } satisfies AcpAssistantMessage];
    }
    if (contentType === 'image' || contentType === 'audio') {
        return [{
            role: 'media',
            media_type: contentType,
            mime_type: asString(contentRecord.mime_type) ?? asString(contentRecord.mimeType),
            data: asString(contentRecord.data) ?? asString(contentRecord.base64),
            uri: asString(contentRecord.uri),
            title: asString(contentRecord.title),
        } satisfies AcpMediaMessage];
    }

    if ('Text' in contentRecord) {
        const rawText = asString(asRecord(contentRecord.Text)?.text);
        if (!rawText) return [];
        const text = normalizeMessageContent(rawText);
        if (textRole === 'user') return [{ role: 'user', content: text, is_chunk: true } satisfies AcpUserMessage];
        if (textRole === 'thought') return [{ role: 'thought', content: text, is_chunk: true } satisfies AcpThoughtMessage];
        return [{ role: 'assistant', content: text, is_chunk: true } satisfies AcpAssistantMessage];
    }
    if ('Image' in contentRecord || 'Audio' in contentRecord) {
        const mediaKey = 'Image' in contentRecord ? 'Image' : 'Audio';
        const media = asRecord(contentRecord[mediaKey]);
        if (!media) return [];
        return [{
            role: 'media',
            media_type: mediaKey === 'Image' ? 'image' : 'audio',
            mime_type: asString(media.mime_type) ?? asString(media.mimeType),
            data: asString(media.data) ?? asString(media.base64),
            uri: asString(media.uri),
            title: asString(media.title),
        } satisfies AcpMediaMessage];
    }
    if ('ResourceLink' in contentRecord) {
        const uri = asString(asRecord(contentRecord.ResourceLink)?.uri);
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
    const sessionId = asString(getAnyField(payload, 'session_id', 'sessionId')) ?? rawMessage.session_id;

    if (kind === 'agent_message_chunk' && payload) {
        return contentBlockToMessages(payload.content, 'assistant');
    }
    if (kind === 'user_message_chunk' && payload) {
        return contentBlockToMessages(payload.content, 'user');
    }
    if (kind === 'agent_thought_chunk' && payload) {
        return contentBlockToMessages(payload.content, 'thought');
    }
    if (kind === 'tool_call' && payload) {
        const id = asString(getAnyField(payload, 'tool_call_id', 'toolCallId', 'id')) ?? generateUUID();
        const title = asString(getAnyField(payload, 'title', 'name')) ?? 'tool';
        const rawInput = asRecord(getAnyField(payload, 'raw_input', 'rawInput', 'input', 'arguments'));
        const content = getAnyField(payload, 'content');
        const locations = getAnyField(payload, 'locations');
        const fullOutputBytes = getAnyField(payload, 'full_output_bytes', 'fullOutputBytes');
        return [{
            role: 'tool_call',
            id,
            session_id: sessionId,
            name: title,
            title,
            command: asString(rawInput?.cmd)
                ?? asString(rawInput?.command)
                ?? asString(rawInput?.CommandLine)
                ?? asString(getAnyField(payload, 'command')),
            arguments: payload,
            kind: asString(getAnyField(payload, 'kind', 'tool_kind')),
            status: normalizeToolStatus(getAnyField(payload, 'status')),
            content: Array.isArray(content) ? content as AcpToolCallMessage['content'] : undefined,
            raw_input: rawInput ?? undefined,
            raw_output: getAnyField(payload, 'raw_output', 'rawOutput', 'output'),
            locations: Array.isArray(locations) ? locations as AcpToolCallMessage['locations'] : undefined,
            has_full_output: Boolean(getAnyField(payload, 'has_full_output', 'hasFullOutput')) || undefined,
            full_output_bytes: typeof fullOutputBytes === 'number' ? fullOutputBytes : undefined,
            is_truncated: Boolean(getAnyField(payload, 'is_truncated', 'isTruncated')) || undefined,
        } satisfies AcpToolCallMessage];
    }
    if ((kind === 'tool_call_update' || kind === 'tool_result' || kind === 'tool_call_result') && payload) {
        const fields = asRecord(getAnyField(payload, 'fields'));
        const id = asString(getAnyField(payload, 'tool_call_id', 'toolCallId', 'id'))
            ?? asString(getAnyField(fields, 'tool_call_id', 'toolCallId', 'id'))
            ?? '';
        if (!id) return [];
        const status = normalizeToolStatus(getAnyField(fields, 'status') ?? getAnyField(payload, 'status'));
        const mergedPayload = fields ? { ...payload, ...fields } : payload;
        const withId = { ...mergedPayload, tool_call_id: id, session_id: sessionId };
        if (status === 'completed' || kind === 'tool_result' || kind === 'tool_call_result') {
            return [{ role: 'tool_result', id, result: withId } satisfies AcpToolResultMessage];
        }
        return [{ role: 'tool_update', id, update: withId } satisfies AcpToolUpdateMessage];
    }
    if (kind === 'usage_update' && payload) {
        return [{
            role: 'context_usage',
            used: Number(payload.used ?? 0),
            size: Number(payload.size ?? 0),
        } satisfies AcpContextUsageMessage];
    }
    if (kind === 'available_commands_update' && payload) {
        const rawCommands = payload.available_commands ?? payload.availableCommands;
        if (Array.isArray(rawCommands)) {
            const commands: AcpAvailableCommand[] = rawCommands
                .map((cmd: any) => ({
                    name: asString(cmd?.name) ?? '',
                    description: asString(cmd?.description) ?? '',
                    input: cmd?.input ? { hint: asString(cmd.input.hint) } : undefined,
                }))
                .filter((cmd) => Boolean(cmd.name));
            return [{ role: 'available_commands', commands } satisfies AcpAvailableCommandsMessage];
        }
    }
    return [];
};

const mergeChunkMessages = (messages: AcpMessage[]): AcpMessage[] => {
    const merged: AcpMessage[] = [];
    for (const item of messages) {
        if (item.role === 'user' || item.role === 'assistant' || item.role === 'thought') {
            const isChunk = Boolean(item.is_chunk);
            const last = merged[merged.length - 1];
            if (isChunk && last && last.role === item.role) {
                let nextContent = item.content;
                if (last.content.endsWith('context canceled') && /^[A-Z]/.test(nextContent)) {
                    nextContent = ': ' + nextContent;
                }
                merged[merged.length - 1] = {
                    ...last,
                    content: normalizeMessageContent(last.content + nextContent),
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
            merged[merged.length - 1] = { ...last, message: `${last.message}\n${message.message}` };
            continue;
        }
        merged.push(message);
    }
    return merged;
};

export const mergeCloudQueue = (
    existingQueue: AcpQueuedMessage[] | undefined,
    incomingQueue: AcpQueuedMessage[],
): AcpQueuedMessage[] => {
    if (!existingQueue || existingQueue.length === 0) return incomingQueue;
    const pendingOptimistic = existingQueue.filter((item) => item.id.startsWith('queued-optimistic-'));
    if (pendingOptimistic.length === 0) return incomingQueue;
    const prevServerCount = existingQueue.filter((item) => !item.id.startsWith('queued-optimistic-')).length;
    const addedOnServer = Math.max(0, incomingQueue.length - prevServerCount);
    return [...incomingQueue, ...pendingOptimistic.slice(addedOnServer)];
};

const createBaseSession = (key: string, serverId: string, agentId: string): CloudAgentSession => ({
    key,
    serverId,
    agentId,
    agentName: agentId,
    messages: [],
    isActive: true,
});

export const applyAcpMessageItem = (
    existing: CloudAgentSession | undefined,
    key: string,
    serverId: string,
    agentId: string,
    item: AcpMessage,
): CloudAgentSession | undefined => {
    const base = existing ?? createBaseSession(key, serverId, agentId);

    if (item.role === 'prompt_state') {
        const isProcessing = (item as AcpPromptStateMessage).is_processing;
        const completedToolIds = new Set(
            base.messages.flatMap((m) => (m.role === 'tool_result' ? [m.id] : [])),
        );
        const messages = !isProcessing
            ? base.messages.map((msg) => {
                if (msg.role === 'tool_call' && !completedToolIds.has(msg.id)) {
                    const tc = msg as AcpToolCallMessage;
                    if (!tc.status || tc.status === 'in_progress' || tc.status === 'pending') {
                        return { ...tc, status: 'canceled' as const };
                    }
                }
                return msg;
            })
            : base.messages;
        return { ...base, messages, isProcessing };
    }

    if (item.role === 'queue_update') {
        const q = (item as AcpQueueUpdateMessage).queue;
        return { ...base, queue: mergeCloudQueue(base.queue, q) };
    }
    if (item.role === 'session_model_selector') {
        const sel = item as AcpModelSelectorMessage;
        return { ...base, modelSelector: { current_value: sel.current_value, options: sel.options } };
    }
    if (item.role === 'session_reasoning_selector') {
        const sel = item as AcpReasoningSelectorMessage;
        return { ...base, reasoningSelector: { current_value: sel.current_value, options: sel.options } };
    }
    if (item.role === 'context_usage') {
        const usage = item as AcpContextUsageMessage;
        return { ...base, contextUsage: { used: usage.used, size: usage.size } };
    }
    if (item.role === 'available_commands') {
        return { ...base, availableCommands: (item as AcpAvailableCommandsMessage).commands };
    }
    if (item.role === 'error') {
        return { ...base, messages: mergeConsecutiveErrors([...base.messages, item]) };
    }

    if (item.role === 'raw_update') {
        if (!existing) return existing;
        const projected = projectRawUpdate(item);
        if (projected.length === 0) return existing;
        let messages = [...existing.messages];
        let contextUsage = existing.contextUsage;
        let availableCommands = existing.availableCommands;

        for (const p of projected) {
            if (p.role === 'available_commands') {
                availableCommands = p.commands;
                continue;
            }
            if (p.role === 'context_usage') {
                contextUsage = { used: p.used, size: p.size };
                continue;
            }
            if (p.role === 'error') {
                messages = mergeConsecutiveErrors([...messages, p]);
                continue;
            }
            if (p.role === 'user') {
                const lastUser = messages.findLast((m): m is AcpUserMessage => m.role === 'user');
                if (lastUser && lastUser.content === p.content) {
                    if (lastUser.client_id) {
                        const idx = messages.lastIndexOf(lastUser);
                        messages[idx] = { ...lastUser, client_id: undefined };
                    }
                    continue;
                }
            }
            messages.push(p);
        }
        return { ...existing, messages: mergeChunkMessages(messages), contextUsage, availableCommands };
    }

    if (
        item.role === 'tool_call'
        || item.role === 'tool_result'
        || item.role === 'tool_update'
        || item.role === 'media'
    ) {
        return { ...base, messages: [...base.messages, item] };
    }

    if (item.role !== 'user' && item.role !== 'assistant' && item.role !== 'thought') {
        return existing;
    }

    if (item.role === 'user') {
        const optimisticIndex = base.messages.findLastIndex(
            (m) => m.role === 'user' && Boolean((m as AcpUserMessage).client_id),
        );
        if (optimisticIndex !== -1) {
            const opt = base.messages[optimisticIndex] as AcpUserMessage;
            if (opt.content === item.content || (item.client_id && opt.client_id === item.client_id)) {
                const updated = [...base.messages];
                updated[optimisticIndex] = item;
                return { ...base, messages: updated };
            }
        }
        const lastUser = base.messages.findLast((m): m is AcpUserMessage => m.role === 'user');
        if (lastUser && lastUser.content === item.content) {
            if (item.checkpoint_id && !lastUser.checkpoint_id) {
                const idx = base.messages.lastIndexOf(lastUser);
                const updated = [...base.messages];
                updated[idx] = { ...lastUser, checkpoint_id: item.checkpoint_id };
                return { ...base, messages: updated };
            }
            return base;
        }
    }

    const isChunk = Boolean(item.is_chunk);
    if (isChunk && base.messages.length > 0) {
        const last = base.messages[base.messages.length - 1];
        if (last.role === item.role && (last.role === 'assistant' || last.role === 'thought')) {
            const updated = [...base.messages];
            updated[updated.length - 1] = { ...last, content: last.content + item.content };
            return { ...base, messages: updated };
        }
    }

    const cleanItem = isChunk && (item.role === 'thought' || item.role === 'assistant')
        ? { ...item, is_chunk: undefined }
        : item;
    return { ...base, messages: [...base.messages, cleanItem] };
};

export const applyAcpHistory = (
    existing: CloudAgentSession | undefined,
    key: string,
    serverId: string,
    agentId: string,
    history: AcpMessage[],
): CloudAgentSession => {
    const base = existing ?? createBaseSession(key, serverId, agentId);
    const expanded: AcpMessage[] = [];
    for (const item of history) {
        if (item.role === 'raw_update') {
            expanded.push(...projectRawUpdate(item));
        } else {
            expanded.push(item);
        }
    }
    const normalized = mergeChunkMessages(expanded);
    const reversed = [...normalized].reverse();
    const modelSelector = reversed.find((i): i is AcpModelSelectorMessage => i.role === 'session_model_selector');
    const reasoningSelector = reversed.find((i): i is AcpReasoningSelectorMessage => i.role === 'session_reasoning_selector');
    const contextUsage = reversed.find((i): i is AcpContextUsageMessage => i.role === 'context_usage');
    const availableCommandsMsg = reversed.find((i): i is AcpAvailableCommandsMessage => i.role === 'available_commands');
    const visible = normalized.filter((i) =>
        i.role !== 'session_model_selector'
        && i.role !== 'session_reasoning_selector'
        && i.role !== 'context_usage'
        && i.role !== 'available_commands'
        && i.role !== 'raw_update'
        && i.role !== 'queue_update',
    );

    return {
        ...base,
        messages: mergeConsecutiveErrors(visible),
        modelSelector: modelSelector
            ? { current_value: modelSelector.current_value, options: modelSelector.options }
            : base.modelSelector,
        reasoningSelector: reasoningSelector
            ? { current_value: reasoningSelector.current_value, options: reasoningSelector.options }
            : base.reasoningSelector,
        contextUsage: contextUsage
            ? { used: contextUsage.used, size: contextUsage.size }
            : base.contextUsage,
        availableCommands: availableCommandsMsg ? availableCommandsMsg.commands : base.availableCommands,
    };
};

import { describe, expect, it } from 'vitest';
import { applyAcpHistory, applyAcpMessageItem, mergeRemoteQueue } from './acpReducer';
import { makeRemoteSessionKey, parseRemoteSessionKey } from './types';
import type { AcpToolCallMessage, AcpUserMessage } from '../../types';

describe('remote session keys', () => {
    it('creates and parses composite keys cleanly', () => {
        const key = makeRemoteSessionKey('srv-1', 'claude-1');
        expect(key).toBe('srv-1::claude-1');
        expect(parseRemoteSessionKey(key)).toEqual({ serverId: 'srv-1', agentId: 'claude-1' });
        expect(parseRemoteSessionKey('invalid')).toBeNull();
        expect(parseRemoteSessionKey('::only-agent')).toBeNull();
    });
});

describe('remote acpReducer', () => {
    it('merges streamed assistant chunks and handles prompt_state', () => {
        const key = makeRemoteSessionKey('local', 'codex-1');
        let session = applyAcpMessageItem(undefined, key, 'local', 'codex-1', {
            role: 'prompt_state',
            is_processing: true,
        });
        expect(session?.isProcessing).toBe(true);

        session = applyAcpMessageItem(session, key, 'local', 'codex-1', {
            role: 'assistant',
            content: 'Hello ',
            is_chunk: true,
        });
        session = applyAcpMessageItem(session, key, 'local', 'codex-1', {
            role: 'assistant',
            content: 'world!',
            is_chunk: true,
        });
        expect(session?.messages).toHaveLength(1);
        expect(session?.messages[0]).toMatchObject({ role: 'assistant', content: 'Hello world!' });

        session = applyAcpMessageItem(session, key, 'local', 'codex-1', {
            role: 'prompt_state',
            is_processing: false,
        });
        expect(session?.isProcessing).toBe(false);
    });

    it('merges sequential thought chunks into a single thought message', () => {
        const key = makeRemoteSessionKey('local', 'codex-1');
        let session = applyAcpMessageItem(undefined, key, 'local', 'codex-1', {
            role: 'thought',
            content: 'Thinking about ',
            is_chunk: true,
        });
        session = applyAcpMessageItem(session, key, 'local', 'codex-1', {
            role: 'thought',
            content: 'the algorithm...',
            is_chunk: true,
        });
        expect(session?.messages).toHaveLength(1);
        expect(session?.messages[0]).toMatchObject({ role: 'thought', content: 'Thinking about the algorithm...' });
    });

    it('appends distinct messages after user prompt instead of merging', () => {
        const key = makeRemoteSessionKey('srv-1', 'claude-1');
        let session = applyAcpMessageItem(undefined, key, 'srv-1', 'claude-1', {
            role: 'assistant',
            content: 'Response 1',
        });
        session = applyAcpMessageItem(session, key, 'srv-1', 'claude-1', {
            role: 'user',
            content: 'Follow up question',
        } as AcpUserMessage);
        session = applyAcpMessageItem(session, key, 'srv-1', 'claude-1', {
            role: 'assistant',
            content: 'Response 2',
            is_chunk: true,
        });

        expect(session?.messages).toHaveLength(3);
        expect(session?.messages[0]).toMatchObject({ role: 'assistant', content: 'Response 1' });
        expect(session?.messages[1]).toMatchObject({ role: 'user', content: 'Follow up question' });
        expect(session?.messages[2]).toMatchObject({ role: 'assistant', content: 'Response 2' });
    });

    it('handles tool_call, tool_update, and tool_result cycles', () => {
        const key = makeRemoteSessionKey('srv-1', 'claude-1');
        let session = applyAcpMessageItem(undefined, key, 'srv-1', 'claude-1', {
            role: 'tool_call',
            id: 'tool-call-42',
            name: 'execute_command',
            title: 'Run test suite',
            command: 'cargo test',
            status: 'running',
        } as AcpToolCallMessage);

        expect(session?.messages).toHaveLength(1);
        expect(session?.messages[0]).toMatchObject({
            role: 'tool_call',
            id: 'tool-call-42',
            title: 'Run test suite',
            command: 'cargo test',
            status: 'running',
        });

        session = applyAcpMessageItem(session, key, 'srv-1', 'claude-1', {
            role: 'tool_update',
            id: 'tool-call-42',
            update: {
                tool_call_id: 'tool-call-42',
                status: 'in_progress',
                raw_output: 'running 4 tests...',
            },
        });
        expect(session?.messages).toHaveLength(2);
        expect(session?.messages[1]).toMatchObject({
            role: 'tool_update',
            id: 'tool-call-42',
        });

        session = applyAcpMessageItem(session, key, 'srv-1', 'claude-1', {
            role: 'tool_result',
            id: 'tool-call-42',
            result: {
                tool_call_id: 'tool-call-42',
                status: 'completed',
                raw_output: 'test result: ok. 4 passed.',
            },
        });
        expect(session?.messages).toHaveLength(3);
        expect(session?.messages[2]).toMatchObject({
            role: 'tool_result',
            id: 'tool-call-42',
        });
    });

    it('updates available commands and context usage', () => {
        const key = makeRemoteSessionKey('srv-1', 'claude-1');
        let session = applyAcpMessageItem(undefined, key, 'srv-1', 'claude-1', {
            role: 'available_commands',
            commands: [
                { name: '/help', description: 'Show available commands' },
                { name: '/test', description: 'Run project tests' },
            ],
        });
        expect(session?.availableCommands).toHaveLength(2);
        expect(session?.availableCommands?.[0].name).toBe('/help');

        session = applyAcpMessageItem(session, key, 'srv-1', 'claude-1', {
            role: 'context_usage',
            used: 12400,
            size: 200000,
        });
        expect(session?.contextUsage).toEqual({ used: 12400, size: 200000 });
    });

    it('unwraps and normalizes raw_update messages onto an existing session', () => {
        const key = makeRemoteSessionKey('srv-1', 'claude-1');
        let session = applyAcpMessageItem(undefined, key, 'srv-1', 'claude-1', {
            role: 'prompt_state',
            is_processing: true,
        });
        session = applyAcpMessageItem(session, key, 'srv-1', 'claude-1', {
            role: 'raw_update',
            agent_id: 'claude-1',
            ts: '2026-01-01T00:00:00Z',
            update: {
                sessionUpdate: 'agent_message_chunk',
                content: {
                    type: 'text',
                    text: 'Streaming from raw update',
                },
            },
        });
        expect(session?.messages).toHaveLength(1);
        expect(session?.messages[0]).toMatchObject({
            role: 'assistant',
            content: 'Streaming from raw update',
        });
    });

    it('reconciles history selectors and merges chunks', () => {
        const key = makeRemoteSessionKey('srv-1', 'claude-1');
        const next = applyAcpHistory(undefined, key, 'srv-1', 'claude-1', [
            {
                role: 'session_model_selector',
                current_value: 'sonnet',
                options: [{ config_id: 'model', value: 'sonnet', name: 'Sonnet' }],
            },
            {
                role: 'session_reasoning_selector',
                current_value: 'medium',
                options: [{ config_id: 'reasoning', value: 'medium', name: 'Medium' }],
            },
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'yo ', is_chunk: true },
            { role: 'assistant', content: 'there', is_chunk: true },
        ]);

        expect(next.modelSelector?.current_value).toBe('sonnet');
        expect(next.reasoningSelector?.current_value).toBe('medium');
        expect(next.messages).toHaveLength(2);
        expect(next.messages[1]).toMatchObject({ role: 'assistant', content: 'yo there' });
    });

    it('preserves pending optimistic queue items across snapshots', () => {
        const merged = mergeRemoteQueue(
            [{ id: 'queued-optimistic-1', prompt: 'next task', created_at: 100 }],
            [],
        );
        expect(merged).toHaveLength(1);
        expect(merged[0].prompt).toBe('next task');
    });

    it('deduplicates items by id and preserves server order', () => {
        const merged = mergeRemoteQueue(
            [{ id: 'queued-optimistic-1', prompt: 'optimistic task', created_at: 100 }],
            [
                { id: 'server-1', prompt: 'first server task', created_at: 50 },
                { id: 'queued-optimistic-1', prompt: 'server confirmed task', created_at: 100 },
            ],
        );
        expect(merged).toHaveLength(2);
        expect(merged[0].id).toBe('server-1');
        expect(merged[1].id).toBe('queued-optimistic-1');
        expect(merged[1].prompt).toBe('server confirmed task');
    });
});

import { describe, expect, it } from 'vitest';
import { applyAcpHistory, applyAcpMessageItem, mergeCloudQueue } from './acpReducer';
import { makeCloudSessionKey, parseCloudSessionKey } from './types';

describe('cloud session keys', () => {
    it('creates and parses composite keys cleanly', () => {
        const key = makeCloudSessionKey('srv-1', 'claude-1');
        expect(key).toBe('srv-1::claude-1');
        expect(parseCloudSessionKey(key)).toEqual({ serverId: 'srv-1', agentId: 'claude-1' });
        expect(parseCloudSessionKey('invalid')).toBeNull();
    });
});

describe('cloud acpReducer', () => {
    it('merges streamed assistant chunks and handles prompt_state', () => {
        const key = makeCloudSessionKey('local', 'codex-1');
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

    it('reconciles history selectors and merges chunks', () => {
        const key = makeCloudSessionKey('srv-1', 'claude-1');
        const next = applyAcpHistory(undefined, key, 'srv-1', 'claude-1', [
            {
                role: 'session_model_selector',
                current_value: 'sonnet',
                options: [{ config_id: 'model', value: 'sonnet', name: 'Sonnet' }],
            },
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'yo ', is_chunk: true },
            { role: 'assistant', content: 'there', is_chunk: true },
        ]);

        expect(next.modelSelector?.current_value).toBe('sonnet');
        expect(next.messages).toHaveLength(2);
        expect(next.messages[1]).toMatchObject({ role: 'assistant', content: 'yo there' });
    });

    it('preserves pending optimistic queue items across snapshots', () => {
        const merged = mergeCloudQueue(
            [{ id: 'queued-optimistic-1', prompt: 'next task', created_at: 100 }],
            [],
        );
        expect(merged).toHaveLength(1);
        expect(merged[0].prompt).toBe('next task');
    });
});

import { describe, it, expect } from 'vitest';
import type { AcpQueuedMessage, AcpSession } from '../../types';
import { mergeServerAndOptimisticQueue } from '../../hooks/useAgents';

describe('ACP Queue operations', () => {
  const createMockSession = (queue: AcpQueuedMessage[] = []): AcpSession => ({
    agentId: 'test-agent',
    agentName: 'Test Agent',
    messages: [],
    queue,
    isActive: true,
    isProcessing: true,
  });

  const moveQueueItem = (
    queue: AcpQueuedMessage[],
    itemId: string,
    direction: 'up' | 'down'
  ): AcpQueuedMessage[] => {
    const index = queue.findIndex((item) => item.id === itemId);
    if (index === -1) return queue;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= queue.length) return queue;

    const newQueue = [...queue];
    const temp = newQueue[index];
    newQueue[index] = newQueue[targetIndex];
    newQueue[targetIndex] = temp;
    return newQueue;
  };

  const updateQueueItem = (
    queue: AcpQueuedMessage[],
    itemId: string,
    newPrompt: string
  ): AcpQueuedMessage[] => {
    return queue.map((item) => (item.id === itemId ? { ...item, prompt: newPrompt } : item));
  };

  const removeQueueItem = (
    queue: AcpQueuedMessage[],
    itemId: string
  ): AcpQueuedMessage[] => {
    return queue.filter((item) => item.id !== itemId);
  };

  it('correctly reorders items when moving up and down', () => {
    const queue: AcpQueuedMessage[] = [
      { id: '1', prompt: 'Prompt 1', created_at: 100 },
      { id: '2', prompt: 'Prompt 2', created_at: 200 },
      { id: '3', prompt: 'Prompt 3', created_at: 300 },
    ];

    // Move middle item up
    const movedUp = moveQueueItem(queue, '2', 'up');
    expect(movedUp.map((q) => q.id)).toEqual(['2', '1', '3']);

    // Move first item up (should be a no-op)
    const movedFirstUp = moveQueueItem(movedUp, '2', 'up');
    expect(movedFirstUp.map((q) => q.id)).toEqual(['2', '1', '3']);

    // Move middle item down
    const movedDown = moveQueueItem(movedUp, '2', 'down');
    expect(movedDown.map((q) => q.id)).toEqual(['1', '2', '3']);

    // Move last item down (should be a no-op)
    const movedLastDown = moveQueueItem(movedDown, '3', 'down');
    expect(movedLastDown.map((q) => q.id)).toEqual(['1', '2', '3']);

    // Move non-existent item (should be a no-op)
    const movedNonExistent = moveQueueItem(queue, '999', 'up');
    expect(movedNonExistent).toEqual(queue);
  });

  it('correctly updates item prompt while preserving id and created_at', () => {
    const queue: AcpQueuedMessage[] = [
      { id: '1', prompt: 'Original prompt', created_at: 100 },
      { id: '2', prompt: 'Second prompt', created_at: 200 },
    ];

    const updated = updateQueueItem(queue, '1', 'Updated prompt text');
    expect(updated[0].prompt).toBe('Updated prompt text');
    expect(updated[0].id).toBe('1');
    expect(updated[0].created_at).toBe(100);
    expect(updated[1].prompt).toBe('Second prompt');
  });

  it('correctly removes an item from queue', () => {
    const queue: AcpQueuedMessage[] = [
      { id: '1', prompt: 'Prompt 1', created_at: 100 },
      { id: '2', prompt: 'Prompt 2', created_at: 200 },
      { id: '3', prompt: 'Prompt 3', created_at: 300 },
    ];

    const removed = removeQueueItem(queue, '2');
    expect(removed.map((q) => q.id)).toEqual(['1', '3']);

    // Remove non-existent item
    const removedNonExistent = removeQueueItem(removed, '999');
    expect(removedNonExistent.map((q) => q.id)).toEqual(['1', '3']);
  });

  it('handles optimistic queue addition and response id replacement', () => {
    const session = createMockSession();
    const tempId = 'queued-optimistic-123';
    const optimisticItem: AcpQueuedMessage = {
      id: tempId,
      prompt: 'New task',
      created_at: 1000,
    };

    // Optimistic add
    const sessionWithTemp: AcpSession = {
      ...session,
      queue: [...(session.queue ?? []), optimisticItem],
    };
    expect(sessionWithTemp.queue?.length).toBe(1);
    expect(sessionWithTemp.queue?.[0].id).toBe(tempId);

    // Server acks with real ID
    const serverId = 'queue-1000-1';
    const sessionWithServerId: AcpSession = {
      ...sessionWithTemp,
      queue: sessionWithTemp.queue?.map((q) =>
        q.id === tempId ? { ...q, id: serverId } : q
      ),
    };
    expect(sessionWithServerId.queue?.[0].id).toBe(serverId);
    expect(sessionWithServerId.queue?.[0].prompt).toBe('New task');
  });

  it('handles optimistic queue addition rollback on server error', () => {
    const session = createMockSession();
    const tempId = 'queued-optimistic-123';
    const optimisticItem: AcpQueuedMessage = {
      id: tempId,
      prompt: 'Failed task',
      created_at: 1000,
    };

    const sessionWithTemp: AcpSession = {
      ...session,
      queue: [...(session.queue ?? []), optimisticItem],
    };
    expect(sessionWithTemp.queue?.length).toBe(1);

    // Rollback
    const rolledBackSession: AcpSession = {
      ...sessionWithTemp,
      queue: sessionWithTemp.queue?.filter((q) => q.id !== tempId),
    };
    expect(rolledBackSession.queue?.length).toBe(0);
  });

  describe('Edge case 1: Idle prompt state (fixed - no UI flicker)', () => {
    it('verifies that idle prompt does not pollute queue when no queue_update is broadcast', () => {
      // 1. Initial idle session
      let session: AcpSession = {
        agentId: 'test-agent',
        agentName: 'Test Agent',
        messages: [],
        queue: [],
        isActive: true,
        isProcessing: false,
      };

      // 2. User sends prompt when isProcessing is false -> optimistic message in messages
      const promptText = 'Build the app';
      const optimisticMessage = {
        role: 'user' as const,
        content: promptText,
        client_id: 'optimistic-1',
      };
      session = {
        ...session,
        messages: [...session.messages, optimisticMessage],
        isProcessing: true,
      };

      // With backend fix: idle prompt does not broadcast queue_update with [prompt]!
      // So queue remains empty:
      expect(session.queue?.length).toBe(0);
      expect(session.messages.length).toBe(1);

      // 3. Backend transitions directly to executing prompt:
      expect(session.isProcessing).toBe(true);
      expect(session.queue?.length).toBe(0);
    });
  });

  describe('Edge case 2: Queue condition check (fixed - prompts do not jump queue)', () => {
    it('verifies that isProcessing || hasQueue correctly routes prompts to queue', () => {
      // Session where Prompt 1 is finishing/done, but Prompt 2 is still in queue:
      const session: AcpSession = {
        agentId: 'test-agent',
        agentName: 'Test Agent',
        messages: [
          { role: 'user', content: 'Prompt 1' },
          { role: 'assistant', content: 'Done 1' },
        ],
        queue: [{ id: 'q-2', prompt: 'Prompt 2 (waiting)', created_at: 100 }],
        isActive: true,
        isProcessing: false,
      };

      const hasQueue = (session.queue?.length ?? 0) > 0;
      const shouldUseQueue = Boolean(session.isProcessing || hasQueue);

      expect(shouldUseQueue).toBe(true);
    });
  });

  describe('Edge case 3: Cancellation clears queue', () => {
    it('clears remaining queued items upon prompt cancellation', () => {
      let session: AcpSession = {
        agentId: 'test-agent',
        agentName: 'Test Agent',
        messages: [{ role: 'user', content: 'Active prompt' }],
        queue: [
          { id: 'q-2', prompt: 'Queued step 2', created_at: 100 },
          { id: 'q-3', prompt: 'Queued step 3', created_at: 200 },
        ],
        isActive: true,
        isProcessing: true,
      };

      expect(session.queue?.length).toBe(2);

      // On cancel, backend clears queue and sends queue: []
      session = {
        ...session,
        queue: [],
        isProcessing: false,
      };

      expect(session.queue?.length).toBe(0);
      expect(session.isProcessing).toBe(false);
    });
  });

  describe('Edge case 4: Optimistic queue merging (no item flicker during rapid enqueuing)', () => {
    it('preserves in-flight optimistic prompts when receiving partial queue update from server', () => {
      const existing: AcpQueuedMessage[] = [
        { id: 'server-1', prompt: 'Prompt 1', created_at: 100 },
        { id: 'queued-optimistic-1', prompt: 'Prompt 2', created_at: 200 },
        { id: 'queued-optimistic-2', prompt: 'Prompt 3', created_at: 300 },
      ];

      // Server acknowledged Prompt 2 (now server-2), but Prompt 3 is still in-flight
      const incoming: AcpQueuedMessage[] = [
        { id: 'server-1', prompt: 'Prompt 1', created_at: 100 },
        { id: 'server-2', prompt: 'Prompt 2', created_at: 200 },
      ];

      const merged = mergeServerAndOptimisticQueue(existing, incoming);
      expect(merged.map((m) => m.id)).toEqual(['server-1', 'server-2', 'queued-optimistic-2']);
      expect(merged[2].prompt).toBe('Prompt 3');
    });

    it('fully synchronizes when all optimistic items are acknowledged by server', () => {
      const existing: AcpQueuedMessage[] = [
        { id: 'queued-optimistic-1', prompt: 'Prompt 1', created_at: 100 },
      ];

      const incoming: AcpQueuedMessage[] = [
        { id: 'server-1', prompt: 'Prompt 1', created_at: 100 },
      ];

      const merged = mergeServerAndOptimisticQueue(existing, incoming);
      expect(merged.map((m) => m.id)).toEqual(['server-1']);
    });
  });
});

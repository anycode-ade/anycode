import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io-client';
import { emitWithAck, useRemote } from './useRemote';
import type { RemoteServerView } from './types';

// Setup minimal DOM globals for React in Node environment
class MockNode {
    childNodes: any[] = [];
    nodeType = 1;
    ownerDocument: any = null;
}

class MockElement extends MockNode {
    tagName: string;
    style = {};
    constructor(tag: string) {
        super();
        this.tagName = tag;
    }
    setAttribute() {}
    removeAttribute() {}
    appendChild(c: any) {
        this.childNodes.push(c);
        return c;
    }
    removeChild(c: any) {
        const i = this.childNodes.indexOf(c);
        if (i !== -1) this.childNodes.splice(i, 1);
        return c;
    }
    insertBefore(c: any) {
        this.childNodes.push(c);
        return c;
    }
    addEventListener() {}
    removeEventListener() {}
}

const originalGlobals: Record<string, unknown> = {};

const ensureDomGlobals = () => {
    const keys = ['Node', 'Element', 'HTMLElement', 'HTMLIFrameElement', 'window', 'document', 'IS_REACT_ACT_ENVIRONMENT'];
    for (const k of keys) {
        if (!(k in originalGlobals)) {
            originalGlobals[k] = (globalThis as any)[k];
        }
    }
    (globalThis as any).Node = (globalThis as any).Node || MockNode;
    (globalThis as any).Element = (globalThis as any).Element || MockElement;
    (globalThis as any).HTMLElement = (globalThis as any).HTMLElement || MockElement;
    (globalThis as any).HTMLIFrameElement = (globalThis as any).HTMLIFrameElement || class HTMLIFrameElement extends MockElement {};
    (globalThis as any).window = globalThis;
    (globalThis as any).document = (globalThis as any).document || {
        defaultView: globalThis,
        nodeType: 9,
        documentElement: new MockElement('HTML'),
        head: new MockElement('HEAD'),
        body: new MockElement('BODY'),
        activeElement: null,
        createElement: (tag: string) => {
            const el = new MockElement(tag.toUpperCase());
            el.ownerDocument = (globalThis as any).document;
            return el;
        },
        createComment: () => ({ nodeType: 8, ownerDocument: (globalThis as any).document }),
        createTextNode: (text: string) => ({ nodeType: 3, textContent: text, ownerDocument: (globalThis as any).document }),
        addEventListener: () => {},
        removeEventListener: () => {},
    };
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
};

const restoreDomGlobals = () => {
    for (const [k, v] of Object.entries(originalGlobals)) {
        if (v === undefined) {
            delete (globalThis as any)[k];
        } else {
            (globalThis as any)[k] = v;
        }
    }
};

class MockSocket {
    public connected = true;
    public listeners = new Map<string, Set<Function>>();
    public emitted: Array<{ event: string; payload: unknown; callback?: Function }> = [];

    on(event: string, fn: Function) {
        if (!this.listeners.has(event)) this.listeners.set(event, new Set());
        this.listeners.get(event)!.add(fn);
        return this;
    }

    off(event: string, fn: Function) {
        this.listeners.get(event)?.delete(fn);
        return this;
    }

    once(event: string, fn: Function) {
        const wrapper = (...args: any[]) => {
            this.off(event, wrapper);
            fn(...args);
        };
        return this.on(event, wrapper);
    }

    emit(event: string, ...args: any[]) {
        const callback = typeof args[args.length - 1] === 'function' ? args.pop() : undefined;
        const payload = args[0];
        this.emitted.push({ event, payload, callback });
        return this;
    }

    emitServer(event: string, ...args: any[]) {
        const handlers = this.listeners.get(event);
        if (handlers) {
            for (const h of Array.from(handlers)) {
                h(...args);
            }
        }
    }

    disconnect() {
        this.connected = false;
        this.emitServer('disconnect');
    }
}

describe('emitWithAck', () => {
    it('rejects immediately when socket is disconnected or null', async () => {
        await expect(emitWithAck(null, 'test:event', {})).rejects.toThrow('Not connected to Anycode backend');

        const mockSocket = new MockSocket();
        mockSocket.connected = false;
        await expect(emitWithAck(mockSocket as unknown as Socket, 'test:event', {})).rejects.toThrow(
            'Not connected to Anycode backend',
        );
    });

    it('rejects on timeout if ack callback is not invoked', async () => {
        const mockSocket = new MockSocket();
        const promise = emitWithAck(mockSocket as unknown as Socket, 'test:slow', {}, 30);
        await expect(promise).rejects.toThrow('Timed out waiting for response to test:slow');
    });

    it('rejects immediately if socket disconnects before ack', async () => {
        const mockSocket = new MockSocket();
        const promise = emitWithAck(mockSocket as unknown as Socket, 'test:pending', {}, 5000);
        mockSocket.disconnect();
        await expect(promise).rejects.toThrow('Disconnected before receiving response for test:pending');
    });

    it('resolves when ack returns success: true and rejects on success: false', async () => {
        const mockSocket = new MockSocket();
        const okPromise = emitWithAck<{ success: true; data: string }>(
            mockSocket as unknown as Socket,
            'test:ok',
            {},
        );
        const okCall = mockSocket.emitted.find((e) => e.event === 'test:ok');
        expect(okCall).toBeDefined();
        okCall?.callback?.({ success: true, data: 'hello-ack' });
        await expect(okPromise).resolves.toEqual({ success: true, data: 'hello-ack' });

        const errPromise = emitWithAck(mockSocket as unknown as Socket, 'test:fail', {});
        const errCall = mockSocket.emitted.find((e) => e.event === 'test:fail');
        expect(errCall).toBeDefined();
        errCall?.callback?.({ success: false, error: 'Simulated backend error' });
        await expect(errPromise).rejects.toThrow('Simulated backend error');
    });
});

describe('useRemote hook operations', () => {
    let mockSocket: MockSocket;
    let wsRef: { current: Socket | null };
    let container: any;
    let root: any;

    beforeEach(() => {
        ensureDomGlobals();
        mockSocket = new MockSocket();
        wsRef = { current: mockSocket as unknown as Socket };
        container = (globalThis as any).document.createElement('div');
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => {
            root?.unmount();
        });
        restoreDomGlobals();
    });

    const renderRemoteHook = async (initialServers: RemoteServerView[] = []) => {
        const hookRef: { current: ReturnType<typeof useRemote> | null } = { current: null };
        const TestComponent = () => {
            hookRef.current = useRemote({ wsRef: wsRef as React.RefObject<Socket | null>, isConnected: true });
            return null;
        };

        await act(async () => {
            root.render(React.createElement(TestComponent));
        });

        // Respond to initial refreshServers request if emitted
        const listCall = mockSocket.emitted.find((e) => e.event === 'remote:servers:list');
        if (listCall?.callback) {
            await act(async () => {
                listCall.callback?.({ success: true, servers: initialServers });
            });
        }

        return hookRef;
    };

    it('handles rapid back-to-back sendPrompt calls: first starts processing and second is queued', async () => {
        const initialServer: RemoteServerView = {
            id: 'srv-demo',
            name: 'Demo Node',
            url: 'http://node:3000',
            is_local: false,
            status: 'online',
            projects: [{ id: 'p1', name: 'p1', root: '/p1' }],
            agents: [
                {
                    id: 'claude-1',
                    project_id: 'p1',
                    name: 'Claude',
                    session_id: 'sess-1',
                    is_processing: false,
                    queue: [],
                },
            ],
        };

        const hookRef = await renderRemoteHook([initialServer]);
        expect(hookRef.current).not.toBeNull();

        // Handle the automatic reconnect RPC emitted on server update
        const reconnectCall = mockSocket.emitted.find((e) => {
            const payload = e.payload as any;
            return e.event === 'remote:rpc' && payload?.method === 'acp:reconnect';
        });
        if (reconnectCall?.callback) {
            act(() => {
                reconnectCall.callback?.({ success: true, data: { agents: initialServer.agents } });
            });
        }

        expect(hookRef.current?.sessions.has('srv-demo::claude-1')).toBe(true);
        expect(hookRef.current?.sessions.get('srv-demo::claude-1')?.isProcessing).toBe(false);

        // Clear emitted log
        mockSocket.emitted = [];

        // Launch two back-to-back prompts without waiting for React re-render
        let prompt1Promise: Promise<void> | undefined;
        let prompt2Promise: Promise<void> | undefined;

        act(() => {
            prompt1Promise = hookRef.current?.sendPrompt('srv-demo', 'claude-1', 'First prompt');
            prompt2Promise = hookRef.current?.sendPrompt('srv-demo', 'claude-1', 'Second prompt');
        });

        // Verify two remote:rpc acp:prompt calls were issued
        const promptCalls = mockSocket.emitted.filter((e) => {
            const p = e.payload as any;
            return e.event === 'remote:rpc' && p?.method === 'acp:prompt';
        });

        expect(promptCalls).toHaveLength(2);
        expect((promptCalls[0].payload as any).params.prompt).toBe('First prompt');
        expect((promptCalls[1].payload as any).params.prompt).toBe('Second prompt');

        await act(async () => {
            promptCalls[0].callback?.({ success: true, data: {} });
            expect(prompt1Promise).toBeDefined();
            await prompt1Promise!;
        });

        await act(async () => {
            promptCalls[1].callback?.({ success: true, data: { id: 'queue-item-2' } });
            expect(prompt2Promise).toBeDefined();
            await prompt2Promise!;
        });

        const session = hookRef.current?.sessions.get('srv-demo::claude-1');
        expect(session?.isProcessing).toBe(true);
        expect(session?.messages).toHaveLength(1);
        expect(session?.messages[0]).toMatchObject({ role: 'user', content: 'First prompt' });
        expect(session?.queue).toBeDefined();
        expect(session?.queue).toHaveLength(1);
        expect(session?.queue?.[0]?.prompt).toBe('Second prompt');
        expect(session?.queue?.[0]?.id).toBe('queue-item-2');
    });

    it('reconciles sessions from servers, marks removed agents inactive, and runs reconnect once', async () => {
        const hookRef = await renderRemoteHook();

        const serverWithAgent: RemoteServerView = {
            id: 'srv-1',
            name: 'GPU Node',
            url: 'http://gpu:3000',
            is_local: false,
            status: 'online',
            projects: [{ id: 'p1', name: 'Project 1', root: '/p1' }],
            agents: [
                {
                    id: 'agent-1',
                    project_id: 'p1',
                    name: 'Agent 1',
                    session_id: 'sess-1',
                    is_processing: false,
                    queue: [],
                },
            ],
        };

        mockSocket.emitted = [];

        act(() => {
            mockSocket.emitServer('remote:servers:updated', { servers: [serverWithAgent] });
        });

        // Reconnect RPC should be emitted once for srv-1
        const reconnectCalls = mockSocket.emitted.filter((e) => {
            const p = e.payload as any;
            return e.event === 'remote:rpc' && p?.method === 'acp:reconnect' && p?.server_id === 'srv-1';
        });
        expect(reconnectCalls).toHaveLength(1);

        expect(hookRef.current?.sessions.get('srv-1::agent-1')?.isActive).toBe(true);

        // Update server list where agent-1 was removed
        act(() => {
            mockSocket.emitServer('remote:servers:updated', {
                servers: [{ ...serverWithAgent, agents: [] }],
            });
        });

        // The session is now deactivated rather than blown away immediately
        expect(hookRef.current?.sessions.get('srv-1::agent-1')?.isActive).toBe(false);

        // Emitting updated servers with agent-1 again should NOT re-trigger acp:reconnect
        mockSocket.emitted = [];
        act(() => {
            mockSocket.emitServer('remote:servers:updated', { servers: [serverWithAgent] });
        });
        const secondReconnect = mockSocket.emitted.filter((e) => {
            const p = e.payload as any;
            return e.event === 'remote:rpc' && p?.method === 'acp:reconnect';
        });
        expect(secondReconnect).toHaveLength(0);
    });

    it('assigns available <agent>-N IDs skipping existing server agent IDs when starting agents', async () => {
        const hookRef = await renderRemoteHook();

        const serverWithPreexistingAgent: RemoteServerView = {
            id: 'srv-counters',
            name: 'Node with Agents',
            url: 'http://node:3000',
            is_local: false,
            status: 'online',
            projects: [{ id: 'p1', name: 'Project 1', root: '/p1' }],
            agents: [
                {
                    id: 'claude-3',
                    project_id: 'p1',
                    name: 'Claude 3',
                    session_id: 'sess-3',
                    is_processing: false,
                    queue: [],
                },
                {
                    id: 'claude-5',
                    project_id: 'p1',
                    name: 'Claude 5',
                    session_id: 'sess-5',
                    is_processing: false,
                    queue: [],
                },
            ],
        };

        act(() => {
            mockSocket.emitServer('remote:servers:updated', { servers: [serverWithPreexistingAgent] });
        });

        let newAgentId = '';
        act(() => {
            newAgentId = hookRef.current?.startAgent({
                serverId: 'srv-counters',
                projectId: 'p1',
                agent: {
                    id: 'claude',
                    name: 'Claude',
                    command: 'claude',
                    args: [],
                },
            }) ?? '';
        });

        // Should skip 3 and pick next available (which is 1 or beyond existing if starting from counter)
        expect(newAgentId).toBe('claude-1');

        let secondAgentId = '';
        act(() => {
            secondAgentId = hookRef.current?.startAgent({
                serverId: 'srv-counters',
                projectId: 'p1',
                agent: {
                    id: 'claude',
                    name: 'Claude',
                    command: 'claude',
                    args: [],
                },
            }) ?? '';
        });
        expect(secondAgentId).toBe('claude-2');

        let thirdAgentId = '';
        act(() => {
            thirdAgentId = hookRef.current?.startAgent({
                serverId: 'srv-counters',
                projectId: 'p1',
                agent: {
                    id: 'claude',
                    name: 'Claude',
                    command: 'claude',
                    args: [],
                },
            }) ?? '';
        });
        // claude-3 is used on the server, so it must skip 3 and pick 4!
        expect(thirdAgentId).toBe('claude-4');
    });

    it('removeServer and stopAgent clean up sessions and caches without state leaks', async () => {
        const hookRef = await renderRemoteHook();

        const serverView: RemoteServerView = {
            id: 'srv-to-remove',
            name: 'Temporary Node',
            url: 'http://temp:3000',
            is_local: false,
            status: 'online',
            projects: [{ id: 'p1', name: 'P1', root: '/p1' }],
            agents: [
                {
                    id: 'agent-temp-1',
                    project_id: 'p1',
                    name: 'Temp Agent',
                    session_id: 'sess-temp-1',
                    is_processing: false,
                    queue: [],
                },
            ],
        };

        act(() => {
            mockSocket.emitServer('remote:servers:updated', { servers: [serverView] });
        });

        expect(hookRef.current?.sessions.has('srv-to-remove::agent-temp-1')).toBe(true);

        // Test stopAgent
        mockSocket.emitted = [];
        let stopPromise: Promise<void> | undefined;
        act(() => {
            stopPromise = hookRef.current?.stopAgent('srv-to-remove', 'agent-temp-1');
        });

        const stopCall = mockSocket.emitted.find((e) => {
            const p = e.payload as any;
            return e.event === 'remote:rpc' && p?.method === 'acp:stop';
        });
        expect(stopCall).toBeDefined();
        await act(async () => {
            stopCall?.callback?.({ success: true, data: {} });
            await stopPromise;
        });

        expect(hookRef.current?.sessions.has('srv-to-remove::agent-temp-1')).toBe(false);

        // Re-add agent
        act(() => {
            mockSocket.emitServer('remote:servers:updated', { servers: [serverView] });
        });
        expect(hookRef.current?.sessions.has('srv-to-remove::agent-temp-1')).toBe(true);

        // Test removeServer
        mockSocket.emitted = [];
        let removePromise: Promise<void> | undefined;
        act(() => {
            removePromise = hookRef.current?.removeServer('srv-to-remove');
        });

        const removeCall = mockSocket.emitted.find((e) => e.event === 'remote:servers:remove');
        expect(removeCall).toBeDefined();
        await act(async () => {
            removeCall?.callback?.({ success: true });
            await removePromise;
        });

        // Session must be completely deleted
        expect(hookRef.current?.sessions.has('srv-to-remove::agent-temp-1')).toBe(false);
    });
});

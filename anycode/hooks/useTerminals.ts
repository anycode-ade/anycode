import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { Terminal } from '../types';
import { loadTerminals } from '../storage';

type UseTerminalsParams = {
    wsRef: React.RefObject<Socket | null>;
    isConnected: boolean;
};

const TERMINAL_DELAY_MS = 100;

export const useTerminals = ({ wsRef, isConnected }: UseTerminalsParams) => {
    const [terminals, setTerminals] = useState<Terminal[]>(loadTerminals);
    const terminalCounterRef = useRef<number>(1);
    const newTerminalsRef = useRef<Set<string>>(new Set());
    const terminalListenersRef = useRef<Map<string, Set<(data: string) => void>>>(new Map());
    const pendingResizeRef = useRef<Map<string, { cols: number; rows: number }>>(new Map());
    const resizeTimerRef = useRef<Map<string, number>>(new Map());
    const lastResizeSentRef = useRef<Map<string, { cols: number; rows: number }>>(new Map());
    const resizeThrottleMsRef = useRef<number>(TERMINAL_DELAY_MS);
    const closingTerminalsRef = useRef<Set<string>>(new Set());

    const clearResizeState = useCallback((name?: string) => {
        if (!name) {
            resizeTimerRef.current.forEach((timerId) => {
                clearTimeout(timerId);
            });
            resizeTimerRef.current.clear();
            pendingResizeRef.current.clear();
            lastResizeSentRef.current.clear();
            return;
        }

        const timerId = resizeTimerRef.current.get(name);
        if (timerId) {
            clearTimeout(timerId);
            resizeTimerRef.current.delete(name);
        }
        pendingResizeRef.current.delete(name);
        lastResizeSentRef.current.delete(name);
    }, []);

    const initializeTerminal = useCallback((terminal: Terminal) => {
        if (!wsRef.current) return;

        const isNewTerminal = newTerminalsRef.current.has(terminal.id);
        const event = isNewTerminal ? 'terminal:start' : 'terminal:reconnect';

        wsRef.current.emit(event, {
            name: terminal.name,
            session: terminal.session,
            cols: terminal.cols,
            rows: terminal.rows,
        });
    }, [wsRef]);

    const attachTerminalListener = useCallback((name: string, callback: (data: string) => void) => {
        if (!wsRef.current) return;
        const channel = `terminal:data:${name}`;
        wsRef.current.on(channel, callback);
    }, [wsRef]);

    const detachTerminalListener = useCallback((name: string, callback: (data: string) => void) => {
        if (!wsRef.current) return;
        const channel = `terminal:data:${name}`;
        wsRef.current.off(channel, callback);
    }, [wsRef]);

    const reattachTerminalListener = useCallback((name: string) => {
        if (!wsRef.current) return;
        const callbacks = terminalListenersRef.current.get(name);
        if (!callbacks) return;

        callbacks.forEach((callback) => {
            detachTerminalListener(name, callback);
            attachTerminalListener(name, callback);
        });
    }, [wsRef, attachTerminalListener, detachTerminalListener]);

    const handleTerminalDataCallback = useCallback((name: string, callback: (data: string) => void) => {
        if (!terminalListenersRef.current.has(name)) {
            terminalListenersRef.current.set(name, new Set());
        }

        const callbacks = terminalListenersRef.current.get(name)!;
        callbacks.add(callback);
        attachTerminalListener(name, callback);

        return () => {
            callbacks.delete(callback);
            detachTerminalListener(name, callback);

            if (callbacks.size === 0) {
                terminalListenersRef.current.delete(name);
            }
        };
    }, [attachTerminalListener, detachTerminalListener]);

    const reconnectTerminals = useCallback(() => {
        terminals.forEach((term) => {
            initializeTerminal(term);
            reattachTerminalListener(term.name);
        });
    }, [terminals, initializeTerminal, reattachTerminalListener]);

    const handleTerminalData = useCallback((name: string, data: string) => {
        const terminal = terminals.find((t) => t.name === name);
        if (!terminal || !wsRef.current || !isConnected) return;

        wsRef.current.emit('terminal:input', {
            name: terminal.name,
            session: terminal.session,
            input: data,
        });
    }, [terminals, wsRef, isConnected]);

    const handleTerminalResize = useCallback((name: string, cols: number, rows: number) => {
        const terminal = terminals.find((t) => t.name === name);
        if (!terminal || !wsRef.current || !isConnected) return;
        pendingResizeRef.current.set(name, { cols, rows });

        if (resizeTimerRef.current.get(name)) {
            return;
        }

        const timerId = window.setTimeout(() => {
            resizeTimerRef.current.delete(name);
            const pending = pendingResizeRef.current.get(name);
            if (!pending || !wsRef.current || !isConnected) return;

            const lastSent = lastResizeSentRef.current.get(name);
            if (lastSent && lastSent.cols === pending.cols && lastSent.rows === pending.rows) {
                return;
            }

            wsRef.current.emit('terminal:resize', {
                name: terminal.name,
                session: terminal.session,
                cols: pending.cols,
                rows: pending.rows,
            });
            lastResizeSentRef.current.set(name, pending);
        }, resizeThrottleMsRef.current);

        resizeTimerRef.current.set(name, timerId);
    }, [terminals, wsRef, isConnected]);

    const addTerminal = useCallback(() => {
        let nextId = terminalCounterRef.current + 1;
        while (terminals.find((t) => t.id === String(nextId))) {
            nextId += 1;
        }
        terminalCounterRef.current = nextId;

        const id = String(nextId);
        const newTerminal: Terminal = { id, name: id, session: 'anycode', cols: 60, rows: 20 };
        newTerminalsRef.current.add(id);
        setTerminals((prev) => [...prev, newTerminal]);

        if (wsRef.current && isConnected) {
            initializeTerminal(newTerminal);
        }
    }, [terminals, wsRef, isConnected, initializeTerminal]);

    const closeTerminal = useCallback((index: number) => {
        const terminalToRemove = terminals[index];
        if (!terminalToRemove) return;

        closingTerminalsRef.current.add(terminalToRemove.name);
        newTerminalsRef.current.delete(terminalToRemove.id);
        clearResizeState(terminalToRemove.name);
        window.setTimeout(() => {
            closingTerminalsRef.current.delete(terminalToRemove.name);
        }, TERMINAL_DELAY_MS * 2);
        setTerminals((prev) => prev.filter((_, i) => i !== index));

        if (wsRef.current && isConnected) {
            wsRef.current.emit('terminal:close', {
                name: terminalToRemove.name,
                session: terminalToRemove.session,
            });
        }
    }, [clearResizeState, terminals, wsRef, isConnected]);

    const isTerminalClosing = useCallback((name: string) => {
        return closingTerminalsRef.current.has(name);
    }, []);

    useEffect(() => {
        return () => {
            clearResizeState();
        };
    }, [clearResizeState]);

    return {
        terminals,
        handleTerminalData,
        handleTerminalResize,
        handleTerminalDataCallback,
        addTerminal,
        closeTerminal,
        reconnectTerminals,
        isTerminalClosing,
    };
};

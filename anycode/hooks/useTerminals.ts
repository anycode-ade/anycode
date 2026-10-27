import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { Terminal } from '../types';
import { loadTerminals } from '../storage';
import { applyTerminalInput } from '../terminalInput';

type UseTerminalsParams = {
    wsRef: React.RefObject<Socket | null>;
    isConnected: boolean;
};

const TERMINAL_DELAY_MS = 100;
const terminalKey = (name: string, session: string) => `${session}:${name}`;
const terminalStorageKey = (kind: 'data' | 'mouseMode', name: string, session: string) => (
    session === 'anycode'
        ? `terminal:${kind}:${name}`
        : `terminal:${kind}:${session}:${name}`
);

export const useTerminals = ({ wsRef, isConnected }: UseTerminalsParams) => {
    const [terminals, setTerminals] = useState<Terminal[]>(loadTerminals);
    const terminalCounterRef = useRef<number>(0);
    const newTerminalsRef = useRef<Set<string>>(new Set());
    const terminalListenersRef = useRef<Map<string, Set<(data: string) => void>>>(new Map());
    const pendingResizeRef = useRef<Map<string, { cols: number; rows: number }>>(new Map());
    const resizeTimerRef = useRef<Map<string, number>>(new Map());
    const lastResizeSentRef = useRef<Map<string, { cols: number; rows: number }>>(new Map());
    const resizeThrottleMsRef = useRef<number>(TERMINAL_DELAY_MS);
    const closingTerminalsRef = useRef<Set<string>>(new Set());
    // Line being typed per terminal id, and the last submitted command per terminal id.
    const inputLinesRef = useRef<Map<string, string>>(new Map());
    const [lastCommands, setLastCommands] = useState<Record<string, string>>({});
    // Latest OSC 0/2 window title per terminal id, reported by wterm's onTitle.
    const [titles, setTitles] = useState<Record<string, string>>({});

    const clearResizeState = useCallback((name?: string, session?: string) => {
        if (!name || !session) {
            resizeTimerRef.current.forEach((timerId) => {
                clearTimeout(timerId);
            });
            resizeTimerRef.current.clear();
            pendingResizeRef.current.clear();
            lastResizeSentRef.current.clear();
            return;
        }

        const key = terminalKey(name, session);
        const timerId = resizeTimerRef.current.get(key);
        if (timerId) {
            clearTimeout(timerId);
            resizeTimerRef.current.delete(key);
        }
        pendingResizeRef.current.delete(key);
        lastResizeSentRef.current.delete(key);
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
            ...(isNewTerminal && terminal.project_id ? { project_id: terminal.project_id } : {}),
        });
    }, [wsRef]);

    const attachTerminalListener = useCallback((name: string, session: string, callback: (data: string) => void) => {
        if (!wsRef.current) return;
        const channel = `terminal:data:${session}:${name}`;
        wsRef.current.on(channel, callback);
    }, [wsRef]);

    const detachTerminalListener = useCallback((name: string, session: string, callback: (data: string) => void) => {
        if (!wsRef.current) return;
        const channel = `terminal:data:${session}:${name}`;
        wsRef.current.off(channel, callback);
    }, [wsRef]);

    const reattachTerminalListener = useCallback((name: string, session: string) => {
        if (!wsRef.current) return;
        const key = terminalKey(name, session);
        const callbacks = terminalListenersRef.current.get(key);
        if (!callbacks) return;

        callbacks.forEach((callback) => {
            detachTerminalListener(name, session, callback);
            attachTerminalListener(name, session, callback);
        });
    }, [wsRef, attachTerminalListener, detachTerminalListener]);

    const handleTerminalDataCallback = useCallback((name: string, session: string, callback: (data: string) => void) => {
        const key = terminalKey(name, session);
        if (!terminalListenersRef.current.has(key)) {
            terminalListenersRef.current.set(key, new Set());
        }

        const callbacks = terminalListenersRef.current.get(key)!;
        callbacks.add(callback);
        attachTerminalListener(name, session, callback);

        return () => {
            callbacks.delete(callback);
            detachTerminalListener(name, session, callback);

            if (callbacks.size === 0) {
                terminalListenersRef.current.delete(key);
            }
        };
    }, [attachTerminalListener, detachTerminalListener]);

    const reconnectTerminals = useCallback(() => {
        terminals.forEach((term) => {
            initializeTerminal(term);
            reattachTerminalListener(term.name, term.session);
        });
    }, [terminals, initializeTerminal, reattachTerminalListener]);

    const handleTerminalData = useCallback((name: string, session: string, data: string) => {
        const terminal = terminals.find((t) => t.name === name && t.session === session);
        if (!terminal || !wsRef.current || !isConnected) return;

        wsRef.current.emit('terminal:input', {
            name: terminal.name,
            session: terminal.session,
            input: data,
        });

        const input = applyTerminalInput(inputLinesRef.current.get(terminal.id) ?? '', data);
        inputLinesRef.current.set(terminal.id, input.line);
        if (input.commands.length > 0) {
            const command = input.commands[input.commands.length - 1];
            setLastCommands((prev) => ({ ...prev, [terminal.id]: command }));
        }
    }, [terminals, wsRef, isConnected]);

    const handleTerminalTitle = useCallback((name: string, session: string, title: string) => {
        const terminal = terminals.find((t) => t.name === name && t.session === session);
        if (!terminal) return;
        // wterm reports the title on every output flush, so skip unchanged values.
        setTitles((prev) => (prev[terminal.id] === title ? prev : { ...prev, [terminal.id]: title }));
    }, [terminals]);

    const handleTerminalResize = useCallback((name: string, session: string, cols: number, rows: number) => {
        const terminal = terminals.find((t) => t.name === name && t.session === session);
        if (!terminal || !wsRef.current || !isConnected) return;
        const key = terminalKey(name, session);
        pendingResizeRef.current.set(key, { cols, rows });

        if (resizeTimerRef.current.get(key)) {
            return;
        }

        const timerId = window.setTimeout(() => {
            resizeTimerRef.current.delete(key);
            const pending = pendingResizeRef.current.get(key);
            if (!pending || !wsRef.current || !isConnected) return;

            const lastSent = lastResizeSentRef.current.get(key);
            if (lastSent && lastSent.cols === pending.cols && lastSent.rows === pending.rows) {
                return;
            }

            wsRef.current.emit('terminal:resize', {
                name: terminal.name,
                session: terminal.session,
                cols: pending.cols,
                rows: pending.rows,
            });
            lastResizeSentRef.current.set(key, pending);
        }, resizeThrottleMsRef.current);

        resizeTimerRef.current.set(key, timerId);
    }, [terminals, wsRef, isConnected]);

    const addTerminal = useCallback((projectId: string) => {
        let nextId = terminalCounterRef.current + 1;
        while (terminals.find((t) => t.id === String(nextId))) {
            nextId += 1;
        }
        terminalCounterRef.current = nextId;

        const id = String(nextId);
        // Ids are reused after a terminal closes, so drop any input state left under this id.
        inputLinesRef.current.delete(id);
        setLastCommands((prev) => {
            if (!(id in prev)) return prev;
            const next = { ...prev };
            delete next[id];
            return next;
        });
        setTitles((prev) => {
            if (!(id in prev)) return prev;
            const next = { ...prev };
            delete next[id];
            return next;
        });
        const newTerminal: Terminal = {
            id,
            name: id,
            session: crypto.randomUUID(),
            cols: 60,
            rows: 20,
            project_id: projectId,
        };
        newTerminalsRef.current.add(id);
        setTerminals((prev) => [...prev, newTerminal]);

        if (wsRef.current && isConnected) {
            initializeTerminal(newTerminal);
        }
        return id;
    }, [terminals, wsRef, isConnected, initializeTerminal]);

    const closeTerminal = useCallback((id: string) => {
        const terminalToRemove = terminals.find((terminal) => terminal.id === id);
        if (!terminalToRemove) return;

        // Clean up terminal history snapshot and mouse mode from localStorage
        localStorage.removeItem(terminalStorageKey('data', terminalToRemove.name, terminalToRemove.session));
        localStorage.removeItem(terminalStorageKey('mouseMode', terminalToRemove.name, terminalToRemove.session));

        const key = terminalKey(terminalToRemove.name, terminalToRemove.session);
        closingTerminalsRef.current.add(key);
        newTerminalsRef.current.delete(terminalToRemove.id);
        clearResizeState(terminalToRemove.name, terminalToRemove.session);
        window.setTimeout(() => {
            closingTerminalsRef.current.delete(key);
        }, TERMINAL_DELAY_MS * 2);
        setTerminals((prev) => prev.filter((terminal) => terminal.id !== id));

        if (wsRef.current && isConnected) {
            wsRef.current.emit('terminal:close', {
                name: terminalToRemove.name,
                session: terminalToRemove.session,
            });
        }
    }, [clearResizeState, terminals, wsRef, isConnected]);

    const isTerminalClosing = useCallback((name: string, session: string) => {
        return closingTerminalsRef.current.has(terminalKey(name, session));
    }, []);

    const uploadFile = useCallback(async (file: File): Promise<string | null> => {
        if (!wsRef.current || !isConnected) return null;

        const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });

        const comma = dataUrl.indexOf(',');
        if (comma === -1) return null;
        const dataBase64 = dataUrl.slice(comma + 1);
        if (!dataBase64) return null;

        let filename = file.name;
        const dotIndex = filename.lastIndexOf('.');
        const ext = dotIndex !== -1 ? filename.substring(dotIndex) : '';
        const base = dotIndex !== -1 ? filename.substring(0, dotIndex) : filename;
        const safeBase = base.replace(/[^a-zA-Z0-9_-]/g, '_');
        filename = `${safeBase}_${Date.now()}${ext}`;

        return new Promise<string | null>((resolve) => {
            wsRef.current!.emit('file:create', {
                parent_path: '',
                name: filename,
                is_file: true,
                content_base64: dataBase64,
                to_temp_dir: true
            }, (response: any) => {
                if (response && response.success) {
                    resolve(response.file);
                } else {
                    resolve(null);
                }
            });
        });
    }, [wsRef, isConnected]);

    const closeAllTerminals = useCallback(() => {
        for (const terminal of terminals) {
            localStorage.removeItem(terminalStorageKey('data', terminal.name, terminal.session));
            localStorage.removeItem(terminalStorageKey('mouseMode', terminal.name, terminal.session));
            clearResizeState(terminal.name, terminal.session);
            if (wsRef.current && isConnected) {
                wsRef.current.emit('terminal:close', {
                    name: terminal.name,
                    session: terminal.session,
                });
            }
        }
        closingTerminalsRef.current.clear();
        newTerminalsRef.current.clear();
        terminalListenersRef.current.clear();
        setTerminals([]);
        localStorage.removeItem('terminals');
    }, [clearResizeState, terminals, wsRef, isConnected]);

    const removeProjectTerminals = useCallback((projectId: string) => {
        const removed = terminals.filter((terminal) => terminal.project_id === projectId);
        for (const terminal of removed) {
            const key = terminalKey(terminal.name, terminal.session);
            closingTerminalsRef.current.add(key);
            localStorage.removeItem(terminalStorageKey('data', terminal.name, terminal.session));
            localStorage.removeItem(terminalStorageKey('mouseMode', terminal.name, terminal.session));
            clearResizeState(terminal.name, terminal.session);
            newTerminalsRef.current.delete(terminal.id);
            terminalListenersRef.current.delete(key);
            window.setTimeout(() => closingTerminalsRef.current.delete(key), TERMINAL_DELAY_MS * 2);
        }
        setTerminals((prev) => prev.filter((terminal) => terminal.project_id !== projectId));
    }, [terminals, clearResizeState]);

    useEffect(() => {
        return () => {
            clearResizeState();
        };
    }, [clearResizeState]);

    return {
        terminals,
        lastCommands,
        terminalTitles: titles,
        handleTerminalTitle,
        handleTerminalData,
        handleTerminalResize,
        handleTerminalDataCallback,
        addTerminal,
        closeTerminal,
        closeAllTerminals,
        removeProjectTerminals,
        reconnectTerminals,
        isTerminalClosing,
        uploadFile,
    };
};

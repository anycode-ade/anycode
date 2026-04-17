import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { BACKEND_URL, BACKEND_URL_CANDIDATES } from '../constants';

type UseSocketParams = {
    onConnect?: () => void;
    onDisconnect?: (reason: string) => void;
    onConnectError?: (error: Error) => void;
    onError?: (data: { message: string }) => void;
};

export const useSocket = ({ onConnect, onDisconnect, onConnectError, onError }: UseSocketParams) => {
    const wsRef = useRef<Socket | null>(null);
    const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reconnectAttemptsRef = useRef<number>(0);
    const backendUrlIndexRef = useRef<number>(0);
    const reconnectDelay = 1000;

    const [isConnected, setIsConnected] = useState<boolean>(false);
    const [connectionError, setConnectionError] = useState<string | null>(null);

    const scheduleReconnect = useCallback((connectFn: () => void) => {
        if (reconnectTimeoutRef.current) return;
        reconnectTimeoutRef.current = setTimeout(() => {
            reconnectTimeoutRef.current = null;
            connectFn();
        }, reconnectDelay);
    }, []);

    const connectToBackend = useCallback(() => {
        try {
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
            }

            if (wsRef.current) {
                wsRef.current.disconnect();
                wsRef.current = null;
            }

            const backendUrl = BACKEND_URL_CANDIDATES[backendUrlIndexRef.current] || BACKEND_URL;
            const ws = io(backendUrl, { transports: ['websocket'] });
            wsRef.current = ws;

            ws.on('connect', () => {
                setIsConnected(true);
                setConnectionError(null);
                reconnectAttemptsRef.current = 0;
                backendUrlIndexRef.current = 0;
                onConnect?.();
            });

            ws.on('disconnect', (reason) => {
                setIsConnected(false);
                onDisconnect?.(reason);
                reconnectAttemptsRef.current += 1;
                scheduleReconnect(connectToBackend);
            });

            ws.on('connect_error', (error) => {
                setIsConnected(false);
                const hasNextBackend = backendUrlIndexRef.current < BACKEND_URL_CANDIDATES.length - 1;
                if (hasNextBackend) {
                    backendUrlIndexRef.current += 1;
                    setConnectionError(`Trying backend ${backendUrlIndexRef.current + 1}/${BACKEND_URL_CANDIDATES.length}...`);
                } else {
                    setConnectionError('Failed to connect to backend');
                }
                onConnectError?.(error);
                reconnectAttemptsRef.current += 1;
                scheduleReconnect(connectToBackend);
            });

            ws.on('error', (data: { message: string }) => {
                setConnectionError(data.message);
                onError?.(data);
            });
        } catch (error) {
            console.error('Failed to connect to backend:', error);
            setConnectionError('Failed to connect to backend');
        }
    }, [onConnect, onDisconnect, onConnectError, onError, scheduleReconnect]);

    const disconnectFromBackend = useCallback(() => {
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
        }

        reconnectAttemptsRef.current = 0;

        if (wsRef.current) {
            wsRef.current.disconnect();
            wsRef.current = null;
        }

        setIsConnected(false);
    }, []);

    useEffect(() => {
        connectToBackend();
        return () => {
            disconnectFromBackend();
        };
    }, [connectToBackend, disconnectFromBackend]);

    return {
        wsRef,
        isConnected,
        connectionError,
        connectToBackend,
        disconnectFromBackend,
    };
};

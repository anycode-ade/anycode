import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { BACKEND_URL } from '../constants';

type UseSocketParams = {
    onConnect?: () => void;
    onDisconnect?: (reason: string) => void;
    onConnectError?: (error: Error) => void;
    onError?: (data: { message: string }) => void;
};

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting';

export const useSocket = ({ onConnect, onDisconnect, onConnectError, onError }: UseSocketParams) => {
    const wsRef = useRef<Socket | null>(null);
    const isUnmountingRef = useRef<boolean>(false);

    const [isConnected, setIsConnected] = useState<boolean>(false);
    const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
    const [connectionError, setConnectionError] = useState<string | null>(null);

    const connectToBackend = useCallback(() => {
        try {
            const existingSocket = wsRef.current;
            if (existingSocket) {
                if (!existingSocket.connected && !existingSocket.active) {
                    existingSocket.connect();
                }
                return;
            }

            setConnectionStatus('connecting');

            const ws = io(BACKEND_URL, {
                transports: ['websocket'],
                reconnection: true,
                reconnectionAttempts: Infinity,
                reconnectionDelay: 1000,
                reconnectionDelayMax: 5000,
                timeout: 10000,
            });
            wsRef.current = ws;

            ws.on('connect', () => {
                setIsConnected(true);
                setConnectionStatus('connected');
                setConnectionError(null);
                onConnect?.();
            });

            ws.on('disconnect', (reason) => {
                setIsConnected(false);
                if (!isUnmountingRef.current) {
                    setConnectionStatus('reconnecting');
                    setConnectionError('Connection to backend lost');
                }
                onDisconnect?.(reason);
            });

            ws.on('connect_error', (error) => {
                setIsConnected(false);
                setConnectionStatus('reconnecting');
                setConnectionError('Failed to connect to backend');
                onConnectError?.(error);
            });

            ws.on('error', (data: { message: string }) => {
                setConnectionError(data.message);
                onError?.(data);
            });
        } catch (error) {
            console.error('Failed to connect to backend:', error);
            setConnectionError('Failed to connect to backend');
        }
    }, [onConnect, onDisconnect, onConnectError, onError]);

    const disconnectFromBackend = useCallback(() => {
        isUnmountingRef.current = true;

        if (wsRef.current) {
            wsRef.current.disconnect();
            wsRef.current = null;
        }

        setIsConnected(false);
    }, []);

    useEffect(() => {
        isUnmountingRef.current = false;
        connectToBackend();
        return () => {
            disconnectFromBackend();
        };
    }, [connectToBackend, disconnectFromBackend]);

    useEffect(() => {
        const reconnectCurrentSocket = () => {
            const ws = wsRef.current;
            if (ws && !ws.connected && !ws.active) {
                ws.connect();
            }
        };

        const reconnectWhenVisible = () => {
            if (document.visibilityState === 'visible') {
                reconnectCurrentSocket();
            }
        };

        window.addEventListener('online', reconnectCurrentSocket);
        window.addEventListener('pageshow', reconnectCurrentSocket);
        document.addEventListener('visibilitychange', reconnectWhenVisible);

        return () => {
            window.removeEventListener('online', reconnectCurrentSocket);
            window.removeEventListener('pageshow', reconnectCurrentSocket);
            document.removeEventListener('visibilitychange', reconnectWhenVisible);
        };
    }, []);

    return {
        wsRef,
        isConnected,
        connectionStatus,
        connectionError,
        connectToBackend,
        disconnectFromBackend,
    };
};

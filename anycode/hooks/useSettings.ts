import { useEffect } from 'react';
import type { Socket } from 'socket.io-client';

type UseSettingsParams = {
    wsRef: React.RefObject<Socket | null>;
    isConnected: boolean;
};

export const useSettings = ({ wsRef, isConnected }: UseSettingsParams) => {
    useEffect(() => {
        if (!isConnected || !wsRef.current) {
            return;
        }

        wsRef.current.emit('config:get', (res: any) => {
            if (res && res.success) {
                // Config loaded
            }
        });
    }, [isConnected, wsRef]);

    return {};
};


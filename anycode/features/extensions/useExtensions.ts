import { useState, useEffect, useCallback, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import type { ExtensionSummary, OpenVsxExtension } from './types';

export function useExtensions(wsRef: React.RefObject<Socket | null>, isConnected: boolean) {
  const [installed, setInstalled] = useState<ExtensionSummary[]>([]);
  const [searchResults, setSearchResults] = useState<OpenVsxExtension[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingInstalled, setIsLoadingInstalled] = useState(false);
  const [installingIds, setInstallingIds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'installed' | 'marketplace'>('installed');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedExtension, setSelectedExtension] = useState<ExtensionSummary | OpenVsxExtension | null>(null);

  const refreshInstalled = useCallback(() => {
    if (!wsRef.current || !isConnected) return;
    setIsLoadingInstalled(true);
    wsRef.current.emit('ext:list', (res: ExtensionSummary[]) => {
      setIsLoadingInstalled(false);
      if (Array.isArray(res)) {
        setInstalled(res);
      }
    });
  }, [wsRef, isConnected]);

  const searchMarketplace = useCallback(
    (query: string = '') => {
      if (!wsRef.current || !isConnected) {
        setSearchResults([]);
        setSearchError(null);
        return;
      }
      setIsSearching(true);
      setSearchError(null);
      wsRef.current.emit('ext:search', { query: query.trim(), offset: 0, size: 30 }, (res: any) => {
        setIsSearching(false);
        if (res?.success && res.data?.extensions) {
          setSearchResults(
            res.data.extensions.map((ext: any) => ({
              ...ext,
              id: `${ext.namespace}.${ext.name}`,
              iconUrl: ext.files?.icon,
            }))
          );
        } else {
          setSearchResults([]);
          if (!res?.success && res?.error) {
            setSearchError(res.error);
          }
        }
      });
    },
    [wsRef, isConnected]
  );

  useEffect(() => {
    if (isConnected) {
      refreshInstalled();
      searchMarketplace('');
    }
  }, [isConnected, refreshInstalled, searchMarketplace]);

  const installExtension = useCallback(
    async (id: string, version?: string) => {
      if (!wsRef.current || !isConnected) return;
      setInstallingIds((prev) => new Set(prev).add(id));

      return new Promise<boolean>((resolve) => {
        wsRef.current?.emit('ext:install', { id, version }, (res: any) => {
          setInstallingIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          if (res?.success) {
            refreshInstalled();
            resolve(true);
          } else {
            alert(`Failed to install ${id}: ${res?.error || 'Unknown error'}`);
            resolve(false);
          }
        });
      });
    },
    [wsRef, isConnected, refreshInstalled]
  );

  const installFromVsix = useCallback(
    async (vsixPath: string) => {
      if (!wsRef.current || !isConnected) return;
      return new Promise<boolean>((resolve) => {
        wsRef.current?.emit('ext:install', { vsixPath }, (res: any) => {
          if (res?.success) {
            refreshInstalled();
            resolve(true);
          } else {
            alert(`Failed to install VSIX: ${res?.error || 'Unknown error'}`);
            resolve(false);
          }
        });
      });
    },
    [wsRef, isConnected, refreshInstalled]
  );

  const uninstallExtension = useCallback(
    async (id: string) => {
      if (!wsRef.current || !isConnected) return;
      return new Promise<boolean>((resolve) => {
        wsRef.current?.emit('ext:uninstall', { id }, (res: any) => {
          if (res?.success) {
            refreshInstalled();
            resolve(true);
          } else {
            alert(`Failed to uninstall ${id}: ${res?.error || 'Unknown error'}`);
            resolve(false);
          }
        });
      });
    },
    [wsRef, isConnected, refreshInstalled]
  );

  const toggleExtension = useCallback(
    async (id: string, enabled: boolean) => {
      if (!wsRef.current || !isConnected) return;
      return new Promise<boolean>((resolve) => {
        wsRef.current?.emit('ext:toggle', { id, enabled }, (res: any) => {
          if (res?.success) {
            refreshInstalled();
            resolve(true);
          } else {
            resolve(false);
          }
        });
      });
    },
    [wsRef, isConnected, refreshInstalled]
  );

  return {
    installed,
    searchResults,
    searchError,
    isSearching,
    isLoadingInstalled,
    installingIds,
    activeTab,
    setActiveTab,
    searchQuery,
    setSearchQuery,
    selectedExtension,
    setSelectedExtension,
    searchMarketplace,
    installExtension,
    installFromVsix,
    uninstallExtension,
    toggleExtension,
    refreshInstalled,
  };
}

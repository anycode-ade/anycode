import { useState, useEffect, useCallback, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import type { ExtensionSummary, OpenVsxExtension } from './types';

const MARKETPLACE_PAGE_SIZE = 30;

const mapOpenVsxExtension = (ext: any) => ({
  ...ext,
  id: `${ext.namespace}.${ext.name}`,
  iconUrl: ext.files?.icon,
});

export function useExtensions(wsRef: React.RefObject<Socket | null>, isConnected: boolean) {
  const [installed, setInstalled] = useState<ExtensionSummary[]>([]);
  const [searchResults, setSearchResults] = useState<OpenVsxExtension[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchTotal, setSearchTotal] = useState(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  // Bumped on every new search so responses from superseded requests are ignored.
  const searchRequestRef = useRef(0);
  const activeQueryRef = useRef('');
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
      const requestId = ++searchRequestRef.current;
      const trimmed = query.trim();
      activeQueryRef.current = trimmed;
      setIsSearching(true);
      setIsLoadingMore(false);
      setSearchError(null);
      wsRef.current.emit('ext:search', { query: trimmed, offset: 0, size: MARKETPLACE_PAGE_SIZE }, (res: any) => {
        if (requestId !== searchRequestRef.current) return;
        setIsSearching(false);
        if (res?.success && res.data?.extensions) {
          setSearchResults(res.data.extensions.map(mapOpenVsxExtension));
          setSearchTotal(res.data.totalSize ?? 0);
        } else {
          setSearchResults([]);
          setSearchTotal(0);
          if (!res?.success && res?.error) {
            setSearchError(res.error);
          }
        }
      });
    },
    [wsRef, isConnected]
  );

  const loadMoreMarketplace = useCallback(() => {
    if (!wsRef.current || !isConnected || isSearching || isLoadingMore) return;
    if (searchResults.length >= searchTotal) return;
    const requestId = searchRequestRef.current;
    setIsLoadingMore(true);
    wsRef.current.emit(
      'ext:search',
      { query: activeQueryRef.current, offset: searchResults.length, size: MARKETPLACE_PAGE_SIZE },
      (res: any) => {
        if (requestId !== searchRequestRef.current) return;
        setIsLoadingMore(false);
        if (res?.success && res.data?.extensions) {
          setSearchResults((prev) => [...prev, ...res.data.extensions.map(mapOpenVsxExtension)]);
          setSearchTotal(res.data.totalSize ?? 0);
        } else {
          alert(`Failed to load more extensions: ${res?.error || 'Unknown error'}`);
        }
      }
    );
  }, [wsRef, isConnected, isSearching, isLoadingMore, searchResults.length, searchTotal]);

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
    searchTotal,
    isSearching,
    isLoadingMore,
    isLoadingInstalled,
    installingIds,
    activeTab,
    setActiveTab,
    searchQuery,
    setSearchQuery,
    selectedExtension,
    setSelectedExtension,
    searchMarketplace,
    loadMoreMarketplace,
    installExtension,
    installFromVsix,
    uninstallExtension,
    toggleExtension,
    refreshInstalled,
  };
}

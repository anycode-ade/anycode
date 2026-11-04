import React, { useEffect, useMemo, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import { useExtensions } from './useExtensions';
import { VirtualRow, useVirtualList } from './useVirtualList';
import { Icons } from '../../components/Icons';
import { BACKEND_URL } from '../../constants';
import './ExtensionsPanel.css';

/** Rough card height incl. gap; real heights are measured once rendered. */
const MARKETPLACE_ROW_ESTIMATE = 130;
/** Start loading the next page when the viewport gets this many rows from the end. */
const LOAD_MORE_AHEAD_ROWS = 6;

const resolveIconUrl = (iconUrl?: string): string | undefined => {
  if (!iconUrl) return undefined;
  if (iconUrl.startsWith('http://') || iconUrl.startsWith('https://') || iconUrl.startsWith('data:')) {
    return iconUrl;
  }
  return `${BACKEND_URL}${iconUrl.startsWith('/') ? '' : '/'}${iconUrl}`;
};

interface ExtensionsPanelProps {
  wsRef: React.RefObject<Socket | null>;
  isConnected: boolean;
  onOpenExtensionView?: (containerId: string, title?: string) => void;
}

export const ExtensionsPanel: React.FC<ExtensionsPanelProps> = ({ wsRef, isConnected, onOpenExtensionView }) => {
  const {
    installed,
    searchResults,
    searchError,
    searchTotal,
    isSearching,
    isLoadingMore,
    loadMoreError,
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
  } = useExtensions(wsRef, isConnected);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const virtualListRef = useRef<HTMLDivElement>(null);

  const marketplaceKeys = useMemo(() => searchResults.map((ext) => ext.id), [searchResults]);
  const { rows, totalHeight, lastVisibleIndex, measureRow } = useVirtualList({
    scrollRef: listScrollRef,
    listRef: virtualListRef,
    keys: marketplaceKeys,
    estimateSize: MARKETPLACE_ROW_ESTIMATE,
    overscan: 400,
  });

  useEffect(() => {
    if (activeTab !== 'marketplace' || isSearching || isLoadingMore || loadMoreError) return;
    const nearEnd = lastVisibleIndex >= searchResults.length - LOAD_MORE_AHEAD_ROWS;
    if (nearEnd && searchResults.length < searchTotal) loadMoreMarketplace();
  }, [activeTab, isSearching, isLoadingMore, loadMoreError, lastVisibleIndex, searchResults.length, searchTotal, loadMoreMarketplace]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    setActiveTab('marketplace');
    searchTimeoutRef.current = setTimeout(() => {
      searchMarketplace(val);
    }, 350);
  };

  const handleVsixSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const path = (file as any).path || file.name;
      installFromVsix(path);
    }
  };

  const isInstalled = (id: string) => {
    return installed.some((e) => e.id.toLowerCase() === id.toLowerCase());
  };

  return (
    <div className="extensions-panel">
      <div className="extensions-header">
        <div className="extensions-search-wrapper">
          <span className="extensions-search-icon">
            <Icons.Search />
          </span>
          <input
            type="text"
            className="extensions-search-input"
            placeholder="Search extensions in Open VSX..."
            value={searchQuery}
            onChange={handleSearchChange}
          />
        </div>

        <div className="extensions-toolbar">
          <div className="extensions-segmented" role="radiogroup" aria-label="Extension tabs">
            <button
              className={`extensions-pill ${activeTab === 'installed' ? 'active' : ''}`}
              onClick={() => setActiveTab('installed')}
            >
              Installed <span className="extensions-count-badge">{installed.length}</span>
            </button>
            <button
              className={`extensions-pill ${activeTab === 'marketplace' ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('marketplace');
                if (searchResults.length === 0) {
                  searchMarketplace(searchQuery);
                }
              }}
            >
              Marketplace
            </button>
          </div>

          <button
            className="extensions-vsix-btn"
            title="Install from local .vsix file"
            onClick={() => fileInputRef.current?.click()}
          >
            <Icons.Plus size={11} />
            <span>Install VSIX</span>
          </button>
          <input
            type="file"
            ref={fileInputRef}
            accept=".vsix"
            style={{ display: 'none' }}
            onChange={handleVsixSelect}
          />
        </div>
      </div>

      <div className="extensions-list" ref={listScrollRef}>
        {activeTab === 'installed' ? (
          installed.length === 0 ? (
            <div className="extensions-empty">
              {isLoadingInstalled ? 'Loading installed extensions...' : 'No extensions installed yet'}
            </div>
          ) : (
            <>
              <div className="extensions-section-title">Installed Extensions</div>
              {installed.map((ext) => (
                <div
                  key={ext.id}
                  className={`extension-item ${selectedExtension?.id === ext.id ? 'selected' : ''}`}
                  onClick={() => setSelectedExtension(ext)}
                >
                  <div className="extension-info">
                    <div className="extension-icon-box">
                      {ext.iconUrl ? (
                        <img src={resolveIconUrl(ext.iconUrl)} alt={ext.displayName} />
                      ) : (
                        <Icons.Extensions size={20} />
                      )}
                    </div>
                    <div className="extension-title-row">
                      <span className="extension-name">{ext.displayName}</span>
                      <span className="extension-version">v{ext.version}</span>
                    </div>
                    <div className="extension-author">{ext.publisher}</div>
                    {ext.description && (
                      <div className="extension-description">{ext.description}</div>
                    )}

                    <div className="extension-footer">
                      <span style={{ fontSize: '0.75em', color: ext.enabled ? '#65c466' : '#888' }}>
                        {ext.enabled ? '● Enabled' : '○ Disabled'}
                      </span>
                      <div className="extension-controls">
                        {ext.enabled && (ext.viewsContainers?.activitybar?.length || (ext.views && Object.keys(ext.views).length > 0)) ? (
                          <button
                            className="ext-btn-view-open"
                            onClick={(e) => {
                              e.stopPropagation();
                              const container = ext.viewsContainers?.activitybar?.[0];
                              const containerId = container?.id || ext.name;
                              const rawTitle = container?.title || ext.displayName || ext.name;
                              const title = (rawTitle && !rawTitle.startsWith('%') ? rawTitle : (ext.displayName || ext.name));
                              onOpenExtensionView?.(containerId, title);
                            }}
                            title="Open extension views"
                          >
                            Open Views
                          </button>
                        ) : null}
                        <button
                          className="ext-btn-secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExtension(ext.id, !ext.enabled);
                          }}
                        >
                          {ext.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          className="ext-btn-danger"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`Uninstall ${ext.displayName}?`)) {
                              uninstallExtension(ext.id);
                            }
                          }}
                        >
                          Uninstall
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )
        ) : isSearching ? (
          <div className="extensions-empty">Searching Open VSX registry...</div>
        ) : searchError ? (
          <div className="extensions-empty" style={{ color: '#f85149', display: 'flex', flexDirection: 'column', gap: 10, padding: 16 }}>
            <div>⚠️ <strong>Failed to query Open VSX</strong></div>
            <div style={{ fontSize: 12, color: '#ccc', wordBreak: 'break-word', background: '#222', padding: 8, borderRadius: 4 }}>
              {searchError}
            </div>
            <button
              onClick={() => searchMarketplace(searchQuery)}
              style={{
                alignSelf: 'center',
                padding: '6px 14px',
                background: '#238636',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              Retry Search
            </button>
          </div>
        ) : searchResults.length === 0 ? (
          <div className="extensions-empty">
            {searchQuery ? `No extensions found for "${searchQuery}"` : 'No extensions available'}
          </div>
        ) : (
          <>
            <div className="extensions-section-title">
              {searchQuery ? `Search results for "${searchQuery}"` : 'Popular & Recommended'}
            </div>
            <div ref={virtualListRef} style={{ position: 'relative', flexShrink: 0, height: totalHeight }}>
            {rows.map(({ index, key, top }) => {
              const ext = searchResults[index];
              const alreadyInstalled = isInstalled(ext.id);
              const isInstalling = installingIds.has(ext.id);

              return (
                <VirtualRow key={key} rowKey={key} top={top} measure={measureRow}>
                  <div
                    className={`extension-item ${selectedExtension?.id === ext.id ? 'selected' : ''}`}
                    onClick={() => setSelectedExtension(ext)}
                  >
                    <div className="extension-info">
                      <div className="extension-icon-box">
                        {ext.iconUrl ? (
                          <img src={resolveIconUrl(ext.iconUrl)} alt={ext.displayName || ext.name} />
                        ) : (
                          <Icons.Extensions size={20} />
                        )}
                      </div>
                      <div className="extension-title-row">
                        <span className="extension-name">{ext.displayName || ext.name}</span>
                        <span className="extension-version">v{ext.version}</span>
                      </div>
                      <div className="extension-author">{ext.namespace}</div>
                      {ext.description && (
                        <div className="extension-description">{ext.description}</div>
                      )}

                      <div className="extension-footer">
                        <div className="extension-stats">
                          {ext.downloadCount != null && (
                            <span className="extension-stat" title={`${ext.downloadCount.toLocaleString()} downloads`}>
                              ↓ {ext.downloadCount >= 1000000 ? `${(ext.downloadCount / 1000000).toFixed(1)}M` : ext.downloadCount >= 1000 ? `${(ext.downloadCount / 1000).toFixed(0)}k` : ext.downloadCount}
                            </span>
                          )}
                          {ext.averageRating != null && typeof ext.averageRating === 'number' && (
                            <span className="extension-stat" title={`Rating: ${ext.averageRating.toFixed(1)}`}>
                              ★ {ext.averageRating.toFixed(1)}
                            </span>
                          )}
                        </div>

                        <div className="extension-controls">
                          {alreadyInstalled ? (
                            <span className="ext-badge-installed">✓ Installed</span>
                          ) : (
                            <button
                              className="ext-btn-install"
                              disabled={isInstalling}
                              onClick={(e) => {
                                e.stopPropagation();
                                installExtension(ext.id, ext.version);
                              }}
                            >
                              {isInstalling ? 'Installing...' : 'Install'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </VirtualRow>
              );
            })}
            </div>
            {isLoadingMore && (
              <div style={{ textAlign: 'center', padding: '8px 0 12px', fontSize: 12, color: '#888' }}>Loading more...</div>
            )}
            {loadMoreError && (
              <div style={{ textAlign: 'center', padding: '8px 0 12px', fontSize: 12, color: '#f85149' }}>
                Failed to load more: {loadMoreError}{' '}
                <button className="ext-btn-secondary" onClick={loadMoreMarketplace}>Retry</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

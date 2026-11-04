import React, { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import type { Socket } from 'socket.io-client';
import type { ExtensionSummary, ContributedView } from './types';
import { TreeViewPanel } from './TreeViewPanel';
import { WebviewViewPanel } from './WebviewPanel';
import { Icons } from '../../components/Icons';
import { LayoutPanelApiContext } from '../../components/layout/Layout';
import './ExtensionContainerPanel.css';

interface ExtensionContainerPanelProps {
  containerId: string;
  wsRef: React.RefObject<Socket | null>;
  isConnected: boolean;
  onOpenFile?: (path: string) => void;
  onOpenFileDiff?: (path: string, projectId: string) => void;
}

export const ExtensionContainerPanel: React.FC<ExtensionContainerPanelProps> = ({
  containerId,
  wsRef,
  isConnected,
  onOpenFile,
  onOpenFileDiff,
}) => {
  const [extensions, setExtensions] = useState<ExtensionSummary[]>([]);
  const [expandedViews, setExpandedViews] = useState<Record<string, boolean>>({});

  const fetchExtensions = useCallback(() => {
    if (!wsRef.current || !isConnected) return;
    wsRef.current.emit('ext:list', (res: ExtensionSummary[]) => {
      if (Array.isArray(res)) {
        setExtensions(res);
      }
    });
  }, [wsRef, isConnected]);

  useEffect(() => {
    fetchExtensions();
  }, [fetchExtensions]);

  const panelApi = useContext(LayoutPanelApiContext);

  // Aggregate views belonging to this container
  const { title, views } = useMemo(() => {
    let resolvedTitle = containerId;
    const viewList: ContributedView[] = [];

    for (const ext of extensions) {
      if (!ext.enabled) continue;

      // Check viewContainers for matching title
      const containers = [
        ...(ext.viewsContainers?.activitybar || []),
        ...(ext.viewsContainers?.panel || []),
        ...((ext.viewsContainers as { secondarySidebar?: Array<{ id: string; title: string }> })?.secondarySidebar || []),
      ];
      const match = containers.find((c) => c.id === containerId);
      if (match) {
        resolvedTitle = match.title;
      }

      // Check views for containerId
      if (ext.views) {
        if (ext.views[containerId]) {
          viewList.push(...ext.views[containerId]);
        }

        // For gitlens, also bundle gitlensInspect and scm views if container is gitlens
        if (containerId.toLowerCase().includes('gitlens')) {
          if (containerId !== 'gitlensInspect' && ext.views['gitlensInspect']) {
            viewList.push(...ext.views['gitlensInspect']);
          }
          if (ext.views['scm']) {
            for (const v of ext.views['scm']) {
              if (v.id.startsWith('gitlens.') && !viewList.some((x) => x.id === v.id)) {
                viewList.push(v);
              }
            }
          }
        }
      }
    }

    // Filter duplicates and hidden views
    const unique = viewList.filter(
      (v, i, self) => i === self.findIndex((x) => x.id === v.id) && v.visibility !== 'hidden'
    );

    return {
      title: resolvedTitle,
      views: unique,
    };
  }, [extensions, containerId]);

  // Sync tab title with resolved manifest title if available
  useEffect(() => {
    if (panelApi && title && title !== containerId) {
      panelApi.setTitle(title);
    }
  }, [panelApi, title, containerId]);

  // Expand top views by default
  useEffect(() => {
    if (views.length > 0) {
      setExpandedViews((prev) => {
        if (Object.keys(prev).length > 0) return prev;
        const init: Record<string, boolean> = {};
        views.slice(0, 3).forEach((v) => {
          init[v.id] = true;
        });
        return init;
      });
    }
  }, [views]);

  const toggleSection = (viewId: string) => {
    setExpandedViews((prev) => ({
      ...prev,
      [viewId]: !prev[viewId],
    }));
  };

  return (
    <div className="ext-container-panel">
      <div className="ext-container-body">
        {views.length === 0 ? (
          <div className="ext-tree-empty-state">
            No views available for {title}. Ensure the extension is enabled.
          </div>
        ) : (
          views.map((view) => {
            const isSingle = views.length === 1;
            const isExpanded = isSingle || Boolean(expandedViews[view.id]);
            return (
              <div
                key={view.id}
                className={`ext-view-section ${isSingle ? 'single-view' : ''} ${isExpanded && view.type === 'webview' ? 'expanded-webview' : ''}`}
              >
                {!isSingle && (
                  <div
                    className="ext-view-section-header"
                    onClick={() => toggleSection(view.id)}
                  >
                    <div className="ext-view-section-title-wrap">
                      <span className={`ext-view-chevron ${isExpanded ? 'open' : ''}`}>
                        <Icons.ChevronRight size={10} />
                      </span>
                      <span className="ext-view-section-title">{view.name || view.id}</span>
                    </div>
                    <div className="ext-view-section-actions">
                      {/* View actions if any */}
                    </div>
                  </div>
                )}

                {isExpanded && (
                  <div className="ext-view-section-content">
                    {view.type === 'webview' ? (
                      <WebviewViewPanel
                        viewId={view.id}
                        title={view.name}
                        wsRef={wsRef}
                      />
                    ) : (
                      <TreeViewPanel
                        viewId={view.id}
                        title={view.name}
                        wsRef={wsRef}
                        onOpenFile={onOpenFile}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

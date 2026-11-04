import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import { WebviewPanel } from './WebviewPanel';
import { LayoutPanelApiContext } from '../../components/layout/Layout';

export interface OverlayWebviewItem {
  panelId: string;
  viewType: string;
  title: string;
  html: string;
}

interface WebviewOverlayContextValue {
  registerWebview: (item: { panelId: string; viewType: string; title: string; html?: string }) => void;
  updateWebviewHtml: (panelId: string, html: string) => void;
  attachAnchor: (panelId: string, anchorEl: HTMLElement, metadata: { viewType: string; title: string }) => void;
  detachAnchor: (panelId: string, anchorEl: HTMLElement) => void;
  syncRect: (panelId: string, rect: DOMRect, isVisible: boolean) => void;
  getHtml: (panelId: string) => string | undefined;
}

const WebviewOverlayContext = createContext<WebviewOverlayContextValue | null>(null);

export const useWebviewOverlay = () => {
  const ctx = useContext(WebviewOverlayContext);
  if (!ctx) {
    throw new Error('useWebviewOverlay must be used within WebviewOverlayProvider');
  }
  return ctx;
};

interface WebviewOverlayProviderProps {
  wsRef: React.RefObject<Socket | null>;
  children: React.ReactNode;
}

export const WebviewOverlayProvider: React.FC<WebviewOverlayProviderProps> = ({ wsRef, children }) => {
  const [overlays, setOverlays] = useState<Map<string, OverlayWebviewItem>>(new Map());
  const overlayDomRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const pendingCleanups = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const htmlCache = useRef<Map<string, string>>(new Map());
  const activeAnchors = useRef<Map<string, HTMLElement>>(new Map());

  const registerWebview = useCallback((item: { panelId: string; viewType: string; title: string; html?: string }) => {
    if (item.html) {
      htmlCache.current.set(item.panelId, item.html);
    }
    setOverlays((prev) => {
      const existing = prev.get(item.panelId);
      if (existing && existing.html === (item.html || existing.html)) {
        return prev;
      }
      const next = new Map(prev);
      next.set(item.panelId, {
        panelId: item.panelId,
        viewType: item.viewType,
        title: item.title,
        html: item.html || existing?.html || htmlCache.current.get(item.panelId) || '',
      });
      return next;
    });
  }, []);

  const updateWebviewHtml = useCallback((panelId: string, html: string) => {
    htmlCache.current.set(panelId, html);
    setOverlays((prev) => {
      const existing = prev.get(panelId);
      if (!existing) return prev;
      if (existing.html === html) return prev;
      const next = new Map(prev);
      next.set(panelId, { ...existing, html });
      return next;
    });
  }, []);

  const getHtml = useCallback((panelId: string) => {
    return htmlCache.current.get(panelId);
  }, []);

  const syncRect = useCallback((panelId: string, rect: DOMRect, isVisible: boolean) => {
    const dom = overlayDomRefs.current.get(panelId);
    if (!dom) return;
    if (!isVisible || rect.width <= 0 || rect.height <= 0) {
      dom.style.visibility = 'hidden';
      dom.style.pointerEvents = 'none';
      dom.style.transform = 'translate3d(-99999px, -99999px, 0)';
      return;
    }
    dom.style.transform = `translate3d(${Math.round(rect.left)}px, ${Math.round(rect.top)}px, 0)`;
    dom.style.width = `${Math.round(rect.width)}px`;
    dom.style.height = `${Math.round(rect.height)}px`;
    dom.style.visibility = 'visible';
    dom.style.pointerEvents = 'auto';
  }, []);

  const attachAnchor = useCallback((panelId: string, anchorEl: HTMLElement, metadata: { viewType: string; title: string }) => {
    activeAnchors.current.set(panelId, anchorEl);
    const cleanup = pendingCleanups.current.get(panelId);
    if (cleanup) {
      clearTimeout(cleanup);
      pendingCleanups.current.delete(panelId);
    }

    setOverlays((prev) => {
      if (prev.has(panelId)) return prev;
      const next = new Map(prev);
      next.set(panelId, {
        panelId,
        viewType: metadata.viewType,
        title: metadata.title,
        html: htmlCache.current.get(panelId) || '',
      });
      return next;
    });
  }, []);

  const detachAnchor = useCallback((panelId: string, anchorEl: HTMLElement) => {
    if (activeAnchors.current.get(panelId) === anchorEl) {
      activeAnchors.current.delete(panelId);
    }
    const dom = overlayDomRefs.current.get(panelId);
    if (dom) {
      dom.style.visibility = 'hidden';
      dom.style.pointerEvents = 'none';
    }

    // Grace period for moving/docking tabs across groups (2 seconds)
    const timeout = setTimeout(() => {
      pendingCleanups.current.delete(panelId);
      if (!activeAnchors.current.has(panelId)) {
        setOverlays((prev) => {
          if (!prev.has(panelId)) return prev;
          const next = new Map(prev);
          next.delete(panelId);
          return next;
        });
      }
    }, 2000);
    pendingCleanups.current.set(panelId, timeout);
  }, []);

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    const onSetHtml = (data: { panelId: string; html: string }) => {
      updateWebviewHtml(data.panelId, data.html);
    };
    ws.on('ext:webview:setHtml', onSetHtml);
    return () => {
      ws.off('ext:webview:setHtml', onSetHtml);
    };
  }, [wsRef, updateWebviewHtml]);

  return (
    <WebviewOverlayContext.Provider
      value={{
        registerWebview,
        updateWebviewHtml,
        attachAnchor,
        detachAnchor,
        syncRect,
        getHtml,
      }}
    >
      {children}
      <div
        className="webview-overlay-root"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          pointerEvents: 'none',
          zIndex: 4,
          overflow: 'hidden',
        }}
      >
        {Array.from(overlays.entries()).map(([panelId, item]) => (
          <div
            key={panelId}
            ref={(el) => {
              if (el) overlayDomRefs.current.set(panelId, el);
              else overlayDomRefs.current.delete(panelId);
            }}
            className="webview-overlay-item"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: 0,
              height: 0,
              transform: 'translate3d(-99999px, -99999px, 0)',
              visibility: 'hidden',
              pointerEvents: 'auto',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {item.html ? (
              <WebviewPanel
                panelId={item.panelId}
                viewType={item.viewType}
                title={item.title}
                html={item.html}
                wsRef={wsRef}
              />
            ) : null}
          </div>
        ))}
      </div>
    </WebviewOverlayContext.Provider>
  );
};

export const WebviewAnchor: React.FC<{
  panelId: string;
  viewType: string;
  title: string;
  className?: string;
  style?: React.CSSProperties;
}> = ({ panelId, viewType, title, className, style }) => {
  const anchorRef = useRef<HTMLDivElement>(null);
  const { attachAnchor, detachAnchor, syncRect } = useWebviewOverlay();
  const panelApi = useContext(LayoutPanelApiContext);

  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;

    attachAnchor(panelId, el, { viewType, title });

    const update = () => {
      if (!el || !document.contains(el)) {
        syncRect(panelId, new DOMRect(), false);
        return;
      }
      if (panelApi && !panelApi.isVisible) {
        syncRect(panelId, new DOMRect(), false);
        return;
      }
      const rect = el.getBoundingClientRect();
      const compStyle = window.getComputedStyle(el);
      const isVisible =
        rect.width > 0 &&
        rect.height > 0 &&
        el.offsetParent !== null &&
        compStyle.display !== 'none' &&
        compStyle.visibility !== 'hidden';
      syncRect(panelId, rect, isVisible);
    };

    update();
    const rafId = requestAnimationFrame(update);

    const ro = new ResizeObserver(() => {
      update();
    });
    ro.observe(el);

    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) {
        syncRect(panelId, new DOMRect(), false);
      } else {
        update();
      }
    });
    io.observe(el);

    const panelDisposables: { dispose: () => void }[] = [];
    if (panelApi) {
      panelDisposables.push(
        panelApi.onDidVisibilityChange((event) => {
          if (!event.isVisible) {
            syncRect(panelId, new DOMRect(), false);
          } else {
            update();
          }
        })
      );
    }

    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      io.disconnect();
      panelDisposables.forEach((d) => d.dispose());
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      detachAnchor(panelId, el);
    };
  }, [panelId, viewType, title, panelApi, attachAnchor, detachAnchor, syncRect]);

  return (
    <div
      ref={anchorRef}
      className={`webview-overlay-anchor ${className || ''}`}
      style={{
        width: '100%',
        height: '100%',
        flex: 1,
        minHeight: 0,
        ...style,
      }}
    />
  );
};

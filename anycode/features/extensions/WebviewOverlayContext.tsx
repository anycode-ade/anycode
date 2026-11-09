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
  attachAnchor: (panelId: string, anchorEl: HTMLElement, metadata: { viewType: string; title: string; html?: string }) => void;
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
  isConnected?: boolean;
  children: React.ReactNode;
}

export const WebviewOverlayProvider: React.FC<WebviewOverlayProviderProps> = ({ wsRef, isConnected, children }) => {
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
      const html = item.html || existing?.html || htmlCache.current.get(item.panelId) || '';
      if (existing && existing.html === html && existing.title === item.title && existing.viewType === item.viewType) {
        return prev;
      }
      const next = new Map(prev);
      next.set(item.panelId, {
        panelId: item.panelId,
        viewType: item.viewType || existing?.viewType || '',
        title: item.title || existing?.title || '',
        html,
      });
      return next;
    });
  }, []);

  const updateWebviewHtml = useCallback((panelId: string, html: string) => {
    htmlCache.current.set(panelId, html);
    setOverlays((prev) => {
      const existing = prev.get(panelId);
      if (existing && existing.html === html) return prev;
      const next = new Map(prev);
      next.set(panelId, {
        panelId,
        viewType: existing?.viewType || '',
        title: existing?.title || '',
        html,
      });
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

  const attachAnchor = useCallback((panelId: string, anchorEl: HTMLElement, metadata: { viewType: string; title: string; html?: string }) => {
    activeAnchors.current.set(panelId, anchorEl);
    const cleanup = pendingCleanups.current.get(panelId);
    if (cleanup) {
      clearTimeout(cleanup);
      pendingCleanups.current.delete(panelId);
    }

    const html = metadata.html || htmlCache.current.get(panelId) || '';
    if (html) {
      htmlCache.current.set(panelId, html);
    }

    setOverlays((prev) => {
      const existing = prev.get(panelId);
      if (existing && (!html || existing.html === html)) {
        return prev;
      }
      const next = new Map(prev);
      next.set(panelId, {
        panelId,
        viewType: metadata.viewType || existing?.viewType || '',
        title: metadata.title || existing?.title || '',
        html: html || existing?.html || '',
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
    const onCreate = (data: { panelId: string; viewType: string; title: string }) => {
      registerWebview({ panelId: data.panelId, viewType: data.viewType, title: data.title });
    };
    const onSetHtml = (data: { panelId: string; html: string }) => {
      updateWebviewHtml(data.panelId, data.html);
    };
    const onSetTitle = (data: { panelId: string; title: string }) => {
      setOverlays((prev) => {
        const existing = prev.get(data.panelId);
        if (!existing) return prev;
        const next = new Map(prev);
        next.set(data.panelId, { ...existing, title: data.title });
        return next;
      });
    };
    const onDispose = (data: { panelId: string }) => {
      setOverlays((prev) => {
        if (!prev.has(data.panelId)) return prev;
        const next = new Map(prev);
        next.delete(data.panelId);
        return next;
      });
      htmlCache.current.delete(data.panelId);
      overlayDomRefs.current.delete(data.panelId);
    };
    ws.on('ext:webview:create', onCreate);
    ws.on('ext:webview:setHtml', onSetHtml);
    ws.on('ext:webview:setTitle', onSetTitle);
    ws.on('ext:webview:dispose', onDispose);
    return () => {
      ws.off('ext:webview:create', onCreate);
      ws.off('ext:webview:setHtml', onSetHtml);
      ws.off('ext:webview:setTitle', onSetTitle);
      ws.off('ext:webview:dispose', onDispose);
    };
  }, [wsRef, isConnected, registerWebview, updateWebviewHtml]);

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
        <WebviewSashProxies />
      </div>
    </WebviewOverlayContext.Provider>
  );
};

interface SashProxyItem {
  id: string;
  el: HTMLElement;
  rect: DOMRect;
  isVertical: boolean;
}

const WebviewSashProxies: React.FC = () => {
  const [sashList, setSashList] = useState<SashProxyItem[]>([]);
  const isDraggingRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  const updateSashes = useCallback(() => {
    const layoutEl = document.querySelector('.layout');
    if (!layoutEl) {
      setSashList((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const domSashes = Array.from(layoutEl.querySelectorAll<HTMLElement>('.dv-sash:not(.disabled):not(.dv-disabled)'));
    const items: SashProxyItem[] = domSashes.map((el, index) => {
      const rect = el.getBoundingClientRect();
      const isVertical = rect.height >= rect.width;
      return {
        id: `sash-${index}`,
        el,
        rect,
        isVertical,
      };
    }).filter((item) => item.rect.width > 0 && item.rect.height > 0);

    setSashList((prev) => {
      if (prev.length === items.length) {
        const matches = prev.every((p, i) => {
          const n = items[i];
          return (
            p.el === n.el &&
            Math.abs(p.rect.left - n.rect.left) < 0.5 &&
            Math.abs(p.rect.top - n.rect.top) < 0.5 &&
            Math.abs(p.rect.width - n.rect.width) < 0.5 &&
            Math.abs(p.rect.height - n.rect.height) < 0.5 &&
            p.isVertical === n.isVertical
          );
        });
        if (matches) return prev;
      }
      return items;
    });
  }, []);

  useEffect(() => {
    updateSashes();

    const startRaf = () => {
      if (isDraggingRef.current) return;
      isDraggingRef.current = true;
      const loop = () => {
        updateSashes();
        if (isDraggingRef.current) {
          rafRef.current = requestAnimationFrame(loop);
        }
      };
      rafRef.current = requestAnimationFrame(loop);
    };

    const stopRaf = () => {
      isDraggingRef.current = false;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      updateSashes();
    };

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.dv-sash') || target?.closest('.webview-sash-proxy')) {
        startRaf();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('pointerup', stopRaf, true);
    document.addEventListener('pointercancel', stopRaf, true);
    window.addEventListener('resize', updateSashes);

    const ro = new ResizeObserver(() => {
      if (!isDraggingRef.current) updateSashes();
    });
    ro.observe(document.body);

    const mo = new MutationObserver(() => {
      if (!isDraggingRef.current) updateSashes();
    });
    mo.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    });

    const t1 = setTimeout(updateSashes, 100);
    const t2 = setTimeout(updateSashes, 500);

    return () => {
      stopRaf();
      clearTimeout(t1);
      clearTimeout(t2);
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('pointerup', stopRaf, true);
      document.removeEventListener('pointercancel', stopRaf, true);
      window.removeEventListener('resize', updateSashes);
      ro.disconnect();
      mo.disconnect();
    };
  }, [updateSashes]);

  if (sashList.length === 0) {
    return null;
  }

  return (
    <>
      {sashList.map((item) => (
        <div
          key={item.id}
          className={`webview-sash-proxy ${item.isVertical ? 'is-vertical' : 'is-horizontal'}`}
          style={{
            position: 'fixed',
            left: `${Math.round(item.rect.left)}px`,
            top: `${Math.round(item.rect.top)}px`,
            width: `${Math.round(item.rect.width)}px`,
            height: `${Math.round(item.rect.height)}px`,
            pointerEvents: 'auto',
            zIndex: 10,
          }}
          onPointerDown={(e) => {
            e.preventDefault();
            const evt = new PointerEvent('pointerdown', {
              bubbles: true,
              cancelable: true,
              clientX: e.clientX,
              clientY: e.clientY,
              screenX: e.screenX,
              screenY: e.screenY,
              pointerId: e.pointerId,
              pointerType: e.pointerType,
              isPrimary: e.isPrimary,
              buttons: e.buttons,
              button: e.button,
            });
            item.el.dispatchEvent(evt);
          }}
        />
      ))}
    </>
  );
};

export const WebviewAnchor: React.FC<{
  panelId: string;
  viewType: string;
  title: string;
  html?: string;
  className?: string;
  style?: React.CSSProperties;
}> = ({ panelId, viewType, title, html, className, style }) => {
  const anchorRef = useRef<HTMLDivElement>(null);
  const { attachAnchor, detachAnchor, syncRect, updateWebviewHtml } = useWebviewOverlay();
  const panelApi = useContext(LayoutPanelApiContext);

  useEffect(() => {
    if (html) {
      updateWebviewHtml(panelId, html);
    }
  }, [panelId, html, updateWebviewHtml]);

  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;

    attachAnchor(panelId, el, { viewType, title, html });

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
  }, [panelId, viewType, title, html, panelApi, attachAnchor, detachAnchor, syncRect]);

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

import React, { useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import { BACKEND_URL } from '../../constants';
import { useWebviewOverlay, WebviewAnchor } from './WebviewOverlayContext';

function prepareForJson(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  if (obj instanceof Uint8Array) {
    return Array.from(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(prepareForJson);
  }
  const res: any = {};
  for (const k of Object.keys(obj)) {
    res[k] = prepareForJson(obj[k]);
  }
  return res;
}

function reviveBytes(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    if (obj.length >= 2 && obj[0] === 'bytes') {
      if (obj[1] && typeof obj[1] === 'object' && !(obj[1] instanceof Uint8Array)) {
        const vals = Array.isArray(obj[1]) ? obj[1] : Object.values(obj[1]);
        obj[1] = new Uint8Array(vals);
      }
      return obj;
    }
    for (let i = 0; i < obj.length; i++) {
      obj[i] = reviveBytes(obj[i]);
    }
    return obj;
  }
  for (const k of Object.keys(obj)) {
    obj[k] = reviveBytes(obj[k]);
  }
  return obj;
}

interface WebviewPanelProps {
  panelId: string;
  viewType: string;
  title: string;
  html: string;
  wsRef: React.RefObject<Socket | null>;
}

export const WebviewPanel: React.FC<WebviewPanelProps> = ({
  panelId,
  title,
  html,
  wsRef,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;

    const onIncomingMessage = (data: { panelId: string; message: any }) => {
      if (data.panelId === panelId && iframeRef.current?.contentWindow) {
        console.log('[WebviewPanel] 📥 [INCOMING]', data.panelId, data.message);
        const revived = reviveBytes(data.message);
        iframeRef.current.contentWindow.postMessage(revived, '*');
      }
    };

    const onOpenExternal = (data: { uri: string }) => {
      console.log('[Extension] 🌐 ext:env:open_external received:', data?.uri);
      if (data?.uri) {
        window.open(data.uri, '_blank', 'noopener,noreferrer');
      }
    };

    ws.on('ext:webview:message', onIncomingMessage);
    ws.on('ext:env:open_external', onOpenExternal);
    return () => {
      ws.off('ext:webview:message', onIncomingMessage);
      ws.off('ext:env:open_external', onOpenExternal);
    };
  }, [panelId, wsRef]);

  // Handle messages posted from inside the iframe webview
  useEffect(() => {
    // The backend runs each socket event in its own task, so back-to-back messages
    // (e.g. a Cap'n Web connect followed by push) can reach the ext host out of order.
    // Send the next message only after the previous one is acknowledged.
    let outbound: Promise<void> = Promise.resolve();
    const handleWindowMessage = (event: MessageEvent) => {
      if (event.source === iframeRef.current?.contentWindow) {
        if (event.data?.__vscode_ext_msg) {
          console.log('[WebviewPanel] 📤 [OUTGOING]', panelId, event.data.payload);
          const safePayload = prepareForJson(event.data.payload);
          const ws = wsRef.current;
          if (!ws) return;
          outbound = outbound.then(() => new Promise<void>((resolve) => {
            // The timeout keeps the queue moving if an ack is lost on disconnect.
            ws.timeout(5000).emit('ext:webview:message', { panelId, message: safePayload }, (err: unknown) => {
              if (err) console.warn(`[webview] no ack from backend for a message on panel ${panelId}`);
              resolve();
            });
          }));
        }
      }
    };

    window.addEventListener('message', handleWindowMessage);
    return () => {
      window.removeEventListener('message', handleWindowMessage);
    };
  }, [panelId, wsRef]);

  // Inject acquireVsCodeApi shim, byte reviver, and standard VS Code theme CSS variables
  const shimScript = `
    <script>
      (function() {
        window.onerror = function(msg, url, line, col, err) {
          console.error('[IFRAME ERROR]', msg, url, line, col, err);
          try { window.parent.console.error('[IFRAME ERROR]', msg, url, line, col, err); } catch(_) {}
        };
        window.onunhandledrejection = function(e) {
          console.error('[IFRAME UNHANDLED REJECTION]', e.reason);
          try { window.parent.console.error('[IFRAME UNHANDLED REJECTION]', e.reason); } catch(_) {}
        };

        function reviveInIframe(obj) {
          if (!obj || typeof obj !== 'object') return obj;
          if (Array.isArray(obj)) {
            if (obj.length >= 2 && obj[0] === 'bytes') {
              if (obj[1] && typeof obj[1] === 'object' && !(obj[1] instanceof Uint8Array)) {
                var vals = Array.isArray(obj[1]) ? obj[1] : Object.values(obj[1]);
                obj[1] = new Uint8Array(vals);
              }
              return obj;
            }
            for (var i = 0; i < obj.length; i++) {
              obj[i] = reviveInIframe(obj[i]);
            }
            return obj;
          }
          for (var k in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, k)) {
              obj[k] = reviveInIframe(obj[k]);
            }
          }
          return obj;
        }

        var listenerMap = new WeakMap();
        var origAddEventListener = window.addEventListener.bind(window);
        window.addEventListener = function(type, listener, options) {
          if (type === 'message' && typeof listener === 'function') {
            var wrappedListener = function(event) {
              if (event) {
                if (event.data) {
                  try {
                    reviveInIframe(event.data);
                  } catch (_) {}
                }
                var proxiedEvent = new Proxy(event, {
                  get: function(target, prop) {
                    if (prop === 'origin') {
                      return window.location.origin;
                    }
                    var val = target[prop];
                    return typeof val === 'function' ? val.bind(target) : val;
                  }
                });
                return listener.call(this, proxiedEvent);
              }
              return listener.apply(this, arguments);
            };
            listenerMap.set(listener, wrappedListener);
            return origAddEventListener(type, wrappedListener, options);
          }
          return origAddEventListener(type, listener, options);
        };

        var origRemoveEventListener = window.removeEventListener.bind(window);
        window.removeEventListener = function(type, listener, options) {
          if (type === 'message' && typeof listener === 'function') {
            var wrapped = listenerMap.get(listener);
            if (wrapped) {
              return origRemoveEventListener(type, wrapped, options);
            }
          }
          return origRemoveEventListener(type, listener, options);
        };

        let state = {};
        window.acquireVsCodeApi = function() {
          return {
            postMessage: function(message) {
              window.parent.postMessage({ __vscode_ext_msg: true, payload: message }, '*');
            },
            setState: function(newState) {
              state = newState;
            },
            getState: function() {
              return state;
            }
          };
        };
      })();
    </script>
    <style id="_vscode_default_styles">
      :root {
        --startup-background: #1e1e1e !important;

        /* Typography */
        --vscode-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        --vscode-font-size: 13px;
        --vscode-font-weight: normal;
        --vscode-editor-font-family: Menlo, Monaco, "Courier New", monospace;
        --vscode-editor-font-size: 12px;
        --vscode-editor-font-weight: normal;

        /* Core Foreground & Background - match Anycode theme */
        --vscode-foreground: #cccccc;
        --vscode-editor-foreground: #cccccc;
        --vscode-sideBar-foreground: #cccccc;
        --vscode-sideBarTitle-foreground: #cccccc;
        --vscode-sideBarSectionHeader-foreground: #cccccc;
        --vscode-sideBarSectionHeader-background: #1e1e1e;
        --vscode-sideBarSectionHeader-border: #282828;
        --vscode-sideBar-background: #1e1e1e;
        --vscode-sideBar-border: #282828;
        --vscode-editor-background: #1e1e1e;
        --vscode-panel-background: #1e1e1e;
        --vscode-panel-border: #282828;
        --vscode-editorGroup-border: #282828;

        /* Text colors & Readability */
        --vscode-descriptionForeground: #8c8c8c;
        --vscode-disabledForeground: #6e6e6e;
        --vscode-errorForeground: #f14c4c;
        --vscode-icon-foreground: #c5c5c5;
        --vscode-focusBorder: #007acc;
        --vscode-textLink-foreground: #3794ff;
        --vscode-textLink-activeForeground: #4da3ff;
        --vscode-textCodeBlock-background: #252528;
        --vscode-textPreformat-foreground: #d7ba7d;
        --vscode-textBlockQuote-background: #252528;
        --vscode-textBlockQuote-border: #007acc;

        /* Inputs, Textareas, Forms */
        --vscode-input-background: #252528;
        --vscode-input-foreground: #cccccc;
        --vscode-input-border: #38383c;
        --vscode-input-placeholderForeground: #767676;
        --vscode-inputOption-activeBorder: #007acc;
        --vscode-inputOption-activeBackground: rgba(0, 122, 204, 0.2);
        --vscode-inputValidation-warningBackground: #352a05;
        --vscode-inputValidation-warningBorder: #bb8009;

        /* Dropdowns */
        --vscode-dropdown-background: #252528;
        --vscode-dropdown-border: #38383c;
        --vscode-dropdown-foreground: #cccccc;
        --vscode-dropdown-listBackground: #252528;

        /* Buttons & Actions */
        --vscode-button-background: #007acc;
        --vscode-button-foreground: #ffffff;
        --vscode-button-hoverBackground: #0062a3;
        --vscode-button-secondaryBackground: #2b2b2f;
        --vscode-button-secondaryForeground: #cccccc;
        --vscode-button-secondaryHoverBackground: #36363b;
        --vscode-button-border: #38383c;

        /* Badges & Pills */
        --vscode-badge-background: #2b2b2f;
        --vscode-badge-foreground: #cccccc;

        /* Lists & Menus */
        --vscode-list-hoverBackground: #2a2d32;
        --vscode-list-hoverForeground: #ffffff;
        --vscode-list-activeSelectionBackground: #094771;
        --vscode-list-activeSelectionForeground: #ffffff;
        --vscode-list-inactiveSelectionBackground: #2a2d32;
        --vscode-list-inactiveSelectionForeground: #cccccc;
        --vscode-list-focusBackground: #094771;
        --vscode-list-focusOutline: #007acc;
        --vscode-menu-background: #252528;
        --vscode-menu-foreground: #cccccc;
        --vscode-menu-selectionBackground: #094771;
        --vscode-menu-selectionForeground: #ffffff;
        --vscode-menu-border: #38383c;
        --vscode-menu-separatorBackground: #38383c;

        /* Widgets & Popups */
        --vscode-widget-border: #38383c;
        --vscode-widget-shadow: rgba(0, 0, 0, 0.36);
        --vscode-editorWidget-background: #252528;
        --vscode-editorWidget-border: #38383c;
        --vscode-editorWidget-foreground: #cccccc;
        --vscode-editorHoverWidget-background: #252528;
        --vscode-editorHoverWidget-border: #38383c;
        --vscode-editorHoverWidget-foreground: #cccccc;

        /* Toolbars & Progress */
        --vscode-toolbar-hoverBackground: rgba(90, 93, 94, 0.31);
        --vscode-toolbar-activeBackground: rgba(90, 93, 94, 0.5);
        --vscode-progressBar-background: #007acc;
        --vscode-banner-background: #094771;

        /* Scrollbars */
        --vscode-scrollbarSlider-background: rgba(121, 121, 121, 0.2);
        --vscode-scrollbarSlider-hoverBackground: rgba(100, 100, 100, 0.35);
        --vscode-scrollbarSlider-activeBackground: rgba(191, 191, 191, 0.45);

        /* Charts */
        --vscode-charts-red: #f14c4c;
        --vscode-charts-blue: #3794ff;
        --vscode-charts-yellow: #cca700;
        --vscode-charts-orange: #d18616;
        --vscode-charts-green: #89d185;

        /* Tailwind / shadcn Root Tokens for clean, cohesive extension UI */
        --background: #1e1e1e;
        --foreground: #cccccc;
        --card: #252528;
        --card-foreground: #cccccc;
        --popover: #252528;
        --popover-foreground: #cccccc;
        --primary: #007acc;
        --primary-foreground: #ffffff;
        --secondary: #2b2b2f;
        --secondary-foreground: #cccccc;
        --muted: #26262a;
        --muted-foreground: #8c8c8c;
        --accent: #2e3036;
        --accent-foreground: #ffffff;
        --border: #38383c;
        --input: #252528;
        --ring: #007acc;

        color-scheme: dark;
      }

      html, body, #root {
        background-color: var(--vscode-sideBar-background, #1e1e1e) !important;
        background: var(--vscode-sideBar-background, #1e1e1e) !important;
        color: var(--vscode-foreground, #cccccc);
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        -webkit-font-smoothing: antialiased;
      }

      /* Global box sizing */
      * {
        box-sizing: border-box;
      }

      /* Clean inputs with subtle borders */
      textarea, input[type="text"], input[type="search"], input:not([type]) {
        background-color: var(--vscode-input-background, #252528);
        color: var(--vscode-input-foreground, #cccccc);
        border: 1px solid var(--vscode-input-border, #38383c);
      }
      textarea::placeholder, input::placeholder {
        color: var(--vscode-input-placeholderForeground, #767676);
      }
      textarea:focus, input:focus {
        border-color: var(--vscode-focusBorder, #007acc);
        outline: 1px solid var(--vscode-focusBorder, #007acc);
      }

      button {
        font-family: inherit;
      }
    </style>
  `;

  // Rewrite vscode-resource: URIs and relax restrictive CSP in sandboxed iframe
  const origin = BACKEND_URL;
  let rewrittenHtml = (html || '')
    .replace(/<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '')
    .replace(/https:\/\/file\+\.vscode-resource\.vscode-cdn\.net/g, `${origin}/api/ext-file`)
    .replace(/vscode-resource:\/\/?/g, `${origin}/api/ext-file/`)
    .replace(/vscode-webview-resource:\/\/?/g, `${origin}/api/ext-file/`)
    .replace(/--startup-background:\s*transparent/g, '--startup-background: #1e1e1e')
    .replace(/<html\b/i, '<html class="dark" data-theme="dark"');

  if (rewrittenHtml.includes('<head>')) {
    rewrittenHtml = rewrittenHtml.replace('<head>', `<head>${shimScript}`);
  } else if (rewrittenHtml.includes('<head ')) {
    rewrittenHtml = rewrittenHtml.replace(/<head\b[^>]*>/, `$&${shimScript}`);
  } else {
    rewrittenHtml = `${shimScript}${rewrittenHtml}`;
  }

  // Ensure body has vscode-dark class and proper theme attributes
  if (rewrittenHtml.includes('<body')) {
    if (/<body[^>]*class=["']/i.test(rewrittenHtml)) {
      rewrittenHtml = rewrittenHtml.replace(
        /<body([^>]*)class=["']([^"']*)["']/i,
        '<body$1class="$2 vscode-dark" data-vscode-theme-kind="vscode-dark"'
      );
    } else {
      rewrittenHtml = rewrittenHtml.replace(
        /<body/i,
        '<body class="vscode-dark" data-vscode-theme-kind="vscode-dark"'
      );
    }
  }

  return (
    <div style={{ width: '100%', height: '100%', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <iframe
        ref={iframeRef}
        srcDoc={rewrittenHtml}
        sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
        style={{
          width: '100%',
          height: '100%',
          flex: 1,
          minHeight: 0,
          border: 'none',
          backgroundColor: '#1e1e1e',
        }}
        title={title}
      />
    </div>
  );
};

interface WebviewViewPanelProps {
  viewId: string;
  title: string;
  wsRef: React.RefObject<Socket | null>;
}

export const WebviewViewPanel: React.FC<WebviewViewPanelProps> = ({
  viewId,
  title,
  wsRef,
}) => {
  const panelId = `view_${viewId.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const { updateWebviewHtml, getHtml } = useWebviewOverlay();
  const [html, setHtml] = React.useState<string>(() => getHtml(panelId) || '');
  const [error, setError] = React.useState<string | null>(null);
  const [retryKey, setRetryKey] = React.useState(0);

  React.useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;

    setError(null);

    const onSetHtml = (data: { panelId: string; html: string }) => {
      if (data.panelId === panelId) {
        setHtml(data.html);
        updateWebviewHtml(panelId, data.html);
        setError(null);
      }
    };

    ws.on('ext:webview:setHtml', onSetHtml);

    // If we already have HTML in cache/context, don't show loading
    const existingHtml = getHtml(panelId);
    if (existingHtml) {
      setHtml(existingHtml);
    }

    // Timeout if no HTML is set after 12 seconds
    const timeout = setTimeout(() => {
      setHtml((currentHtml) => {
        if (!currentHtml && !getHtml(panelId)) {
          setError(`Timed out waiting for webview "${title || viewId}" to load. Check if the extension is enabled or required services are accessible.`);
        }
        return currentHtml;
      });
    }, 12000);

    // Resolve the webview view provider
    ws.emit('ext:webview_view:resolve', { viewId, panelId }, (res: any) => {
      const isSuccess = res === true || res?.success === true;
      if (isSuccess) {
        if (res?.html) {
          setHtml(res.html);
          updateWebviewHtml(panelId, res.html);
          setError(null);
        }
      } else {
        console.warn(`[webviewView] Failed to resolve view ${viewId}:`, res?.error);
        setError(res?.error || `Failed to resolve view provider for "${title || viewId}"`);
      }
    });

    return () => {
      clearTimeout(timeout);
      ws.off('ext:webview:setHtml', onSetHtml);
    };
  }, [viewId, panelId, wsRef, retryKey, title, updateWebviewHtml, getHtml]);

  return (
    <div style={{ width: '100%', height: '100%', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {html ? (
        <WebviewAnchor panelId={panelId} viewType={viewId} title={title} />
      ) : error ? (
        <div style={{ padding: 16, color: '#f85149', fontSize: 13, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 16 }}>⚠️</span>
            <strong>Failed to load extension view</strong>
          </div>
          <div style={{ color: '#ccc', fontSize: 12, wordBreak: 'break-word', background: '#222', padding: 8, borderRadius: 4 }}>
            {error}
          </div>
          <button
            onClick={() => {
              setError(null);
              setRetryKey((k) => k + 1);
            }}
            style={{
              alignSelf: 'flex-start',
              padding: '6px 12px',
              background: '#238636',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Retry
          </button>
        </div>
      ) : (
        <div style={{ padding: 16, color: '#888', fontSize: 12 }}>
          Loading webview ({title || viewId})...
        </div>
      )}
    </div>
  );
};

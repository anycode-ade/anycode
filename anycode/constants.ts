declare global {
  interface Window {
    __ANYCODE_PORT__?: number;
    __ANYCODE_TOKEN__?: string;
  }
}

const hasWindow = typeof window !== 'undefined';

// Backend connection settings
export const isTauri =
  hasWindow &&
  (window.location.protocol === 'tauri:' ||
    window.location.protocol === 'asset:' ||
    window.location.hostname === 'tauri.localhost' ||
    Boolean(window.__ANYCODE_PORT__) ||
    Boolean((window as any).__TAURI_INTERNALS__) ||
    Boolean((window as any).__TAURI__));

export const BACKEND_URL = (() => {
  if (!hasWindow) {
    return 'http://127.0.0.1:3000';
  }
  if (isTauri) {
    const port = window.__ANYCODE_PORT__ || 3000;
    return `http://127.0.0.1:${port}`;
  }
  // Web Vite dev server (port 5173) connects to backend on port 3000
  if (window.location.port === '5173') {
    return `http://${window.location.hostname || 'localhost'}:3000`;
  }
  // Standard web production: connect back to the origin that served the app
  return window.location.origin;
})();

// File change batching delay in milliseconds
export const BATCH_DELAY_MS = 30;

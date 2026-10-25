declare global {
  interface Window {
    __ANYCODE_PORT__?: number;
    __ANYCODE_TOKEN__?: string;
  }
}

const hasWindow = typeof window !== 'undefined';

// Demo mode (GitHub Pages build or ?demo=true) runs against DemoSocket instead of a backend.
export const IS_DEMO_MODE =
  import.meta.env.MODE === 'demo' ||
  import.meta.env.VITE_DEMO_MODE === 'true' ||
  (hasWindow &&
    (new URLSearchParams(window.location.search).get('demo') === 'true' || window.location.hash.includes('demo')));

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

// Warp jump transition length (ms). Default for the user-adjustable setting.
export const WARP_DURATION_MS = 1000;
export const WARP_DURATION_RANGE = { min: 200, max: 1200, step: 20 } as const;

export const clampWarpDurationMs = (ms: number): number => {
  const { min, max, step } = WARP_DURATION_RANGE;
  const snapped = Math.round(ms / step) * step;
  return Math.min(max, Math.max(min, snapped));
};

// The screen swaps one third of the way through the transition.
export const warpSwapMs = (durationMs: number): number => Math.round(durationMs / 3);

// CSS custom properties read by App.css and SettingsPanel.css.
export const warpCssVars = (durationMs: number): Record<string, string> => ({
  '--warp-duration': `${durationMs}ms`,
  '--warp-swap-duration': `${warpSwapMs(durationMs)}ms`,
  '--warp-in-duration': `${durationMs - warpSwapMs(durationMs)}ms`,
});

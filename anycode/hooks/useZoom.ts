import { useEffect } from 'react';
import { isTauri } from '../constants';

let currentZoomLevel = 1.0;

export const useZoom = () => {
  useEffect(() => {
    if (!isTauri) return;

    // Remove mobile-viewport lock so desktop WebKit scales full layout (pageZoom)
    const metaViewport = document.querySelector('meta[name="viewport"]');
    if (metaViewport) {
      metaViewport.remove();
    }

    const applyZoom = (newZoom: number) => {
      currentZoomLevel = Math.min(3.0, Math.max(0.4, Math.round(newZoom * 100) / 100));
      import('@tauri-apps/api/webview')
        .then(({ getCurrentWebview }) => {
          getCurrentWebview().setZoom(currentZoomLevel).catch(() => {});
        })
        .catch(() => {});
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const isCmdOrCtrl = event.metaKey || event.ctrlKey;
      if (!isCmdOrCtrl) return;

      const code = event.code;
      const key = event.key;

      if (code === 'Equal' || code === 'NumpadAdd' || key === '=' || key === '+') {
        event.preventDefault();
        event.stopPropagation();
        applyZoom(currentZoomLevel + 0.1);
      } else if (code === 'Minus' || code === 'NumpadSubtract' || key === '-') {
        event.preventDefault();
        event.stopPropagation();
        applyZoom(currentZoomLevel - 0.1);
      } else if (code === 'Digit0' || code === 'Numpad0' || key === '0') {
        event.preventDefault();
        event.stopPropagation();
        applyZoom(1.0);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, []);
};

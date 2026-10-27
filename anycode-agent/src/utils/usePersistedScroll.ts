import { useLayoutEffect, useRef } from 'react';
import { defaultStorage, type AcpStorage } from './storage';

const sessionScrollCache = new Map<string, number>();
// Elements currently hidden (display: none). Browsers reset scrollTop to 0 when an element is hidden.
const hiddenElements = new WeakSet<HTMLElement>();

// True while a scroll position change is a browser reset rather than user input, so it must not be saved
// or treated as scrolling up. Covers hidden elements and the frames after a restore on show.
export function isScrollReportSuspended(element: HTMLElement): boolean {
  return hiddenElements.has(element) || element.classList.contains('is-restoring-scroll');
}

export function hasPersistedScroll(
  id: string,
  persist: 'session' | 'local' = 'session',
  storage: AcpStorage = defaultStorage,
): boolean {
  if (persist === 'local') {
    return storage.getItem(`scroll:${id}`) != null;
  }
  return sessionScrollCache.has(id);
}

export function usePersistedScroll<T extends HTMLElement>(
  id: string,
  persist: 'session' | 'local' = 'session',
  deps: any[] = [],
  storage: AcpStorage = defaultStorage,
) {
  const ref = useRef<T | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const restoreScroll = () => {
      let savedScroll: number | null = null;
      if (persist === 'local') {
        const val = storage.getItem(`scroll:${id}`);
        if (val != null) savedScroll = parseInt(val, 10);
      } else {
        const val = sessionScrollCache.get(id);
        if (val !== undefined) savedScroll = val;
      }

      if (savedScroll === null || savedScroll <= 0) return;

      let attempts = 0;
      const maxAttempts = 5;

      const applyScroll = () => {
        if (!element) return;
        if (element.scrollHeight > element.clientHeight) {
          element.classList.add('is-restoring-scroll');
          element.scrollTop = savedScroll!;

          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              element.classList.remove('is-restoring-scroll');
            });
          });
        } else if (attempts < maxAttempts) {
          attempts++;
          requestAnimationFrame(applyScroll);
        }
      };

      requestAnimationFrame(applyScroll);
    };

    restoreScroll();

    const handleScroll = () => {
      if (element.clientHeight === 0 && element.clientWidth === 0) {
        return;
      }

      if (isScrollReportSuspended(element)) {
        return;
      }

      if (persist === 'local') {
        storage.setItem(`scroll:${id}`, element.scrollTop.toString());
      } else {
        sessionScrollCache.set(id, element.scrollTop);
      }
    };

    element.addEventListener('scroll', handleScroll, { passive: true });

    // Dock tabs hide the panel with display: none, which keeps the element mounted. Restore the saved
    // position when it is shown again; reports stay suspended until the reset has passed.
    const visibilityObserver = new ResizeObserver(() => {
      if (element.clientHeight === 0 && element.clientWidth === 0) {
        hiddenElements.add(element);
        return;
      }
      if (!hiddenElements.delete(element)) return;

      element.classList.add('is-restoring-scroll');
      restoreScroll();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          element.classList.remove('is-restoring-scroll');
        });
      });
    });
    visibilityObserver.observe(element);

    return () => {
      visibilityObserver.disconnect();
      element.removeEventListener('scroll', handleScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, persist, storage, ...deps]);

  return ref;
}

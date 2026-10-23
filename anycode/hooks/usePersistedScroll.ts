import { useLayoutEffect, useRef, useContext } from 'react';
import { type DockviewPanelApi } from 'dockview';
import { LayoutPanelApiContext } from '../components/layout/Layout';

const sessionScrollCache = new Map<string, number>();

export function hasPersistedScroll(id: string, persist: 'session' | 'local' = 'session'): boolean {
    if (persist === 'local') {
        return localStorage.getItem(`scroll:${id}`) !== null;
    }
    return sessionScrollCache.has(id);
}

export function usePersistedScroll<T extends HTMLElement>(
    id: string,
    persist: 'session' | 'local' = 'session',
    deps: any[] = [],
) {
    const ref = useRef<T | null>(null);
    const panel = useContext(LayoutPanelApiContext) as DockviewPanelApi | null;

    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) return;

        const restoreScroll = () => {
            let savedScroll: number | null = null;
            if (persist === 'local') {
                const val = localStorage.getItem(`scroll:${id}`);
                if (val !== null) savedScroll = parseInt(val, 10);
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

            applyScroll();
        };

        // Restore scroll on mount/dependency change
        restoreScroll();

        const handleScroll = () => {
            // Ignore scroll events when the element is hidden (browser resets scroll to 0 on display: none)
            if (element.clientHeight === 0 && element.clientWidth === 0) {
                return;
            }

            // Also ignore if Dockview panel is marked as hidden
            if (panel && !panel.isVisible) {
                return;
            }

            // Also ignore while actively restoring scroll
            if (element.classList.contains('is-restoring-scroll')) {
                return;
            }

            if (persist === 'local') {
                localStorage.setItem(`scroll:${id}`, element.scrollTop.toString());
            } else {
                sessionScrollCache.set(id, element.scrollTop);
            }
        };

        element.addEventListener('scroll', handleScroll, { passive: true });

        // Listen to Dockview visibility changes to restore scroll position when tab is activated again
        let visibilityDisposable: { dispose: () => void } | null = null;
        if (panel) {
            visibilityDisposable = panel.onDidVisibilityChange((event: any) => {
                if (event.isVisible) {
                    restoreScroll();
                }
            });
        }

        return () => {
            element.removeEventListener('scroll', handleScroll);
            if (visibilityDisposable) {
                visibilityDisposable.dispose();
            }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, persist, panel, ...deps]);

    return ref;
}

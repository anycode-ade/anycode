import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';

export type TabMenuState = {
    kind: 'file' | 'terminal' | 'agent';
    targetId: string;
    anchor: [number, number];
};

const VIEWPORT_PADDING = 40;

export const useTabContextMenu = () => {
    const menuRef = useRef<HTMLDivElement | null>(null);
    const [tabMenu, setTabMenu] = useState<TabMenuState | null>(null);

    const closeMenu = useCallback(() => setTabMenu(null), []);

    const openMenu = useCallback((
        event: ReactMouseEvent,
        kind: TabMenuState['kind'],
        targetId: string,
    ) => {
        event.preventDefault();
        event.stopPropagation();
        setTabMenu({
            kind,
            targetId,
            anchor: [event.clientX, event.clientY],
        });
    }, []);

    useEffect(() => {
        if (!tabMenu) {
            return undefined;
        }

        const handleClick = (event: MouseEvent) => {
            if (menuRef.current?.contains(event.target as Node)) {
                return;
            }
            closeMenu();
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                closeMenu();
            }
        };

        window.addEventListener('click', handleClick);
        window.addEventListener('scroll', closeMenu, true);
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('click', handleClick);
            window.removeEventListener('scroll', closeMenu, true);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [closeMenu, tabMenu]);

    useLayoutEffect(() => {
        if (!tabMenu || !menuRef.current) {
            return;
        }

        const rect = menuRef.current.getBoundingClientRect();
        const [anchorX, anchorY] = tabMenu.anchor;
        const clampedX = Math.min(Math.max(anchorX, VIEWPORT_PADDING), window.innerWidth - rect.width - VIEWPORT_PADDING);
        const clampedY = Math.min(Math.max(anchorY, VIEWPORT_PADDING), window.innerHeight - rect.height - VIEWPORT_PADDING);
        if (clampedX !== anchorX || clampedY !== anchorY) {
            setTabMenu((prev) => (prev ? { ...prev, anchor: [clampedX, clampedY] } : prev));
        }
    }, [tabMenu]);

    return {
        closeMenu,
        menuRef,
        openMenu,
        tabMenu,
    };
};

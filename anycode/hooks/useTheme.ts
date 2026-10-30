import { useCallback, useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { addCssToDocument, generateCssClasses } from 'anycode-editor';
import { isTauri } from '../constants';

type UseThemeParams = {
    wsRef: React.RefObject<Socket | null>;
    isConnected: boolean;
};

const parseRgb = (color: string): [number, number, number] | null => {
    const trimmed = color.trim().toLowerCase();
    if (trimmed.startsWith('#')) {
        const hex = trimmed.slice(1);
        if (hex.length === 3) {
            return [
                parseInt(hex[0] + hex[0], 16),
                parseInt(hex[1] + hex[1], 16),
                parseInt(hex[2] + hex[2], 16),
            ];
        }
        if (hex.length >= 6) {
            return [
                parseInt(hex.slice(0, 2), 16),
                parseInt(hex.slice(2, 4), 16),
                parseInt(hex.slice(4, 6), 16),
            ];
        }
    }
    const match = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (match) {
        return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
    }
    return null;
};

const toRgba = (color: string, alpha: number): string => {
    const rgb = parseRgb(color);
    return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : color;
};

const getRelativeLuminance = ([r, g, b]: [number, number, number]): number => {
    const [rs, gs, bs] = [r / 255, g / 255, b / 255].map((v) =>
        v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    );
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
};

const isSafari = typeof navigator !== 'undefined' && /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

/**
 * Determines if a dark color is virtually pitch black (e.g. rgb <= 12).
 * Safari tints its toolbar from the page background and adds a light overlay to dark colors,
 * so near-black page backgrounds are mapped to #000000 there to keep the toolbar black.
 */
const isDeepBlack = (color: string): boolean => {
    const rgb = parseRgb(color);
    if (!rgb) return false;
    return getRelativeLuminance(rgb) <= 0.008 || Math.max(...rgb) <= 12;
};

export const useTheme = ({ wsRef, isConnected }: UseThemeParams) => {
    const [currentThemeId, setCurrentThemeId] = useState<string | null>(() => {
        if (typeof window === 'undefined') return null;
        return localStorage.getItem('themeId') || 'anycode.json:anycode';
    });

    const applyBrowserChromeColor = useCallback((color: string, isLight: boolean = false) => {
        const safeColor = color?.trim() || (isLight ? '#ffffff' : '#242424');
        const ensureMeta = (selector: string, attrs: Record<string, string>, contentVal: string) => {
            let meta = document.head.querySelector(selector) as HTMLMetaElement | null;
            if (!meta) {
                meta = document.createElement('meta');
                for (const [key, value] of Object.entries(attrs)) {
                    meta.setAttribute(key, value);
                }
                document.head.appendChild(meta);
            }
            meta.setAttribute('content', contentVal);
        };

        const chromeColor = safeColor;
        const pageColor = !isLight && isSafari && !isTauri && isDeepBlack(safeColor) ? '#000000' : safeColor;

        // Both variants get the app theme color: the media queries follow the OS appearance, not the app theme.
        ensureMeta('meta[name="theme-color"][media="(prefers-color-scheme: dark)"]', { name: 'theme-color', media: '(prefers-color-scheme: dark)' }, chromeColor);
        ensureMeta('meta[name="theme-color"][media="(prefers-color-scheme: light)"]', { name: 'theme-color', media: '(prefers-color-scheme: light)' }, chromeColor);
        ensureMeta('meta[name="theme-color"]:not([media])', { name: 'theme-color' }, chromeColor);
        ensureMeta('meta[name="color-scheme"]', { name: 'color-scheme' }, isLight ? 'light' : 'dark');
        ensureMeta('meta[name="apple-mobile-web-app-status-bar-style"]', { name: 'apple-mobile-web-app-status-bar-style' }, 'default');

        if (isTauri) {
            import('@tauri-apps/api/window')
                .then(({ getCurrentWindow }) => {
                    const win = getCurrentWindow();
                    win.setTheme(isLight ? 'light' : 'dark').catch(() => {});
                    win.setBackgroundColor(safeColor).catch(() => {});
                })
                .catch(() => {});
        }

        if (typeof document !== 'undefined') {
            document.documentElement.style.backgroundColor = pageColor;
            if (document.body) {
                document.body.style.backgroundColor = pageColor;
            }
            const shim = document.getElementById('safari-theme-shim');
            if (shim) {
                shim.style.backgroundColor = pageColor;
            }
        }
    }, []);

    const applyTheme = useCallback((theme: any) => {
        const root = document.documentElement;
        let uiBackground = '#242424';
        let uiForeground = '#f0f0f0';

        if (theme.colors) {
            const getThemeColor = (key: string, fallback: string) => theme.colors[key] || fallback;
            const baseBackground = getThemeColor('background', '#242424');
            const baseForeground = getThemeColor('foreground', '#f0f0f0');
            const baseBorder = getThemeColor('border', '#3f3f3f');
            const tabBackground = getThemeColor('tab.active.background', '#1C1C1C');
            const tabForeground = getThemeColor('tab.foreground', '#848382');

            root.style.setProperty('--theme-background', baseBackground);
            root.style.setProperty('--theme-foreground', baseForeground);
            root.style.setProperty('--theme-border', baseBorder);
            root.style.setProperty('--theme-panel-background', getThemeColor('panel.background', '#282828'));
            root.style.setProperty('--theme-tab-active-background', tabBackground);
            root.style.setProperty('--theme-tab-active-foreground', getThemeColor('tab.active.foreground', '#ebdbb2'));
            root.style.setProperty('--theme-tab-background', getThemeColor('tab.background', '#14141400'));
            root.style.setProperty('--theme-tab-foreground', tabForeground);
            root.style.setProperty('--theme-accent-background', getThemeColor('primary.background', '#458588'));
            root.style.setProperty('--theme-accent-foreground', getThemeColor('primary.foreground', '#ffffff'));
            root.style.setProperty('--theme-muted-foreground', getThemeColor('muted.foreground', '#888888'));

            root.style.setProperty('--item-bg', baseBackground);
            root.style.setProperty('--assistant-message-bg', baseBackground);
            root.style.setProperty('--tool-call-bg', baseBackground);
            root.style.setProperty('--border-color', baseBorder);
            root.style.setProperty('--text-color', baseForeground);
            root.style.setProperty('--text-color-secondary', tabForeground);
            root.style.setProperty('--hover-bg', tabBackground);
            root.style.setProperty('--user-message-bg', getThemeColor('accent.background', tabBackground));
            root.style.setProperty('--user-message-fg', getThemeColor('accent.foreground', baseForeground));

            uiBackground = baseBackground;
            uiForeground = baseForeground;
        }

        if (theme.highlight) {
            const getHighlightColor = (key: string, fallback: string) => theme.highlight[key] || fallback;

            root.style.setProperty('--theme-editor-background', getHighlightColor('editor.background', '#000000'));
            root.style.setProperty('--theme-editor-foreground', getHighlightColor('editor.foreground', '#DDDDDD'));
            root.style.setProperty('--theme-editor-active-line-background', getHighlightColor('editor.active_line.background', '#131313'));
            root.style.setProperty('--theme-editor-line-number', getHighlightColor('editor.line_number', '#8F8F8F'));
            root.style.setProperty('--theme-editor-active-line-number', getHighlightColor('editor.active_line_number', '#DDDDDD'));

            if (!theme.colors) {
                uiBackground = getHighlightColor('editor.background', '#000000');
                uiForeground = getHighlightColor('editor.foreground', '#DDDDDD');
            }

            if (theme.highlight.syntax) {
                const flatSyntax: Record<string, string> = {};
                for (const [key, value] of Object.entries(theme.highlight.syntax)) {
                    if (value && typeof value === 'object' && 'color' in value) {
                        flatSyntax[key] = (value as any).color;
                    }
                }
                const css = generateCssClasses(flatSyntax);
                addCssToDocument(css, 'theme-highlight-styles');
            }
        }

        const isLight = theme.mode === 'light';
        root.setAttribute('data-theme-mode', isLight ? 'light' : 'dark');
        root.style.colorScheme = isLight ? 'light' : 'dark';

        const getThemeColorSafe = (key: string, fallback: string) => (theme.colors && theme.colors[key]) || fallback;
        const getHighlightColorSafe = (key: string, fallback: string) => (theme.highlight && theme.highlight[key]) || fallback;

        const added = getHighlightColorSafe('created', getThemeColorSafe('base.green', isLight ? '#1a8c3d' : '#47c770'));
        const deleted = getHighlightColorSafe('deleted', getThemeColorSafe('base.red', isLight ? '#c72933' : '#eb5261'));
        const modified = getHighlightColorSafe('modified', getThemeColorSafe('base.yellow', isLight ? '#0969da' : '#ffc799'));
        const renamed = getHighlightColorSafe('renamed', getThemeColorSafe('base.blue', isLight ? '#0969da' : '#8ab4f8'));
        const conflict = getHighlightColorSafe('conflict', getThemeColorSafe('base.yellow', isLight ? '#d97706' : '#ff9800'));

        const addedBg = getHighlightColorSafe('created.background', toRgba(added, isLight ? 0.60 : 0.15));
        const deletedBg = getHighlightColorSafe('deleted.background', toRgba(deleted, isLight ? 0.60 : 0.15));
        const addedWordHighlight = toRgba(added, isLight ? 0.52 : 0.48);
        const deletedWordHighlight = toRgba(deleted, isLight ? 0.50 : 0.48);

        root.style.setProperty('--diff-added-gutter', added);
        root.style.setProperty('--diff-added-bg', addedBg);
        root.style.setProperty('--diff-added-word-highlight', addedWordHighlight);
        root.style.setProperty('--diff-deleted-gutter', deleted);
        root.style.setProperty('--diff-deleted-bg', deletedBg);
        root.style.setProperty('--diff-deleted-word-highlight', deletedWordHighlight);

        root.style.setProperty('--theme-git-added', added);
        root.style.setProperty('--theme-git-added-strong', added);
        root.style.setProperty('--theme-git-removed', deleted);
        root.style.setProperty('--theme-git-removed-strong', deleted);
        root.style.setProperty('--theme-git-modified', modified);
        root.style.setProperty('--theme-git-renamed', renamed);
        root.style.setProperty('--theme-git-conflict', conflict);

        root.style.setProperty('--background-color', uiBackground);
        root.style.setProperty('--foreground-color', uiForeground);
        applyBrowserChromeColor(uiBackground, isLight);

        try {
            localStorage.setItem('themeMode', isLight ? 'light' : 'dark');
            localStorage.setItem('themeBackground', uiBackground);
        } catch {
            // Ignore localStorage quota or private browsing errors
        }
    }, [applyBrowserChromeColor]);

    const handleThemeChange = useCallback((themeId: string, fileName: string, themeName: string) => {
        if (!wsRef.current || !isConnected) return;
        wsRef.current.emit('theme:get', { fileName, themeName }, (res: any) => {
            if (res && res.success && res.theme) {
                applyTheme(res.theme);
                setCurrentThemeId(themeId);
                localStorage.setItem('themeId', themeId);
                localStorage.setItem('themeFileName', fileName);
                localStorage.setItem('themeName', themeName);
            }
        });
    }, [wsRef, isConnected, applyTheme]);

    useEffect(() => {
        let storedMode: string | null = null;
        let storedBg: string | null = null;
        try {
            storedMode = localStorage.getItem('themeMode');
            storedBg = localStorage.getItem('themeBackground');
        } catch {
            // Ignore localStorage access errors
        }
        const isLight = storedMode === 'light';
        const fallbackBg = isLight ? '#ffffff' : '#242424';
        applyBrowserChromeColor(storedBg || fallbackBg, isLight);
    }, [applyBrowserChromeColor]);

    useEffect(() => {
        if (!isConnected || !wsRef.current) {
            return;
        }

        const storedThemeId = localStorage.getItem('themeId') || 'anycode.json:anycode';
        const storedThemeFileName = localStorage.getItem('themeFileName') || 'anycode.json';
        const storedThemeName = localStorage.getItem('themeName') || 'anycode';

        wsRef.current.emit('theme:get', {
            fileName: storedThemeFileName,
            themeName: storedThemeName,
        }, (res: any) => {
            if (res && res.success && res.theme) {
                applyTheme(res.theme);
                setCurrentThemeId(storedThemeId);
            }
        });
    }, [isConnected, wsRef, applyTheme]);

    return {
        currentThemeId,
        handleThemeChange,
    };
};

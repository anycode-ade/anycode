import { useCallback, useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { addCssToDocument, generateCssClasses } from '../../anycode-base/src/utils';
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

const getRelativeLuminance = ([r, g, b]: [number, number, number]): number => {
    const [rs, gs, bs] = [r / 255, g / 255, b / 255].map((v) =>
        v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    );
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
};

const isSafari = typeof navigator !== 'undefined' && /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

/**
 * Determines if a dark color is virtually pitch black (e.g. rgb <= 12).
 * For Safari to render deep black toolbar chrome (8, 8, 8) like x.com / GitHub without
 * translucent milky-gray blur artifacts, near-black toolbar chrome is mapped to #000000.
 */
const isDeepBlack = (color: string): boolean => {
    const rgb = parseRgb(color);
    if (!rgb) return false;
    return getRelativeLuminance(rgb) <= 0.008 || Math.max(...rgb) <= 12;
};

export const DEFAULT_THEME_FILE_NAME = 'default-theme.json';
export const DEFAULT_THEME_NAME = 'Vesper Dark';
export const DEFAULT_THEME_ID = `${DEFAULT_THEME_FILE_NAME}:${DEFAULT_THEME_NAME}`;
export const DEFAULT_DARK_BACKGROUND = '#0a0a0a';

const THEME_STORAGE_VERSION = 'v2_vesper';
if (typeof window !== 'undefined') {
    try {
        if (localStorage.getItem('theme_default_version') !== THEME_STORAGE_VERSION) {
            const current = localStorage.getItem('themeId');
            if (!current || current === 'anycode.json:anycode') {
                localStorage.removeItem('themeId');
                localStorage.removeItem('themeFileName');
                localStorage.removeItem('themeName');
                localStorage.removeItem('themeBackground');
            }
            localStorage.setItem('theme_default_version', THEME_STORAGE_VERSION);
        }
    } catch {
        // Ignore localStorage access errors
    }
}

export const useTheme = ({ wsRef, isConnected }: UseThemeParams) => {
    const [currentThemeId, setCurrentThemeId] = useState<string | null>(() => {
        if (typeof window === 'undefined') return null;
        return localStorage.getItem('themeId') || DEFAULT_THEME_ID;
    });

    const applyBrowserChromeColor = useCallback((color: string, isLight: boolean = false) => {
        const safeColor = color?.trim() || (isLight ? '#ffffff' : DEFAULT_DARK_BACKGROUND);
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

        // For Safari toolbar chrome to render deep black without milky-gray blur, map truly near-black colors to #000000 in Safari meta only
        const safariChromeColor = !isLight && isSafari && isDeepBlack(safeColor) ? '#000000' : safeColor;
        const chromeColor = isTauri ? safeColor : safariChromeColor;

        ensureMeta('meta[name="theme-color"][media="(prefers-color-scheme: dark)"]', { name: 'theme-color', media: '(prefers-color-scheme: dark)' }, isLight ? '#ffffff' : chromeColor);
        ensureMeta('meta[name="theme-color"][media="(prefers-color-scheme: light)"]', { name: 'theme-color', media: '(prefers-color-scheme: light)' }, isLight ? safeColor : '#ffffff');
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
            document.documentElement.style.backgroundColor = safeColor;
            if (document.body) {
                document.body.style.backgroundColor = safeColor;
            }
            const shim = document.getElementById('safari-theme-shim');
            if (shim) {
                shim.style.backgroundColor = chromeColor;
            }
        }
    }, []);

    const applyTheme = useCallback((theme: any) => {
        const root = document.documentElement;
        let uiBackground = DEFAULT_DARK_BACKGROUND;
        let uiForeground = '#f0f0f0';

        if (theme.colors) {
            const getThemeColor = (key: string, fallback: string) => theme.colors[key] || fallback;
            const baseBackground = getThemeColor('background', DEFAULT_DARK_BACKGROUND);
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

        const gitModified = getHighlightColorSafe('modified', getThemeColorSafe('base.yellow', isLight ? '#b08800' : '#e5c07b'));
        const gitAdded = getHighlightColorSafe('created', getThemeColorSafe('base.green', isLight ? '#1a8c3d' : '#34a853'));
        const gitDeleted = getHighlightColorSafe('deleted', getThemeColorSafe('base.red', isLight ? '#c72933' : '#ea4335'));
        const gitRenamed = getHighlightColorSafe('renamed', getThemeColorSafe('base.blue', isLight ? '#0969da' : '#8ab4f8'));
        const gitConflict = getHighlightColorSafe('conflict', getThemeColorSafe('base.yellow', isLight ? '#d97706' : '#ff9800'));

        root.style.setProperty('--theme-git-modified', gitModified);
        root.style.setProperty('--theme-git-added-strong', gitAdded);
        root.style.setProperty('--theme-git-removed-strong', gitDeleted);
        root.style.setProperty('--theme-git-renamed', gitRenamed);
        root.style.setProperty('--theme-git-conflict', gitConflict);

        if (isLight) {
            root.style.setProperty('--diff-added-bg', 'rgba(184, 240, 194, 0.62)');
            root.style.setProperty('--diff-added-gutter', '#1a8c3d');
            root.style.setProperty('--diff-added-word-highlight', 'rgba(92, 199, 112, 0.52)');
            root.style.setProperty('--diff-deleted-bg', 'rgba(250, 199, 204, 0.62)');
            root.style.setProperty('--diff-deleted-gutter', '#c72933');
            root.style.setProperty('--diff-deleted-word-highlight', 'rgba(235, 97, 107, 0.50)');
        } else {
            root.style.setProperty('--diff-added-bg', 'rgba(51, 115, 64, 0.28)');
            root.style.setProperty('--diff-added-gutter', '#47c770');
            root.style.setProperty('--diff-added-word-highlight', 'rgba(64, 166, 89, 0.48)');
            root.style.setProperty('--diff-deleted-bg', 'rgba(122, 46, 56, 0.28)');
            root.style.setProperty('--diff-deleted-gutter', '#eb5261');
            root.style.setProperty('--diff-deleted-word-highlight', 'rgba(199, 51, 66, 0.48)');
        }

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
        const fallbackBg = isLight ? '#ffffff' : DEFAULT_DARK_BACKGROUND;
        applyBrowserChromeColor(storedBg || fallbackBg, isLight);
    }, [applyBrowserChromeColor]);

    useEffect(() => {
        if (!isConnected || !wsRef.current) {
            return;
        }

        const storedThemeId = localStorage.getItem('themeId') || DEFAULT_THEME_ID;
        const storedThemeFileName = localStorage.getItem('themeFileName') || DEFAULT_THEME_FILE_NAME;
        const storedThemeName = localStorage.getItem('themeName') || DEFAULT_THEME_NAME;

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

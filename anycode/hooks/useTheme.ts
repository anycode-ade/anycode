import { useCallback, useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { addCssToDocument, generateCssClasses } from '../../anycode-base/src/utils';

type UseThemeParams = {
    wsRef: React.RefObject<Socket | null>;
    isConnected: boolean;
};

export const useTheme = ({ wsRef, isConnected }: UseThemeParams) => {
    const [currentThemeId, setCurrentThemeId] = useState<string | null>(() => {
        if (typeof window === 'undefined') return null;
        return localStorage.getItem('themeId') || 'anycode.json:anycode';
    });

    const applyBrowserChromeColor = useCallback((color: string) => {
        const safeColor = color?.trim() || '#242424';
        const ensureMeta = (selector: string, attrs: Record<string, string>) => {
            let meta = document.head.querySelector(selector) as HTMLMetaElement | null;
            if (!meta) {
                meta = document.createElement('meta');
                for (const [key, value] of Object.entries(attrs)) {
                    meta.setAttribute(key, value);
                }
                document.head.appendChild(meta);
            }
            meta.setAttribute('content', safeColor);
        };

        ensureMeta('meta[name="theme-color"]', { name: 'theme-color' });
        ensureMeta('meta[name="apple-mobile-web-app-status-bar-style"]', { name: 'apple-mobile-web-app-status-bar-style' });
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
            applyBrowserChromeColor(baseBackground);

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

        root.style.setProperty('--background-color', uiBackground);
        root.style.setProperty('--foreground-color', uiForeground);
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

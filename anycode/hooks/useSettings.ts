import { useCallback, useEffect, useRef, useState } from 'react';

export type FontSection = 'interface' | 'editor' | 'terminal';

export const FONT_FAMILIES = {
    'jetbrains-mono': '"JetBrains Mono", monospace',
    'sf-pro': '"SF Pro", "SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif',
    'sf-mono': '"SF Mono", "SFMono-Regular", Menlo, Monaco, monospace',
    'system-ui': 'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
} as const;

export type FontId = keyof typeof FONT_FAMILIES;
export type FontFamilyId = FontId | 'custom';

export interface FontConfig {
    family: FontFamilyId;
    customFamily: string;
    size: number;
    weight: number;
    lineHeight: number;
}

export type FontSettings = Record<FontSection, FontConfig>;

const DEFAULT_FONT_SETTINGS: FontSettings = {
    interface: { family: 'jetbrains-mono', customFamily: '', size: 14, weight: 700, lineHeight: 1.4 },
    editor: { family: 'jetbrains-mono', customFamily: '', size: 14, weight: 700, lineHeight: 1.43 },
    terminal: { family: 'jetbrains-mono', customFamily: '', size: 14, weight: 700, lineHeight: 1.2 },
};

export const resolveFontFamily = (config: FontConfig): string => {
    if (config.family === 'custom') {
        return config.customFamily.trim() || FONT_FAMILIES['jetbrains-mono'];
    }
    return FONT_FAMILIES[config.family];
};

const normalizeConfig = (section: FontSection, value?: Partial<FontConfig>): FontConfig => {
    const fallback = DEFAULT_FONT_SETTINGS[section];
    let family: FontFamilyId = value?.family === 'custom'
        || (value?.family && value.family in FONT_FAMILIES)
        ? value.family
        : fallback.family;
    if (section !== 'interface' && (
        family === 'sf-pro' || family === 'system-ui'
    )) {
        family = 'sf-mono';
    }
    return {
        family,
        customFamily: typeof value?.customFamily === 'string'
            ? value.customFamily.slice(0, 500)
            : fallback.customFamily,
        size: Math.min(24, Math.max(10, Number(value?.size) || fallback.size)),
        weight: [100, 200, 300, 400, 500, 600, 700, 800].includes(Number(value?.weight))
            ? Number(value?.weight)
            : fallback.weight,
        lineHeight: Math.min(2, Math.max(1, Number(value?.lineHeight) || fallback.lineHeight)),
    };
};

const loadFontSettings = (): FontSettings => {
    try {
        const saved = JSON.parse(localStorage.getItem('fontSettings') || '{}') as Partial<FontSettings>;
        const legacyFamily = (section: FontSection): FontId | undefined => {
            const value = localStorage.getItem(`font:${section}`);
            return value && value in FONT_FAMILIES ? value as FontId : undefined;
        };
        return {
            interface: normalizeConfig('interface', {
                family: legacyFamily('interface'),
                ...saved.interface,
            }),
            editor: normalizeConfig('editor', {
                family: legacyFamily('editor'),
                ...saved.editor,
            }),
            terminal: normalizeConfig('terminal', {
                family: legacyFamily('terminal'),
                ...saved.terminal,
            }),
        };
    } catch {
        return DEFAULT_FONT_SETTINGS;
    }
};

export type ScrollbarStyle = 'rounded' | 'flat';

export interface ScrollbarSettingsState {
    style: ScrollbarStyle;
    width: number;
    minSize: number;
    alwaysShow: boolean;
}

const DEFAULT_SCROLLBAR_SETTINGS: ScrollbarSettingsState = {
    style: 'rounded',
    width: 8,
    minSize: 20,
    alwaysShow: false,
};

const loadScrollbarSettings = (): ScrollbarSettingsState => {
    try {
        const saved = JSON.parse(localStorage.getItem('scrollbarSettings') || '{}');
        return {
            style: saved.style === 'flat' || saved.style === 'windows' ? 'flat' : 'rounded',
            width: typeof saved.width === 'number' ? Math.max(2, Math.min(12, saved.width)) : 8,
            minSize: typeof saved.minSize === 'number' ? Math.max(10, Math.min(100, saved.minSize)) : 20,
            alwaysShow: saved.alwaysShow === true,
        };
    } catch {
        return DEFAULT_SCROLLBAR_SETTINGS;
    }
};

export const useSettings = () => {
    const [fontSettings, setFontSettings] = useState<FontSettings>(loadFontSettings);
    const [scrollbarSettings, setScrollbarSettings] = useState<ScrollbarSettingsState>(loadScrollbarSettings);
    const previousScrollbarSettingsRef = useRef<ScrollbarSettingsState | null>(null);
    const scrollbarPreviewTimerRef = useRef<number | null>(null);

    useEffect(() => {
        const root = document.documentElement;
        (Object.keys(fontSettings) as FontSection[]).forEach((section) => {
            const config = fontSettings[section];
            root.style.setProperty(`--${section}-font-family`, resolveFontFamily(config));
            root.style.setProperty(`--${section}-font-size`, `${config.size}px`);
            root.style.setProperty(`--${section}-font-weight`, String(config.weight));
            root.style.setProperty(`--${section}-line-height`, String(config.lineHeight));
        });
        window.dispatchEvent(new CustomEvent('anycode:editor-font-settings', {
            detail: fontSettings.editor,
        }));
        localStorage.setItem('fontSettings', JSON.stringify(fontSettings));
    }, [fontSettings]);

    useEffect(() => {
        const root = document.documentElement;
        const previous = previousScrollbarSettingsRef.current;
        const settingsChanged = previous !== null && (
            previous.style !== scrollbarSettings.style
            || previous.width !== scrollbarSettings.width
            || previous.minSize !== scrollbarSettings.minSize
            || previous.alwaysShow !== scrollbarSettings.alwaysShow
        );
        previousScrollbarSettingsRef.current = scrollbarSettings;

        root.dataset.scrollbarStyle = scrollbarSettings.style;
        root.dataset.scrollbarAlwaysShow = scrollbarSettings.alwaysShow ? 'true' : 'false';
        root.style.setProperty('--smr-custom-width', `${scrollbarSettings.width}px`);
        root.style.setProperty('--smr-min-size', `${scrollbarSettings.minSize}px`);
        localStorage.setItem('scrollbarSettings', JSON.stringify(scrollbarSettings));

        if (scrollbarPreviewTimerRef.current !== null) {
            window.clearTimeout(scrollbarPreviewTimerRef.current);
            scrollbarPreviewTimerRef.current = null;
        }

        if (!settingsChanged || scrollbarSettings.alwaysShow) {
            delete root.dataset.scrollbarPreview;
            return;
        }

        root.dataset.scrollbarPreview = 'true';
        scrollbarPreviewTimerRef.current = window.setTimeout(() => {
            delete root.dataset.scrollbarPreview;
            scrollbarPreviewTimerRef.current = null;
        }, 1500);

        return () => {
            if (scrollbarPreviewTimerRef.current !== null) {
                window.clearTimeout(scrollbarPreviewTimerRef.current);
                scrollbarPreviewTimerRef.current = null;
            }
            delete root.dataset.scrollbarPreview;
        };
    }, [scrollbarSettings]);

    const updateFontSettings = useCallback((
        section: FontSection,
        patch: Partial<FontConfig>,
    ) => {
        setFontSettings((current) => ({
            ...current,
            [section]: normalizeConfig(section, { ...current[section], ...patch }),
        }));
    }, []);

    const updateScrollbarSettings = useCallback((patch: Partial<ScrollbarSettingsState>) => {
        setScrollbarSettings((current) => ({
            ...current,
            ...patch,
        }));
    }, []);

    return { fontSettings, updateFontSettings, scrollbarSettings, updateScrollbarSettings };
};

import { useCallback, useEffect, useState } from 'react';

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

export const useSettings = () => {
    const [fontSettings, setFontSettings] = useState<FontSettings>(loadFontSettings);

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

    const updateFontSettings = useCallback((
        section: FontSection,
        patch: Partial<FontConfig>,
    ) => {
        setFontSettings((current) => ({
            ...current,
            [section]: normalizeConfig(section, { ...current[section], ...patch }),
        }));
    }, []);

    return { fontSettings, updateFontSettings };
};

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { usePersistedScroll } from '../hooks/usePersistedScroll';
import { FileIcon } from './FileIcon';
import {
    FONT_FAMILIES,
    type FontConfig,
    type FontId,
    type FontSection,
    type FontSettings,
} from '../hooks/useSettings';
import './SettingsPanel.css';

export interface ThemeItem {
    id: string;
    name: string;
    fileName: string;
    themeName: string;
}

interface SettingsPanelProps {
    wsRef: React.MutableRefObject<any>;
    isConnected: boolean;
    currentThemeId: string | null;
    onThemeChange: (themeId: string, fileName: string, themeName: string) => void;
    fileIconsStyle?: 'colored' | 'monochrome' | 'disabled';
    onFileIconsStyleChange?: (style: 'colored' | 'monochrome' | 'disabled') => void;
    fileIconsOpacity?: number;
    onFileIconsOpacityChange?: (opacity: number) => void;
    fontSettings: FontSettings;
    onFontSettingsChange: (section: FontSection, patch: Partial<FontConfig>) => void;
}

type FontOption = { id: FontId; name: string };

const INTERFACE_FONT_OPTIONS: FontOption[] = [
    { id: 'jetbrains-mono', name: 'JetBrains Mono' },
    { id: 'sf-pro', name: 'SF Pro' },
    { id: 'sf-mono', name: 'SF Mono' },
    { id: 'system-ui', name: 'System UI' },
];

const MONOSPACE_FONT_OPTIONS: FontOption[] = [
    { id: 'jetbrains-mono', name: 'JetBrains Mono' },
    { id: 'sf-mono', name: 'SF Mono' },
];

const FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 24];
const FONT_WEIGHTS = [
    { value: 100, name: 'Thin' },
    { value: 200, name: 'ExtraLight' },
    { value: 300, name: 'Light' },
    { value: 400, name: 'Regular' },
    { value: 500, name: 'Medium' },
    { value: 600, name: 'Semibold' },
    { value: 700, name: 'Bold' },
    { value: 800, name: 'ExtraBold' },
];
const LINE_HEIGHTS = [1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 2];

const FontSetting = ({
    label,
    description,
    config,
    onChange,
    options,
}: {
    label: string;
    description: string;
    config: FontConfig;
    onChange: (patch: Partial<FontConfig>) => void;
    options: FontOption[];
}) => (
    <div className="font-setting">
        <div className="settings-option-info">
            <span className="settings-option-label">{label}</span>
            <span className="settings-option-desc">{description}</span>
        </div>
        <div className="themes-grid font-options-grid">
            {options.map((font) => (
                <button
                    key={font.id}
                    className={`settings-card font-card ${config.family === font.id ? 'active' : ''}`}
                    onClick={() => onChange({ family: font.id })}
                    type="button"
                    style={{ fontFamily: FONT_FAMILIES[font.id] }}
                >
                    <div className="settings-card-header">
                        <span className="settings-card-name">{font.name}</span>
                        {config.family === font.id && (
                            <span className="settings-card-badge dark">Active</span>
                        )}
                    </div>
                    <div className="font-card-preview">Aa 0123 {'{ }'}</div>
                </button>
            ))}
            <div
                className={`settings-card font-card font-custom-card ${
                    config.family === 'custom' ? 'active' : ''
                }`}
                onClick={() => onChange({ family: 'custom' })}
            >
                <div className="settings-card-header">
                    <span className="settings-card-name">Custom</span>
                    {config.family === 'custom' && (
                        <span className="settings-card-badge dark">Active</span>
                    )}
                </div>
                <input
                    className="font-custom-input"
                    type="text"
                    value={config.customFamily}
                    placeholder={'"Fira Code", monospace'}
                    onChange={(event) => onChange({
                        family: 'custom',
                        customFamily: event.target.value,
                    })}
                    onFocus={() => onChange({ family: 'custom' })}
                    onClick={(event) => event.stopPropagation()}
                    spellCheck={false}
                    aria-label={`${label} custom CSS font-family`}
                />
            </div>
        </div>
        <div className="font-choice-group">
            <span className="font-choice-label">Size</span>
            <div className="font-choice-row">
                {FONT_SIZES.map((size) => (
                    <button
                        key={size}
                        className={`settings-card font-choice-card ${config.size === size ? 'active' : ''}`}
                        onClick={() => onChange({ size })}
                        type="button"
                    >
                        <span className="font-choice-value">{size}px</span>
                    </button>
                ))}
            </div>
        </div>
        <div className="font-choice-group">
            <span className="font-choice-label">Weight</span>
            <div className="font-choice-row">
                {FONT_WEIGHTS.map((weight) => (
                    <button
                        key={weight.value}
                        className={`settings-card font-choice-card font-weight-card ${
                            config.weight === weight.value ? 'active' : ''
                        }`}
                        onClick={() => onChange({ weight: weight.value })}
                        type="button"
                        style={{ fontWeight: weight.value }}
                    >
                        <span className="font-choice-value">{weight.name}</span>
                    </button>
                ))}
            </div>
        </div>
        <div className="font-choice-group">
            <span className="font-choice-label">Line height</span>
            <div className="font-choice-row">
                {LINE_HEIGHTS.map((lineHeight) => (
                    <button
                        key={lineHeight}
                        className={`settings-card font-choice-card ${
                            config.lineHeight === lineHeight ? 'active' : ''
                        }`}
                        onClick={() => onChange({ lineHeight })}
                        type="button"
                    >
                        <span className="font-choice-value">{lineHeight.toFixed(1)}</span>
                    </button>
                ))}
            </div>
        </div>
    </div>
);

interface ThemeCardProps {
    theme: ThemeItem;
    isActive: boolean;
    onSelectTheme: (theme: ThemeItem) => void;
}

const ThemeCard = React.memo(({ theme, isActive, onSelectTheme }: ThemeCardProps) => {
    const isDark = theme.name.toLowerCase().includes('dark');

    return (
        <button
            className={`settings-card ${isActive ? 'active' : ''}`}
            onClick={() => onSelectTheme(theme)}
            type="button"
        >
            <div className="settings-card-header">
                <span className="settings-card-name">{theme.themeName}</span>
                <span className={`settings-card-badge ${isDark ? 'dark' : 'light'}`}>
                    {isDark ? 'Dark' : 'Light'}
                </span>
            </div>
            <div className="settings-card-file">{theme.fileName}</div>
        </button>
    );
});
ThemeCard.displayName = 'ThemeCard';

interface FileIconsStyleCardProps {
    styleId: 'colored' | 'monochrome' | 'disabled';
    name: string;
    description: string;
    badge: string;
    isActive: boolean;
    onSelect: (style: 'colored' | 'monochrome' | 'disabled') => void;
}

const FileIconsStyleCard = React.memo(({
    styleId,
    name,
    description,
    badge,
    isActive,
    onSelect,
}: FileIconsStyleCardProps) => {
    return (
        <button
            className={`settings-card icon-style-card ${isActive ? 'active' : ''}`}
            onClick={() => onSelect(styleId)}
            type="button"
        >
            <div className="icon-style-card-content">
                <div className="settings-card-header">
                    <span className="settings-card-name">{name}</span>
                    <span className={`settings-card-badge ${isActive ? 'dark' : 'light'} icon-style-badge`}>
                        {badge}
                    </span>
                </div>
                <div className="settings-card-file icon-style-desc">
                    {description}
                </div>
            </div>
            {styleId !== 'disabled' ? (
                <div className="icon-style-preview">
                    <FileIcon path="App.tsx" styleType={styleId} />
                    <FileIcon path="package.json" styleType={styleId} />
                    <FileIcon path="src" isDirectory={true} isExpanded={false} styleType={styleId} />
                </div>
            ) : (
                <div className="icon-style-empty">
                    No icons
                </div>
            )}
        </button>
    );
});
FileIconsStyleCard.displayName = 'FileIconsStyleCard';

const SettingsPanelComponent: React.FC<SettingsPanelProps> = ({
    wsRef,
    isConnected,
    currentThemeId,
    onThemeChange,
    fileIconsStyle = 'colored',
    onFileIconsStyleChange,
    fileIconsOpacity = 0.85,
    onFileIconsOpacityChange,
    fontSettings,
    onFontSettingsChange,
}) => {
    const [themes, setThemes] = useState<ThemeItem[]>([]);
    const scrollRef = usePersistedScroll<HTMLDivElement>('settings-panel', 'session', [themes]);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (!isConnected || !wsRef.current) return;

        setIsLoading(true);
        wsRef.current.emit('theme:list', (response: ThemeItem[]) => {
            setThemes(response || []);
            setIsLoading(false);
        });
    }, [isConnected, wsRef]);

    const handleSelectTheme = useCallback((theme: ThemeItem) => {
        onThemeChange(theme.id, theme.fileName, theme.themeName);
    }, [onThemeChange]);

    const themeCards = useMemo(() => {
        return themes.map((theme) => (
            <ThemeCard
                key={theme.id}
                theme={theme}
                isActive={currentThemeId === theme.id}
                onSelectTheme={handleSelectTheme}
            />
        ));
    }, [currentThemeId, handleSelectTheme, themes]);

    return (
        <div ref={scrollRef} className="settings-panel">
            <div className="settings-section">
                <h3 className="settings-section-title">Font</h3>
                <div className="font-settings">
                    <FontSetting
                        label="Interface"
                        description="Panels, menus, tabs, and settings."
                        config={fontSettings.interface}
                        onChange={(patch) => onFontSettingsChange('interface', patch)}
                        options={INTERFACE_FONT_OPTIONS}
                    />
                    <FontSetting
                        label="Editor"
                        description="Source code in editor panes."
                        config={fontSettings.editor}
                        onChange={(patch) => onFontSettingsChange('editor', patch)}
                        options={MONOSPACE_FONT_OPTIONS}
                    />
                    <FontSetting
                        label="Terminal"
                        description="Text rendered by the terminal."
                        config={fontSettings.terminal}
                        onChange={(patch) => onFontSettingsChange('terminal', patch)}
                        options={MONOSPACE_FONT_OPTIONS}
                    />
                </div>
            </div>

            <div className="settings-section">
                <h3 className="settings-section-title">Appearance & Themes</h3>
                {isLoading ? (
                    <div className="settings-loading">Loading themes...</div>
                ) : themes.length === 0 ? (
                    <div className="settings-empty">No themes found in ~/dev/anyagent/themes</div>
                ) : (
                    <div className="themes-grid">
                        {themeCards}
                    </div>
                )}
            </div>

            <div className="settings-section">
                <h3 className="settings-section-title">File Icons Style</h3>
                <div className="themes-grid">
                    <FileIconsStyleCard
                        styleId="colored"
                        name="Colored"
                        badge="Default"
                        description="Vibrant colors for easy identification."
                        isActive={fileIconsStyle === 'colored'}
                        onSelect={onFileIconsStyleChange || (() => {})}
                    />
                    <FileIconsStyleCard
                        styleId="monochrome"
                        name="Monochrome"
                        badge="Muted"
                        description="Muted icons inheriting the text color."
                        isActive={fileIconsStyle === 'monochrome'}
                        onSelect={onFileIconsStyleChange || (() => {})}
                    />
                    <FileIconsStyleCard
                        styleId="disabled"
                        name="Disabled"
                        badge="Clean"
                        description="Hide all file explorer and tab icons."
                        isActive={fileIconsStyle === 'disabled'}
                        onSelect={onFileIconsStyleChange || (() => {})}
                    />
                </div>
            </div>

            {fileIconsStyle !== 'disabled' && (
                <div className="settings-section">
                    <h3 className="settings-section-title">File Icons Opacity</h3>
                    <div className="settings-slider-container">
                        <input
                            type="range"
                            min="0.01"
                            max="1.0"
                            step="0.01"
                            value={fileIconsOpacity}
                            onChange={(e) => onFileIconsOpacityChange?.(parseFloat(e.target.value))}
                            className="settings-slider"
                            id="file-icons-opacity-slider"
                        />
                        <span className="settings-slider-value">
                            {Math.round(fileIconsOpacity * 100)}%
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
};

export const SettingsPanel = React.memo(SettingsPanelComponent);

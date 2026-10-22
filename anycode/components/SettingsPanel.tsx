import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { usePersistedScroll } from '../hooks/usePersistedScroll';
import { FileIcon } from './FileIcon';
import {
    FONT_FAMILIES,
    type FontConfig,
    type FontId,
    type FontSection,
    type FontSettings,
    type ScrollbarSettingsState,
    type ScrollbarStyle,
    type DynamicBackgroundSettings,
    type BackgroundPhysicsMode,
    type BackgroundPulsationMode,
    type BackgroundScope,
    type GridPattern,
} from '../hooks/useSettings';
import './SettingsPanel.css';
import { WARP_DURATION_MS, WARP_DURATION_RANGE } from '../constants';
import { announceWarp } from '../utils';

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
    scrollbarSettings?: ScrollbarSettingsState;
    onScrollbarSettingsChange?: (patch: Partial<ScrollbarSettingsState>) => void;
    backgroundSettings?: DynamicBackgroundSettings;
    onBackgroundSettingsChange?: (patch: Partial<DynamicBackgroundSettings>) => void;
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

const BACKGROUND_PHYSICS_OPTIONS: { id: BackgroundPhysicsMode; name: string; badge: string; desc: string }[] = [
    { id: 'none', name: 'Off', badge: 'Static', desc: 'No cursor displacement' },
    { id: 'blackhole', name: 'Black Hole', badge: '🕳️ Gravity', desc: 'Pulls dots toward cursor' },
    { id: 'lens', name: 'Lens', badge: '🔍 Magnify', desc: 'Magnifies & pushes dots' },
    { id: 'invert', name: 'Invert', badge: '📉 Shrink', desc: 'Shrinks dots near cursor' },
    { id: 'repel', name: 'Magnet', badge: '🧲 Push', desc: 'Pushes dots away from cursor' },
    { id: 'vortex', name: 'Vortex', badge: '🌀 Swirl', desc: 'Spirals dots around cursor' },
];

const BACKGROUND_PULSATION_OPTIONS: { id: BackgroundPulsationMode; name: string; badge: string; desc: string }[] = [
    { id: 'none', name: 'Static', badge: 'Off', desc: 'Quiet background' },
    { id: 'breathe', name: 'Breathe', badge: '🫀 Calm', desc: 'Smooth breathing sine pulse' },
    { id: 'radial', name: 'Wave', badge: '🌊 Ripple', desc: 'Expanding radial wave ring' },
    { id: 'radar', name: 'Radar', badge: '🧭 Sweep', desc: 'Rotating radar beam sweep' },
    { id: 'twinkle', name: 'Twinkle', badge: '✨ Stars', desc: 'Organic twinkling starfield' },
    { id: 'shockwave', name: 'Shockwave', badge: '⚡ Click', desc: 'Expanding shockwave ripples' },
];

const BACKGROUND_SCOPE_OPTIONS: { id: BackgroundScope; name: string; badge: string; desc: string }[] = [
    { id: 'all', name: 'Global', badge: 'Everywhere', desc: 'Active across all panes & background' },
    { id: 'welcome', name: 'Welcome Screen', badge: 'Isolated', desc: 'Only on empty workspace welcome screen' },
];

const BACKGROUND_GEOMETRY_OPTIONS: { id: GridPattern; name: string; badge: string; desc: string }[] = [
    { id: 'matrix', name: 'Matrix (Square)', badge: 'Orthogonal', desc: 'Clean square coordinate grid layout' },
    { id: 'isometric', name: 'Honeycomb (Hex)', badge: 'Isometric', desc: 'Staggered triangular lattice mesh' },
];

const BACKGROUND_DENSITY_PRESETS = [
    { name: 'Cyber Mesh', badge: '10px', spacing: 10, scale: 0.75, pattern: 'matrix' as GridPattern, opacity: 1.15, desc: 'Ultra-dense cybernetic dot matrix' },
    { name: 'Fine Tech', badge: '14px', spacing: 14, scale: 0.9, pattern: 'matrix' as GridPattern, opacity: 1.0, desc: 'High-density crisp developer grid' },
    { name: 'Balanced', badge: '18px', spacing: 18, scale: 1.0, pattern: 'matrix' as GridPattern, opacity: 1.0, desc: 'Classic default, clean & comfortable' },
    { name: 'Hex Hive', badge: '20px', spacing: 20, scale: 1.1, pattern: 'isometric' as GridPattern, opacity: 1.05, desc: 'Staggered honeycomb futuristic lattice' },
    { name: 'Linear App', badge: '24px', spacing: 24, scale: 1.15, pattern: 'matrix' as GridPattern, opacity: 0.95, desc: 'Modern Linear & Raycast spacing' },
    { name: 'Spacious', badge: '32px', spacing: 32, scale: 1.35, pattern: 'isometric' as GridPattern, opacity: 0.9, desc: 'Architectural airy lattice' },
    { name: 'Cosmic Sparse', badge: '44px', spacing: 44, scale: 1.6, pattern: 'matrix' as GridPattern, opacity: 0.85, desc: 'Deep space wide constellation field' },
];


const SPOTLIGHT_PRESETS = [
    { name: '🔦 Deep Torch', badge: 'Torch', ambient: 0.01, peak: 0.95, radius: 200, desc: 'Near total darkness outside beam' },
    { name: '🎬 Cinema Beam', badge: 'Cinema', ambient: 0.04, peak: 0.85, radius: 260, desc: 'Balanced cinematic contrast' },
    { name: '🌌 Soft Reveal', badge: 'Reveal', ambient: 0.08, peak: 0.75, radius: 320, desc: 'Gentle radial illumination' },
    { name: '💡 Broad Stage', badge: 'Stage', ambient: 0.12, peak: 0.90, radius: 420, desc: 'Wide dramatic spotlight' },
];

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

const SCROLLBAR_WIDTH_OPTIONS = [4, 6, 8, 10, 12];
const SCROLLBAR_MIN_SIZE_OPTIONS = [15, 20, 28, 36, 48];

interface ScrollbarStyleCardProps {
    styleId: ScrollbarStyle;
    name: string;
    description: string;
    badge: string;
    isActive: boolean;
    onSelect: (style: ScrollbarStyle) => void;
}

const ScrollbarStyleCard = React.memo(({
    styleId,
    name,
    description,
    badge,
    isActive,
    onSelect,
}: ScrollbarStyleCardProps) => {
    return (
        <button
            className={`settings-card scrollbar-style-card ${isActive ? 'active' : ''}`}
            onClick={() => onSelect(styleId)}
            type="button"
        >
            <div className="scrollbar-style-card-content">
                <div className="settings-card-header">
                    <span className="settings-card-name">{name}</span>
                    <span className={`settings-card-badge ${isActive ? 'dark' : 'light'}`}>
                        {badge}
                    </span>
                </div>
                <div className="settings-card-file icon-style-desc">
                    {description}
                </div>
            </div>
            <div className="scrollbar-style-preview-track">
                <div className={`scrollbar-style-preview-thumb preview-${styleId}`} />
            </div>
        </button>
    );
});
ScrollbarStyleCard.displayName = 'ScrollbarStyleCard';



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
    scrollbarSettings,
    onScrollbarSettingsChange,
    backgroundSettings,
    onBackgroundSettingsChange,
}) => {
    const [themes, setThemes] = useState<ThemeItem[]>([]);
    const scrollRef = usePersistedScroll<HTMLDivElement>('settings-panel', 'session', [themes]);
    const [isLoading, setIsLoading] = useState(false);

    const warpDurationMs = backgroundSettings?.warpDurationMs ?? WARP_DURATION_MS;

    const [isWarping, setIsWarping] = useState<boolean>(() => {
        if (typeof window === 'undefined') return false;
        const isWarpingGlobal = Boolean((window as any).__ANYCODE_IS_WARPING__);
        const warpStart = (window as any).__ANYCODE_WARP_TIMESTAMP__ || 0;
        return isWarpingGlobal || (Date.now() - warpStart < warpDurationMs);
    });

    useEffect(() => {
        const handleWarp = () => {
            setIsWarping(true);
        };
        window.addEventListener('anycode:warp-speed', handleWarp);
        return () => window.removeEventListener('anycode:warp-speed', handleWarp);
    }, []);

    useEffect(() => {
        if (!isWarping) return;
        const elapsed = Date.now() - ((window as any).__ANYCODE_WARP_TIMESTAMP__ || Date.now());
        const remaining = Math.max(0, warpDurationMs - elapsed);
        const timer = setTimeout(() => {
            setIsWarping(false);
        }, remaining);
        return () => clearTimeout(timer);
    }, [isWarping, warpDurationMs]);

    const playWarpPreview = useCallback(() => {
        announceWarp();
        window.setTimeout(() => {
            (window as any).__ANYCODE_IS_WARPING__ = false;
        }, warpDurationMs);
    }, [warpDurationMs]);

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
        return themes.map((theme, idx) => (
            <ThemeCard
                key={theme.id || `${theme.fileName || 'theme'}-${idx}`}
                theme={theme}
                isActive={currentThemeId === theme.id}
                onSelectTheme={handleSelectTheme}
            />
        ));
    }, [currentThemeId, handleSelectTheme, themes]);

    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        const target = (e.target as HTMLElement).closest('.settings-card') as HTMLElement;
        if (target) {
            const rect = target.getBoundingClientRect();
            target.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
            target.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
        }
    }, []);

    return (
        <div ref={scrollRef} className={`settings-panel ${isWarping ? 'warping-in' : ''}`} onMouseMove={handleMouseMove}>
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

            {scrollbarSettings && onScrollbarSettingsChange && (
                <div className="settings-section">
                    <h3 className="settings-section-title">Scrollbar</h3>
                    <div className="themes-grid">
                        <ScrollbarStyleCard
                            styleId="rounded"
                            name="Rounded"
                            badge="Rounded"
                            description="Classic smooth rounded pill scrollbar thumb."
                            isActive={scrollbarSettings.style === 'rounded'}
                            onSelect={(style) => onScrollbarSettingsChange({ style })}
                        />
                        <ScrollbarStyleCard
                            styleId="flat"
                            name="Flat"
                            badge="Flat"
                            description="Clean flat rectangular scrollbar thumb with sharp corners."
                            isActive={scrollbarSettings.style === 'flat'}
                            onSelect={(style) => onScrollbarSettingsChange({ style })}
                        />
                    </div>

                    <div className="settings-option">
                        <div className="settings-option-info">
                            <span className="settings-option-label">Always show</span>
                            <span className="settings-option-desc">
                                Keep the scrollbar thumb visible instead of fading it after scrolling.
                            </span>
                        </div>
                        <button
                            type="button"
                            className={`settings-toggle-switch ${scrollbarSettings.alwaysShow ? 'active' : ''}`}
                            aria-label="Always show scrollbar"
                            aria-pressed={scrollbarSettings.alwaysShow}
                            onClick={() => onScrollbarSettingsChange({ alwaysShow: !scrollbarSettings.alwaysShow })}
                        >
                            <span className="settings-toggle-knob" />
                        </button>
                    </div>

                    <div className="font-choice-group" style={{ marginTop: '8px' }}>
                        <span className="font-choice-label">Scrollbar Width</span>
                        <div className="font-choice-row">
                            {SCROLLBAR_WIDTH_OPTIONS.map((w) => (
                                <button
                                    key={w}
                                    className={`settings-card font-choice-card ${scrollbarSettings.width === w ? 'active' : ''}`}
                                    onClick={() => onScrollbarSettingsChange({ width: w })}
                                    type="button"
                                >
                                    <span className="font-choice-value">{w}px {w === 8 ? '(Default)' : ''}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="font-choice-group" style={{ marginTop: '4px' }}>
                        <span className="font-choice-label">Min Height</span>
                        <div className="font-choice-row">
                            {SCROLLBAR_MIN_SIZE_OPTIONS.map((size) => (
                                <button
                                    key={size}
                                    className={`settings-card font-choice-card ${scrollbarSettings.minSize === size ? 'active' : ''}`}
                                    onClick={() => onScrollbarSettingsChange({ minSize: size })}
                                    type="button"
                                >
                                    <span className="font-choice-value">{size}px {size === 20 ? '(Default)' : size === 28 ? '(Touch)' : ''}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {backgroundSettings && onBackgroundSettingsChange && (
                <div className="settings-section">
                    <h3 className="settings-section-title">Dynamic Background & FX</h3>

                    {/* Master Switch */}
                    <div className="settings-option">
                        <div className="settings-option-info">
                            <span className="settings-option-label">Enable Dynamic Background</span>
                            <span className="settings-option-desc">
                                Interactive 60 FPS particle grid with physics, waves, and special effects.
                            </span>
                        </div>
                        <button
                            type="button"
                            className={`settings-toggle-switch ${backgroundSettings.enabled ? 'active' : ''}`}
                            aria-label="Toggle dynamic background"
                            aria-pressed={backgroundSettings.enabled}
                            onClick={() => onBackgroundSettingsChange({ enabled: !backgroundSettings.enabled })}
                        >
                            <span className="settings-toggle-knob" />
                        </button>
                    </div>

                    {/* Warp Jump */}
                    <div className="settings-option">
                        <div className="settings-option-info">
                            <span className="settings-option-label">Warp Jump</span>
                            <span className="settings-option-desc">
                                Hyperspace transition when switching projects.
                            </span>
                        </div>
                        <button
                            type="button"
                            className={`settings-toggle-switch ${backgroundSettings.warpJump ? 'active' : ''}`}
                            aria-label="Toggle warp jump"
                            aria-pressed={backgroundSettings.warpJump}
                            onClick={() => onBackgroundSettingsChange({ warpJump: !backgroundSettings.warpJump })}
                        >
                            <span className="settings-toggle-knob" />
                        </button>
                    </div>

                    <div className="font-choice-group">
                        <span className="font-choice-label">Warp Duration</span>
                        <div className="settings-slider-container">
                            <input
                                type="range"
                                min={WARP_DURATION_RANGE.min}
                                max={WARP_DURATION_RANGE.max}
                                step={WARP_DURATION_RANGE.step}
                                value={warpDurationMs}
                                onChange={(e) => onBackgroundSettingsChange({ warpDurationMs: Number(e.target.value) })}
                                className="settings-slider"
                                id="warp-duration-slider"
                            />
                            <span className="settings-slider-value">{warpDurationMs} ms</span>
                            <button
                                type="button"
                                className="settings-preview-button"
                                disabled={!backgroundSettings.enabled}
                                aria-label="Play warp preview"
                                title={backgroundSettings.enabled ? 'Play preview' : 'Enable dynamic background to preview'}
                                onClick={playWarpPreview}
                            >
                                ▶
                            </button>
                        </div>
                    </div>

                    {backgroundSettings.enabled && (
                        <>
                            {/* Scope */}
                            <div className="font-choice-group" style={{ marginTop: '4px' }}>
                                <span className="font-choice-label">Display Scope</span>
                                <div className="themes-grid">
                                    {BACKGROUND_SCOPE_OPTIONS.map((opt) => (
                                        <button
                                            key={opt.id}
                                            className={`settings-card ${backgroundSettings.scope === opt.id ? 'active' : ''}`}
                                            onClick={() => onBackgroundSettingsChange({ scope: opt.id })}
                                            type="button"
                                        >
                                            <div className="settings-card-header">
                                                <span className="settings-card-name">{opt.name}</span>
                                                <span className={`settings-card-badge ${backgroundSettings.scope === opt.id ? 'dark' : 'light'}`}>
                                                    {opt.badge}
                                                </span>
                                            </div>
                                            <div className="settings-card-file">{opt.desc}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Physics Mode */}
                            <div className="font-choice-group" style={{ marginTop: '8px' }}>
                                <span className="font-choice-label">Mouse Physics</span>
                                <div className="themes-grid">
                                    {BACKGROUND_PHYSICS_OPTIONS.map((opt) => (
                                        <button
                                            key={opt.id}
                                            className={`settings-card ${backgroundSettings.physics === opt.id ? 'active' : ''}`}
                                            onClick={() => onBackgroundSettingsChange({ physics: opt.id })}
                                            type="button"
                                        >
                                            <div className="settings-card-header">
                                                <span className="settings-card-name">{opt.name}</span>
                                                <span className={`settings-card-badge ${backgroundSettings.physics === opt.id ? 'dark' : 'light'}`}>
                                                    {opt.badge}
                                                </span>
                                            </div>
                                            <div className="settings-card-file">{opt.desc}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Pulsation Mode */}
                            <div className="font-choice-group" style={{ marginTop: '8px' }}>
                                <span className="font-choice-label">Pulsation & Rhythm</span>
                                <div className="themes-grid">
                                    {BACKGROUND_PULSATION_OPTIONS.map((opt) => (
                                        <button
                                            key={opt.id}
                                            className={`settings-card ${backgroundSettings.pulsation === opt.id ? 'active' : ''}`}
                                            onClick={() => onBackgroundSettingsChange({ pulsation: opt.id })}
                                            type="button"
                                        >
                                            <div className="settings-card-header">
                                                <span className="settings-card-name">{opt.name}</span>
                                                <span className={`settings-card-badge ${backgroundSettings.pulsation === opt.id ? 'dark' : 'light'}`}>
                                                    {opt.badge}
                                                </span>
                                            </div>
                                            <div className="settings-card-file">{opt.desc}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Grid Geometry & Lattice */}
                            <div className="font-choice-group" style={{ marginTop: '8px' }}>
                                <span className="font-choice-label">Grid Geometry & Lattice</span>
                                <div className="themes-grid">
                                    {BACKGROUND_GEOMETRY_OPTIONS.map((geo) => (
                                        <button
                                            key={geo.id}
                                            className={`settings-card ${backgroundSettings.gridPattern === geo.id ? 'active' : ''}`}
                                            onClick={() => onBackgroundSettingsChange({ gridPattern: geo.id })}
                                            type="button"
                                        >
                                            <div className="settings-card-header">
                                                <span className="settings-card-name">{geo.name}</span>
                                                <span className={`settings-card-badge ${backgroundSettings.gridPattern === geo.id ? 'dark' : 'light'}`}>
                                                    {geo.badge}
                                                </span>
                                            </div>
                                            <div className="settings-card-file">{geo.desc}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Curated Density Presets */}
                            <div className="font-choice-group" style={{ marginTop: '8px' }}>
                                <span className="font-choice-label">Curated Density Presets</span>
                                <div className="themes-grid">
                                    {BACKGROUND_DENSITY_PRESETS.map((preset) => {
                                        const isMatch =
                                            backgroundSettings.particleSpacing === preset.spacing &&
                                            Math.abs((backgroundSettings.dotScale ?? 1) - preset.scale) < 0.05 &&
                                            backgroundSettings.gridPattern === preset.pattern;
                                        return (
                                            <button
                                                key={preset.name}
                                                className={`settings-card ${isMatch ? 'active' : ''}`}
                                                onClick={() =>
                                                    onBackgroundSettingsChange({
                                                        particleSpacing: preset.spacing,
                                                        dotScale: preset.scale,
                                                        gridPattern: preset.pattern,
                                                        gridOpacity: preset.opacity,
                                                    })
                                                }
                                                type="button"
                                            >
                                                <div className="settings-card-header">
                                                    <span className="settings-card-name">{preset.name}</span>
                                                    <span className={`settings-card-badge ${isMatch ? 'dark' : 'light'}`}>
                                                        {preset.badge}
                                                    </span>
                                                </div>
                                                <div className="settings-card-file">{preset.desc}</div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Grid Spacing / Distance */}
                            <div className="font-choice-group" style={{ marginTop: '8px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span className="font-choice-label">Grid Spacing (Distance between dots)</span>
                                    <span className="settings-slider-value" style={{ fontSize: '0.84em', color: 'var(--theme-accent-background, #007acc)' }}>
                                        {backgroundSettings.particleSpacing}px
                                    </span>
                                </div>
                                <div className="settings-slider-container" style={{ marginTop: '6px' }}>
                                    <input
                                        type="range"
                                        min="8"
                                        max="60"
                                        step="1"
                                        value={backgroundSettings.particleSpacing}
                                        onChange={(e) => onBackgroundSettingsChange({ particleSpacing: parseInt(e.target.value, 10) })}
                                        className="settings-slider"
                                        id="particle-spacing-slider"
                                    />
                                    <span className="settings-slider-value">
                                        {backgroundSettings.particleSpacing}px
                                    </span>
                                </div>
                            </div>

                            {/* Dot Scale / Particle Size */}
                            <div className="font-choice-group" style={{ marginTop: '8px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span className="font-choice-label">Dot Scale (Particle Size)</span>
                                    <span className="settings-slider-value" style={{ fontSize: '0.84em', color: 'var(--theme-accent-background, #007acc)' }}>
                                        {(backgroundSettings.dotScale ?? 0.85).toFixed(1)}x
                                    </span>
                                </div>
                                <div className="settings-slider-container" style={{ marginTop: '6px' }}>
                                    <input
                                        type="range"
                                        min="0.5"
                                        max="2.5"
                                        step="0.05"
                                        value={backgroundSettings.dotScale ?? 0.85}
                                        onChange={(e) => onBackgroundSettingsChange({ dotScale: parseFloat(e.target.value) })}
                                        className="settings-slider"
                                        id="dot-scale-slider"
                                    />
                                    <span className="settings-slider-value">
                                        {Math.round((backgroundSettings.dotScale ?? 0.85) * 100)}%
                                    </span>
                                </div>
                            </div>

                            {/* Grid Opacity / Brightness */}
                            <div className="font-choice-group" style={{ marginTop: '8px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span className="font-choice-label">Grid Brightness / Dot Opacity</span>
                                    <span className="settings-slider-value" style={{ fontSize: '0.84em', color: 'var(--theme-accent-background, #007acc)' }}>
                                        {Math.round((backgroundSettings.gridOpacity ?? 0.5) * 100)}%
                                    </span>
                                </div>
                                <div className="settings-slider-container" style={{ marginTop: '6px' }}>
                                    <input
                                        type="range"
                                        min="0.3"
                                        max="2.2"
                                        step="0.05"
                                        value={backgroundSettings.gridOpacity ?? 0.5}
                                        onChange={(e) => onBackgroundSettingsChange({ gridOpacity: parseFloat(e.target.value) })}
                                        className="settings-slider"
                                        id="grid-opacity-slider"
                                    />
                                    <span className="settings-slider-value">
                                        {Math.round((backgroundSettings.gridOpacity ?? 0.5) * 100)}%
                                    </span>
                                </div>
                            </div>

                            {/* WOW Special FX Toggles */}
                            <div className="font-choice-group" style={{ marginTop: '8px' }}>
                                <span className="font-choice-label">Special FX Features</span>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
                                    <div className="settings-option">
                                        <div className="settings-option-info">
                                            <span className="settings-option-label">🔦 Cursor Spotlight Beam</span>
                                            <span className="settings-option-desc">Radiant flashlight beam following cursor, illuminating dots with high glow &amp; radiance.</span>
                                        </div>
                                        <button
                                            type="button"
                                            className={`settings-toggle-switch ${backgroundSettings.spotlight ? 'active' : ''}`}
                                            aria-label="Toggle cursor spotlight"
                                            onClick={() => onBackgroundSettingsChange({ spotlight: !backgroundSettings.spotlight })}
                                        >
                                            <span className="settings-toggle-knob" />
                                        </button>
                                    </div>

                                    {backgroundSettings.spotlight && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '2px', paddingLeft: '2px' }}>
                                            {/* Quick Spotlight Presets */}
                                            <div className="font-choice-row" style={{ marginTop: '2px' }}>
                                                {SPOTLIGHT_PRESETS.map((sp) => {
                                                    const isMatch =
                                                        backgroundSettings.spotlightRadius === sp.radius &&
                                                        Math.abs((backgroundSettings.spotlightAmbientOpacity ?? 0.04) - sp.ambient) < 0.01 &&
                                                        Math.abs((backgroundSettings.spotlightPeakOpacity ?? 0.85) - sp.peak) < 0.05;
                                                    return (
                                                        <button
                                                            key={sp.name}
                                                            className={`settings-card font-choice-card settings-horizontal-card ${isMatch ? 'active' : ''}`}
                                                            onClick={() =>
                                                                onBackgroundSettingsChange({
                                                                    spotlightRadius: sp.radius,
                                                                    spotlightAmbientOpacity: sp.ambient,
                                                                    spotlightPeakOpacity: sp.peak,
                                                                })
                                                            }
                                                            type="button"
                                                        >
                                                            <span className="font-choice-value">{sp.name}</span>
                                                            <span className="settings-card-badge">{sp.badge}</span>
                                                        </button>
                                                    );
                                                })}
                                            </div>

                                            {/* 1. Beam Radius */}
                                            <div className="settings-slider-container">
                                                <span style={{ fontSize: '0.84em', color: 'var(--theme-tab-foreground, #8f8f8f)', minWidth: '120px' }}>
                                                    Beam Radius
                                                </span>
                                                <input
                                                    type="range"
                                                    min="100"
                                                    max="500"
                                                    step="10"
                                                    value={backgroundSettings.spotlightRadius ?? 130}
                                                    onChange={(e) => onBackgroundSettingsChange({ spotlightRadius: parseInt(e.target.value, 10) })}
                                                    className="settings-slider"
                                                    id="spotlight-radius-slider"
                                                />
                                                <span className="settings-slider-value">
                                                    {backgroundSettings.spotlightRadius ?? 130}px
                                                </span>
                                            </div>

                                            {/* 2. Spotlight Peak Brightness (inside beam) */}
                                            <div className="settings-slider-container">
                                                <span style={{ fontSize: '0.84em', color: 'var(--theme-tab-foreground, #8f8f8f)', minWidth: '120px' }}>
                                                    Beam Brightness
                                                </span>
                                                <input
                                                    type="range"
                                                    min="0.2"
                                                    max="1.0"
                                                    step="0.05"
                                                    value={backgroundSettings.spotlightPeakOpacity ?? 0.45}
                                                    onChange={(e) => onBackgroundSettingsChange({ spotlightPeakOpacity: parseFloat(e.target.value) })}
                                                    className="settings-slider"
                                                    id="spotlight-peak-slider"
                                                />
                                                <span className="settings-slider-value">
                                                    {Math.round((backgroundSettings.spotlightPeakOpacity ?? 0.45) * 100)}%
                                                </span>
                                            </div>

                                            {/* 3. Far Distance Dimness (outside beam) */}
                                            <div className="settings-slider-container">
                                                <span style={{ fontSize: '0.84em', color: 'var(--theme-tab-foreground, #8f8f8f)', minWidth: '120px' }}>
                                                    Far Dots Dimness
                                                </span>
                                                <input
                                                    type="range"
                                                    min="0.0"
                                                    max="0.25"
                                                    step="0.01"
                                                    value={backgroundSettings.spotlightAmbientOpacity ?? 0.04}
                                                    onChange={(e) => onBackgroundSettingsChange({ spotlightAmbientOpacity: parseFloat(e.target.value) })}
                                                    className="settings-slider"
                                                    id="spotlight-ambient-slider"
                                                />
                                                <span className="settings-slider-value">
                                                    {Math.round((backgroundSettings.spotlightAmbientOpacity ?? 0.04) * 100)}%
                                                </span>
                                            </div>
                                        </div>
                                    )}

                                    <div className="settings-option">
                                        <div className="settings-option-info">
                                            <span className="settings-option-label">🪐 Orbit Satellites</span>
                                            <span className="settings-option-desc">Tiny glowing photon satellites orbiting the cursor.</span>
                                        </div>
                                        <button
                                            type="button"
                                            className={`settings-toggle-switch ${backgroundSettings.satellites ? 'active' : ''}`}
                                            aria-label="Toggle orbit satellites"
                                            onClick={() => onBackgroundSettingsChange({ satellites: !backgroundSettings.satellites })}
                                        >
                                            <span className="settings-toggle-knob" />
                                        </button>
                                    </div>

                                    <div className="settings-option">
                                        <div className="settings-option-info">
                                            <span className="settings-option-label">💻 Code Morphing</span>
                                            <span className="settings-option-desc">Nearby dots transform into code syntax glyphs ({`{ }`}, fn, =&gt;, let, 01).</span>
                                        </div>
                                        <button
                                            type="button"
                                            className={`settings-toggle-switch ${backgroundSettings.codeGlyphs ? 'active' : ''}`}
                                            aria-label="Toggle code morphing"
                                            onClick={() => onBackgroundSettingsChange({ codeGlyphs: !backgroundSettings.codeGlyphs })}
                                        >
                                            <span className="settings-toggle-knob" />
                                        </button>
                                    </div>

                                    <div className="settings-option">
                                        <div className="settings-option-info">
                                            <span className="settings-option-label">🌈 RGB Split (Prismatic Lens)</span>
                                            <span className="settings-option-desc">Chromatic aberration lens effect splitting dots into RGB channels near cursor.</span>
                                        </div>
                                        <button
                                            type="button"
                                            className={`settings-toggle-switch ${backgroundSettings.rgbSplit ? 'active' : ''}`}
                                            aria-label="Toggle RGB split"
                                            onClick={() => onBackgroundSettingsChange({ rgbSplit: !backgroundSettings.rgbSplit })}
                                        >
                                            <span className="settings-toggle-knob" />
                                        </button>
                                    </div>

                                    <div className="settings-option">
                                        <div className="settings-option-info">
                                            <span className="settings-option-label">🌌 Cosmic Nebula Aurora</span>
                                            <span className="settings-option-desc">Soft, deep cosmic nebula gradient glowing underneath dots.</span>
                                        </div>
                                        <button
                                            type="button"
                                            className={`settings-toggle-switch ${backgroundSettings.aurora ? 'active' : ''}`}
                                            aria-label="Toggle nebula aurora"
                                            onClick={() => onBackgroundSettingsChange({ aurora: !backgroundSettings.aurora })}
                                        >
                                            <span className="settings-toggle-knob" />
                                        </button>
                                    </div>

                                    <div className="settings-option">
                                        <div className="settings-option-info">
                                            <span className="settings-option-label">🕸️ Neural Mesh Lines</span>
                                            <span className="settings-option-desc">Interconnecting neural web threads between dots near cursor.</span>
                                        </div>
                                        <button
                                            type="button"
                                            className={`settings-toggle-switch ${backgroundSettings.meshLines ? 'active' : ''}`}
                                            aria-label="Toggle neural mesh lines"
                                            onClick={() => onBackgroundSettingsChange({ meshLines: !backgroundSettings.meshLines })}
                                        >
                                            <span className="settings-toggle-knob" />
                                        </button>
                                    </div>

                                    <div className="settings-option">
                                        <div className="settings-option-info">
                                            <span className="settings-option-label">🪞 3D Parallax Tilt</span>
                                            <span className="settings-option-desc">Subtle 3D perspective tilt on cards following cursor angle.</span>
                                        </div>
                                        <button
                                            type="button"
                                            className={`settings-toggle-switch ${backgroundSettings.tilt ? 'active' : ''}`}
                                            aria-label="Toggle 3D parallax tilt"
                                            onClick={() => onBackgroundSettingsChange({ tilt: !backgroundSettings.tilt })}
                                        >
                                            <span className="settings-toggle-knob" />
                                        </button>
                                    </div>

                                    <div className="settings-option">
                                        <div className="settings-option-info">
                                            <span className="settings-option-label">⌨️ Keyboard Sonic Ripple</span>
                                            <span className="settings-option-desc">Emit expanding shockwave pulse when typing keys.</span>
                                        </div>
                                        <button
                                            type="button"
                                            className={`settings-toggle-switch ${backgroundSettings.keyboardShockwave ? 'active' : ''}`}
                                            aria-label="Toggle keyboard shockwave"
                                            onClick={() => onBackgroundSettingsChange({ keyboardShockwave: !backgroundSettings.keyboardShockwave })}
                                        >
                                            <span className="settings-toggle-knob" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

export const SettingsPanel = React.memo(SettingsPanelComponent);

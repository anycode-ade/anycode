import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FileIcon } from './FileIcon';
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
}

interface ThemeCardProps {
    theme: ThemeItem;
    isActive: boolean;
    onSelectTheme: (theme: ThemeItem) => void;
}

const ThemeCard = React.memo(({ theme, isActive, onSelectTheme }: ThemeCardProps) => {
    const isDark = theme.name.toLowerCase().includes('dark');

    return (
        <button
            className={`theme-card ${isActive ? 'active' : ''}`}
            onClick={() => onSelectTheme(theme)}
            type="button"
        >
            <div className="theme-card-header">
                <span className="theme-card-name">{theme.themeName}</span>
                <span className={`theme-card-badge ${isDark ? 'dark' : 'light'}`}>
                    {isDark ? 'Dark' : 'Light'}
                </span>
            </div>
            <div className="theme-card-file">{theme.fileName}</div>
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
            className={`theme-card icon-style-card ${isActive ? 'active' : ''}`}
            onClick={() => onSelect(styleId)}
            type="button"
        >
            <div className="icon-style-card-content">
                <div className="theme-card-header">
                    <span className="theme-card-name">{name}</span>
                    <span className={`theme-card-badge ${isActive ? 'dark' : 'light'} icon-style-badge`}>
                        {badge}
                    </span>
                </div>
                <div className="theme-card-file icon-style-desc">
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
}) => {
    const [themes, setThemes] = useState<ThemeItem[]>([]);
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
        <div className="settings-panel">
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

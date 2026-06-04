import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

const SettingsPanelComponent: React.FC<SettingsPanelProps> = ({
    wsRef,
    isConnected,
    currentThemeId,
    onThemeChange,
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
        </div>
    );
};

export const SettingsPanel = React.memo(SettingsPanelComponent);

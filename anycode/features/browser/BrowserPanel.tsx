import React, { useCallback, useMemo, useState } from 'react';
import { Icons } from '../../components/Icons';
import './BrowserPanel.css';

type BrowserPanelProps = {
    panelKey: string;
};

const normalizeUrl = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) {
        return '';
    }

    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)) {
        return trimmed;
    }

    return `https://${trimmed}`;
};

export const BrowserPanel: React.FC<BrowserPanelProps> = ({ panelKey }) => {
    const [inputValue, setInputValue] = useState<string>('');
    const [currentUrl, setCurrentUrl] = useState<string>('');
    const [hasNavigated, setHasNavigated] = useState<boolean>(false);
    const [reloadKey, setReloadKey] = useState<number>(0);

    const handleNavigate = useCallback(() => {
        const nextUrl = normalizeUrl(inputValue);
        if (!nextUrl) {
            return;
        }

        setInputValue(nextUrl);
        setCurrentUrl(nextUrl);
        setHasNavigated(true);
        setReloadKey((prev) => prev + 1);
    }, [inputValue]);

    const handlePrimaryAction = useCallback(() => {
        if (!hasNavigated) {
            handleNavigate();
            return;
        }
        setReloadKey((prev) => prev + 1);
    }, [handleNavigate, hasNavigated]);

    const frameTitle = useMemo(() => `browser-frame-${panelKey}`, [panelKey]);

    return (
        <div className="browser-panel">
            <div className="browser-panel-controls">
                <input
                    className="browser-panel-input"
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            handleNavigate();
                        }
                    }}
                    placeholder="https://example.com"
                    spellCheck={false}
                />
                <button
                    className="browser-panel-go"
                    type="button"
                    onClick={handlePrimaryAction}
                >
                    {hasNavigated ? <Icons.Refresh /> : '→'}
                </button>
            </div>
            <div className="browser-panel-frame-wrap">
                {currentUrl ? (
                    <iframe
                        key={`${frameTitle}-${reloadKey}`}
                        className="browser-panel-frame"
                        src={currentUrl}
                        title={frameTitle}
                        sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts"
                        referrerPolicy="no-referrer"
                    />
                ) : (
                    <div className="browser-panel-placeholder">Enter a URL to open a site.</div>
                )}
            </div>
        </div>
    );
};

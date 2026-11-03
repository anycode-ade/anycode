import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Update } from '@tauri-apps/plugin-updater';
import { isTauri } from '../constants';
import './UpdaterToast.css';

type InfoState = {
    title: string;
    message: string;
} | null;

export const UpdaterToast: React.FC = () => {
    const [update, setUpdate] = useState<Update | null>(null);
    const [info, setInfo] = useState<InfoState>(null);
    const [isInstalling, setIsInstalling] = useState(false);
    const [statusText, setStatusText] = useState('A new version of Anycode is ready to install.');
    const [progressPct, setProgressPct] = useState<number | null>(null);
    const [hasError, setHasError] = useState(false);
    const updateRef = useRef<Update | null>(null);

    const checkForUpdates = useCallback(async (manual = false) => {
        if (!isTauri) return;

        try {
            const { check } = await import('@tauri-apps/plugin-updater');
            const found = await check();

            if (found) {
                console.log(`[Anycode Updater] Found update ${found.version} (current: ${found.currentVersion})`);
                if (updateRef.current && updateRef.current !== found) {
                    void updateRef.current.close().catch(() => {});
                }
                updateRef.current = found;
                setInfo(null);
                setIsInstalling(false);
                setHasError(false);
                setProgressPct(null);
                setStatusText('A new version of Anycode is ready to install.');
                setUpdate(found);
            } else if (manual) {
                setInfo({
                    title: 'Up to Date',
                    message: 'You are running the latest version of Anycode.',
                });
            }
        } catch (err) {
            console.debug('[Anycode Updater] Check skipped or failed:', err);
            if (manual) {
                setInfo({
                    title: 'Update Check Failed',
                    message: err instanceof Error ? err.message : String(err),
                });
            }
        }
    }, []);

    useEffect(() => {
        if (!isTauri) return;

        let unlisten: (() => void) | undefined;
        let cancelled = false;

        void (async () => {
            try {
                const { listen } = await import('@tauri-apps/api/event');
                const stop = await listen('check_for_updates', () => {
                    void checkForUpdates(true);
                });
                if (cancelled) {
                    stop();
                } else {
                    unlisten = stop;
                }
            } catch {
                // Ignore if event listener fails in dev
            }
        })();

        void checkForUpdates(false);

        return () => {
            cancelled = true;
            unlisten?.();
        };
    }, [checkForUpdates]);

    useEffect(() => {
        if (!info) return;
        const timer = window.setTimeout(() => {
            setInfo(null);
        }, 4500);
        return () => window.clearTimeout(timer);
    }, [info]);

    const handleDismissUpdate = useCallback(() => {
        if (updateRef.current) {
            void updateRef.current.close().catch(() => {});
            updateRef.current = null;
        }
        setUpdate(null);
    }, []);

    const handleInstall = useCallback(async () => {
        if (!update) return;
        setIsInstalling(true);
        setHasError(false);
        setProgressPct(0);
        setStatusText('Downloading update...');

        let totalBytes = 0;
        let downloadedBytes = 0;

        try {
            await update.downloadAndInstall((event) => {
                if (event.event === 'Started') {
                    totalBytes = event.data.contentLength ?? 0;
                } else if (event.event === 'Progress') {
                    downloadedBytes += event.data.chunkLength;
                    if (totalBytes > 0) {
                        const pct = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
                        setProgressPct(pct);
                        setStatusText(`Downloading update... ${pct}%`);
                    } else {
                        const mb = (downloadedBytes / (1024 * 1024)).toFixed(1);
                        setStatusText(`Downloading update... ${mb} MB`);
                    }
                } else if (event.event === 'Finished') {
                    setProgressPct(100);
                    setStatusText('Installing update and restarting...');
                }
            });

            const { relaunch } = await import('@tauri-apps/plugin-process');
            await relaunch();
        } catch (err) {
            console.error('[Anycode Updater] Update installation failed:', err);
            setIsInstalling(false);
            setHasError(true);
            setProgressPct(null);
            setStatusText(`Update failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }, [update]);

    if (!isTauri) return null;

    if (update) {
        return (
            <div className="anycode-updater-toast" role="dialog" aria-label="Update Available">
                <div className="anycode-updater-title">
                    <span>Update Available</span>
                    <span className="anycode-updater-badge">
                        v{update.currentVersion} → v{update.version}
                    </span>
                </div>
                <div className="anycode-updater-desc">{statusText}</div>
                {isInstalling && (
                    <div className="anycode-updater-progress-wrap">
                        <div
                            className="anycode-updater-progress-bar"
                            style={{ width: `${progressPct ?? 100}%` }}
                        />
                    </div>
                )}
                <div className="anycode-updater-actions">
                    <button
                        type="button"
                        className="anycode-updater-btn"
                        disabled={isInstalling}
                        onClick={handleDismissUpdate}
                    >
                        {hasError ? 'Close' : 'Later'}
                    </button>
                    <button
                        type="button"
                        className="anycode-updater-btn primary"
                        disabled={isInstalling}
                        onClick={handleInstall}
                    >
                        {isInstalling ? 'Updating...' : hasError ? 'Retry' : 'Update & Restart'}
                    </button>
                </div>
            </div>
        );
    }

    if (info) {
        return (
            <div className="anycode-updater-toast" role="status">
                <div className="anycode-updater-title">
                    <span>{info.title}</span>
                </div>
                <div className="anycode-updater-desc" style={{ marginBottom: 8 }}>
                    {info.message}
                </div>
                <div className="anycode-updater-actions">
                    <button
                        type="button"
                        className="anycode-updater-btn"
                        onClick={() => setInfo(null)}
                    >
                        Dismiss
                    </button>
                </div>
            </div>
        );
    }

    return null;
};

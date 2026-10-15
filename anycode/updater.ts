import { isTauri } from './constants';

export async function initAutoUpdater() {
  if (!isTauri) return;

  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();

    if (update?.available) {
      console.log(`[Anycode Updater] Found update ${update.version} (current: ${update.currentVersion})`);
      const shouldUpdate = window.confirm(
        `Доступна новая версия Anycode ${update.version}.\n\nУстановить обновление сейчас?`
      );

      if (shouldUpdate) {
        console.log('[Anycode Updater] Downloading and installing update...');
        await update.downloadAndInstall();
        const shouldRelaunch = window.confirm(
          `Обновление ${update.version} успешно установлено!\n\nПерезапустить приложение сейчас?`
        );
        if (shouldRelaunch) {
          const { relaunch } = await import('@tauri-apps/plugin-process');
          await relaunch();
        }
      }
    }
  } catch (err) {
    // In local dev mode or when offline, silently ignore
    console.debug('[Anycode Updater] Check skipped or failed:', err);
  }
}

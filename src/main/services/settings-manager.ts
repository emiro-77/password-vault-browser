// ============================================================================
// Settings Manager — persistent key/value application settings
// ============================================================================
// Backed by the `app_settings` table. Currently used for the Downloads feature
// (default directory, ask-each-time, keep-history) but general-purpose.

import { app } from 'electron';
import { getDatabase } from '../db';
import { DownloadSettings } from '../../shared/types';

const KEYS = {
  DOWNLOAD_DIR: 'download.dir',
  DOWNLOAD_ASK_EACH_TIME: 'download.askEachTime',
  DOWNLOAD_KEEP_HISTORY: 'download.keepHistory',
} as const;

class SettingsManager {
  /** Read a raw string setting, or the provided fallback. */
  get(key: string, fallback = ''): string {
    try {
      const row = getDatabase()
        .prepare('SELECT value FROM app_settings WHERE key = ?')
        .get(key) as { value?: string } | undefined;
      return row?.value ?? fallback;
    } catch {
      return fallback;
    }
  }

  /** Write a raw string setting (upsert). */
  set(key: string, value: string): void {
    try {
      getDatabase()
        .prepare(
          `INSERT INTO app_settings (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`
        )
        .run(key, value);
    } catch (err) {
      console.error('[SettingsManager] set failed:', err);
    }
  }

  /** The effective download directory: the saved one, or the OS Downloads dir. */
  getDownloadDir(): string {
    const saved = this.get(KEYS.DOWNLOAD_DIR, '');
    if (saved) return saved;
    try {
      return app.getPath('downloads');
    } catch {
      return '';
    }
  }

  getDownloadSettings(): DownloadSettings {
    return {
      downloadDir: this.get(KEYS.DOWNLOAD_DIR, '') || this.getDownloadDir(),
      askEachTime: this.get(KEYS.DOWNLOAD_ASK_EACH_TIME, '0') === '1',
      keepHistory: this.get(KEYS.DOWNLOAD_KEEP_HISTORY, '1') === '1',
    };
  }

  setDownloadSettings(patch: Partial<DownloadSettings>): DownloadSettings {
    if (patch.downloadDir !== undefined) this.set(KEYS.DOWNLOAD_DIR, patch.downloadDir);
    if (patch.askEachTime !== undefined) this.set(KEYS.DOWNLOAD_ASK_EACH_TIME, patch.askEachTime ? '1' : '0');
    if (patch.keepHistory !== undefined) this.set(KEYS.DOWNLOAD_KEEP_HISTORY, patch.keepHistory ? '1' : '0');
    return this.getDownloadSettings();
  }
}

export const settingsManager = new SettingsManager();

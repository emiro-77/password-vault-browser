// ============================================================================
// Download Manager — browser-style downloads (Electron DownloadItem)
// ============================================================================
// Hooks `session.on('will-download')` on every tab session so any download the
// user triggers is captured, tracked, persisted (across restarts) and streamed
// to the renderer as progress events. Supports pause/resume/cancel, retry,
// open-file, show-in-folder, remove-from-history and delete-from-disk.

import { app, BrowserWindow, dialog, shell, DownloadItem as ElectronDownloadItem, Session, WebContents } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { getDatabase } from '../db';
import { settingsManager } from './settings-manager';
import { IPC_CHANNELS, DownloadItem, DownloadState } from '../../shared/types';

/** Broadcast to every app window (the renderer UI). */
function broadcast(channel: string, data: any): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, data);
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

class DownloadManager {
  /** Sessions we've already attached the will-download hook to. */
  private hookedSessions = new WeakSet<Session>();
  /** Live Electron DownloadItem handles by our row id (for pause/resume/cancel). */
  private live = new Map<string, ElectronDownloadItem>();
  /** Reverse lookup: Electron item -> our row id. */
  private itemIds = new WeakMap<ElectronDownloadItem, string>();

  /** Attach the will-download listener to a session (idempotent per session). */
  attachToSession(session: Session): void {
    if (!session || this.hookedSessions.has(session)) return;
    this.hookedSessions.add(session);
    session.on('will-download', (_event, item, webContents) => {
      this.handleWillDownload(item, webContents);
    });
  }

  /** Attach to the session backing a webContents (called per BrowserView). */
  attachToWebContents(wc: WebContents): void {
    try {
      if (wc && wc.session) this.attachToSession(wc.session);
    } catch { /* ignore */ }
  }

  private handleWillDownload(item: ElectronDownloadItem, _wc: WebContents): void {
    const id = `dl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const filename = item.getFilename() || 'download';
    const settings = settingsManager.getDownloadSettings();

    // Decide the save path. If "ask each time" is on, show a Save-As dialog;
    // otherwise auto-save into the configured (or OS) download directory.
    let savePath: string;
    if (settings.askEachTime) {
      const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed());
      const chosen = dialog.showSaveDialogSync(win!, {
        defaultPath: path.join(settings.downloadDir || app.getPath('downloads'), filename),
      });
      if (!chosen) {
        // User cancelled the Save-As dialog -> cancel the download entirely.
        item.cancel();
        return;
      }
      savePath = chosen;
    } else {
      const dir = settings.downloadDir || app.getPath('downloads');
      savePath = this.uniquePath(path.join(dir, filename));
      item.setSavePath(savePath);
    }

    const finalName = path.basename(savePath);
    const row: DownloadItem = {
      id,
      url: item.getURL(),
      filename: finalName,
      savePath,
      mime: item.getMimeType() || '',
      totalBytes: item.getTotalBytes() || 0,
      receivedBytes: item.getReceivedBytes() || 0,
      state: 'in_progress',
      paused: false,
      seen: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    this.insertRow(row);
    this.live.set(id, item);
    this.itemIds.set(item, id);
    broadcast(IPC_CHANNELS.EVENT_DOWNLOADS_CHANGED, {});
    broadcast(IPC_CHANNELS.EVENT_DOWNLOAD_UPDATED, row);

    // Progress updates.
    item.on('updated', (_e, state) => {
      const received = item.getReceivedBytes();
      const total = item.getTotalBytes();
      const paused = item.isPaused();
      const dlState: DownloadState =
        state === 'interrupted' ? 'interrupted' : paused ? 'paused' : 'in_progress';
      this.updateRow(id, {
        receivedBytes: received,
        totalBytes: total,
        state: dlState,
        paused,
      });
    });

    // Terminal state.
    item.on('done', (_e, state) => {
      const dlState: DownloadState =
        state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'interrupted';
      this.updateRow(id, {
        state: dlState,
        paused: false,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes() || item.getReceivedBytes(),
      });
      this.live.delete(id);
    });
  }

  /** Ensure a path is unique by appending " (n)" before the extension. */
  private uniquePath(p: string): string {
    if (!fs.existsSync(p)) return p;
    const dir = path.dirname(p);
    const ext = path.extname(p);
    const base = path.basename(p, ext);
    let i = 1;
    let candidate: string;
    do {
      candidate = path.join(dir, `${base} (${i})${ext}`);
      i++;
    } while (fs.existsSync(candidate));
    return candidate;
  }

  // ---- Persistence ----

  private insertRow(r: DownloadItem): void {
    try {
      getDatabase().prepare(`
        INSERT INTO downloads
          (id, url, filename, save_path, mime, total_bytes, received_bytes, state, paused, seen, created_at, updated_at)
        VALUES (@id, @url, @filename, @savePath, @mime, @totalBytes, @receivedBytes, @state, @paused, @seen, @createdAt, @updatedAt)
      `).run({
        ...r,
        paused: r.paused ? 1 : 0,
        seen: r.seen ? 1 : 0,
      });
    } catch (err) {
      console.error('[DownloadManager] insert failed:', err);
    }
  }

  private updateRow(id: string, patch: Partial<DownloadItem>): void {
    try {
      const current = this.getById(id);
      if (!current) return;
      const merged: DownloadItem = { ...current, ...patch, updatedAt: nowIso() };
      getDatabase().prepare(`
        UPDATE downloads SET
          filename = @filename, save_path = @savePath, mime = @mime,
          total_bytes = @totalBytes, received_bytes = @receivedBytes,
          state = @state, paused = @paused, seen = @seen, updated_at = @updatedAt
        WHERE id = @id
      `).run({
        ...merged,
        paused: merged.paused ? 1 : 0,
        seen: merged.seen ? 1 : 0,
      });
      broadcast(IPC_CHANNELS.EVENT_DOWNLOAD_UPDATED, merged);
    } catch (err) {
      console.error('[DownloadManager] update failed:', err);
    }
  }

  private mapRow(row: any): DownloadItem {
    return {
      id: row.id,
      url: row.url,
      filename: row.filename,
      savePath: row.save_path,
      mime: row.mime,
      totalBytes: row.total_bytes,
      receivedBytes: row.received_bytes,
      state: row.state,
      paused: !!row.paused,
      seen: !!row.seen,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  getById(id: string): DownloadItem | null {
    try {
      const row = getDatabase().prepare('SELECT * FROM downloads WHERE id = ?').get(id);
      return row ? this.mapRow(row) : null;
    } catch {
      return null;
    }
  }

  list(): DownloadItem[] {
    try {
      const rows = getDatabase()
        .prepare('SELECT * FROM downloads ORDER BY created_at DESC')
        .all() as any[];
      return rows.map(r => this.mapRow(r));
    } catch {
      return [];
    }
  }

  // ---- On boot: reconcile any rows left "in_progress"/"paused" from a crash ----
  reconcileOnBoot(): void {
    try {
      getDatabase()
        .prepare(`UPDATE downloads SET state='interrupted', paused=0 WHERE state IN ('in_progress','paused')`)
        .run();
    } catch (err) {
      console.error('[DownloadManager] boot reconcile failed:', err);
    }
  }

  // ---- Actions ----

  pause(id: string): boolean {
    const item = this.live.get(id);
    if (item && !item.isPaused()) { item.pause(); return true; }
    return false;
  }

  resume(id: string): boolean {
    const item = this.live.get(id);
    if (item && item.canResume()) { item.resume(); return true; }
    return false;
  }

  cancel(id: string): boolean {
    const item = this.live.get(id);
    if (item) { item.cancel(); return true; }
    // Not live (already done or from a previous session): just mark cancelled.
    this.updateRow(id, { state: 'cancelled', paused: false });
    return true;
  }

  /** Retry re-issues the download by navigating a fresh download of the URL. */
  retry(id: string): { url: string } | null {
    const row = this.getById(id);
    if (!row) return null;
    // The renderer opens the URL in a new tab which re-triggers will-download.
    return { url: row.url };
  }

  async openFile(id: string): Promise<boolean> {
    const row = this.getById(id);
    if (!row || row.state !== 'completed') return false;
    if (!fs.existsSync(row.savePath)) return false;
    const err = await shell.openPath(row.savePath);
    return !err;
  }

  showInFolder(id: string): boolean {
    const row = this.getById(id);
    if (!row) return false;
    if (!fs.existsSync(row.savePath)) return false;
    shell.showItemInFolder(row.savePath);
    return true;
  }

  /** Remove from history only — leaves the file on disk. */
  remove(id: string): boolean {
    try {
      const item = this.live.get(id);
      if (item) { try { item.cancel(); } catch { /* ignore */ } this.live.delete(id); }
      getDatabase().prepare('DELETE FROM downloads WHERE id = ?').run(id);
      broadcast(IPC_CHANNELS.EVENT_DOWNLOADS_CHANGED, {});
      return true;
    } catch {
      return false;
    }
  }

  /** Delete the file from disk AND remove from history. */
  deleteFile(id: string): boolean {
    const row = this.getById(id);
    if (row) {
      try { if (fs.existsSync(row.savePath)) fs.unlinkSync(row.savePath); } catch { /* ignore */ }
    }
    return this.remove(id);
  }

  /** Clear all finished (non-active) downloads from history. */
  clearFinished(): boolean {
    try {
      getDatabase()
        .prepare(`DELETE FROM downloads WHERE state IN ('completed','cancelled','interrupted')`)
        .run();
      broadcast(IPC_CHANNELS.EVENT_DOWNLOADS_CHANGED, {});
      return true;
    } catch {
      return false;
    }
  }

  /** Mark all downloads as seen (called when the panel opens) — clears "unread". */
  markAllSeen(): boolean {
    try {
      getDatabase().prepare('UPDATE downloads SET seen = 1 WHERE seen = 0').run();
      broadcast(IPC_CHANNELS.EVENT_DOWNLOADS_CHANGED, {});
      return true;
    } catch {
      return false;
    }
  }
}

export const downloadManager = new DownloadManager();

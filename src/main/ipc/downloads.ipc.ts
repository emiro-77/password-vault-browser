// ============================================================================
// Downloads IPC Handlers
// ============================================================================

import { ipcMain, dialog, BrowserWindow } from 'electron';
import { IPC_CHANNELS, IpcResponse, DownloadSettings } from '../../shared/types';
import { downloadManager } from '../services/download-manager';
import { settingsManager } from '../services/settings-manager';

export function registerDownloadsIpc(): void {
  ipcMain.handle(IPC_CHANNELS.DOWNLOADS_LIST, async (): Promise<IpcResponse> => {
    return { success: true, data: downloadManager.list() };
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOADS_PAUSE, async (_e, id: string): Promise<IpcResponse> => {
    return { success: downloadManager.pause(id) };
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOADS_RESUME, async (_e, id: string): Promise<IpcResponse> => {
    return { success: downloadManager.resume(id) };
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOADS_CANCEL, async (_e, id: string): Promise<IpcResponse> => {
    return { success: downloadManager.cancel(id) };
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOADS_RETRY, async (_e, id: string): Promise<IpcResponse> => {
    const res = downloadManager.retry(id);
    return res ? { success: true, data: res } : { success: false, error: 'Download not found' };
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOADS_OPEN_FILE, async (_e, id: string): Promise<IpcResponse> => {
    const ok = await downloadManager.openFile(id);
    return { success: ok, error: ok ? undefined : 'File not found' };
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOADS_SHOW_IN_FOLDER, async (_e, id: string): Promise<IpcResponse> => {
    const ok = downloadManager.showInFolder(id);
    return { success: ok, error: ok ? undefined : 'File not found' };
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOADS_REMOVE, async (_e, id: string): Promise<IpcResponse> => {
    return { success: downloadManager.remove(id) };
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOADS_DELETE_FILE, async (_e, id: string): Promise<IpcResponse> => {
    return { success: downloadManager.deleteFile(id) };
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOADS_CLEAR, async (): Promise<IpcResponse> => {
    return { success: downloadManager.clearFinished() };
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOADS_MARK_SEEN, async (): Promise<IpcResponse> => {
    return { success: downloadManager.markAllSeen() };
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOADS_GET_SETTINGS, async (): Promise<IpcResponse> => {
    return { success: true, data: settingsManager.getDownloadSettings() };
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOADS_SET_SETTINGS, async (_e, patch: Partial<DownloadSettings>): Promise<IpcResponse> => {
    return { success: true, data: settingsManager.setDownloadSettings(patch || {}) };
  });

  // Pick a default download directory via the OS folder picker.
  ipcMain.handle(IPC_CHANNELS.DOWNLOADS_CHOOSE_DIR, async (): Promise<IpcResponse> => {
    const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed());
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: settingsManager.getDownloadDir(),
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: 'cancelled' };
    }
    const dir = result.filePaths[0];
    settingsManager.setDownloadSettings({ downloadDir: dir });
    return { success: true, data: { downloadDir: dir } };
  });
}

// ============================================================================
// Site Login Status IPC Handlers
// ============================================================================

import { ipcMain } from 'electron';
import { IPC_CHANNELS, IpcResponse } from '../../shared/types';
import { statusManager } from '../services/status-manager';
import { tabManager } from '../services/tab-manager';

export function registerStatusIpc(): void {
  // Get status for all login entries on a specific domain (VAULT SIDEBAR).
  // The sidebar shows which account is active in the ONE currently-focused
  // tab, so we pass the focused tab id: only that tab's account reads as the
  // "Active tab"; other open-tab accounts on the same domain read as "used".
  // (Settings › Site accounts uses a different path and still shows every
  // open-tab account as active.)
  ipcMain.handle(IPC_CHANNELS.STATUS_GET_FOR_DOMAIN, async (_event, domain: string): Promise<IpcResponse> => {
    try {
      const focusedTabId = tabManager.getActiveTabId();
      const statuses = statusManager.getForDomain(domain, focusedTabId);
      return { success: true, data: statuses };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Get all site login statuses
  ipcMain.handle(IPC_CHANNELS.STATUS_GET_ALL, async (): Promise<IpcResponse> => {
    try {
      const statuses = statusManager.getAll();
      return { success: true, data: statuses };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}

// ============================================================================
// Site Login Status IPC Handlers
// ============================================================================

import { ipcMain } from 'electron';
import { IPC_CHANNELS, IpcResponse } from '../../shared/types';
import { statusManager } from '../services/status-manager';

export function registerStatusIpc(): void {
  // Get status for all login entries on a specific domain
  ipcMain.handle(IPC_CHANNELS.STATUS_GET_FOR_DOMAIN, async (_event, domain: string): Promise<IpcResponse> => {
    try {
      const statuses = statusManager.getForDomain(domain);
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

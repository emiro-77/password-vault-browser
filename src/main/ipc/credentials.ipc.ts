// ============================================================================
// Credentials IPC Handlers
// ============================================================================

import { ipcMain } from 'electron';
import { IPC_CHANNELS, IpcResponse, LoginEntryCreateRequest, LoginEntryUpdateRequest } from '../../shared/types';
import { loginEntryManager } from '../services/login-entry-manager';
import { getCredential } from '../services/credential-store';

export function registerCredentialsIpc(): void {
  // List login entries. If a domain is provided, only accounts for that site
  // (plus unscoped/global accounts) are returned; otherwise all are returned.
  ipcMain.handle(IPC_CHANNELS.CREDENTIALS_LIST, async (_event, domain?: string): Promise<IpcResponse> => {
    try {
      const entries = (domain && domain.trim())
        ? loginEntryManager.listForDomain(domain.trim().toLowerCase())
        : loginEntryManager.listAll();
      return { success: true, data: entries };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Create a new login entry
  ipcMain.handle(IPC_CHANNELS.CREDENTIALS_CREATE, async (_event, request: LoginEntryCreateRequest): Promise<IpcResponse> => {
    try {
      const entry = await loginEntryManager.create(request);
      return { success: true, data: entry };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Update a login entry
  ipcMain.handle(IPC_CHANNELS.CREDENTIALS_UPDATE, async (_event, request: LoginEntryUpdateRequest): Promise<IpcResponse> => {
    try {
      const entry = await loginEntryManager.update(request);
      if (!entry) {
        return { success: false, error: 'Login entry not found' };
      }
      return { success: true, data: entry };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Delete a login entry
  ipcMain.handle(IPC_CHANNELS.CREDENTIALS_DELETE, async (_event, id: string): Promise<IpcResponse> => {
    try {
      const deleted = await loginEntryManager.delete(id);
      return { success: true, data: { deleted } };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}

// ============================================================================
// Login-Page Mapping IPC Handlers
// ============================================================================
// Powers the "Save Current Page as Login Page" feature:
//   - list mappings (optionally for one main website)
//   - save (create/replace) a mapping
//   - delete a mapping
//   - resolve: given the current page + selected account, decide whether to
//     open a saved login page instead of autofilling the current page.

import { ipcMain } from 'electron';
import {
  IPC_CHANNELS,
  IpcResponse,
  LoginPageMapping,
  SaveLoginPageRequest,
  UpdateLoginPageRequest,
  ResolvedLoginPage,
  LoginConnection,
} from '../../shared/types';
import { loginPageManager } from '../services/login-page-manager';

export function registerLoginPageIpc(): void {
  // List mappings. If a mainDomain is passed, only that site's mappings.
  ipcMain.handle(IPC_CHANNELS.LOGIN_PAGE_LIST, async (_event, mainDomain?: string): Promise<IpcResponse<LoginPageMapping[]>> => {
    try {
      const data = (mainDomain && mainDomain.trim())
        ? loginPageManager.listForMainDomain(mainDomain.trim())
        : loginPageManager.listAll();
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Save (create or replace) a mapping.
  ipcMain.handle(IPC_CHANNELS.LOGIN_PAGE_SAVE, async (_event, req: SaveLoginPageRequest): Promise<IpcResponse<LoginPageMapping>> => {
    try {
      const data = loginPageManager.save(req);
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Update a mapping in place (Settings editor: main URL, related URLs, toggle).
  ipcMain.handle(IPC_CHANNELS.LOGIN_PAGE_UPDATE, async (_event, req: UpdateLoginPageRequest): Promise<IpcResponse<LoginPageMapping>> => {
    try {
      if (!req?.id) return { success: false, error: 'A mapping id is required.' };
      const data = loginPageManager.update(req);
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Delete a mapping.
  ipcMain.handle(IPC_CHANNELS.LOGIN_PAGE_DELETE, async (_event, id: string): Promise<IpcResponse> => {
    try {
      const deleted = loginPageManager.delete(id);
      return { success: true, data: { deleted } };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Resolve whether a selected account should open a saved login page.
  ipcMain.handle(IPC_CHANNELS.LOGIN_PAGE_RESOLVE, async (_event, payload: { currentUrl: string; loginEntryId: string }): Promise<IpcResponse<ResolvedLoginPage | null>> => {
    try {
      const { currentUrl, loginEntryId } = payload || ({} as any);
      if (!currentUrl || !loginEntryId) {
        return { success: true, data: null };
      }
      const data = loginPageManager.resolveForSelection(currentUrl, loginEntryId);
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Resolve the connection context (scenario + canonical account domain) for
  // the currently-viewed URL. Drives the 3 vault-sidebar scenarios and makes
  // accounts sync across login / main / related pages.
  ipcMain.handle(IPC_CHANNELS.LOGIN_PAGE_CONNECTION, async (_event, url: string): Promise<IpcResponse<LoginConnection>> => {
    try {
      const data = loginPageManager.resolveConnection(url || '');
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}

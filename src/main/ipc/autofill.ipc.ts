// ============================================================================
// Autofill IPC Handlers
// ============================================================================
// The renderer requests autofill for a specific tab + login entry.
// The main process retrieves the password from secure storage and
// injects the autofill script into the webview's page context.
//
// Security: password NEVER goes to the renderer process.

import { ipcMain } from 'electron';
import { IPC_CHANNELS, IpcResponse } from '../../shared/types';
import { tabManager } from '../services/tab-manager';
import { autofillEngine } from '../services/autofill-engine';
import { loginEntryManager } from '../services/login-entry-manager';
import { statusManager } from '../services/status-manager';
import { hostnameMatches, extractDomain } from '../services/domain-utils';
import { emitStatusChanged } from './tabs.ipc';

export function registerAutofillIpc(): void {
  ipcMain.handle(IPC_CHANNELS.AUTOFILL, async (_event, payload: {
    tabId: string;
    loginEntryId: string;
    url: string;
  }): Promise<IpcResponse> => {
    try {
      const { tabId, loginEntryId, url } = payload;

      // Validate login entry exists
      const entry = loginEntryManager.getById(loginEntryId);
      if (!entry) {
        return { success: false, error: 'Login entry not found' };
      }

      // Get the view for this tab
      const view = tabManager.getView(tabId);
      if (!view) {
        return { success: false, error: 'Tab view not found' };
      }

      // Get the secret ref for password retrieval
      const secretRef = loginEntryManager.getSecretRef(loginEntryId);
      if (!secretRef) {
        return { success: false, error: 'Credential secret not found' };
      }

      // Execute autofill (password never reaches renderer)
      const autofilled = await autofillEngine.autofill(view, {
        url,
        username: entry.usernameOrEmail,
        passwordSecretRef: secretRef,
      });

      if (!autofilled) {
        return { success: false, error: 'Autofill failed — hostname mismatch or script error' };
      }

      // Mark as logged in for this domain and refresh the sidebar
      const domain = extractDomain(url);
      if (domain) {
        statusManager.markLoggedIn(loginEntryId, domain, tabId);
        emitStatusChanged(domain);
      }

      return { success: true, data: { domain } };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}

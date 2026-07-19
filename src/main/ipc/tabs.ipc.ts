// ============================================================================
// Tabs IPC Handlers
// ============================================================================

import { ipcMain, BrowserWindow, BrowserView, session as electronSession } from 'electron';
import { IPC_CHANNELS, IpcResponse, PageInfo } from '../../shared/types';
import { tabManager } from '../services/tab-manager';
import { autofillEngine } from '../services/autofill-engine';
import { statusManager } from '../services/status-manager';
import { loginEntryManager } from '../services/login-entry-manager';
import { normalizeUrlOrSearch } from '../services/domain-utils';
import { extractHostname, extractDomain } from '../services/domain-utils';
import { AUTOFILL_PRELOAD } from '../../shared/constants';
import * as path from 'path';

export function registerTabsIpc(): void {
  // Create a new guest tab
  ipcMain.handle(IPC_CHANNELS.TAB_CREATE_GUEST, async (): Promise<IpcResponse> => {
    try {
      const tabInfo = await tabManager.createGuestTab();
      const view = createViewForTab(tabInfo.id, tabInfo.partitionId);
      tabManager.setView(tabInfo.id, view);

      // Set up web contents event forwarding
      setupViewEvents(tabInfo.id, view);

      // Load blank page
      view.webContents.loadURL('about:blank');

      return { success: true, data: tabInfo };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Create a login-entry tab (new tab with credential)
  ipcMain.handle(IPC_CHANNELS.TAB_CREATE_LOGIN, async (_event, payload: { loginEntryId: string; url: string }): Promise<IpcResponse> => {
    try {
      const { loginEntryId, url } = payload;
      const normalizedUrl = normalizeUrlOrSearch(url);

      // Check if there's already an active tab for this login+domain
      const domain = extractDomain(normalizedUrl);
      if (domain) {
        const existingTab = tabManager.findTabByLoginAndDomain(loginEntryId, domain);
        if (existingTab) {
          // Switch to existing tab
          await tabManager.switchToTab(existingTab.id);
          return { success: true, data: { ...existingTab, switched: true } };
        }
      }

      // Create new isolated tab
      const tabInfo = await tabManager.createLoginEntryTab(loginEntryId, normalizedUrl);
      const view = createViewForTab(tabInfo.id, tabInfo.partitionId);
      tabManager.setView(tabInfo.id, view);

      // Set up web contents event forwarding
      setupViewEvents(tabInfo.id, view);

      // Load the URL
      view.webContents.loadURL(normalizedUrl);

      // Wait for page to load, then autofill
      view.webContents.on('did-finish-load', async () => {
        const secretRef = loginEntryManager.getSecretRef(loginEntryId);
        if (!secretRef) return;

        const entry = loginEntryManager.getById(loginEntryId);
        if (!entry) return;

        const currentUrl = view.webContents.getURL();
        if (domain && extractDomain(currentUrl) === domain) {
          await autofillEngine.autofill(view, {
            url: currentUrl,
            username: entry.usernameOrEmail,
            passwordSecretRef: secretRef,
          });

          // Mark as logged in
          statusManager.markLoggedIn(loginEntryId, domain, tabInfo.id);
        }
      });

      return { success: true, data: tabInfo };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Switch to a tab by ID
  ipcMain.handle(IPC_CHANNELS.TAB_SWITCH, async (_event, tabId: string): Promise<IpcResponse> => {
    try {
      await tabManager.switchToTab(tabId);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Close a tab
  ipcMain.handle(IPC_CHANNELS.TAB_CLOSE, async (_event, tabId: string): Promise<IpcResponse> => {
    try {
      await tabManager.closeTab(tabId);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Navigate active tab to URL
  ipcMain.handle(IPC_CHANNELS.TAB_NAVIGATE, async (_event, url: string): Promise<IpcResponse> => {
    try {
      const normalizedUrl = normalizeUrlOrSearch(url);
      tabManager.navigateActiveTab(normalizedUrl);
      return { success: true, data: { url: normalizedUrl } };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Go back
  ipcMain.handle(IPC_CHANNELS.TAB_GO_BACK, async (): Promise<IpcResponse> => {
    try {
      tabManager.goBack();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Go forward
  ipcMain.handle(IPC_CHANNELS.TAB_GO_FORWARD, async (): Promise<IpcResponse> => {
    try {
      tabManager.goForward();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Refresh
  ipcMain.handle(IPC_CHANNELS.TAB_REFRESH, async (): Promise<IpcResponse> => {
    try {
      tabManager.refresh();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // List all tabs
  ipcMain.handle(IPC_CHANNELS.TAB_LIST, async (): Promise<IpcResponse> => {
    try {
      const tabs = tabManager.listTabs();
      return { success: true, data: tabs };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}

// ---- Helper functions ----

function createViewForTab(tabId: string, partitionId: string): BrowserView {
  const view = new BrowserView({
    webPreferences: {
      partition: partitionId,
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      // Autofill preload — injected into webview content
      preload: path.join(__dirname, '../../preload/autofill-preload.js'),
    },
  });

  return view;
}

/**
 * Set up event forwarding from the webview to the renderer process.
 * This keeps the renderer's UI in sync with webview state.
 */
function setupViewEvents(tabId: string, view: BrowserView): void {
  const wc = view.webContents;

  const sendToRenderer = (channel: string, data: any) => {
    const wins = BrowserWindow.getAllWindows();
    for (const win of wins) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, data);
      }
    }
  };

  // URL changed
  wc.on('did-navigate', (_event, url) => {
    sendToRenderer(IPC_CHANNELS.EVENT_TAB_URL_CHANGED, {
      tabId,
      url,
      domain: extractDomain(url),
      canGoBack: wc.canGoBack(),
      canGoForward: wc.canGoForward(),
    });
  });

  wc.on('did-navigate-in-page', (_event, url) => {
    sendToRenderer(IPC_CHANNELS.EVENT_TAB_URL_CHANGED, {
      tabId,
      url,
      domain: extractDomain(url),
      canGoBack: wc.canGoBack(),
      canGoForward: wc.canGoForward(),
    });
  });

  // Page title changed
  wc.on('page-title-updated', (_event, title) => {
    sendToRenderer(IPC_CHANNELS.EVENT_PAGE_TITLE_CHANGED, { tabId, title });
  });

  // Loading state
  wc.on('did-start-loading', () => {
    sendToRenderer(IPC_CHANNELS.EVENT_NAVIGATION_STATE_CHANGED, { tabId, isLoading: true });
  });

  wc.on('did-stop-loading', () => {
    sendToRenderer(IPC_CHANNELS.EVENT_NAVIGATION_STATE_CHANGED, { tabId, isLoading: false });
  });

  // Update DB when navigated
  wc.on('did-navigate', (_event, url) => {
    try {
      const { getDatabase } = require('../db');
      const db = getDatabase();
      db.prepare('UPDATE tabs SET current_url = ?, domain = ? WHERE id = ?')
        .run(url, extractDomain(url), tabId);
    } catch {
      // DB may not be ready
    }
  });
}

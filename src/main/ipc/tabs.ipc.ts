// ============================================================================
// Tabs IPC Handlers
// ============================================================================

import { ipcMain, BrowserWindow, BrowserView, Menu, MenuItemConstructorOptions, clipboard, shell, session as electronSession } from 'electron';
import { IPC_CHANNELS, IpcResponse, PageInfo } from '../../shared/types';
import { tabManager } from '../services/tab-manager';
import { autofillEngine } from '../services/autofill-engine';
import { downloadManager } from '../services/download-manager';
import { statusManager } from '../services/status-manager';
import { loginEntryManager } from '../services/login-entry-manager';
import { loginPageManager } from '../services/login-page-manager';
import { normalizeUrlOrSearch } from '../services/domain-utils';
import { extractHostname, extractDomain } from '../services/domain-utils';
import { canGoBack, canGoForward, goBack as wcGoBack, goForward as wcGoForward } from '../services/webcontents-utils';
import {
  describeNetError,
  mapHttpStatus,
  renderErrorPage,
  errorPageDataUrl,
} from '../services/error-page';
import { AUTOFILL_PRELOAD } from '../../shared/constants';
import { getDatabase } from '../db';
import * as path from 'path';

/** Broadcast a message to every open app window (the renderer UI). */
function broadcast(channel: string, data: any): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  }
}

/** Push refreshed per-site status for a domain to the renderer. */
export function emitStatusChanged(domain: string | null): void {
  broadcast(IPC_CHANNELS.EVENT_STATUS_CHANGED, { domain });
}

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

      // Check if there's already an active tab for this login+domain.
      // Dedup uses the RAW tab domain (tabs store their raw domain), but status
      // is keyed on the CANONICAL account domain so it stays in sync across the
      // login page, main site and related URLs.
      const domain = extractDomain(normalizedUrl);
      const accountDomain = loginPageManager.canonicalAccountDomain(normalizedUrl) || domain;
      if (domain) {
        const existingTab = tabManager.findTabByLoginAndDomain(loginEntryId, domain);
        if (existingTab) {
          // Switch to existing tab. Re-mark this account as the active one so
          // any previously-active account on this domain becomes "used" and
          // this one takes over the single active-tab slot.
          await tabManager.switchToTab(existingTab.id);
          if (accountDomain) {
            statusManager.markLoggedIn(loginEntryId, accountDomain, existingTab.id);
            emitStatusChanged(accountDomain);
          }
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

      // Wait for the page to load, then autofill — but only ONCE. The old
      // handler stayed attached and re-ran autofill on every finish-load
      // (each SPA re-render), wasting work and risking overwriting user input.
      let autofilled = false;
      const onFirstLoad = async () => {
        if (autofilled) return;

        const secretRef = loginEntryManager.getSecretRef(loginEntryId);
        if (!secretRef) return;

        const entry = loginEntryManager.getById(loginEntryId);
        if (!entry) return;

        const currentUrl = view.webContents.getURL();
        if (domain && extractDomain(currentUrl) === domain) {
          autofilled = true;
          view.webContents.off('did-finish-load', onFirstLoad);
          await autofillEngine.autofill(view, {
            url: currentUrl,
            username: entry.usernameOrEmail,
            passwordSecretRef: secretRef,
          });

          // Mark as logged in on the CANONICAL account domain (so the login
          // page, main site and related URLs share one status) and notify the
          // renderer to refresh the sidebar.
          const canonical = loginPageManager.canonicalAccountDomain(currentUrl) || domain;
          statusManager.markLoggedIn(loginEntryId, canonical, tabInfo.id);
          emitStatusChanged(canonical);
        }
      };
      view.webContents.on('did-finish-load', onFirstLoad);

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

  // Show/hide a shell overlay (modal). Detaches the web view so the modal in
  // the renderer is visible and clickable above any loaded page.
  ipcMain.handle(IPC_CHANNELS.VIEW_SET_OVERLAY, async (_event, visible: boolean): Promise<IpcResponse> => {
    try {
      tabManager.setOverlay(!!visible);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Show a bookmark folder's contents as a NATIVE dropdown menu. A native
  // Electron menu always renders above the web view, so — unlike an HTML
  // dropdown — it needs no BrowserView detach (no page flash / reload).
  // Left-click navigates the active tab; the menu also offers open-in-new-tab.
  ipcMain.handle(IPC_CHANNELS.BOOKMARK_SHOW_FOLDER_MENU, async (
    _event,
    payload: { items: Array<{ title: string; url: string }>; x?: number; y?: number }
  ): Promise<IpcResponse> => {
    try {
      const items = Array.isArray(payload?.items) ? payload.items : [];
      const template: MenuItemConstructorOptions[] = [];

      if (items.length === 0) {
        template.push({ label: '(empty)', enabled: false });
      } else {
        for (const bm of items) {
          const url = bm.url;
          const label = (bm.title && bm.title.trim()) ? bm.title.trim() : url;
          template.push({
            label: label.length > 60 ? label.slice(0, 59) + '…' : label,
            submenu: [
              { label: 'Open', click: () => { tabManager.navigateActiveTab(normalizeUrlOrSearch(url)); } },
              { label: 'Open in New Tab', click: () => { openUrlInNewTab(url); } },
              { label: 'Copy Address', click: () => { clipboard.writeText(url); } },
            ],
            // A plain left-click on the label opens it in the current tab.
            click: () => { tabManager.navigateActiveTab(normalizeUrlOrSearch(url)); },
          });
        }
      }

      const menu = Menu.buildFromTemplate(template);
      const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed());
      const x = typeof payload?.x === 'number' ? Math.round(payload.x) : undefined;
      const y = typeof payload?.y === 'number' ? Math.round(payload.y) : undefined;
      menu.popup(win ? { window: win, x, y } : { x, y });
      return { success: true };
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
      // ---- Performance ----
      // Keep the active page's timers/rAF running at full speed (no throttling)
      // so scrolling and animations stay smooth.
      backgroundThrottling: false,
      // Cache decoded images between navigations for snappier back/forward.
      // (Electron/Chromium defaults are conservative; these are safe wins.)
      webgl: true,
    },
  });

  // A solid background avoids a white flash + an extra full-page repaint on
  // first paint, which makes navigations feel faster.
  view.setBackgroundColor('#ffffff');

  // Capture downloads triggered from this tab's session (browser-style
  // downloads: progress, pause/resume, history, open-in-folder, etc.).
  downloadManager.attachToWebContents(view.webContents);

  return view;
}

/**
 * Set up event forwarding from the webview to the renderer process.
 * This keeps the renderer's UI in sync with webview state.
 */
function setupViewEvents(tabId: string, view: BrowserView): void {
  const wc = view.webContents;

  const emitUrl = (url: string) => {
    broadcast(IPC_CHANNELS.EVENT_TAB_URL_CHANGED, {
      tabId,
      url,
      domain: extractDomain(url),
      canGoBack: canGoBack(wc),
      canGoForward: canGoForward(wc),
    });
  };

  const emitNavState = (isLoading: boolean) => {
    broadcast(IPC_CHANNELS.EVENT_NAVIGATION_STATE_CHANGED, {
      tabId,
      isLoading,
      canGoBack: canGoBack(wc),
      canGoForward: canGoForward(wc),
    });
  };

  // ---- Estimated load progress (0..1) ----
  // Chromium does not expose a true byte-level loading percentage, so we
  // synthesize a smooth, believable progress from the navigation lifecycle:
  //   start-loading -> 0.08, start-navigation -> 0.25, dom-ready -> 0.65,
  //   each frame finish nudges it up, stop-loading -> 1.0 (then hidden).
  let progress = 0;
  const emitProgress = (value: number) => {
    // Never go backwards during a single load; clamp to [0,1].
    progress = Math.max(progress, Math.min(1, value));
    broadcast(IPC_CHANNELS.EVENT_LOAD_PROGRESS, { tabId, progress });
  };
  const resetProgress = () => { progress = 0; };

  // URL changed (full navigation + in-page/SPA navigation).
  // `did-navigate` also reports the main-frame HTTP status code. When the
  // server returns a hard error status (>=400) we render our own error page —
  // but ONLY if the server sent no meaningful body of its own (many sites
  // serve custom 404/503 pages we should keep). We can't read the body here, so
  // we heuristically override only for statuses that commonly return an empty
  // body from proxies/load-balancers (502/503/504) plus 5xx; 4xx pages are far
  // more likely to carry real content and are left untouched.
  wc.on('did-navigate', (_event, url, httpResponseCode) => {
    emitUrl(url);
    persistTabUrl(tabId, url);

    const status = typeof httpResponseCode === 'number' ? httpResponseCode : 0;
    if (status === 502 || status === 503 || status === 504) {
      // Give the site a moment to paint its own body; if the document is empty
      // (no visible text), show our branded error page instead of a blank tab.
      setTimeout(() => {
        if (wc.isDestroyed()) return;
        wc.executeJavaScript('document.body ? document.body.innerText.trim().length : 0', true)
          .then((len: number) => {
            if (!wc.isDestroyed() && (!len || len < 2)) {
              const info = mapHttpStatus(status);
              const html = renderErrorPage({
                title: info.title,
                message: info.message,
                hint: info.hint,
                code: `HTTP ${status}`,
                failedUrl: url,
              });
              wc.loadURL(errorPageDataUrl(html));
            }
          })
          .catch(() => { /* page gone / cross-origin — leave as-is */ });
      }, 400);
    }
  });

  wc.on('did-navigate-in-page', (_event, url) => {
    emitUrl(url);
    persistTabUrl(tabId, url);
  });

  // Network-level load failure on the MAIN frame (DNS, connection refused/reset,
  // timeout, offline, SSL, etc.). Render a branded error page with a Retry
  // button. Ignore sub-frame failures and benign aborts (-3, ERR_ABORTED —
  // fired on redirects and when the user navigates away mid-load), and never
  // recurse on our own data: error page.
  wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    if (errorCode === -3) return; // ERR_ABORTED — usually not a real failure
    if ((validatedURL || '').startsWith('data:text/html')) return; // our error page
    if (wc.isDestroyed()) return;

    const info = describeNetError(errorCode, errorDescription);
    const html = renderErrorPage({
      title: info.title,
      message: info.message,
      hint: info.hint,
      code: `${errorDescription || 'ERROR'} (${errorCode})`,
      failedUrl: validatedURL || wc.getURL() || 'about:blank',
    });
    wc.loadURL(errorPageDataUrl(html));
  });

  // Page title changed
  wc.on('page-title-updated', (_event, title) => {
    broadcast(IPC_CHANNELS.EVENT_PAGE_TITLE_CHANGED, { tabId, title });
  });

  // Loading state — include nav availability so back/forward buttons update.
  wc.on('did-start-loading', () => {
    emitNavState(true);
    resetProgress();
    emitProgress(0.08);
  });
  wc.on('did-stop-loading', () => {
    emitNavState(false);
    emitProgress(1);
  });

  // Progress milestones through the navigation lifecycle.
  wc.on('did-start-navigation', (_e, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) emitProgress(0.25);
  });
  wc.on('did-frame-finish-load', (_e, isMainFrame) => {
    // Sub-frames nudge progress up a little; the main frame is nearly done.
    emitProgress(isMainFrame ? 0.9 : Math.min(0.85, progress + 0.05));
  });

  // Emit an authoritative nav state once the DOM is ready, so buttons reflect
  // history even for the very first load.
  wc.on('dom-ready', () => {
    emitNavState(wc.isLoading());
    emitProgress(0.65);
  });

  // Drop the per-tab persisted-URL cache when the view goes away.
  wc.on('destroyed', () => { lastPersistedUrl.delete(tabId); });

  // ---- Native right-click context menu (Issue 4) ----
  // A BrowserView has no default context menu, so we build one from the
  // Chromium `params` describing what the user right-clicked (link, image,
  // selection, editable field, or plain page) and pop it up at the cursor.
  wc.on('context-menu', (_event, params) => {
    if (wc.isDestroyed()) return;

    const items: MenuItemConstructorOptions[] = [];
    const sep = () => { if (items.length && items[items.length - 1].type !== 'separator') items.push({ type: 'separator' }); };

    // --- Link actions ---
    if (params.linkURL) {
      items.push({
        label: 'Open Link in New Tab',
        click: () => { openUrlInNewTab(params.linkURL); },
      });
      items.push({
        label: 'Open Link',
        click: () => { if (!wc.isDestroyed()) wc.loadURL(params.linkURL); },
      });
      items.push({
        label: 'Copy Link Address',
        click: () => { clipboard.writeText(params.linkURL); },
      });
      items.push({
        label: 'Open Link in Browser',
        click: () => { shell.openExternal(params.linkURL).catch(() => { /* ignore */ }); },
      });
      sep();
    }

    // --- Image actions ---
    if (params.mediaType === 'image' && params.srcURL) {
      items.push({
        label: 'Open Image in New Tab',
        click: () => { openUrlInNewTab(params.srcURL); },
      });
      items.push({
        label: 'Copy Image',
        click: () => { if (!wc.isDestroyed()) wc.copyImageAt(params.x, params.y); },
      });
      items.push({
        label: 'Copy Image Address',
        click: () => { clipboard.writeText(params.srcURL); },
      });
      sep();
    }

    // --- Editable field actions ---
    if (params.isEditable) {
      const f = params.editFlags;
      items.push({ label: 'Cut', enabled: f.canCut, role: 'cut' });
      items.push({ label: 'Copy', enabled: f.canCopy, role: 'copy' });
      items.push({ label: 'Paste', enabled: f.canPaste, role: 'paste' });
      items.push({ label: 'Select All', enabled: f.canSelectAll, role: 'selectAll' });
      sep();
    } else if (params.selectionText && params.selectionText.trim()) {
      // --- Selected (non-editable) text ---
      items.push({ label: 'Copy', role: 'copy' });
      const q = encodeURIComponent(params.selectionText.trim().slice(0, 200));
      items.push({
        label: 'Search Web for Selection',
        click: () => { openUrlInNewTab(`https://www.google.com/search?q=${q}`); },
      });
      sep();
    }

    // --- Navigation + page actions (always available) ---
    items.push({ label: 'Back', enabled: canGoBack(wc), click: () => { if (!wc.isDestroyed()) wcGoBack(wc); } });
    items.push({ label: 'Forward', enabled: canGoForward(wc), click: () => { if (!wc.isDestroyed()) wcGoForward(wc); } });
    items.push({ label: 'Reload', click: () => { if (!wc.isDestroyed()) wc.reload(); } });
    sep();
    items.push({
      label: 'Copy Page URL',
      click: () => { if (!wc.isDestroyed()) clipboard.writeText(wc.getURL()); },
    });
    items.push({
      label: 'Inspect Element',
      click: () => { if (!wc.isDestroyed()) wc.inspectElement(params.x, params.y); },
    });

    const menu = Menu.buildFromTemplate(items);
    const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed());
    menu.popup(win ? { window: win } : undefined);
  });
}

/**
 * Open a URL in a brand-new guest tab, switch to it, and tell the renderer to
 * add it to the tab strip. Used by the webpage context menu ("Open Link in New
 * Tab", "Open Image in New Tab", "Search Web for Selection").
 */
async function openUrlInNewTab(url: string): Promise<void> {
  if (!url) return;
  try {
    const normalizedUrl = normalizeUrlOrSearch(url);
    const tabInfo = await tabManager.createGuestTab();
    const view = createViewForTab(tabInfo.id, tabInfo.partitionId);
    tabManager.setView(tabInfo.id, view);
    setupViewEvents(tabInfo.id, view);
    view.webContents.loadURL(normalizedUrl);

    // Reflect the destination URL immediately so the tab strip does not flash
    // "New Tab" before the first navigation event arrives.
    const created = { ...tabInfo, currentUrl: normalizedUrl, domain: extractDomain(normalizedUrl) };
    broadcast(IPC_CHANNELS.EVENT_TAB_CREATED, created);
    await tabManager.switchToTab(tabInfo.id);
  } catch (err) {
    console.error('[Tabs] openUrlInNewTab failed:', err);
  }
}

// Remember the last URL persisted per tab so repeated events for the same URL
// (common with SPA in-page navigation) don't hit SQLite again.
const lastPersistedUrl = new Map<string, string>();

function persistTabUrl(tabId: string, url: string): void {
  // Keep the tab manager's in-memory URL in sync with the real page (it
  // short-circuits when unchanged) so tab dedup and the canonical account
  // domain used on tab-close stay accurate after redirects / SPA navigations.
  tabManager.syncTabUrl(tabId, url);

  if (lastPersistedUrl.get(tabId) === url) return;
  lastPersistedUrl.set(tabId, url);
  try {
    const db = getDatabase();
    db.prepare('UPDATE tabs SET current_url = ?, domain = ? WHERE id = ?')
      .run(url, extractDomain(url), tabId);
  } catch {
    // DB may not be ready
  }
}

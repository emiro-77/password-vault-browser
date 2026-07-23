// ============================================================================
// Tab Manager — Creates, tracks, and destroys isolated tab sessions
// ============================================================================
//
// Each tab gets its own Chromium StoragePartition via Electron's `partition` API.
// Guest tabs use 'pvb-guest-<uuid>' (temporary partitions).
// Login-entry tabs use 'pvb-login-<uuid>' (temporary partitions).
//
// On tab close: partition session data is cleared and the partition is released.

import { BrowserView, session as electronSession, BrowserWindow } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { TabInfo, TabType } from '../../shared/types';
import { getDatabase } from '../db';
import { extractDomain } from './domain-utils';
import { canGoBack, canGoForward, goBack, goForward, computeViewBounds } from './webcontents-utils';

/** Default chrome height (address bar + bookmarks bar + tab strip) until the
 *  renderer reports the exact value via IPC. Must match the renderer's
 *  CHROME_HEIGHT constant. */
const DEFAULT_CHROME_HEIGHT = 120;
import {
  PARTITION_PREFIX_GUEST,
  PARTITION_PREFIX_LOGIN,
  SIDEBAR_WIDTH,
} from '../../shared/constants';

interface TabEntry {
  info: TabInfo;
  view: BrowserView | null;
}

export class TabManager {
  private tabs: Map<string, TabEntry> = new Map();
  private activeTabId: string | null = null;
  private window: BrowserWindow | null = null;
  /** Last chrome height reported by the renderer; used to position views. */
  private chromeHeight: number = DEFAULT_CHROME_HEIGHT;
  /** Last sidebar width reported by the renderer; used to position views.
   *  Falls back to the SIDEBAR_WIDTH constant until the renderer reports one. */
  private sidebarWidth: number = SIDEBAR_WIDTH;
  /** When true, the active web view is detached so a shell modal/overlay in the
   *  renderer can receive focus & clicks (a BrowserView always renders above the
   *  shell HTML, so it must be removed, not just z-index'd). */
  private overlayActive: boolean = false;

  /**
   * Attach the tab manager to a browser window.
   */
  attachToWindow(win: BrowserWindow): void {
    this.window = win;
  }

  /**
   * Create a new guest tab (no credentials attached).
   * Returns the tab info with its partition ID.
   */
  async createGuestTab(): Promise<TabInfo> {
    const id = uuidv4();
    const partitionId = `${PARTITION_PREFIX_GUEST}${uuidv4()}`;
    const now = new Date().toISOString();

    const info: TabInfo = {
      id,
      type: 'guest',
      currentUrl: 'about:blank',
      domain: null,
      loginEntryId: null,
      partitionId,
      createdAt: now,
      lastActiveAt: now,
    };

    // Persist to DB
    const db = getDatabase();
    db.prepare(`
      INSERT INTO tabs (id, type, current_url, domain, login_entry_id, partition_id, created_at, last_active_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(info.id, info.type, info.currentUrl, info.domain, info.loginEntryId, info.partitionId, info.createdAt, info.lastActiveAt);

    this.tabs.set(id, { info, view: null });

    console.log(`[TabManager] Created guest tab: ${id} (partition: ${partitionId})`);
    return info;
  }

  /**
   * Create a new login-entry tab associated with a specific credential.
   */
  async createLoginEntryTab(loginEntryId: string, url: string): Promise<TabInfo> {
    const id = uuidv4();
    const partitionId = `${PARTITION_PREFIX_LOGIN}${uuidv4()}`;
    const now = new Date().toISOString();

    const domain = extractDomain(url) || null;

    const info: TabInfo = {
      id,
      type: 'login_entry',
      currentUrl: url,
      domain,
      loginEntryId,
      partitionId,
      createdAt: now,
      lastActiveAt: now,
    };

    // Persist to DB
    const db = getDatabase();
    db.prepare(`
      INSERT INTO tabs (id, type, current_url, domain, login_entry_id, partition_id, created_at, last_active_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(info.id, info.type, info.currentUrl, info.domain, info.loginEntryId, info.partitionId, info.createdAt, info.lastActiveAt);

    this.tabs.set(id, { info, view: null });

    console.log(`[TabManager] Created login-entry tab: ${id} (loginEntry: ${loginEntryId}, partition: ${partitionId})`);
    return info;
  }

  /**
   * Get tab info by ID.
   */
  getTab(id: string): TabInfo | null {
    const entry = this.tabs.get(id);
    return entry ? { ...entry.info } : null;
  }

  /**
   * Get the BrowserView for a tab.
   */
  getView(id: string): BrowserView | null {
    const entry = this.tabs.get(id);
    return entry?.view || null;
  }

  /**
   * Attach a BrowserView to a tab.
   */
  setView(id: string, view: BrowserView): void {
    const entry = this.tabs.get(id);
    if (!entry) {
      throw new Error(`Tab not found: ${id}`);
    }
    entry.view = view;
  }

  /**
   * List all active tabs.
   */
  listTabs(): TabInfo[] {
    return Array.from(this.tabs.values()).map(e => ({ ...e.info }));
  }

  /**
   * Get the active tab ID.
   */
  getActiveTabId(): string | null {
    return this.activeTabId;
  }

  /**
   * Get the active tab info.
   */
  getActiveTab(): TabInfo | null {
    if (!this.activeTabId) return null;
    return this.getTab(this.activeTabId);
  }

  /**
   * Switch to a tab by ID.
   * Updates the BrowserWindow to show the correct BrowserView.
   */
  async switchToTab(tabId: string): Promise<void> {
    const entry = this.tabs.get(tabId);
    if (!entry || !this.window) return;

    // Update active state in DB
    const now = new Date().toISOString();
    const db = getDatabase();
    db.prepare('UPDATE tabs SET last_active_at = ? WHERE id = ?').run(now, tabId);
    entry.info.lastActiveAt = now;

    this.activeTabId = tabId;

    // Remove all existing views from the window
    for (const [, e] of this.tabs) {
      if (e.view && e.info.id !== tabId) {
        try {
          this.window.removeBrowserView(e.view);
        } catch {
          // View may not be attached
        }
      }
    }

    // Add the selected view — unless an overlay/modal is currently showing,
    // in which case the view stays detached until the overlay is dismissed.
    if (entry.view && !this.overlayActive) {
      // Use the sidebar + chrome-aware bounds so the page never overlaps the UI.
      this.window.setBrowserView(entry.view);
      this.applyBounds(entry.view);
    }

    console.log(`[TabManager] Switched to tab: ${tabId}`);
  }

  /**
   * Compute the content-area bounds from the window size, the last reported
   * chrome height (top bar + bookmarks + tab strip) and the sidebar width.
   * Uses the window content bounds (not frame bounds) so the page sits exactly
   * in the client area.
   */
  private applyBounds(view: BrowserView): void {
    if (!this.window) return;
    // getContentBounds excludes the OS window frame/titlebar.
    const bounds = this.window.getContentBounds();
    view.setBounds(computeViewBounds(bounds.width, bounds.height, this.sidebarWidth, this.chromeHeight));
    // Auto-resize so the view follows window resizes between explicit updates.
    view.setAutoResize({ width: true, height: true });
  }

  /**
   * Update the bounds of the active tab's BrowserView.
   * Called when the window is resized or chrome height changes.
   * The chrome height is remembered so future tab switches reuse it.
   */
  updateActiveViewBounds(chromeHeight: number): void {
    if (chromeHeight && chromeHeight > 0) {
      this.chromeHeight = chromeHeight;
    }
    if (!this.activeTabId || !this.window) return;

    const entry = this.tabs.get(this.activeTabId);
    if (!entry?.view) return;

    this.applyBounds(entry.view);
  }

  /**
   * Update the sidebar width used to position the active web view. Called when
   * the renderer collapses/expands the vault sidebar so the BrowserView follows
   * the shell layout instead of leaving a gap or overlapping.
   */
  updateSidebarWidth(sidebarWidth: number): void {
    if (typeof sidebarWidth === 'number' && sidebarWidth >= 0) {
      this.sidebarWidth = sidebarWidth;
    }
    if (!this.activeTabId || !this.window) return;

    const entry = this.tabs.get(this.activeTabId);
    if (!entry?.view) return;

    this.applyBounds(entry.view);
  }

  /**
   * Show or hide a shell overlay/modal. When shown, the active web view is
   * detached from the window so the renderer's modal (plain HTML) becomes
   * visible and interactive; when hidden, the view is reattached.
   */
  setOverlay(visible: boolean): void {
    this.overlayActive = visible;
    if (!this.window) return;

    const entry = this.activeTabId ? this.tabs.get(this.activeTabId) : null;
    if (!entry?.view) return;

    if (visible) {
      try {
        this.window.removeBrowserView(entry.view);
      } catch {
        // Not attached
      }
    } else {
      this.window.setBrowserView(entry.view);
      this.applyBounds(entry.view);
    }
  }

  /**
   * Close a tab: destroy session data, clean up BrowserView, remove from tracking.
   */
  async closeTab(tabId: string): Promise<void> {
    const entry = this.tabs.get(tabId);
    if (!entry) return;

    console.log(`[TabManager] Closing tab: ${tabId} (partition: ${entry.info.partitionId})`);

    // 1. Remove BrowserView from window
    if (entry.view && this.window) {
      try {
        this.window.removeBrowserView(entry.view);
      } catch {
        // Already removed
      }

      try {
        // Destroy the web contents
        (entry.view as any).webContents?.destroy();
      } catch {
        // May already be destroyed
      }
    }

    // 2. Clear partition session data
    try {
      const partitionSession = electronSession.fromPartition(entry.info.partitionId);
      await partitionSession.clearStorageData();
      await partitionSession.clearCache();
      console.log(`[TabManager] Cleared partition data for: ${entry.info.partitionId}`);
    } catch (err) {
      console.error(`[TabManager] Failed to clear partition data:`, err);
    }

    // 3. Update site_login_status for any login-entry tab
    if (entry.info.loginEntryId && entry.info.domain) {
      const db = getDatabase();
      db.prepare(`
        UPDATE site_login_status
        SET active_tab_id = NULL, status = 'logged_in'
        WHERE login_entry_id = ? AND domain = ? AND active_tab_id = ?
      `).run(entry.info.loginEntryId, entry.info.domain, tabId);
    }

    // 4. Remove from DB
    try {
      const db = getDatabase();
      db.prepare('DELETE FROM tabs WHERE id = ?').run(tabId);
    } catch (err) {
      console.error(`[TabManager] Failed to remove tab from DB:`, err);
    }

    // 5. Remove from tracking
    this.tabs.delete(tabId);

    // 6. If this was the active tab, switch to another
    if (this.activeTabId === tabId) {
      const remaining = Array.from(this.tabs.keys());
      if (remaining.length > 0) {
        await this.switchToTab(remaining[remaining.length - 1]);
      } else {
        this.activeTabId = null;
      }
    }

    console.log(`[TabManager] Tab ${tabId} closed and cleaned up.`);
  }

  /**
   * Navigate the active tab to a URL.
   */
  navigateActiveTab(url: string): void {
    if (!this.activeTabId) return;

    const entry = this.tabs.get(this.activeTabId);
    if (!entry?.view) return;

    entry.info.currentUrl = url;

    // Update domain
    entry.info.domain = extractDomain(url) || null;

    // Update DB
    try {
      const db = getDatabase();
      db.prepare('UPDATE tabs SET current_url = ?, domain = ? WHERE id = ?')
        .run(url, entry.info.domain, this.activeTabId);
    } catch (err) {
      console.error(`[TabManager] Failed to update tab URL in DB:`, err);
    }

    entry.view.webContents.loadURL(url);
  }

  /**
   * Go back in the active tab's history.
   */
  goBack(): void {
    if (!this.activeTabId) return;
    const view = this.tabs.get(this.activeTabId)?.view;
    if (view?.webContents && canGoBack(view.webContents)) {
      goBack(view.webContents);
    }
  }

  /**
   * Go forward in the active tab's history.
   */
  goForward(): void {
    if (!this.activeTabId) return;
    const view = this.tabs.get(this.activeTabId)?.view;
    if (view?.webContents && canGoForward(view.webContents)) {
      goForward(view.webContents);
    }
  }

  /**
   * Reload the active tab.
   */
  refresh(): void {
    if (!this.activeTabId) return;
    const view = this.tabs.get(this.activeTabId)?.view;
    view?.webContents?.reload();
  }

  /**
   * Find a tab that has the given login entry active on the given domain.
   * Used to deduplicate tabs (switch instead of creating new).
   */
  findTabByLoginAndDomain(loginEntryId: string, domain: string): TabInfo | null {
    for (const [, entry] of this.tabs) {
      if (entry.info.loginEntryId === loginEntryId &&
          entry.info.domain === domain &&
          entry.view !== null) {
        return { ...entry.info };
      }
    }
    return null;
  }

  /**
   * Clean up all tabs. Called on app quit.
   */
  async closeAllTabs(): Promise<void> {
    const tabIds = Array.from(this.tabs.keys());
    for (const id of tabIds) {
      await this.closeTab(id);
    }
  }

  /**
   * Get the count of active tabs.
   */
  getTabCount(): number {
    return this.tabs.size;
  }
}

// Singleton instance
export const tabManager = new TabManager();

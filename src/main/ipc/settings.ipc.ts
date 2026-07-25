// ============================================================================
// Settings IPC Handlers
// ============================================================================
// Powers the Settings tab:
//   1. Site account management — which sites have saved accounts and what they
//      are (grouped by domain), including each account's per-site status.
//   2. Data management — clear the browser's cache / cookies / site storage.

import { ipcMain, session as electronSession, dialog, BrowserWindow, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
  IPC_CHANNELS,
  IpcResponse,
  SiteAccountsGroup,
  SiteAccountInfo,
  ClearDataRequest,
  ClearDataResult,
  LoginStatus,
  SetAccountStatusRequest,
  ClearAccountTimerRequest,
  ExportDataRequest,
  ExportDataResult,
  ImportDataRequest,
  ImportDataResult,
} from '../../shared/types';
import { loginEntryManager } from '../services/login-entry-manager';
import { statusManager } from '../services/status-manager';
import { sessionManager } from '../services/session-manager';
import { loginPageManager } from '../services/login-page-manager';
import { buildEncryptedExport, importEncryptedBackup, wipeAllVaultData } from '../services/vault-transfer';

export function registerSettingsIpc(): void {
  // ---- Site account management ----
  ipcMain.handle(IPC_CHANNELS.SETTINGS_SITE_ACCOUNTS, async (): Promise<IpcResponse<SiteAccountsGroup[]>> => {
    try {
      const entries = loginEntryManager.listAll();

      // Group entries by their (site) domain. '' = unscoped/legacy accounts.
      const groups = new Map<string, SiteAccountInfo[]>();

      for (const entry of entries) {
        const domain = entry.domain || '';

        // Per-site status: for unscoped accounts there is no domain to key on,
        // so we report 'never_used' (they're global metadata only).
        let status: LoginStatus = 'never_used';
        let lastUsedAt: string | null = null;
        let loggedInUntil: string | null = null;
        let isActiveTab = false;
        if (domain) {
          const st = statusManager.getForEntryAndDomain(entry.id, domain);
          if (st) {
            status = st.status;
            lastUsedAt = st.lastUsedAt;
            loggedInUntil = st.loggedInUntil;
            isActiveTab = st.status === 'active_tab_open' || !!st.activeTabId;
          }
        }

        const info: SiteAccountInfo = {
          loginEntryId: entry.id,
          label: entry.label,
          usernameOrEmail: entry.usernameOrEmail,
          status,
          lastUsedAt,
          loggedInUntil,
          isActiveTab,
        };

        const list = groups.get(domain);
        if (list) list.push(info);
        else groups.set(domain, [info]);
      }

      // Sort accounts within each group by time-remaining, SHORTEST first.
      // Accounts with no timer (never_used / failed / etc.) sort after those
      // with a timer; the active tab (longest remaining, ~24h) ends up last.
      const remainingMs = (a: SiteAccountInfo): number => {
        if (!a.loggedInUntil) return Number.POSITIVE_INFINITY;
        const ms = new Date(a.loggedInUntil).getTime() - Date.now();
        return ms > 0 ? ms : Number.POSITIVE_INFINITY;
      };
      for (const accounts of groups.values()) {
        accounts.sort((a, b) => {
          const ra = remainingMs(a);
          const rb = remainingMs(b);
          if (ra !== rb) return ra - rb;
          // Stable tiebreak for two timer-less accounts: label alphabetical.
          return a.label.localeCompare(b.label);
        });
      }

      // Attach login-page mapping info: a group whose domain matches a
      // mapping's login domain (or, as a fallback, its main domain) is a
      // "login site". This lets Settings visually flag it and show its
      // main/related URLs.
      const mappings = loginPageManager.listAll();
      const mappingByDomain = new Map<string, typeof mappings[number]>();
      for (const m of mappings) {
        if (m.loginDomain) mappingByDomain.set(m.loginDomain, m);
      }

      // Emit sorted: named sites alphabetically, unscoped ('') last.
      const result: SiteAccountsGroup[] = Array.from(groups.entries())
        .map(([domain, accounts]) => ({
          domain,
          accounts,
          loginMapping: (domain && mappingByDomain.get(domain)) || null,
        }))
        .sort((a, b) => {
          if (a.domain === '') return 1;
          if (b.domain === '') return -1;
          return a.domain.localeCompare(b.domain);
        });

      return { success: true, data: result };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ---- Data management: clear browsing data ----
  ipcMain.handle(IPC_CHANNELS.SETTINGS_CLEAR_DATA, async (_event, req: ClearDataRequest): Promise<IpcResponse<ClearDataResult>> => {
    try {
      const request: ClearDataRequest = req || {};
      // Default (no flags at all): clear the BROWSER data (cache/cookies/
      // storage) but NEVER the vault — wiping saved accounts must be an
      // explicit opt-in (request.vault === true), never a side effect of the
      // "clear everything" default.
      const clearAll = !request.cache && !request.cookies && !request.storage && !request.vault;

      const cleared: string[] = [];

      // Collect every session we touch: the default session plus each open
      // tab's isolated partition session.
      const sessions = new Set<Electron.Session>();
      sessions.add(electronSession.defaultSession);
      try {
        const { tabManager } = await import('../services/tab-manager');
        for (const tab of tabManager.listTabs()) {
          try { sessions.add(electronSession.fromPartition(tab.partitionId)); } catch { /* ignore */ }
        }
      } catch { /* ignore — tabManager may not be ready */ }

      const wantCache = clearAll || !!request.cache;
      const wantCookies = clearAll || !!request.cookies;
      const wantStorage = clearAll || !!request.storage;

      for (const s of sessions) {
        if (wantCache) {
          await s.clearCache();
        }
        if (wantCookies || wantStorage) {
          const storages: string[] = [];
          if (wantCookies) storages.push('cookies');
          if (wantStorage) storages.push('localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage', 'shadercache');
          await s.clearStorageData({ storages: storages as any });
        }
      }

      if (wantCache) cleared.push('cache');
      if (wantCookies) cleared.push('cookies');
      if (wantStorage) cleared.push('site storage');

      // Also clear the isolated tab partitions via the session manager so any
      // still-open sessions are fully wiped.
      try { await sessionManager.clearAllSessions(); } catch { /* best-effort */ }

      // Vault wipe (explicit opt-in only): permanently delete saved accounts,
      // bookmarks, saved login pages, per-site status, categories & site rules.
      if (request.vault) {
        try {
          const { tabManager } = await import('../services/tab-manager');
          // Close every open tab first — they reference accounts/URLs that are
          // about to be deleted, so leaving them open would show stale state.
          await tabManager.closeAllTabs().catch(() => {});
        } catch { /* tabManager may not be ready */ }

        const wiped = await wipeAllVaultData();
        cleared.push(
          `vault data (${wiped.accounts} account(s), ${wiped.bookmarks} bookmark(s), ${wiped.loginPages} saved login page(s))`
        );
      }

      return { success: true, data: { cleared } };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ---- Change an account's per-site status (from the edit dialog) ----
  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET_ACCOUNT_STATUS, async (_event, req: SetAccountStatusRequest): Promise<IpcResponse> => {
    try {
      if (!req?.loginEntryId || !req?.domain) {
        return { success: false, error: 'A site (domain) is required to set status.' };
      }
      statusManager.changeStatus(req.loginEntryId, req.domain, req.status);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ---- Delete an account's 24h time-remaining data ----
  ipcMain.handle(IPC_CHANNELS.SETTINGS_CLEAR_ACCOUNT_TIMER, async (_event, req: ClearAccountTimerRequest): Promise<IpcResponse> => {
    try {
      if (!req?.loginEntryId || !req?.domain) {
        return { success: false, error: 'A site (domain) is required to clear the timer.' };
      }
      statusManager.clearTimer(req.loginEntryId, req.domain);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ---- Data export: write an encrypted, cross-platform backup file ----
  ipcMain.handle(IPC_CHANNELS.SETTINGS_EXPORT_DATA, async (event, req: ExportDataRequest): Promise<IpcResponse<ExportDataResult>> => {
    try {
      if (!req?.passphrase || req.passphrase.length < 4) {
        return { success: false, error: 'Enter a passphrase of at least 4 characters to protect the backup.' };
      }

      const { fileContents, summary } = await buildEncryptedExport(req.passphrase);

      const stamp = new Date().toISOString().slice(0, 10);
      const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? undefined;
      const { canceled, filePath } = await dialog.showSaveDialog(win as any, {
        title: 'Export vault backup',
        defaultPath: path.join(app.getPath('documents'), `vault-browser-backup-${stamp}.vaultbackup`),
        filters: [{ name: 'Vault Browser Backup', extensions: ['vaultbackup', 'json'] }],
      });

      if (canceled || !filePath) {
        return { success: true, data: { canceled: true } };
      }

      fs.writeFileSync(filePath, fileContents, { encoding: 'utf8', mode: 0o600 });

      return {
        success: true,
        data: {
          filePath,
          accounts: summary.accounts,
          categories: summary.categories,
          bookmarks: summary.bookmarks,
        },
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ---- Data import: decrypt a backup and OVERWRITE the current vault ----
  ipcMain.handle(IPC_CHANNELS.SETTINGS_IMPORT_DATA, async (event, req: ImportDataRequest): Promise<IpcResponse<ImportDataResult>> => {
    try {
      if (!req?.passphrase) {
        return { success: false, error: 'Enter the passphrase used when the backup was created.' };
      }

      const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? undefined;
      const { canceled, filePaths } = await dialog.showOpenDialog(win as any, {
        title: 'Import vault backup (this overwrites your current data)',
        properties: ['openFile'],
        filters: [{ name: 'Vault Browser Backup', extensions: ['vaultbackup', 'json'] }],
      });

      if (canceled || filePaths.length === 0) {
        return { success: true, data: { canceled: true } };
      }

      const fileContents = fs.readFileSync(filePaths[0], 'utf8');
      const summary = await importEncryptedBackup(fileContents, req.passphrase);

      return {
        success: true,
        data: {
          accounts: summary.accounts,
          categories: summary.categories,
          bookmarks: summary.bookmarks,
        },
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}

// ============================================================================
// Settings IPC Handlers
// ============================================================================
// Powers the Settings tab:
//   1. Site account management — which sites have saved accounts and what they
//      are (grouped by domain), including each account's per-site status.
//   2. Data management — clear the browser's cache / cookies / site storage.

import { ipcMain, session as electronSession } from 'electron';
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
} from '../../shared/types';
import { loginEntryManager } from '../services/login-entry-manager';
import { statusManager } from '../services/status-manager';
import { sessionManager } from '../services/session-manager';

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

      // Emit sorted: named sites alphabetically, unscoped ('') last.
      const result: SiteAccountsGroup[] = Array.from(groups.entries())
        .map(([domain, accounts]) => ({ domain, accounts }))
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
      // Default: clear everything if the caller passed no specific flags.
      const clearAll = !request.cache && !request.cookies && !request.storage;

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
}

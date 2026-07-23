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
        if (domain) {
          const st = statusManager.getForEntryAndDomain(entry.id, domain);
          if (st) {
            status = st.status;
            lastUsedAt = st.lastUsedAt;
          }
        }

        const info: SiteAccountInfo = {
          loginEntryId: entry.id,
          label: entry.label,
          usernameOrEmail: entry.usernameOrEmail,
          status,
          lastUsedAt,
        };

        const list = groups.get(domain);
        if (list) list.push(info);
        else groups.set(domain, [info]);
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
}

// ============================================================================
// Site Rules IPC Handlers — future extension point
// ============================================================================
// These handlers provide an extension point for site-specific autofill selectors.
// For MVP, generic field detection is used. Future versions can store per-site
// CSS selectors for more precise autofill targeting.

import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { IPC_CHANNELS, IpcResponse } from '../../shared/types';
import { getDatabase } from '../db';

export function registerSiteRulesIpc(): void {
  // Get rules for a specific domain
  ipcMain.handle(IPC_CHANNELS.SITE_RULES_GET, async (_event, domain: string): Promise<IpcResponse> => {
    try {
      const db = getDatabase();
      const row = db.prepare('SELECT * FROM site_rules WHERE domain = ?').get(domain) as any;

      if (!row) {
        return { success: true, data: null };
      }

      return {
        success: true,
        data: {
          id: row.id,
          domain: row.domain,
          loginUrlPattern: row.login_url_pattern,
          usernameSelector: row.username_selector,
          passwordSelector: row.password_selector,
          submitSelector: row.submit_selector,
          successIndicatorSelector: row.success_indicator_selector,
        },
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Set/update rules for a domain
  ipcMain.handle(IPC_CHANNELS.SITE_RULES_SET, async (_event, payload: {
    domain: string;
    loginUrlPattern?: string;
    usernameSelector?: string;
    passwordSelector?: string;
    submitSelector?: string;
    successIndicatorSelector?: string;
  }): Promise<IpcResponse> => {
    try {
      const db = getDatabase();
      const { domain, loginUrlPattern, usernameSelector, passwordSelector, submitSelector, successIndicatorSelector } = payload;

      const existing = db.prepare('SELECT id FROM site_rules WHERE domain = ?').get(domain) as any;

      if (existing) {
        db.prepare(`
          UPDATE site_rules SET
            login_url_pattern = ?,
            username_selector = ?,
            password_selector = ?,
            submit_selector = ?,
            success_indicator_selector = ?
          WHERE domain = ?
        `).run(loginUrlPattern ?? null, usernameSelector ?? null, passwordSelector ?? null, submitSelector ?? null, successIndicatorSelector ?? null, domain);
      } else {
        uuidv4
        db.prepare(`
          INSERT INTO site_rules (id, domain, login_url_pattern, username_selector, password_selector, submit_selector, success_indicator_selector)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(uuidv4(), domain, loginUrlPattern ?? null, usernameSelector ?? null, passwordSelector ?? null, submitSelector ?? null, successIndicatorSelector ?? null);
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}

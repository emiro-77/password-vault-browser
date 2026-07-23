// ============================================================================
// Status Manager — Site-specific login status per (login_entry × domain)
// ============================================================================
//
// Design:
// - Status is tracked per (login_entry_id, domain) pair
// - "logged_in" status expires after 24 hours (LOGGED_IN_DURATION_MS)
// - Status is app-managed state, not real auth detection
// - The app explicitly labels this in the UI

import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db';
import { SiteLoginStatus, LoginStatus } from '../../shared/types';
import { LOGGED_IN_DURATION_MS } from '../../shared/constants';

export class StatusManager {
  /**
   * Get status for all login entries on a specific domain.
   * Returns current computed status (handles expiry).
   */
  getForDomain(domain: string): (SiteLoginStatus & { loginLabel: string; loginUsername: string })[] {
    const db = getDatabase();
    this.expireStale(Date.now());
    const rows = db.prepare(`
      SELECT s.*, l.label as login_label, l.username_or_email as login_username
      FROM site_login_status s
      JOIN login_entries l ON l.id = s.login_entry_id
      WHERE s.domain = ?
      ORDER BY s.last_used_at DESC
    `).all(domain) as any[];

    const now = Date.now();

    return rows.map(r => {
      // Compute current status
      const currentStatus = this.computeCurrentStatus(r, now);

      return {
        id: r.id,
        loginEntryId: r.login_entry_id,
        domain: r.domain,
        status: currentStatus,
        firstLoginAt: r.first_login_at,
        loggedInUntil: r.logged_in_until,
        lastUsedAt: r.last_used_at,
        activeTabId: r.active_tab_id,
        loginLabel: r.login_label,
        loginUsername: r.login_username,
      };
    });
  }

  /**
   * Get all site login statuses across all domains for a specific login entry.
   */
  getForLoginEntry(loginEntryId: string): SiteLoginStatus[] {
    const db = getDatabase();
    this.expireStale(Date.now());
    const rows = db.prepare(
      'SELECT * FROM site_login_status WHERE login_entry_id = ?'
    ).all(loginEntryId) as any[];

    const now = Date.now();

    return rows.map(r => {
      const currentStatus = this.computeCurrentStatus(r, now);
      return {
        id: r.id,
        loginEntryId: r.login_entry_id,
        domain: r.domain,
        status: currentStatus,
        firstLoginAt: r.first_login_at,
        loggedInUntil: r.logged_in_until,
        lastUsedAt: r.last_used_at,
        activeTabId: r.active_tab_id,
      };
    });
  }

  /**
   * Get all site login statuses for all entries (for sidebar metadata).
   */
  getAll(): (SiteLoginStatus & { loginLabel: string; loginUsername: string })[] {
    const db = getDatabase();
    this.expireStale(Date.now());
    const rows = db.prepare(`
      SELECT s.*, l.label as login_label, l.username_or_email as login_username
      FROM site_login_status s
      JOIN login_entries l ON l.id = s.login_entry_id
      ORDER BY s.last_used_at DESC
    `).all() as any[];

    const now = Date.now();

    return rows.map(r => {
      const currentStatus = this.computeCurrentStatus(r, now);
      return {
        id: r.id,
        loginEntryId: r.login_entry_id,
        domain: r.domain,
        status: currentStatus,
        firstLoginAt: r.first_login_at,
        loggedInUntil: r.logged_in_until,
        lastUsedAt: r.last_used_at,
        activeTabId: r.active_tab_id,
        loginLabel: r.login_label,
        loginUsername: r.login_username,
      };
    });
  }

  /**
   * Mark a login entry as the active account for a domain.
   *
   * Only ONE account per domain may be the "active tab" (the last logged-in
   * account). Any other account on this domain that was previously active is
   * demoted to "used" (shown red) so the sidebar always shows exactly one
   * active account.
   *
   * The 24h window is tracked from the FIRST login: `first_login_at` and
   * `logged_in_until` are only set the first time (or once a previous window
   * has fully expired / been reset), not on every re-selection.
   */
  markLoggedIn(loginEntryId: string, domain: string, tabId: string): SiteLoginStatus {
    const db = getDatabase();
    const nowIso = new Date().toISOString();

    // Demote every OTHER active account on this domain to "used" and clear its
    // active tab link — there can be only one active account per domain.
    db.prepare(`
      UPDATE site_login_status
      SET status = 'used', active_tab_id = NULL, last_used_at = ?
      WHERE domain = ? AND login_entry_id != ?
        AND (active_tab_id IS NOT NULL OR status IN ('logged_in','active_tab_open'))
    `).run(nowIso, domain, loginEntryId);

    // Determine whether the 24h window should (re)start. It starts if there is
    // no prior first_login_at, or the previous window has fully lapsed.
    const existing = db.prepare(
      'SELECT * FROM site_login_status WHERE login_entry_id = ? AND domain = ?'
    ).get(loginEntryId, domain) as any;

    const windowExpired = !existing?.first_login_at
      || !existing?.logged_in_until
      || Date.now() > new Date(existing.logged_in_until).getTime();

    const firstLoginAt = windowExpired ? nowIso : existing.first_login_at;
    const loggedInUntil = windowExpired
      ? new Date(Date.now() + LOGGED_IN_DURATION_MS).toISOString()
      : existing.logged_in_until;

    return this.upsertStatus(loginEntryId, domain, {
      status: 'logged_in',
      firstLoginAt,
      loggedInUntil,
      lastUsedAt: nowIso,
      activeTabId: tabId,
    });
  }

  /**
   * Update the active tab link for a login entry/domain pair.
   */
  updateActiveTab(loginEntryId: string, domain: string, tabId: string | null): void {
    const db = getDatabase();
    db.prepare(`
      UPDATE site_login_status
      SET active_tab_id = ?, last_used_at = ?
      WHERE login_entry_id = ? AND domain = ?
    `).run(tabId, new Date().toISOString(), loginEntryId, domain);
  }

  /**
   * Mark a login entry as having a specific status for a domain.
   */
  setStatus(loginEntryId: string, domain: string, status: LoginStatus): void {
    this.upsertStatus(loginEntryId, domain, { status });
  }

  /**
   * Get status for a specific login entry on a specific domain.
   */
  getForEntryAndDomain(loginEntryId: string, domain: string): SiteLoginStatus | null {
    const db = getDatabase();
    this.expireStale(Date.now());
    const row = db.prepare(
      'SELECT * FROM site_login_status WHERE login_entry_id = ? AND domain = ?'
    ).get(loginEntryId, domain) as any;

    if (!row) return null;

    const now = Date.now();
    const currentStatus = this.computeCurrentStatus(row, now);

    return {
      id: row.id,
      loginEntryId: row.login_entry_id,
      domain: row.domain,
      status: currentStatus,
      firstLoginAt: row.first_login_at,
      loggedInUntil: row.logged_in_until,
      lastUsedAt: row.last_used_at,
      activeTabId: row.active_tab_id,
    };
  }

  // ---- Private helpers ----

  private upsertStatus(
    loginEntryId: string,
    domain: string,
    updates: Partial<{
      status: LoginStatus;
      firstLoginAt: string;
      loggedInUntil: string;
      lastUsedAt: string;
      activeTabId: string | null;
    }>
  ): SiteLoginStatus {
    const db = getDatabase();
    const existing = db.prepare(
      'SELECT * FROM site_login_status WHERE login_entry_id = ? AND domain = ?'
    ).get(loginEntryId, domain) as any;

    const now = new Date().toISOString();

    if (existing) {
      const setClauses: string[] = [];
      const params: any[] = [];

      if (updates.status) {
        setClauses.push('status = ?');
        params.push(updates.status);
      }
      if (updates.firstLoginAt) {
        setClauses.push('first_login_at = ?');
        params.push(updates.firstLoginAt);
      }
      if (updates.loggedInUntil) {
        setClauses.push('logged_in_until = ?');
        params.push(updates.loggedInUntil);
      }
      if (updates.lastUsedAt) {
        setClauses.push('last_used_at = ?');
        params.push(updates.lastUsedAt);
      }
      if (updates.activeTabId !== undefined) {
        setClauses.push('active_tab_id = ?');
        params.push(updates.activeTabId);
      }

      if (setClauses.length > 0) {
        setClauses.push('last_used_at = ?');
        params.push(now);

        params.push(existing.id);
        db.prepare(`UPDATE site_login_status SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);
      }

      const updated = db.prepare(
        'SELECT * FROM site_login_status WHERE id = ?'
      ).get(existing.id) as any;

      return {
        id: updated.id,
        loginEntryId: updated.login_entry_id,
        domain: updated.domain,
        status: updated.status,
        firstLoginAt: updated.first_login_at,
        loggedInUntil: updated.logged_in_until,
        lastUsedAt: updated.last_used_at,
        activeTabId: updated.active_tab_id,
      };
    }

    // Create new
    const id = uuidv4();
    const status = updates.status ?? 'never_used';

    db.prepare(`
      INSERT INTO site_login_status (id, login_entry_id, domain, status, first_login_at, logged_in_until, last_used_at, active_tab_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      loginEntryId,
      domain,
      status,
      updates.firstLoginAt ?? null,
      updates.loggedInUntil ?? null,
      updates.lastUsedAt ?? now,
      updates.activeTabId ?? null,
    );

    return {
      id,
      loginEntryId,
      domain,
      status,
      firstLoginAt: updates.firstLoginAt ?? null,
      loggedInUntil: updates.loggedInUntil ?? null,
      lastUsedAt: updates.lastUsedAt ?? now,
      activeTabId: updates.activeTabId ?? null,
    };
  }

  /**
   * Compute the effective status considering the 24h expiry window.
   * Internal helper.
   *
   * Rules:
   * - After 24h from the first login, any active/used/logged_in status resets
   *   to "never_used" (the app also clears the stored row lazily; see
   *   expireStale). This is what "refresh to never used after 24 hours" means.
   * - An account that still has an active tab link and an unexpired window is
   *   the single active account -> "active_tab_open".
   * - A logged_in account without an active tab has been superseded -> "used".
   */
  private computeCurrentStatus(row: any, nowMs: number): LoginStatus {
    // 24h window check: once the window lapses, the account is "never_used".
    if (row.logged_in_until) {
      const untilMs = new Date(row.logged_in_until).getTime();
      if (nowMs > untilMs) {
        return 'never_used';
      }
    }

    // Within the window, an account with a live active tab is THE active one.
    if (row.active_tab_id) {
      return 'active_tab_open';
    }

    // A previously logged-in account that no longer holds the active tab has
    // been used (and superseded) -> "used" (red).
    if (row.status === 'logged_in' || row.status === 'active_tab_open') {
      return 'used';
    }

    return row.status as LoginStatus;
  }

  /**
   * Lazily reset rows whose 24h window has fully lapsed back to "never_used"
   * and clear their active tab link. Keeps the persisted state consistent with
   * the computed status. Safe to call on every read.
   */
  private expireStale(nowMs: number): void {
    const db = getDatabase();
    db.prepare(`
      UPDATE site_login_status
      SET status = 'never_used', active_tab_id = NULL,
          first_login_at = NULL, logged_in_until = NULL
      WHERE logged_in_until IS NOT NULL
        AND status != 'never_used'
        AND ? > CAST(strftime('%s', logged_in_until) AS INTEGER) * 1000
    `).run(nowMs);
  }
}

// Singleton
export const statusManager = new StatusManager();

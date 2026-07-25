// ============================================================================
// Status Manager — Site-specific login status per (login_entry × domain)
// ============================================================================
//
// Design:
// - Status is tracked per (login_entry_id, domain) pair
// - "logged_in" status expires after 24 hours (LOGGED_IN_DURATION_MS)
// - Status is app-managed state, not real auth detection
// - The app explicitly labels this in the UI
//
// Active-tab model (multi-tab):
// - Each (login_entry_id, domain) row stores its OWN `active_tab_id`. That row
//   is the "unique hash" for "this account is logged in, in this tab". A row
//   with a non-null active_tab_id computes to "active_tab_open".
// - Because the active tab is a STORED per-row fact (not derived from other
//   accounts), MULTIPLE accounts on the SAME domain can each be active at the
//   same time — one per open tab. markLoggedIn therefore does NOT demote the
//   other accounts on the domain; each tab owns its own row's active_tab_id and
//   only that row is cleared when its tab closes (see tabManager.closeTab).

import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db';
import { SiteLoginStatus, LoginStatus } from '../../shared/types';
import { LOGGED_IN_DURATION_MS } from '../../shared/constants';

export class StatusManager {
  /**
   * Get status for all login entries on a specific domain.
   * Returns current computed status (handles expiry).
   *
   * `focusedTabId` selects the "active" interpretation (see
   * computeCurrentStatus): pass the currently-focused tab id for the VAULT
   * SIDEBAR (at most one "Active tab"), or omit it for SETTINGS › Site accounts
   * (every open-tab account reads active).
   */
  getForDomain(
    domain: string,
    focusedTabId?: string | null,
    liveTabIds?: Set<string>,
  ): (SiteLoginStatus & { loginLabel: string; loginUsername: string })[] {
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
      const currentStatus = this.computeCurrentStatus(r, now, focusedTabId, liveTabIds);

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
  getAll(liveTabIds?: Set<string>): (SiteLoginStatus & { loginLabel: string; loginUsername: string })[] {
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
      const currentStatus = this.computeCurrentStatus(r, now, undefined, liveTabIds);
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
   * Mark a login entry as logged-in (active) on a domain, in the tab `tabId`.
   *
   * IMPORTANT (multi-tab design): we do NOT demote the OTHER accounts on this
   * domain. Each (account, domain) row stores its OWN `active_tab_id`, so two
   * tabs on the same domain — each logged in with a different account — can
   * BOTH be active at the same time (one row per tab). This row's active_tab_id
   * is set to `tabId`; it is only cleared when THIS tab closes.
   *
   * The 24h window is tracked from the FIRST login: `first_login_at` and
   * `logged_in_until` are only set the first time (or once a previous window
   * has fully expired / been reset), not on every re-selection.
   */
  markLoggedIn(loginEntryId: string, domain: string, tabId: string): SiteLoginStatus {
    const db = getDatabase();
    const nowIso = new Date().toISOString();

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
  getForEntryAndDomain(
    loginEntryId: string,
    domain: string,
    liveTabIds?: Set<string>,
  ): SiteLoginStatus | null {
    const db = getDatabase();
    this.expireStale(Date.now());
    const row = db.prepare(
      'SELECT * FROM site_login_status WHERE login_entry_id = ? AND domain = ?'
    ).get(loginEntryId, domain) as any;

    if (!row) return null;

    const now = Date.now();
    const currentStatus = this.computeCurrentStatus(row, now, undefined, liveTabIds);

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

  /**
   * Change an account's per-site status from Settings.
   *
   * Rules enforced here (mirrored/warned in the UI):
   * - The single "active tab" account's status may NOT be changed — it reflects
   *   the live active tab. Callers must switch away first.
   * - Changing the status deletes the 24h time-remaining data (first_login_at /
   *   logged_in_until) and clears any active tab link, so the manually-set
   *   status is authoritative and won't be recomputed/expired away.
   */
  changeStatus(loginEntryId: string, domain: string, status: LoginStatus): void {
    const db = getDatabase();
    const row = db.prepare(
      'SELECT * FROM site_login_status WHERE login_entry_id = ? AND domain = ?'
    ).get(loginEntryId, domain) as any;

    // Guard: never let the caller set/keep 'active_tab_open' manually, and
    // never allow changing a row that currently holds an active tab (its own
    // stored active_tab_id). The tab must be closed / switched away first.
    const current = row ? this.computeCurrentStatus(row, Date.now()) : 'never_used';
    if (current === 'active_tab_open' || (row && row.active_tab_id)) {
      throw new Error('Cannot change the status of the active tab. Switch to another account first.');
    }
    if (status === 'active_tab_open') {
      throw new Error('The "Active tab" status cannot be assigned manually.');
    }

    const now = new Date().toISOString();
    if (row) {
      db.prepare(`
        UPDATE site_login_status
        SET status = ?, first_login_at = NULL, logged_in_until = NULL,
            active_tab_id = NULL, last_used_at = ?
        WHERE id = ?
      `).run(status, now, row.id);
    } else {
      const id = uuidv4();
      db.prepare(`
        INSERT INTO site_login_status (id, login_entry_id, domain, status, first_login_at, logged_in_until, last_used_at, active_tab_id)
        VALUES (?, ?, ?, ?, NULL, NULL, ?, NULL)
      `).run(id, loginEntryId, domain, status, now);
    }
  }

  /**
   * Delete an account's 24h time-remaining data for a domain WITHOUT changing
   * its (computed) status label. Since a logged_in/active row computes to a
   * time-based status, we persist the currently-computed label first so the
   * account keeps a sensible status once the timer is gone.
   *
   * The active tab's timer may not be cleared (would desync the live tab).
   */
  clearTimer(loginEntryId: string, domain: string): void {
    const db = getDatabase();
    const row = db.prepare(
      'SELECT * FROM site_login_status WHERE login_entry_id = ? AND domain = ?'
    ).get(loginEntryId, domain) as any;
    if (!row) return;

    // A row holding an active tab (its own stored active_tab_id) may not have
    // its timer cleared — close/switch away from that tab first.
    if (row.active_tab_id) {
      throw new Error('Cannot clear the timer of the active tab. Switch to another account first.');
    }

    // Freeze the current computed status (e.g. 'used') so removing the window
    // doesn't flip it back via computeCurrentStatus.
    const frozen = this.computeCurrentStatus(row, Date.now());
    const persisted = frozen === 'active_tab_open' ? 'used' : frozen;

    db.prepare(`
      UPDATE site_login_status
      SET status = ?, first_login_at = NULL, logged_in_until = NULL,
          active_tab_id = NULL, last_used_at = ?
      WHERE id = ?
    `).run(persisted, new Date().toISOString(), row.id);
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
   * Compute the effective status considering the 24h expiry window and the
   * STORED active-tab link. Internal helper.
   *
   * `focusedTabId` controls how "active" is interpreted — the two consumers
   * want DIFFERENT views of the same stored data:
   *
   * - Vault sidebar (focusedTabId provided): shows which account is active in
   *   the ONE currently-focused tab. Only the row whose active_tab_id equals
   *   focusedTabId is "active_tab_open"; every OTHER open-tab account on the
   *   domain shows as "used". So the sidebar always has at most one "Active
   *   tab", and switching tabs moves it (never resets to never_used).
   *
   * - Settings › Site accounts (focusedTabId === undefined): shows every
   *   account currently open in ANY tab. Each row that holds a LIVE
   *   active_tab_id is "active_tab_open" — so several accounts can read active
   *   at once when multiple tabs on the same URL are open.
   *
   * `liveTabIds` is the set of tab ids that are genuinely open RIGHT NOW (from
   * tabManager.getLiveTabIds()). It is the single source of truth for "active":
   * a stored active_tab_id is honoured ONLY if it is in this set. A stored id
   * that is NOT live is stale (left over from a previous session / crash) and
   * is ignored — the account falls through to "used"/its stored status. This
   * is what guarantees "Active tab" always reflects the REAL open tabs and
   * clears phantom actives. When `liveTabIds` is omitted (e.g. pure unit tests
   * / legacy callers), every stored active_tab_id is trusted as before.
   *
   * Rules (both modes):
   * - After 24h from the first login, any active/used/logged_in status resets
   *   to "never_used".
   * - A previously logged-in account whose tab has closed (active_tab_id NULL
   *   or stale) is still within its window -> "used" (red).
   * - Otherwise the stored status stands.
   */
  private computeCurrentStatus(
    row: any,
    nowMs: number,
    focusedTabId?: string | null,
    liveTabIds?: Set<string>,
  ): LoginStatus {
    // 24h window check: once the window lapses, the account is "never_used".
    if (row.logged_in_until) {
      const untilMs = new Date(row.logged_in_until).getTime();
      if (nowMs > untilMs) {
        return 'never_used';
      }
    }

    // A stored active_tab_id only counts as active if that tab is genuinely
    // open right now. When liveTabIds is provided and the id isn't in it, the
    // link is stale → treat this row as "no active tab" (falls through below).
    const hasLiveActiveTab =
      !!row.active_tab_id &&
      (liveTabIds === undefined || liveTabIds.has(row.active_tab_id));

    if (hasLiveActiveTab) {
      // Sidebar mode: only the focused tab's account is "active"; the other
      // open-tab accounts are "used". Settings mode (focusedTabId undefined):
      // every open-tab account is "active".
      if (focusedTabId === undefined || row.active_tab_id === focusedTabId) {
        return 'active_tab_open';
      }
      return 'used';
    }

    // A previously logged-in/active account whose tab has closed is "used"
    // (red) while still within its window.
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

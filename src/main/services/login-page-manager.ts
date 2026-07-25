// ============================================================================
// Login Page Manager — CRUD + resolution for saved login-page mappings
// ============================================================================
//
// A login-page mapping connects a MAIN website to the exact login-page URL that
// should be opened + autofilled when the user selects an account while on the
// main site or any nested/related page.
//
// ---- Account synchronization (the core requirement) -----------------------
// Every mapping stores a CANONICAL `loginDomain` (the eTLD+1 of the login URL).
// Accounts, per-site status and categories are all keyed on that canonical
// domain. Whenever the user is on:
//     - the login page itself, OR
//     - the main website (main_domain), OR
//     - any related URL (a stored `host/path` root or nested page under it),
// the app loads accounts under the SAME canonical `loginDomain`. That makes the
// account list + statuses identical across the Login Page, the Main URL and all
// Related URLs — which naive eTLD+1 grouping alone could not guarantee when the
// login page lives on a different domain than the main site.
//
// `resolveConnection(url)` returns which of the 3 scenarios the current URL is
// in (login / connected / standalone) plus the canonical account domain to use.

import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db';
import {
  LoginPageMapping,
  SaveLoginPageRequest,
  UpdateLoginPageRequest,
  ResolvedLoginPage,
  LoginConnection,
} from '../../shared/types';
import { extractDomain, belongsToRelated, normalizeRoot } from './domain-utils';

export class LoginPageManager {
  private rowToMapping(r: any): LoginPageMapping {
    let related: string[] = [];
    try {
      const parsed = JSON.parse(r.related_urls ?? '[]');
      if (Array.isArray(parsed)) related = parsed.filter((x: any) => typeof x === 'string');
    } catch { /* keep [] */ }
    return {
      id: r.id,
      mainDomain: r.main_domain,
      loginUrl: r.login_url,
      loginDomain: r.login_domain || extractDomain(r.login_url) || '',
      relatedUrls: related,
      categoryId: r.category_id ?? null,
      categoryRestricted: !!r.category_restricted,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  /** List every saved mapping (newest first). */
  listAll(): LoginPageMapping[] {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT * FROM login_page_mappings ORDER BY updated_at DESC')
      .all() as any[];
    return rows.map(r => this.rowToMapping(r));
  }

  getById(id: string): LoginPageMapping | null {
    const db = getDatabase();
    const r = db.prepare('SELECT * FROM login_page_mappings WHERE id = ?').get(id);
    return r ? this.rowToMapping(r) : null;
  }

  /** All mappings whose main website matches the given eTLD+1. */
  listForMainDomain(mainDomain: string): LoginPageMapping[] {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT * FROM login_page_mappings WHERE main_domain = ? ORDER BY updated_at DESC')
      .all(mainDomain.toLowerCase().replace(/^www\./, '')) as any[];
    return rows.map(r => this.rowToMapping(r));
  }

  private normalizeRelated(list?: string[]): string[] {
    if (!list) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of list) {
      const n = normalizeRoot(raw);
      if (n && !seen.has(n)) { seen.add(n); out.push(n); }
    }
    return out;
  }

  /**
   * Save (create or replace) a login-page mapping. There is at most ONE mapping
   * per (main_domain, category) pairing — saving again updates it in place, so
   * re-saving a login page for the same site/category doesn't create dupes.
   */
  save(request: SaveLoginPageRequest): LoginPageMapping {
    const db = getDatabase();

    const mainDomain = (request.mainDomain ?? '').trim().toLowerCase().replace(/^www\./, '');
    if (!mainDomain) throw new Error('A main website is required.');

    const loginUrl = (request.loginUrl ?? '').trim();
    if (!loginUrl) throw new Error('A login-page URL is required.');

    const loginDomain = extractDomain(loginUrl) || '';
    const relatedUrls = JSON.stringify(this.normalizeRelated(request.relatedUrls));

    const restricted = !!request.categoryRestricted;
    // When not restricted, the category is irrelevant to matching; store null.
    const categoryId = restricted ? (request.categoryId ?? null) : null;

    if (restricted && !categoryId) {
      throw new Error('Choose a category, or turn off the category restriction.');
    }

    const now = new Date().toISOString();

    // Upsert on (main_domain, category_id) — treat NULL category as its own key.
    const existing = db
      .prepare(
        `SELECT id FROM login_page_mappings
         WHERE main_domain = ? AND ((category_id IS NULL AND ? IS NULL) OR category_id = ?)`
      )
      .get(mainDomain, categoryId, categoryId) as any;

    if (existing) {
      db.prepare(
        `UPDATE login_page_mappings
         SET login_url = ?, login_domain = ?, related_urls = ?, category_id = ?,
             category_restricted = ?, updated_at = ?
         WHERE id = ?`
      ).run(loginUrl, loginDomain, relatedUrls, categoryId, restricted ? 1 : 0, now, existing.id);
      return this.getById(existing.id)!;
    }

    const id = uuidv4();
    db.prepare(
      `INSERT INTO login_page_mappings
         (id, main_domain, login_url, login_domain, related_urls, category_id, category_restricted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, mainDomain, loginUrl, loginDomain, relatedUrls, categoryId, restricted ? 1 : 0, now, now);

    console.log(`[LoginPageManager] Saved mapping ${id}: ${mainDomain} -> ${loginUrl} (login domain ${loginDomain})`);
    return this.getById(id)!;
  }

  /**
   * Partial in-place update from the Settings editor: change the main URL,
   * add/remove related URLs, and/or toggle category restriction.
   */
  update(request: UpdateLoginPageRequest): LoginPageMapping {
    const db = getDatabase();
    const current = this.getById(request.id);
    if (!current) throw new Error('Login-page mapping not found.');

    const mainDomain =
      request.mainDomain !== undefined
        ? request.mainDomain.trim().toLowerCase().replace(/^www\./, '')
        : current.mainDomain;
    if (!mainDomain) throw new Error('A main website is required.');

    const loginUrl = request.loginUrl !== undefined ? request.loginUrl.trim() : current.loginUrl;
    if (!loginUrl) throw new Error('A login-page URL is required.');
    const loginDomain = extractDomain(loginUrl) || current.loginDomain;

    const relatedUrls =
      request.relatedUrls !== undefined
        ? this.normalizeRelated(request.relatedUrls)
        : current.relatedUrls;

    const restricted =
      request.categoryRestricted !== undefined ? !!request.categoryRestricted : current.categoryRestricted;
    const categoryId = restricted
      ? (request.categoryId !== undefined ? request.categoryId : current.categoryId)
      : null;
    if (restricted && !categoryId) {
      throw new Error('Choose a category, or turn off the category restriction.');
    }

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE login_page_mappings
       SET main_domain = ?, login_url = ?, login_domain = ?, related_urls = ?,
           category_id = ?, category_restricted = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      mainDomain, loginUrl, loginDomain, JSON.stringify(relatedUrls),
      categoryId, restricted ? 1 : 0, now, request.id
    );
    return this.getById(request.id)!;
  }

  delete(id: string): boolean {
    const db = getDatabase();
    const res = db.prepare('DELETE FROM login_page_mappings WHERE id = ?').run(id);
    return res.changes > 0;
  }

  /**
   * Find the mapping (if any) whose group the given URL belongs to. A URL is in
   * a mapping's group when it is the login page, the main website, or a related
   * URL (or nested page under one).
   */
  private findMappingForUrl(url: string): LoginPageMapping | null {
    const domain = extractDomain(url);
    if (!domain) return null;
    const all = this.listAll();
    // Prefer a mapping where the URL is on the LOGIN domain (it IS the login
    // page), then the main domain, then a related root.
    return (
      all.find(m => m.loginDomain && m.loginDomain === domain) ||
      all.find(m => m.mainDomain === domain) ||
      all.find(m => belongsToRelated(url, m.relatedUrls)) ||
      null
    );
  }

  /**
   * Classify the current URL into one of the 3 scenarios and return the
   * canonical account domain to load accounts/status/categories under.
   */
  resolveConnection(url: string): LoginConnection {
    const domain = extractDomain(url) || '';
    const mapping = this.findMappingForUrl(url);

    if (!mapping) {
      return {
        scenario: 'standalone',
        accountDomain: domain,
        mappingId: null,
        mainDomain: null,
        loginUrl: null,
        loginDomain: null,
        relatedUrls: [],
      };
    }

    // The canonical account key is always the mapping's login domain (falling
    // back to the main domain if the login URL had no resolvable eTLD+1).
    const accountDomain = mapping.loginDomain || mapping.mainDomain;

    const isLoginPage = !!mapping.loginDomain && mapping.loginDomain === domain;

    return {
      scenario: isLoginPage ? 'login' : 'connected',
      accountDomain,
      mappingId: mapping.id,
      mainDomain: mapping.mainDomain,
      loginUrl: mapping.loginUrl,
      loginDomain: mapping.loginDomain,
      relatedUrls: mapping.relatedUrls,
    };
  }

  /**
   * Return the CANONICAL account domain that per-site status, accounts and
   * categories must be keyed on for a given URL.
   *
   * This is the single source of truth used by BOTH the renderer (via
   * resolveConnection → accountDomain) and the main process (status writes),
   * so a login page, its main website and every related URL all read AND write
   * status under the same key. Using the raw eTLD+1 for writes while the
   * sidebar reads under the login domain is exactly what caused statuses to
   * appear reset and the wrong account to hold the active-tab slot.
   *
   * Falls back to the raw eTLD+1 when the URL is not part of any mapping.
   */
  canonicalAccountDomain(url: string): string {
    const conn = this.resolveConnection(url);
    return conn.accountDomain || extractDomain(url) || '';
  }

  /**
   * Decide whether selecting `loginEntryId` while on `currentUrl` should open a
   * saved login page. Returns the URL to open, or null to fall back to the
   * default (autofill the current page).
   *
   * Precedence: a category-restricted mapping that the account belongs to wins
   * over an unrestricted one (more specific mapping first).
   */
  resolveForSelection(currentUrl: string, loginEntryId: string): ResolvedLoginPage | null {
    const mapping = this.findMappingForUrl(currentUrl);
    if (!mapping) return null;

    const domain = extractDomain(currentUrl) || '';
    // If the user is already ON the login page, there's nothing to open.
    if (mapping.loginDomain && mapping.loginDomain === domain) return null;

    const db = getDatabase();
    // Gather every mapping in this group (same main domain) so category
    // precedence still works when several mappings target one main site.
    const mappings = this.listForMainDomain(mapping.mainDomain);
    if (mappings.length === 0) return null;

    const accountCategoryIds = new Set(
      (db
        .prepare('SELECT category_id FROM category_accounts WHERE login_entry_id = ?')
        .all(loginEntryId) as any[]
      ).map(r => r.category_id)
    );

    const restrictedMatch = mappings.find(
      m => m.categoryRestricted && m.categoryId && accountCategoryIds.has(m.categoryId)
    );
    if (restrictedMatch) {
      return { mappingId: restrictedMatch.id, mainDomain: restrictedMatch.mainDomain, loginUrl: restrictedMatch.loginUrl };
    }

    const openMatch = mappings.find(m => !m.categoryRestricted);
    if (openMatch) {
      return { mappingId: openMatch.id, mainDomain: openMatch.mainDomain, loginUrl: openMatch.loginUrl };
    }

    return null;
  }
}

// Singleton
export const loginPageManager = new LoginPageManager();

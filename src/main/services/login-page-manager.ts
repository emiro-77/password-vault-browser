// ============================================================================
// Login Page Manager — CRUD + resolution for saved login-page mappings
// ============================================================================
//
// A login-page mapping connects a MAIN website (eTLD+1, e.g. 'chatgpt.com') to
// the exact login-page URL that should be opened + autofilled when the user
// selects an account while on the main site or any nested/related page.
//
// Resolution rule (used by the account-selection flow):
//   Given the current page's domain and the selected account, return the
//   login-page URL to open IF:
//     - a mapping exists whose main_domain == current eTLD+1, AND
//     - the mapping is either unrestricted, OR the account is a member of the
//       mapping's category.
//
// Per-site login STATUS remains keyed on eTLD+1 (via extractDomain), so the
// login page, main page and related pages already share the same vault status
// / timer / account data — the mapping only decides which URL to open+autofill.

import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db';
import { LoginPageMapping, SaveLoginPageRequest, ResolvedLoginPage } from '../../shared/types';
import { extractDomain } from './domain-utils';

export class LoginPageManager {
  private rowToMapping(r: any): LoginPageMapping {
    return {
      id: r.id,
      mainDomain: r.main_domain,
      loginUrl: r.login_url,
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

  /** All mappings whose main website matches the given eTLD+1. */
  listForMainDomain(mainDomain: string): LoginPageMapping[] {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT * FROM login_page_mappings WHERE main_domain = ? ORDER BY updated_at DESC')
      .all(mainDomain.toLowerCase().replace(/^www\./, '')) as any[];
    return rows.map(r => this.rowToMapping(r));
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
         SET login_url = ?, category_id = ?, category_restricted = ?, updated_at = ?
         WHERE id = ?`
      ).run(loginUrl, categoryId, restricted ? 1 : 0, now, existing.id);
      return this.rowToMapping(
        db.prepare('SELECT * FROM login_page_mappings WHERE id = ?').get(existing.id)
      );
    }

    const id = uuidv4();
    db.prepare(
      `INSERT INTO login_page_mappings
         (id, main_domain, login_url, category_id, category_restricted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, mainDomain, loginUrl, categoryId, restricted ? 1 : 0, now, now);

    console.log(`[LoginPageManager] Saved mapping ${id}: ${mainDomain} -> ${loginUrl}`);
    return this.rowToMapping(db.prepare('SELECT * FROM login_page_mappings WHERE id = ?').get(id));
  }

  delete(id: string): boolean {
    const db = getDatabase();
    const res = db.prepare('DELETE FROM login_page_mappings WHERE id = ?').run(id);
    return res.changes > 0;
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
    const domain = extractDomain(currentUrl);
    if (!domain) return null;

    const db = getDatabase();
    const mappings = this.listForMainDomain(domain);
    if (mappings.length === 0) return null;

    // Which categories does this account belong to?
    const accountCategoryIds = new Set(
      (db
        .prepare('SELECT category_id FROM category_accounts WHERE login_entry_id = ?')
        .all(loginEntryId) as any[]
      ).map(r => r.category_id)
    );

    // Prefer a restricted mapping the account qualifies for.
    const restrictedMatch = mappings.find(
      m => m.categoryRestricted && m.categoryId && accountCategoryIds.has(m.categoryId)
    );
    if (restrictedMatch) {
      return { mappingId: restrictedMatch.id, mainDomain: restrictedMatch.mainDomain, loginUrl: restrictedMatch.loginUrl };
    }

    // Otherwise use an unrestricted mapping (any account may use it).
    const openMatch = mappings.find(m => !m.categoryRestricted);
    if (openMatch) {
      return { mappingId: openMatch.id, mainDomain: openMatch.mainDomain, loginUrl: openMatch.loginUrl };
    }

    // Only restricted mappings exist and the account isn't in any of them.
    return null;
  }
}

// Singleton
export const loginPageManager = new LoginPageManager();

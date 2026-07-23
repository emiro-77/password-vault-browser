// ============================================================================
// Category Manager — CRUD for account categories / folders
// ============================================================================
//
// Categories organize login entries into folders. A category is either:
//   - global  : usable across every website (domain = '')
//   - private : unique to one website (domain = that site's host)
//
// An account may belong to multiple categories (many-to-many via
// category_accounts). Per-site login *status* is unaffected by categories —
// it stays keyed by (loginEntryId, domain) as before.

import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db';
import {
  Category,
  CategoryCreateRequest,
  CategoryUpdateRequest,
  CategoryScope,
} from '../../shared/types';

export class CategoryManager {
  private rowToCategory(r: any, accountIds: string[]): Category {
    return {
      id: r.id,
      name: r.name,
      icon: r.icon ?? '📁',
      scope: (r.scope === 'private' ? 'private' : 'global') as CategoryScope,
      domain: r.domain ?? '',
      position: r.position ?? 0,
      accountIds,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private accountIdsFor(categoryId: string): string[] {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT login_entry_id FROM category_accounts WHERE category_id = ?'
    ).all(categoryId) as any[];
    return rows.map(r => r.login_entry_id);
  }

  /**
   * List categories visible for a given site.
   *   - Global categories are always visible.
   *   - Private categories are visible ONLY on their own domain.
   * If no domain is provided, only global categories are returned.
   */
  listForDomain(domain?: string): Category[] {
    const db = getDatabase();
    const d = (domain ?? '').trim().toLowerCase();

    const rows = (d
      ? db.prepare(
          `SELECT * FROM categories
           WHERE scope = 'global' OR (scope = 'private' AND domain = ?)
           ORDER BY position ASC, created_at ASC`
        ).all(d)
      : db.prepare(
          `SELECT * FROM categories
           WHERE scope = 'global'
           ORDER BY position ASC, created_at ASC`
        ).all()) as any[];

    return rows.map(r => this.rowToCategory(r, this.accountIdsFor(r.id)));
  }

  /** List every category (used by tests / management screens). */
  listAll(): Category[] {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT * FROM categories ORDER BY position ASC, created_at ASC'
    ).all() as any[];
    return rows.map(r => this.rowToCategory(r, this.accountIdsFor(r.id)));
  }

  getById(id: string): Category | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToCategory(row, this.accountIdsFor(id));
  }

  private setAccounts(categoryId: string, accountIds: string[]): void {
    const db = getDatabase();
    db.prepare('DELETE FROM category_accounts WHERE category_id = ?').run(categoryId);
    const insert = db.prepare(
      'INSERT OR IGNORE INTO category_accounts (category_id, login_entry_id) VALUES (?, ?)'
    );
    for (const accId of accountIds) {
      insert.run(categoryId, accId);
    }
  }

  create(request: CategoryCreateRequest): Category {
    const db = getDatabase();
    const id = uuidv4();
    const now = new Date().toISOString();
    const scope: CategoryScope = request.scope === 'private' ? 'private' : 'global';
    const domain = scope === 'private'
      ? (request.domain ?? '').trim().toLowerCase()
      : '';

    if (scope === 'private' && !domain) {
      throw new Error('A private category must be tied to a website.');
    }

    const name = (request.name ?? '').trim();
    if (!name) throw new Error('Category name is required.');

    const icon = (request.icon && request.icon.trim()) ? request.icon.trim() : '📁';

    // Next position = end of the list within this scope/domain.
    const posRow = db.prepare(
      `SELECT COALESCE(MAX(position), -1) + 1 AS next FROM categories
       WHERE scope = ? AND domain = ?`
    ).get(scope, domain) as any;

    db.prepare(`
      INSERT INTO categories (id, name, icon, scope, domain, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, icon, scope, domain, posRow?.next ?? 0, now, now);

    this.setAccounts(id, request.accountIds ?? []);

    console.log(`[CategoryManager] Created category ${id} (${name}) scope=${scope} domain="${domain}"`);
    return this.getById(id)!;
  }

  update(request: CategoryUpdateRequest): Category | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM categories WHERE id = ?').get(request.id) as any;
    if (!row) return null;

    const now = new Date().toISOString();
    const name = request.name !== undefined ? request.name.trim() : row.name;
    const icon = request.icon !== undefined && request.icon.trim() ? request.icon.trim() : row.icon;
    const scope: CategoryScope = request.scope
      ? (request.scope === 'private' ? 'private' : 'global')
      : row.scope;
    let domain = row.domain;
    if (request.scope) {
      domain = scope === 'private'
        ? (request.domain ?? row.domain ?? '').trim().toLowerCase()
        : '';
    } else if (request.domain !== undefined && scope === 'private') {
      domain = request.domain.trim().toLowerCase();
    }

    if (scope === 'private' && !domain) {
      throw new Error('A private category must be tied to a website.');
    }
    if (!name) throw new Error('Category name is required.');

    db.prepare(`
      UPDATE categories SET name = ?, icon = ?, scope = ?, domain = ?, updated_at = ? WHERE id = ?
    `).run(name, icon, scope, domain, now, request.id);

    if (request.accountIds !== undefined) {
      this.setAccounts(request.id, request.accountIds);
    }

    console.log(`[CategoryManager] Updated category ${request.id}`);
    return this.getById(request.id);
  }

  delete(id: string): boolean {
    const db = getDatabase();
    const row = db.prepare('SELECT id FROM categories WHERE id = ?').get(id) as any;
    if (!row) return false;
    // category_accounts rows are removed via ON DELETE CASCADE.
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    console.log(`[CategoryManager] Deleted category ${id}`);
    return true;
  }

  /** Persist a new left-to-right order for the given category ids. */
  reorder(orderedIds: string[]): void {
    const db = getDatabase();
    const stmt = db.prepare('UPDATE categories SET position = ? WHERE id = ?');
    const tx = db.transaction((ids: string[]) => {
      ids.forEach((id, i) => stmt.run(i, id));
    });
    tx(orderedIds);
  }
}

export const categoryManager = new CategoryManager();

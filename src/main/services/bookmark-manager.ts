// ============================================================================
// Bookmark Manager — CRUD for bookmarks
// ============================================================================

import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db';
import { Bookmark, BookmarkCreateRequest } from '../../shared/types';

export class BookmarkManager {
  /**
   * List all bookmarks, ordered by position.
   */
  listAll(): Bookmark[] {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT id, title, url, position, created_at FROM bookmarks ORDER BY position ASC, created_at ASC'
    ).all() as any[];

    return rows.map(r => ({
      id: r.id,
      title: r.title,
      url: r.url,
      position: r.position,
      createdAt: r.created_at,
    }));
  }

  /**
   * Create a new bookmark.
   */
  create(request: BookmarkCreateRequest): Bookmark {
    const id = uuidv4();
    const now = new Date().toISOString();

    const db = getDatabase();

    // Get the next position
    const maxPos = db.prepare('SELECT MAX(position) as maxPos FROM bookmarks').get() as any;
    const position = (maxPos?.maxPos ?? -1) + 1;

    db.prepare(`
      INSERT INTO bookmarks (id, title, url, position, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, request.title, request.url, position, now);

    return { id, title: request.title, url: request.url, position, createdAt: now };
  }

  /**
   * Delete a bookmark by ID.
   */
  delete(id: string): boolean {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM bookmarks WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Reorder bookmarks by providing an ordered list of bookmark IDs.
   */
  reorder(orderedIds: string[]): void {
    const db = getDatabase();
    const transaction = db.transaction(() => {
      orderedIds.forEach((id, index) => {
        db.prepare('UPDATE bookmarks SET position = ? WHERE id = ?').run(index, id);
      });
    });
    transaction();
  }
}

// Singleton
export const bookmarkManager = new BookmarkManager();

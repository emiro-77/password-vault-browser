// ============================================================================
// Login Entry Manager — CRUD for global login entries
// ============================================================================
//
// Login entries store credential metadata in SQLite.
// Passwords are stored in Windows Credential Manager (via CredentialStore).
// The DB stores only a secret_ref key that maps to the Credential Manager entry.

import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db';
import {
  LoginEntry,
  LoginEntryCreateRequest,
  LoginEntryUpdateRequest,
} from '../../shared/types';
import { saveCredential, deleteCredential } from './credential-store';
import { APP_CODE_NAME } from '../../shared/constants';

export class LoginEntryManager {
  /**
   * List all login entries.
   * Returns entries WITHOUT passwords (passwords never leave main process unprotected).
   */
  listAll(): LoginEntry[] {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT id, label, username_or_email, created_at, updated_at FROM login_entries ORDER BY updated_at DESC'
    ).all() as any[];

    return rows.map(r => ({
      id: r.id,
      label: r.label,
      usernameOrEmail: r.username_or_email,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /**
   * Get a single login entry by ID.
   */
  getById(id: string): LoginEntry | null {
    const db = getDatabase();
    const row = db.prepare(
      'SELECT id, label, username_or_email, created_at, updated_at FROM login_entries WHERE id = ?'
    ).get(id) as any;

    if (!row) return null;

    return {
      id: row.id,
      label: row.label,
      usernameOrEmail: row.username_or_email,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Create a new login entry.
   * Password is stored in Windows Credential Manager; DB stores the reference key.
   */
  async create(request: LoginEntryCreateRequest): Promise<LoginEntry> {
    const id = uuidv4();
    const secretRef = `${APP_CODE_NAME}-entry-${id}`;
    const now = new Date().toISOString();

    // Store password in secure storage first
    await saveCredential(secretRef, request.password);

    // Store metadata in SQLite
    const db = getDatabase();
    db.prepare(`
      INSERT INTO login_entries (id, label, username_or_email, password_secret_ref, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, request.label, request.usernameOrEmail, secretRef, now, now);

    console.log(`[LoginEntryManager] Created entry: ${id} (${request.label})`);

    return {
      id,
      label: request.label,
      usernameOrEmail: request.usernameOrEmail,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Update an existing login entry.
   * If password is provided, it is updated in secure storage.
   */
  async update(request: LoginEntryUpdateRequest): Promise<LoginEntry | null> {
    const db = getDatabase();
    const row = db.prepare(
      'SELECT id, label, username_or_email, password_secret_ref, created_at, updated_at FROM login_entries WHERE id = ?'
    ).get(request.id) as any;

    if (!row) return null;

    const now = new Date().toISOString();
    const label = request.label ?? row.label;
    const usernameOrEmail = request.usernameOrEmail ?? row.username_or_email;

    // If password is being updated, store in secure storage
    if (request.password) {
      await saveCredential(row.password_secret_ref, request.password);
    }

    db.prepare(`
      UPDATE login_entries SET label = ?, username_or_email = ?, updated_at = ? WHERE id = ?
    `).run(label, usernameOrEmail, now, request.id);

    console.log(`[LoginEntryManager] Updated entry: ${request.id}`);

    return {
      id: row.id,
      label,
      usernameOrEmail,
      createdAt: row.created_at,
      updatedAt: now,
    };
  }

  /**
   * Delete a login entry.
   * Removes from both SQLite and secure storage.
   */
  async delete(id: string): Promise<boolean> {
    const db = getDatabase();
    const row = db.prepare('SELECT password_secret_ref FROM login_entries WHERE id = ?').get(id) as any;

    if (!row) return false;

    // Delete from secure storage
    await deleteCredential(row.password_secret_ref);

    // Delete from SQLite (cascade will handle site_login_status)
    db.prepare('DELETE FROM login_entries WHERE id = ?').run(id);

    console.log(`[LoginEntryManager] Deleted entry: ${id}`);
    return true;
  }

  /**
   * Get the password secret ref for a login entry.
   * DO NOT expose this to the renderer — main process only.
   */
  getSecretRef(id: string): string | null {
    const db = getDatabase();
    const row = db.prepare('SELECT password_secret_ref FROM login_entries WHERE id = ?').get(id) as any;
    return row?.password_secret_ref ?? null;
  }
}

// Singleton
export const loginEntryManager = new LoginEntryManager();

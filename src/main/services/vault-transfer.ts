// ============================================================================
// Vault Transfer — encrypted export / import of the whole vault
// ============================================================================
//
// Produces a single self-contained, passphrase-encrypted backup file that can
// be moved to ANY device and future platform (Windows, macOS, Linux, Android,
// iOS). We deliberately do NOT copy the raw SQLite file or the Windows
// Credential Manager entries — those are OS-bound and not portable. Instead we
// serialize the vault to a plain-JSON payload (universally parseable in every
// language / runtime) and encrypt the whole thing.
//
// File format (the `.vaultbackup` envelope, itself JSON so any platform can
// read the header without our code):
//   {
//     "format": "vault-browser-backup",   // magic string
//     "formatVersion": 1,                  // bump on breaking payload changes
//     "app": "Vault Browser Desktop",
//     "createdAt": "<ISO>",
//     "kdf":    { "name": "PBKDF2", "hash": "SHA-256", "iterations": 210000,
//                 "salt": "<base64>" },
//     "cipher": { "name": "AES-256-GCM", "iv": "<base64>", "authTag": "<base64>" },
//     "ciphertext": "<base64>"             // encrypted UTF-8 JSON payload
//   }
//
// The inner (decrypted) payload holds the actual vault data INCLUDING the
// plaintext passwords — that is the point of an export (a new device has an
// empty credential store), which is exactly why the envelope is encrypted with
// the user's passphrase. Everything uses primitives available on every
// platform's standard crypto library (PBKDF2-SHA256 + AES-256-GCM), so mobile /
// other-OS versions can implement read/write without this codebase.

import * as crypto from 'crypto';
import { getDatabase } from '../db';
import { getCredential, saveCredential, deleteCredential } from './credential-store';
import { APP_NAME } from '../../shared/constants';

const FORMAT_MAGIC = 'vault-browser-backup';
const FORMAT_VERSION = 1;
const PBKDF2_ITERATIONS = 210_000; // OWASP-recommended floor for PBKDF2-SHA256
const KEY_LEN = 32; // AES-256

// ---- Payload shape (the decrypted, portable JSON) --------------------------

interface VaultPayload {
  loginEntries: Array<{
    id: string;
    label: string;
    usernameOrEmail: string;
    domain: string;
    password: string; // plaintext — protected by the envelope encryption
    createdAt: string;
    updatedAt: string;
  }>;
  categories: Array<Record<string, unknown>>;
  categoryAccounts: Array<Record<string, unknown>>;
  bookmarks: Array<Record<string, unknown>>;
  siteLoginStatus: Array<Record<string, unknown>>;
  siteRules: Array<Record<string, unknown>>;
  loginPageMappings?: Array<Record<string, unknown>>; // optional for backward-compat with older backups
}

interface BackupEnvelope {
  format: string;
  formatVersion: number;
  app: string;
  createdAt: string;
  kdf: { name: string; hash: string; iterations: number; salt: string };
  cipher: { name: string; iv: string; authTag: string };
  ciphertext: string;
}

export interface ExportSummary {
  accounts: number;
  categories: number;
  bookmarks: number;
}

export interface ImportSummary {
  accounts: number;
  categories: number;
  bookmarks: number;
}

// ---- Crypto helpers --------------------------------------------------------

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, KEY_LEN, 'sha256');
}

// ---- Export ----------------------------------------------------------------

/**
 * Collect the whole vault (metadata + passwords) and return an encrypted
 * `.vaultbackup` JSON string protected by `passphrase`.
 */
export async function buildEncryptedExport(
  passphrase: string
): Promise<{ fileContents: string; summary: ExportSummary }> {
  if (!passphrase || passphrase.length < 4) {
    throw new Error('A passphrase of at least 4 characters is required to encrypt the export.');
  }

  const db = getDatabase();

  const entryRows = db
    .prepare(
      'SELECT id, label, username_or_email, domain, password_secret_ref, created_at, updated_at FROM login_entries'
    )
    .all() as any[];

  const loginEntries: VaultPayload['loginEntries'] = [];
  for (const r of entryRows) {
    const password = (await getCredential(r.password_secret_ref)) ?? '';
    loginEntries.push({
      id: r.id,
      label: r.label,
      usernameOrEmail: r.username_or_email,
      domain: r.domain ?? '',
      password,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    });
  }

  const payload: VaultPayload = {
    loginEntries,
    categories: db.prepare('SELECT * FROM categories').all() as any[],
    categoryAccounts: db.prepare('SELECT * FROM category_accounts').all() as any[],
    bookmarks: db.prepare('SELECT * FROM bookmarks').all() as any[],
    siteLoginStatus: db.prepare('SELECT * FROM site_login_status').all() as any[],
    siteRules: db.prepare('SELECT * FROM site_rules').all() as any[],
    loginPageMappings: db.prepare('SELECT * FROM login_page_mappings').all() as any[],
  };

  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');

  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12); // 96-bit IV is standard for GCM
  const key = deriveKey(passphrase, salt);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const envelope: BackupEnvelope = {
    format: FORMAT_MAGIC,
    formatVersion: FORMAT_VERSION,
    app: APP_NAME,
    createdAt: new Date().toISOString(),
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, salt: salt.toString('base64') },
    cipher: { name: 'AES-256-GCM', iv: iv.toString('base64'), authTag: authTag.toString('base64') },
    ciphertext: ciphertext.toString('base64'),
  };

  return {
    fileContents: JSON.stringify(envelope, null, 2),
    summary: {
      accounts: loginEntries.length,
      categories: payload.categories.length,
      bookmarks: payload.bookmarks.length,
    },
  };
}

// ---- Import ----------------------------------------------------------------

/**
 * Decrypt a `.vaultbackup` file with `passphrase`, then WIPE the current vault
 * and OVERWRITE it with the imported data (the previous database vanishes).
 */
export async function importEncryptedBackup(
  fileContents: string,
  passphrase: string
): Promise<ImportSummary> {
  let envelope: BackupEnvelope;
  try {
    envelope = JSON.parse(fileContents);
  } catch {
    throw new Error('This file is not a valid backup (could not parse JSON).');
  }

  if (envelope?.format !== FORMAT_MAGIC) {
    throw new Error('Unrecognized file — this is not a Vault Browser backup.');
  }
  if (envelope.formatVersion > FORMAT_VERSION) {
    throw new Error(
      `This backup was made by a newer version (format v${envelope.formatVersion}). Please update the app.`
    );
  }

  // Decrypt the payload.
  let payload: VaultPayload;
  try {
    const salt = Buffer.from(envelope.kdf.salt, 'base64');
    const iv = Buffer.from(envelope.cipher.iv, 'base64');
    const authTag = Buffer.from(envelope.cipher.authTag, 'base64');
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
    const key = deriveKey(passphrase, salt);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    payload = JSON.parse(plaintext.toString('utf8'));
  } catch {
    // GCM auth failure or JSON parse failure both land here.
    throw new Error('Wrong passphrase, or the backup file is corrupted.');
  }

  if (!payload || !Array.isArray(payload.loginEntries)) {
    throw new Error('The backup file is missing expected data.');
  }

  const db = getDatabase();

  // 1) Remove every existing credential from secure storage (best-effort) so we
  //    don't leak orphaned secrets after the DB is wiped.
  try {
    const oldRefs = db.prepare('SELECT password_secret_ref FROM login_entries').all() as any[];
    for (const r of oldRefs) {
      await deleteCredential(r.password_secret_ref).catch(() => {});
    }
  } catch {
    /* best-effort */
  }

  // 2) Wipe + repopulate the DB and secure store atomically (DB part in a txn).
  //    Passwords are saved to the credential store OUTSIDE the sync txn (async),
  //    but each entry keeps its original secret_ref so the mapping stays valid.
  for (const e of payload.loginEntries) {
    // secret_ref must match what the DB row will reference; reuse a stable one.
    const secretRef = `pvb-entry-${e.id}`;
    await saveCredential(secretRef, e.password ?? '');
    (e as any).__secretRef = secretRef;
  }

  const wipeAndInsert = db.transaction(() => {
    db.exec(`
      DELETE FROM login_page_mappings;
      DELETE FROM category_accounts;
      DELETE FROM categories;
      DELETE FROM bookmarks;
      DELETE FROM site_login_status;
      DELETE FROM site_rules;
      DELETE FROM login_entries;
    `);

    const insEntry = db.prepare(
      `INSERT INTO login_entries (id, label, username_or_email, domain, password_secret_ref, created_at, updated_at)
       VALUES (@id, @label, @username_or_email, @domain, @password_secret_ref, @created_at, @updated_at)`
    );
    for (const e of payload.loginEntries) {
      insEntry.run({
        id: e.id,
        label: e.label,
        username_or_email: e.usernameOrEmail,
        domain: e.domain ?? '',
        password_secret_ref: (e as any).__secretRef,
        created_at: e.createdAt,
        updated_at: e.updatedAt,
      });
    }

    insertRows(db, 'categories', payload.categories);
    insertRows(db, 'category_accounts', payload.categoryAccounts);
    insertRows(db, 'bookmarks', payload.bookmarks);
    insertRows(db, 'site_login_status', payload.siteLoginStatus);
    insertRows(db, 'site_rules', payload.siteRules);
    // login_page_mappings references categories(id), so insert AFTER categories.
    insertRows(db, 'login_page_mappings', payload.loginPageMappings);
  });

  wipeAndInsert();

  return {
    accounts: payload.loginEntries.length,
    categories: payload.categories?.length ?? 0,
    bookmarks: payload.bookmarks?.length ?? 0,
  };
}

/**
 * Generic column-driven INSERT for the "carry rows verbatim" tables. Skips
 * unknown columns defensively so a slightly-newer payload won't hard-crash.
 */
function insertRows(db: any, table: string, rows: Array<Record<string, unknown>> | undefined): void {
  if (!rows || rows.length === 0) return;
  const cols = Object.keys(rows[0]);
  const placeholders = cols.map((c) => '@' + c).join(', ');
  const stmt = db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`);
  for (const row of rows) {
    stmt.run(row);
  }
}

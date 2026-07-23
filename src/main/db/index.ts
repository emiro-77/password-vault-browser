// ============================================================================
// Database — initialization and migrations
// ============================================================================
// Uses better-sqlite3 for synchronous, fast SQLite access.
// Falls back gracefully if the native module fails to load.

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { DB_FILENAME, APP_CODE_NAME } from '../../shared/constants';
import { SCHEMA_SQL } from './schema';

let db: Database.Database | null = null;

/**
 * Get the database file path.
 * Stores in the Electron userData directory.
 */
function getDbPath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, DB_FILENAME);
}

/**
 * Initialize the database: open file, run migrations, enable WAL mode.
 */
export function initDatabase(): Database.Database {
  if (db) return db;

  const dbPath = getDbPath();
  console.log(`[DB] Initializing database at: ${dbPath}`);

  // Ensure parent directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');

  // Use WAL mode and enable foreign keys
  db.pragma('foreign_keys = ON');

  console.log('[DB] Running schema migrations...');
  db.exec(SCHEMA_SQL);

  // Migrate older databases that predate the per-site `domain` column.
  migrateAddDomainColumn(db);

  // Migrate the site_login_status CHECK constraint to allow the new 'used'
  // status (existing DBs still have the old CHECK from CREATE TABLE).
  migrateStatusCheckAllowUsed(db);

  console.log('[DB] Schema initialized successfully.');

  return db;
}

/**
 * Ensure login_entries has a `domain` column (added when accounts became
 * per-site). Safe to run repeatedly. On very old DBs the CREATE TABLE above is
 * a no-op (table exists), so we ALTER in the new column here.
 */
function migrateAddDomainColumn(database: Database.Database): void {
  try {
    const cols = database.prepare(`PRAGMA table_info(login_entries)`).all() as any[];
    const hasDomain = cols.some(c => c.name === 'domain');
    if (!hasDomain) {
      console.log('[DB] Migrating: adding login_entries.domain column');
      database.exec(`ALTER TABLE login_entries ADD COLUMN domain TEXT NOT NULL DEFAULT ''`);
    }
    // (Re)create the uniqueness index — ignore errors if duplicates already
    // exist in a legacy DB (index creation would then fail; we log and skip).
    try {
      database.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_login_entries_domain_user
          ON login_entries(domain, username_or_email)
      `);
    } catch (e) {
      console.warn('[DB] Could not create unique index (legacy duplicates?):', e);
    }
  } catch (err) {
    console.error('[DB] domain-column migration failed:', err);
  }
}

/**
 * Rebuild site_login_status so its CHECK constraint permits the 'used' status.
 * SQLite can't ALTER a CHECK, so if the existing table's SQL lacks 'used' we
 * recreate the table (preserving rows). Safe to run repeatedly.
 */
function migrateStatusCheckAllowUsed(database: Database.Database): void {
  try {
    const row = database.prepare(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='site_login_status'`
    ).get() as { sql?: string } | undefined;

    // Only migrate if the table exists and its CHECK does not already list 'used'.
    if (!row?.sql || /'used'/.test(row.sql)) return;

    console.log('[DB] Migrating: rebuilding site_login_status to allow "used" status');
    const migrate = database.transaction(() => {
      database.exec(`
        CREATE TABLE site_login_status_new (
          id               TEXT PRIMARY KEY,
          login_entry_id   TEXT NOT NULL REFERENCES login_entries(id) ON DELETE CASCADE,
          domain           TEXT NOT NULL,
          status           TEXT NOT NULL DEFAULT 'never_used'
                             CHECK (status IN (
                               'never_used','logged_in','used','expired',
                               'login_failed','needs_2fa','active_tab_open'
                             )),
          first_login_at   TEXT,
          logged_in_until  TEXT,
          last_used_at     TEXT,
          active_tab_id    TEXT,
          UNIQUE(login_entry_id, domain)
        );
      `);
      database.exec(`
        INSERT INTO site_login_status_new
          (id, login_entry_id, domain, status, first_login_at, logged_in_until, last_used_at, active_tab_id)
        SELECT id, login_entry_id, domain, status, first_login_at, logged_in_until, last_used_at, active_tab_id
        FROM site_login_status;
      `);
      database.exec(`DROP TABLE site_login_status;`);
      database.exec(`ALTER TABLE site_login_status_new RENAME TO site_login_status;`);
    });
    migrate();
  } catch (err) {
    console.error('[DB] status-check migration failed:', err);
  }
}

/**
 * Get the database instance. Throws if not initialized.
 */
export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/**
 * Close the database connection gracefully.
 */
export function closeDatabase(): void {
  if (db) {
    console.log('[DB] Closing database connection.');
    db.close();
    db = null;
  }
}

/**
 * Run a migration function. Migrations are numbered and tracked in a meta table.
 */
export function runMigration(version: number, name: string, fn: (db: Database.Database) => void): void {
  const database = getDatabase();

  // Create migrations meta table if not exists
  database.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version   INTEGER PRIMARY KEY,
      name      TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const row = database.prepare('SELECT version FROM _migrations WHERE version = ?').get(version);
  if (row) {
    console.log(`[DB] Migration ${version} (${name}) already applied.`);
    return;
  }

  console.log(`[DB] Applying migration ${version}: ${name}`);
  fn(database);
  database.prepare('INSERT INTO _migrations (version, name) VALUES (?, ?)').run(version, name);
  console.log(`[DB] Migration ${version} applied successfully.`);
}

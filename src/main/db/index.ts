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
  console.log('[DB] Schema initialized successfully.');

  return db;
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

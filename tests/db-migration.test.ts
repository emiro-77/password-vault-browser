// ============================================================================
// DB migration test — upgrading an OLD login_page_mappings table
// ============================================================================
// Regression test for the packaged-app crash:
//   "SqliteError: no such column: login_domain"
//
// Cause: SCHEMA_SQL used to create an index on login_page_mappings(login_domain)
// inline. On an UPGRADED database the `CREATE TABLE IF NOT EXISTS` is a no-op
// (the old table already exists without login_domain), so the inline index
// creation ran against a table that had no such column and threw — killing
// startup before the ALTER-TABLE migration could add the column.
//
// The fix moves the login_domain index into the migration, AFTER the ALTER.
// This test reproduces the upgrade path against an in-memory DB and asserts the
// full init sequence (schema first, then migration) no longer throws and the
// column + index exist afterwards.
//
// NOTE: we deliberately do NOT import ../src/main/db (it pulls in electron).
// We import SCHEMA_SQL and re-implement the exact migration sequence here.

import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../src/main/db/schema';
import { extractDomain } from '../src/main/services/domain-utils';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failures++;
    console.error('  ❌ assertion failed:', msg);
  } else {
    console.log('  ✓', msg);
  }
}

// Mirror of migrateLoginPageMappingColumns() from src/main/db/index.ts.
// Kept in sync manually; the point is to exercise the ordering, not the code path.
function migrateLoginPageMappingColumns(database: Database.Database): void {
  const cols = database.prepare(`PRAGMA table_info(login_page_mappings)`).all() as any[];
  const names = new Set(cols.map(c => c.name));
  if (!names.has('login_domain')) {
    database.exec(`ALTER TABLE login_page_mappings ADD COLUMN login_domain TEXT NOT NULL DEFAULT ''`);
  }
  if (!names.has('related_urls')) {
    database.exec(`ALTER TABLE login_page_mappings ADD COLUMN related_urls TEXT NOT NULL DEFAULT '[]'`);
  }
  const legacy = database.prepare(
    `SELECT id, login_url FROM login_page_mappings WHERE login_domain = '' OR login_domain IS NULL`
  ).all() as any[];
  const upd = database.prepare(`UPDATE login_page_mappings SET login_domain = ? WHERE id = ?`);
  for (const r of legacy) {
    const d = extractDomain(r.login_url) || '';
    if (d) upd.run(d, r.id);
  }
  database.exec(
    `CREATE INDEX IF NOT EXISTS idx_login_page_mappings_login_domain ON login_page_mappings(login_domain)`
  );
}

// The OLD (pre-v1.1.0) login_page_mappings table — no login_domain/related_urls.
const OLD_LOGIN_PAGE_MAPPINGS_SQL = `
CREATE TABLE login_page_mappings (
  id                  TEXT PRIMARY KEY,
  main_domain         TEXT NOT NULL,
  login_url           TEXT NOT NULL,
  category_id         TEXT,
  category_restricted INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
`;

function initSequence(database: Database.Database) {
  // Exactly mirrors initDatabase(): schema first, then the column migration.
  database.exec(SCHEMA_SQL);
  migrateLoginPageMappingColumns(database);
}

function test_upgrade_from_old_db() {
  console.log('\n[db-migration] upgrade from OLD login_page_mappings (the crash repro):');
  const db = new Database(':memory:');

  // Simulate a user's existing DB from an older version.
  db.exec(OLD_LOGIN_PAGE_MAPPINGS_SQL);
  db.prepare(
    `INSERT INTO login_page_mappings (id, main_domain, login_url, category_restricted, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, ?)`
  ).run('m1', 'example.com', 'https://accounts.example.com/login', 'now', 'now');

  let threw = false;
  try {
    initSequence(db);
  } catch (e) {
    threw = true;
    console.error('  init threw:', (e as Error).message);
  }
  assert(!threw, 'init sequence does NOT throw on an upgraded DB');

  const cols = db.prepare(`PRAGMA table_info(login_page_mappings)`).all() as any[];
  const names = new Set(cols.map(c => c.name));
  assert(names.has('login_domain'), 'login_domain column exists after migration');
  assert(names.has('related_urls'), 'related_urls column exists after migration');

  const idx = db.prepare(`PRAGMA index_list(login_page_mappings)`).all() as any[];
  assert(
    idx.some(i => i.name === 'idx_login_page_mappings_login_domain'),
    'idx_login_page_mappings_login_domain index exists after migration'
  );

  const row = db.prepare(`SELECT login_domain, related_urls FROM login_page_mappings WHERE id='m1'`).get() as any;
  assert(row.login_domain === 'example.com', `legacy row backfilled login_domain (got '${row.login_domain}')`);
  assert(row.related_urls === '[]', `legacy row defaults related_urls to '[]' (got '${row.related_urls}')`);

  db.close();
}

function test_fresh_db() {
  console.log('\n[db-migration] fresh install (no pre-existing tables):');
  const db = new Database(':memory:');
  let threw = false;
  try {
    initSequence(db);
  } catch (e) {
    threw = true;
    console.error('  init threw:', (e as Error).message);
  }
  assert(!threw, 'init sequence does NOT throw on a fresh DB');

  const cols = db.prepare(`PRAGMA table_info(login_page_mappings)`).all() as any[];
  const names = new Set(cols.map(c => c.name));
  assert(names.has('login_domain'), 'fresh DB has login_domain column');
  assert(names.has('related_urls'), 'fresh DB has related_urls column');
  db.close();
}

function test_idempotent() {
  console.log('\n[db-migration] running init twice is idempotent:');
  const db = new Database(':memory:');
  let threw = false;
  try {
    initSequence(db);
    initSequence(db); // second run must not throw (IF NOT EXISTS everywhere)
  } catch (e) {
    threw = true;
    console.error('  second init threw:', (e as Error).message);
  }
  assert(!threw, 'running init sequence twice does NOT throw');
  db.close();
}

test_upgrade_from_old_db();
test_fresh_db();
test_idempotent();

if (failures > 0) {
  console.error(`\n[db-migration] ${failures} assertion(s) failed`);
  process.exit(1);
} else {
  console.log('\n[db-migration] all assertions passed');
}

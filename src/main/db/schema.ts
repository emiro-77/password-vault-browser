// ============================================================================
// Database Schema — DDL definitions
// ============================================================================
// Note: In actual usage, these are executed via better-sqlite3.
// For compile-time verification, we define them as string constants.

export const SCHEMA_SQL = `
-- Global login entries (passwords stored in Windows Credential Manager)
CREATE TABLE IF NOT EXISTS login_entries (
  id                 TEXT PRIMARY KEY,
  label              TEXT NOT NULL,
  username_or_email  TEXT NOT NULL,
  password_secret_ref TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

-- Bookmarks (flat list for MVP)
CREATE TABLE IF NOT EXISTS bookmarks (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  url        TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Site-specific login status per (login_entry × domain)
CREATE TABLE IF NOT EXISTS site_login_status (
  id               TEXT PRIMARY KEY,
  login_entry_id   TEXT NOT NULL REFERENCES login_entries(id) ON DELETE CASCADE,
  domain           TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'never_used'
                     CHECK (status IN (
                       'never_used','logged_in','expired',
                       'login_failed','needs_2fa','active_tab_open'
                     )),
  first_login_at   TEXT,
  logged_in_until  TEXT,
  last_used_at     TEXT,
  active_tab_id    TEXT,
  UNIQUE(login_entry_id, domain)
);

-- Active tab tracking (in-memory state, persisted for recovery)
CREATE TABLE IF NOT EXISTS tabs (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL CHECK (type IN ('guest','login_entry')),
  current_url     TEXT,
  domain          TEXT,
  login_entry_id  TEXT REFERENCES login_entries(id),
  partition_id    TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  last_active_at  TEXT NOT NULL
);

-- Optional future: site-specific autofill selectors
CREATE TABLE IF NOT EXISTS site_rules (
  id                         TEXT PRIMARY KEY,
  domain                     TEXT NOT NULL UNIQUE,
  login_url_pattern          TEXT,
  username_selector          TEXT,
  password_selector          TEXT,
  submit_selector            TEXT,
  success_indicator_selector TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_site_login_status_entry ON site_login_status(login_entry_id);
CREATE INDEX IF NOT EXISTS idx_site_login_status_domain ON site_login_status(domain);
CREATE INDEX IF NOT EXISTS idx_tabs_login_entry ON tabs(login_entry_id);
CREATE INDEX IF NOT EXISTS idx_tabs_partition ON tabs(partition_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_position ON bookmarks(position);
`;

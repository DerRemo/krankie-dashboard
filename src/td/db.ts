import { Database } from "bun:sqlite";
import { dirname } from "path";
import { mkdirSync, existsSync } from "fs";

const SCHEMA_VERSION = 1;

// Embedded so `bun build --compile` carries the schema into the binary.
// Mirrors src/td/migrations/001_init.sql.
const SCHEMA_001 = `
CREATE TABLE td_apps (
  td_app_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  bundle_id TEXT,
  asc_app_store_id TEXT,
  mapping_source TEXT,
  fetched_at TEXT NOT NULL,
  bundle_fetched_at TEXT
);
CREATE INDEX idx_td_apps_bundle ON td_apps(bundle_id);
CREATE INDEX idx_td_apps_asc   ON td_apps(asc_app_store_id);

CREATE TABLE td_daily_engagement (
  td_app_id TEXT NOT NULL,
  date TEXT NOT NULL,
  sessions INTEGER,
  dau INTEGER,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (td_app_id, date)
);

CREATE TABLE td_mau_cache (
  td_app_id TEXT NOT NULL,
  as_of_date TEXT NOT NULL,
  mau INTEGER NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (td_app_id, as_of_date)
);

CREATE TABLE td_custom_events (
  td_app_id TEXT NOT NULL,
  date TEXT NOT NULL,
  event_type TEXT NOT NULL,
  count INTEGER NOT NULL,
  unique_users INTEGER,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (td_app_id, date, event_type)
);
CREATE INDEX idx_td_custom_events_type ON td_custom_events(event_type);

CREATE TABLE td_breakdowns (
  td_app_id TEXT NOT NULL,
  date TEXT NOT NULL,
  dimension TEXT NOT NULL,
  value TEXT NOT NULL,
  users INTEGER NOT NULL,
  sessions INTEGER NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (td_app_id, date, dimension, value)
);

CREATE TABLE td_signal_types (
  td_app_id TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  PRIMARY KEY (td_app_id, signal_type)
);

CREATE TABLE td_sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  summary_json TEXT,
  error_message TEXT
);
CREATE INDEX idx_td_sync_runs_started ON td_sync_runs(started_at DESC);

CREATE TABLE td_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO td_meta (key, value) VALUES ('schema_version', '1');
`;

export interface OpenOpts {
  readonly?: boolean;
}

export function openTdDb(path: string, opts: OpenOpts = {}): Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const isFresh = path === ":memory:" || !existsSync(path);
  const db = new Database(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  if (isFresh) {
    runMigrations(db);
  } else {
    ensureSchemaVersion(db);
  }

  if (opts.readonly) {
    db.exec("PRAGMA query_only = 1");
  }
  return db;
}

export function runMigrations(db: Database): void {
  db.exec(SCHEMA_001);
}

export function ensureSchemaVersion(db: Database): void {
  const row = db.query("SELECT value FROM td_meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | null;
  if (!row) {
    throw new Error("td.db is missing schema_version; database is corrupt or pre-bootstrap");
  }
  const version = Number(row.value);
  if (version > SCHEMA_VERSION) {
    throw new Error(
      `td.db schema_version=${version} is newer than this binary (supports v${SCHEMA_VERSION}). Upgrade krankie-dashboard.`,
    );
  }
}

export function getSchemaVersion(db: Database): number {
  const row = db.query("SELECT value FROM td_meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | null;
  return row ? Number(row.value) : 0;
}

/**
 * ATTACH an asc.db file to read its tables. Callers must not write to attached tables; we don't.
 * Pass ":memory:" if asc.db doesn't exist — caller's queries will simply return 0 rows.
 */
export function attachAsc(db: Database, ascDbPath: string): void {
  db.run(`ATTACH DATABASE ? AS asc`, [ascDbPath]);
}

export function detachAsc(db: Database): void {
  db.run(`DETACH DATABASE asc`);
}

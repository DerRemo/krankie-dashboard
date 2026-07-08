import { Database } from "bun:sqlite";
import { dirname } from "path";
import { mkdirSync, existsSync } from "fs";

const SCHEMA_VERSION = 6;

// Embedded so `bun build --compile` carries the schema into the binary without
// needing a sidecar .sql file at runtime. Mirrors src/asc/migrations/001_initial.sql.
const SCHEMA_001 = `
CREATE TABLE asc_apps (
  app_store_id TEXT PRIMARY KEY,
  apple_id TEXT NOT NULL,
  name TEXT,
  fetched_at TEXT NOT NULL
);

CREATE TABLE sales_daily (
  app_store_id TEXT NOT NULL,
  date TEXT NOT NULL,
  territory TEXT NOT NULL,
  units INTEGER NOT NULL DEFAULT 0,
  redownloads INTEGER NOT NULL DEFAULT 0,
  updates INTEGER NOT NULL DEFAULT 0,
  proceeds_usd REAL NOT NULL DEFAULT 0,
  iap_units INTEGER NOT NULL DEFAULT 0,
  iap_proceeds_usd REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (app_store_id, date, territory)
);

CREATE TABLE analytics_daily (
  app_store_id TEXT NOT NULL,
  date TEXT NOT NULL,
  territory TEXT NOT NULL,
  impressions INTEGER,
  product_page_views INTEGER,
  first_time_downloads INTEGER,
  sessions INTEGER,
  active_devices INTEGER,
  crashes INTEGER,
  PRIMARY KEY (app_store_id, date, territory)
);

CREATE TABLE asc_report_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  apple_id TEXT NOT NULL,
  access_type TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (apple_id, access_type)
);

CREATE TABLE asc_report_segments_seen (
  segment_url_hash TEXT PRIMARY KEY,
  request_id_fk INTEGER NOT NULL REFERENCES asc_report_requests(id),
  category TEXT NOT NULL,
  granularity TEXT NOT NULL,
  processing_date TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL,
  summary_json TEXT,
  error TEXT
);

CREATE TABLE asc_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO asc_meta (key, value) VALUES ('schema_version', '1');
`;

const SCHEMA_002 = `
ALTER TABLE asc_apps ADD COLUMN bundle_id TEXT;
UPDATE asc_meta SET value = '2' WHERE key = 'schema_version';
`;

const SCHEMA_003 = `
ALTER TABLE sales_daily ADD COLUMN proceeds_local REAL NOT NULL DEFAULT 0;
ALTER TABLE sales_daily ADD COLUMN iap_proceeds_local REAL NOT NULL DEFAULT 0;
ALTER TABLE sales_daily ADD COLUMN proceeds_currency TEXT;

CREATE TABLE IF NOT EXISTS fx_rates_daily (
  date         TEXT NOT NULL,
  currency     TEXT NOT NULL,
  usd_per_unit REAL NOT NULL,
  fetched_at   TEXT NOT NULL,
  PRIMARY KEY (date, currency)
);

UPDATE asc_meta SET value = '3' WHERE key = 'schema_version';
`;

const SCHEMA_004 = `
ALTER TABLE asc_apps ADD COLUMN sku TEXT;
UPDATE asc_meta SET value = '4' WHERE key = 'schema_version';
`;

const SCHEMA_005 = `
CREATE TABLE purchases_daily (
  app_store_id TEXT NOT NULL,
  date         TEXT NOT NULL,
  territory    TEXT NOT NULL,
  purchases    INTEGER NOT NULL DEFAULT 0,
  proceeds_usd REAL    NOT NULL DEFAULT 0,
  sales_usd    REAL    NOT NULL DEFAULT 0,
  paying_users INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (app_store_id, date, territory)
);
UPDATE asc_meta SET value = '5' WHERE key = 'schema_version';
`;

const SCHEMA_006 = `
CREATE TABLE reviews_raw (
  app_store_id      TEXT NOT NULL,
  review_id         TEXT NOT NULL,
  territory         TEXT NOT NULL,
  rating            INTEGER NOT NULL,
  title             TEXT,
  body              TEXT,
  reviewer_nickname TEXT,
  created_at        TEXT NOT NULL,
  fetched_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (app_store_id, review_id)
);
CREATE INDEX idx_reviews_raw_app_created ON reviews_raw(app_store_id, created_at DESC);

CREATE TABLE rating_snapshots_daily (
  app_store_id TEXT NOT NULL,
  date         TEXT NOT NULL,
  territory    TEXT NOT NULL,
  average      REAL    NOT NULL,
  count        INTEGER NOT NULL,
  stars_1      INTEGER NOT NULL DEFAULT 0,
  stars_2      INTEGER NOT NULL DEFAULT 0,
  stars_3      INTEGER NOT NULL DEFAULT 0,
  stars_4      INTEGER NOT NULL DEFAULT 0,
  stars_5      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (app_store_id, date, territory)
);

CREATE TABLE review_summarizations (
  app_store_id TEXT NOT NULL,
  territory    TEXT NOT NULL,
  summary_text TEXT NOT NULL,
  fetched_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (app_store_id, territory)
);
UPDATE asc_meta SET value = '6' WHERE key = 'schema_version';
`;

export interface OpenOpts {
  readonly?: boolean;
}

export function openAscDb(path: string, opts: OpenOpts = {}): Database {
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
    runMigrations(db);
  }

  if (opts.readonly) {
    db.exec("PRAGMA query_only = 1");
  }
  return db;
}

export function runMigrations(db: Database): void {
  const existing = getSchemaVersion(db);
  if (existing === 0) {
    db.transaction(() => db.exec(SCHEMA_001))();
  }
  if (getSchemaVersion(db) < 2) {
    db.transaction(() => db.exec(SCHEMA_002))();
  }
  if (getSchemaVersion(db) < 3) {
    db.transaction(() => db.exec(SCHEMA_003))();
  }
  if (getSchemaVersion(db) < 4) {
    db.transaction(() => db.exec(SCHEMA_004))();
  }
  if (getSchemaVersion(db) < 5) {
    db.transaction(() => db.exec(SCHEMA_005))();
  }
  if (getSchemaVersion(db) < 6) {
    db.transaction(() => db.exec(SCHEMA_006))();
  }
}

export function ensureSchemaVersion(db: Database): void {
  const row = db.query("SELECT value FROM asc_meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | null;
  if (!row) {
    throw new Error("asc.db is missing schema_version; database is corrupt or pre-bootstrap");
  }
  const version = Number(row.value);
  if (version > SCHEMA_VERSION) {
    throw new Error(
      `asc.db schema_version=${version} is newer than this binary (supports v${SCHEMA_VERSION}). Upgrade krankie-dashboard.`,
    );
  }
}

export function getSchemaVersion(db: Database): number {
  try {
    const row = db.query("SELECT value FROM asc_meta WHERE key = 'schema_version'").get() as
      | { value: string }
      | null;
    return row ? Number(row.value) : 0;
  } catch {
    // asc_meta table does not exist yet (pre-bootstrap database)
    return 0;
  }
}

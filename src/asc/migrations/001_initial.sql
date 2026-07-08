-- ASC schema v1. UPDATE asc_meta.schema_version when adding migrations.

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

-- TelemetryDeck schema v1. UPDATE td_meta.schema_version when adding migrations.

CREATE TABLE td_apps (
  td_app_id TEXT PRIMARY KEY,           -- UUID from TD org-apps endpoint
  name TEXT NOT NULL,
  bundle_id TEXT,                       -- discovered via groupBy on payload.appBundle
  asc_app_store_id TEXT,                -- mapping bridge to asc_apps.app_store_id, NULL until matched
  mapping_source TEXT,                  -- 'auto-bundle' | 'auto-name' | 'manual' | NULL
  fetched_at TEXT NOT NULL,
  bundle_fetched_at TEXT
);
CREATE INDEX idx_td_apps_bundle ON td_apps(bundle_id);
CREATE INDEX idx_td_apps_asc   ON td_apps(asc_app_store_id);

CREATE TABLE td_daily_engagement (
  td_app_id TEXT NOT NULL,
  date TEXT NOT NULL,                   -- 'YYYY-MM-DD' UTC
  sessions INTEGER,
  dau INTEGER,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (td_app_id, date)
);

CREATE TABLE td_mau_cache (
  td_app_id TEXT NOT NULL,
  as_of_date TEXT NOT NULL,             -- end-of-28d-window date
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
  dimension TEXT NOT NULL,              -- 'appVersion' | 'systemVersion' | 'modelName'
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
  trigger TEXT NOT NULL,                -- 'cron' | 'cli' | 'web'
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,                 -- 'success' | 'partial' | 'error' | 'running'
  summary_json TEXT,
  error_message TEXT
);
CREATE INDEX idx_td_sync_runs_started ON td_sync_runs(started_at DESC);

CREATE TABLE td_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO td_meta (key, value) VALUES ('schema_version', '1');

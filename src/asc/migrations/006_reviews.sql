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

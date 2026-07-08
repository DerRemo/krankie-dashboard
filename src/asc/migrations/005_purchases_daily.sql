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

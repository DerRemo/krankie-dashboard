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

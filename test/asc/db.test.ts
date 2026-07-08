import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { tmpdir } from "os";
import { join } from "path";
import { rmSync, existsSync } from "fs";
import { openAscDb, getSchemaVersion } from "../../src/asc/db";
import { makeAscDb, seedPurchases } from "./seed";

function cleanupDb(path: string) {
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = path + suffix;
    if (existsSync(p)) rmSync(p);
  }
}

describe("openAscDb", () => {
  test("creates fresh database with full schema and version=6", () => {
    const db = openAscDb(":memory:");
    expect(getSchemaVersion(db)).toBe(6);
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain("asc_apps");
    expect(names).toContain("sales_daily");
    expect(names).toContain("analytics_daily");
    expect(names).toContain("asc_report_requests");
    expect(names).toContain("asc_report_segments_seen");
    expect(names).toContain("sync_runs");
    expect(names).toContain("asc_meta");
  });

  test("re-opening an existing DB does not re-run migrations", () => {
    const path = join(tmpdir(), `asc-db-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    try {
      const a = openAscDb(path);
      a.run("INSERT INTO asc_meta (key, value) VALUES ('marker', '1')");
      a.close();
      const b = openAscDb(path);
      const row = b.query("SELECT value FROM asc_meta WHERE key='marker'").get() as { value: string };
      expect(row.value).toBe("1");
      b.close();
    } finally {
      cleanupDb(path);
    }
  });

  test("fresh database has bundle_id column on asc_apps", () => {
    const db = openAscDb(":memory:");
    const cols = db.query("PRAGMA table_info(asc_apps)").all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === "bundle_id")).toBe(true);
  });

  test("fresh database has sku column on asc_apps", () => {
    const db = openAscDb(":memory:");
    const cols = db.query("PRAGMA table_info(asc_apps)").all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === "sku")).toBe(true);
  });

  test("migrates existing v1 asc.db to v6 (adds bundle_id, sku columns, purchases_daily table, review tables)", () => {
    const path = join(tmpdir(), `asc-mig-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    try {
      // Construct a v1-shaped database by hand (mirrors SCHEMA_001 from src/asc/db.ts)
      const raw = new Database(path);
      raw.exec("PRAGMA journal_mode = WAL");
      raw.exec(`
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
      `);
      raw.close();

      // Re-open via openAscDb — should forward-migrate to v6
      const db = openAscDb(path);
      expect(getSchemaVersion(db)).toBe(6);
      const cols = db.query("PRAGMA table_info(asc_apps)").all() as Array<{ name: string }>;
      expect(cols.some((c) => c.name === "bundle_id")).toBe(true);
      expect(cols.some((c) => c.name === "sku")).toBe(true);
      const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
      expect(tables.some((t) => t.name === "purchases_daily")).toBe(true);
      db.close();
    } finally {
      cleanupDb(path);
    }
  });

  test("rejects opening a DB with a future schema_version", () => {
    const path = join(tmpdir(), `asc-db-future-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    try {
      const a = openAscDb(path);
      a.run("UPDATE asc_meta SET value = '99' WHERE key = 'schema_version'");
      a.close();
      expect(() => openAscDb(path)).toThrow(/schema_version=99/);
    } finally {
      cleanupDb(path);
    }
  });

  test("readonly=true sets PRAGMA query_only", () => {
    const path = join(tmpdir(), `asc-db-ro-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    try {
      openAscDb(path).close();
      const db = openAscDb(path, { readonly: true });
      const r = db.query("PRAGMA query_only").get() as { query_only: number };
      expect(r.query_only).toBe(1);
      db.close();
    } finally {
      cleanupDb(path);
    }
  });

  test("fresh db has purchases_daily (schema v6)", () => {
    const db = makeAscDb();
    const cols = db.query("PRAGMA table_info(purchases_daily)").all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(["app_store_id", "date", "paying_users", "proceeds_usd", "purchases", "sales_usd", "territory"]);
    expect((db.query("SELECT value FROM asc_meta WHERE key='schema_version'").get() as { value: string }).value).toBe("6");
  });

  test("fresh db has version=6 and the review tables", () => {
    const db = makeAscDb();
    expect(getSchemaVersion(db)).toBe(6);
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain("reviews_raw");
    expect(names).toContain("rating_snapshots_daily");
    expect(names).toContain("review_summarizations");
  });

  test("reviews_raw has the expected columns", () => {
    const db = makeAscDb();
    const cols = db.query("PRAGMA table_info(reviews_raw)").all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual([
      "app_store_id", "body", "created_at", "fetched_at", "rating",
      "review_id", "reviewer_nickname", "territory", "title",
    ]);
  });

  test("migrates existing v5 asc.db to v6 (adds review tables, keeps existing data)", () => {
    const path = join(tmpdir(), `asc-mig-v6-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    try {
      const v5 = openAscDb(path);
      v5.run(
        `INSERT INTO sales_daily (app_store_id, date, territory, units, redownloads, updates, proceeds_usd, iap_units, iap_proceeds_usd)
         VALUES ('111', '2024-01-01', 'US', 1, 0, 0, 1.5, 0, 0)`,
      );
      v5.close();

      const db = openAscDb(path);
      expect(getSchemaVersion(db)).toBe(6);
      const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
      expect(tables.some((t: any) => t.name === "reviews_raw")).toBe(true);
      const row = db.query("SELECT units FROM sales_daily WHERE app_store_id='111'").get() as any;
      expect(row.units).toBe(1);
      db.close();
    } finally {
      cleanupDb(path);
    }
  });

  test("seedPurchases inserts and reads back", () => {
    const db = makeAscDb();
    seedPurchases(db, [{ appStoreId: "111", date: "2024-01-10", territory: "DE", purchases: 2, proceedsUsd: 4.1, salesUsd: 6.96, payingUsers: 2 }]);
    const row = db.query("SELECT * FROM purchases_daily").get() as any;
    expect(row.paying_users).toBe(2);
    expect(row.proceeds_usd).toBeCloseTo(4.1);
    expect(row.purchases).toBe(2);
    expect(row.sales_usd).toBeCloseTo(6.96);
  });

  test("schema v6: sales_daily has proceeds_local, iap_proceeds_local, proceeds_currency; fx_rates_daily exists", () => {
    const db = openAscDb(":memory:");
    const cols = db
      .query<{ name: string }, []>("PRAGMA table_info(sales_daily)")
      .all()
      .map((r) => r.name);
    expect(cols).toContain("proceeds_local");
    expect(cols).toContain("iap_proceeds_local");
    expect(cols).toContain("proceeds_currency");

    const tables = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name);
    expect(tables).toContain("fx_rates_daily");

    const fxCols = db
      .query<{ name: string }, []>("PRAGMA table_info(fx_rates_daily)")
      .all()
      .map((r) => r.name);
    expect(fxCols).toEqual(expect.arrayContaining(["date", "currency", "usd_per_unit", "fetched_at"]));

    const ver = db.query<{ value: string }, []>("SELECT value FROM asc_meta WHERE key='schema_version'").get();
    expect(ver?.value).toBe("6");
  });
});

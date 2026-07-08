import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { tmpdir } from "os";
import { join } from "path";
import { writeFileSync, rmSync } from "fs";
import { startMockAsc } from "./mock-asc";
import { makeKeyFixture } from "./fixture-keys";
import { openAscDb } from "../../src/asc/db";
import { AscAuth } from "../../src/asc/auth";
import { AscClient } from "../../src/asc/client";
import { runSync } from "../../src/asc/sync";

describe("ASC sync e2e against mock server", () => {
  let baseUrl: string;
  let stop: () => void;
  let keyPath: string;

  beforeAll(async () => {
    const mock = await startMockAsc({ knownApps: ["111"] });
    baseUrl = mock.baseUrl;
    stop = mock.stop;

    const fix = await makeKeyFixture();
    keyPath = join(tmpdir(), `asc-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}.p8`);
    writeFileSync(keyPath, fix.privateKeyPem);
  });

  afterAll(() => {
    stop();
    try { rmSync(keyPath); } catch {}
  });

  test("runs a full sync: 1 app, sales+engagement+usage land in DB, status=success", async () => {
    const ascDb = openAscDb(":memory:");
    const krankieDb = new Database(":memory:");
    krankieDb.exec(`CREATE TABLE apps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id TEXT NOT NULL UNIQUE, name TEXT, platform TEXT NOT NULL,
      track_keywords INTEGER NOT NULL DEFAULT 0,
      track_ratings INTEGER NOT NULL DEFAULT 0,
      track_reviews INTEGER NOT NULL DEFAULT 0,
      developer TEXT, is_own INTEGER NOT NULL DEFAULT 0
    )`);
    krankieDb.run("INSERT INTO apps (app_id, name, platform, track_keywords) VALUES ('111', 'Alpha', 'iphone', 1)");

    const auth = new AscAuth({ issuerId: "iss", keyId: "kid", privateKeyPath: keyPath });
    const client = new AscClient({ baseUrl, auth, sleep: async () => {}, rateLimitPerSecond: 10000 });

    // Seed sales_daily so backfill window is small (prevents 365 mock requests in test)
    ascDb.run(
      `INSERT INTO sales_daily (app_store_id, date, territory, units, redownloads, updates, proceeds_usd, iap_units, iap_proceeds_usd)
       VALUES ('111', '2024-01-13', 'US', 0, 0, 0, 0, 0, 0)`,
    );

    const out = await runSync({
      ascDb, krankieDb, client,
      vendorNumber: "vn", trigger: "manual",
      today: new Date("2024-01-16T12:00:00Z"),
    });

    expect(out.status).toBe("success");
    const sales = ascDb.query("SELECT COUNT(*) AS c FROM sales_daily").get() as { c: number };
    const analytics = ascDb.query("SELECT COUNT(*) AS c FROM analytics_daily").get() as { c: number };
    expect(sales.c).toBeGreaterThan(0);
    expect(analytics.c).toBeGreaterThan(0);
  });
});

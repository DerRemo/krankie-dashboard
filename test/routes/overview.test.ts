import { test, expect } from "bun:test";
import { rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { makeApp } from "../../src/server";
import { openAscDb } from "../../src/asc/db";
import { makeTestDb, seedDefault, mockKrankieBin, mockConfig, seedApp, seedKeyword, seedRankings } from "../seed";
import { seedAnalytics, seedSales } from "../asc/seed";

test("GET / lists apps with their per-app keyword stats", async () => {
  const db = makeTestDb();
  seedDefault(db);
  const app = makeApp({
    config: mockConfig(),
    db,
    journalMode: "wal",
  });
  const res = await app.request("/");
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain("TestApp");
  // Per-app keyword stats render as a compact strip row (rank-distribution
  // bar + tier counts), not the old KPI-tile portfolio summary.
  expect(html).toContain("ov-strip-row");
  expect(html).toContain('class="ov-rank-bar ov-strip-bar"');
  expect(html).not.toContain("kpi-grid");
  // Overview shows per-app summary stats only — the full keyword table with
  // ranks/sparklines lives on /keywords and /apps/:id, not here.
  expect(html).not.toContain('class="sparkline"');
});

test("GET / returns 503 when db unreachable", async () => {
  const app = makeApp({
    config: mockConfig(),
    db: null,
    journalMode: "unknown",
  });
  const res = await app.request("/");
  expect(res.status).toBe(503);
});

test("GET / sees ASC DB created after server startup", async () => {
  const dir = join(tmpdir(), `overview-asc-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const ascPath = join(dir, "asc.db");
  try {
    const db = makeTestDb();
    seedDefault(db);
    const app = makeApp({
      config: mockConfig({
        ascConfigured: true,
        asc: {
          issuerId: "issuer",
          keyId: "key",
          privateKeyPath: "/tmp/key.p8",
          vendorNumber: "123",
          apiBase: "https://test.invalid",
          dbPath: ascPath,
        },
      }),
      db,
      journalMode: "wal",
      ascDb: null,
    });

    const ascDb = openAscDb(ascPath);
    seedAnalytics(ascDb, [
      { appStoreId: "6737412117", date: "2024-01-10", territory: "US", impressions: 1234, firstTimeDownloads: 12 },
    ]);
    ascDb.close();

    const res = await app.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Impr.");
    expect(html).toContain("1,234");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("GET / shows ASC pills for Sales-only data while analytics is pending", async () => {
  const db = makeTestDb();
  seedDefault(db);
  const ascDb = openAscDb(":memory:");
  seedSales(ascDb, [
    { appStoreId: "6737412117", date: "2024-01-10", territory: "US", units: 7 },
  ]);
  const app = makeApp({
    config: mockConfig({ ascConfigured: true }),
    db,
    journalMode: "wal",
    ascDb,
  });

  const res = await app.request("/");
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain("Downl.");
  expect(html).toContain('<span class="num">7</span> Downl.');
});

test("GET / keeps per-app tiers independent across apps, with no portfolio-wide rollup", async () => {
  const db = makeTestDb();
  const aId = seedApp(db, { appStoreId: "111", name: "A", platform: "iphone" });
  const bId = seedApp(db, { appStoreId: "222", name: "B", platform: "iphone" });
  const k1 = seedKeyword(db, { appId: aId, keyword: "alpha", store: "us" });
  const k2 = seedKeyword(db, { appId: bId, keyword: "beta", store: "us" });
  seedRankings(db, k1, [{ daysAgo: 0, rank: 3 }]);
  seedRankings(db, k2, [{ daysAgo: 0, rank: 40 }]);

  const app = makeApp({ config: mockConfig(), db, journalMode: "wal" });
  const res = await app.request("/");
  expect(res.status).toBe(200);
  const html = await res.text();
  // Two independent strip rows, one per app — no portfolio-wide KPI grid.
  expect(html.match(/ov-strip-row/g)?.length).toBe(2);
  expect(html).not.toContain("kpi-grid");
  expect(html).not.toContain("Impressions 30d"); // ASC not configured
});

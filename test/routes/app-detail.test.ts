import { test, expect } from "bun:test";
import { makeApp } from "../../src/server";
import { makeTestDb, seedDefault, mockKrankieBin, mockConfig, seedCompetitor, linkCompetitor, seedCompetitorRankings } from "../seed";
import { makeAscDb, seedAnalytics, seedSales } from "../asc/seed";
import { openTdDb, attachAsc } from "../../src/td/db";

test("GET /apps/:appStoreId renders header, KPIs, and keyword grouping", async () => {
  const db = makeTestDb();
  seedDefault(db);
  const app = makeApp({
    config: mockConfig(),
    db, journalMode: "wal",
  });
  const res = await app.request("/apps/6737412117");
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain("TestApp");
  expect(html).toContain("Keywords");
  expect(html).toContain("habit tracker");
  expect(html).toContain("Top 10");
  expect(html.match(/store-group/g)?.length).toBeGreaterThanOrEqual(2);
});

test("GET /apps/:appStoreId renders ASC daily data table when ASC data exists", async () => {
  const db = makeTestDb();
  seedDefault(db);
  const ascDb = makeAscDb();
  seedAnalytics(ascDb, [{ appStoreId: "6737412117", date: "2024-01-10", territory: "US", impressions: 100, productPageViews: 10 }]);
  seedSales(ascDb, [{ appStoreId: "6737412117", date: "2024-01-10", territory: "US", units: 2, proceedsUsd: 5 }]);
  const app = makeApp({
    config: mockConfig({ ascConfigured: true }),
    db, journalMode: "wal", ascDb,
  });
  const res = await app.request("/apps/6737412117");
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain("Daily Data");
  expect(html).toContain("sales only");
  expect(html).not.toContain(">2</td><td class=\"num\">20.00%</td>");
  expect(html).toContain("$5");
});

test("GET /apps/:unknown returns 404", async () => {
  const db = makeTestDb();
  const app = makeApp({
    config: mockConfig(),
    db, journalMode: "wal",
  });
  const res = await app.request("/apps/9999");
  expect(res.status).toBe(404);
});

test("GET /apps/:appStoreId renders revenue-by-territory table", async () => {
  const db = makeTestDb();
  seedDefault(db);
  const ascDb = makeAscDb();
  seedSales(ascDb, [
    { appStoreId: "6737412117", date: "2024-01-10", territory: "US", units: 2, proceedsUsd: 6 },
    { appStoreId: "6737412117", date: "2024-01-10", territory: "DE", units: 1, proceedsUsd: 0, iapProceedsUsd: 4 },
  ]);
  const app = makeApp({
    config: mockConfig({ ascConfigured: true }),
    db, journalMode: "wal", ascDb,
  });
  const res = await app.request("/apps/6737412117");
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain("Revenue by Territory");
  expect(html).toContain("60.0 %");
});

test("renders TelemetryDeck tab + AsoToAppFunnel when TD data is mapped", async () => {
  const db = makeTestDb();
  seedDefault(db);

  // Set up an ASC db with analytics data so funnel has ASC impressions.
  const ascDb = makeAscDb();
  seedAnalytics(ascDb, [
    { appStoreId: "6737412117", date: "2024-01-10", territory: "US", impressions: 500, productPageViews: 50, firstTimeDownloads: 10 },
  ]);

  // Set up a TD db with a mapped app + engagement rows.
  const tdDb = openTdDb(":memory:");
  tdDb.run(
    "INSERT INTO td_apps (td_app_id, name, asc_app_store_id, fetched_at) VALUES (?, ?, ?, ?)",
    ["td-app-abc", "TestApp", "6737412117", "2024-01-10T00:00:00Z"],
  );
  tdDb.run(
    "INSERT INTO td_daily_engagement (td_app_id, date, sessions, dau, fetched_at) VALUES (?, ?, ?, ?, ?)",
    ["td-app-abc", "2024-01-10", 123, 45, "2024-01-10T12:00:00Z"],
  );
  // Attach a stub asc schema so getFunnelTotals can query asc.analytics_daily.
  // (In-memory asc.db can't be attached by path, so we create the schema inline.)
  tdDb.run("ATTACH DATABASE ':memory:' AS asc");
  tdDb.run(`CREATE TABLE asc.analytics_daily (
    app_store_id TEXT, date TEXT, territory TEXT,
    impressions INTEGER, product_page_views INTEGER, first_time_downloads INTEGER,
    sessions INTEGER, active_devices INTEGER, crashes INTEGER
  )`);
  tdDb.run(
    "INSERT INTO asc.analytics_daily (app_store_id, date, territory, impressions, product_page_views, first_time_downloads) VALUES (?,?,?,?,?,?)",
    ["6737412117", "2024-01-10", "US", 500, 50, 10],
  );

  const app = makeApp({
    config: mockConfig({ tdConfigured: true }),
    db, journalMode: "wal", ascDb, tdDb,
  });
  const res = await app.request("/apps/6737412117");
  expect(res.status).toBe(200);
  const html = await res.text();

  // TD tab markup
  expect(html).toContain('data-tab-id="td"');
  expect(html).toContain("TelemetryDeck");

  // TD engagement chart (requires a TD mapping)
  expect(html).toContain("data-td-engagement-chart");

  // AsoToAppFunnel
  expect(html).toContain("ASO → App Funnel");
});

test("GET /apps/:appStoreId renders Competitors section when links exist", async () => {
  const db = makeTestDb();
  const { appId, keywordIds } = seedDefault(db);
  const deKw = keywordIds.find((k) => k.store === "de")!;
  const rival = seedCompetitor(db, { appStoreId: "RIVAL1", name: "Packr" });
  linkCompetitor(db, appId, rival);
  seedCompetitorRankings(db, rival, { keyword: deKw.keyword, store: "de" }, [{ daysAgo: 0, rank: 3 }]);

  const app = makeApp({ config: mockConfig(), db, journalMode: "wal" });
  const res = await app.request("/apps/6737412117");
  const html = await res.text();
  expect(res.status).toBe(200);
  expect(html).toContain("Competitors");
  expect(html).toContain("Packr");
  // BenchmarkSummary KPI strip renders between the section label and the matrix.
  expect(html).toContain("Benchmarked");
  expect(html).toContain("Wir führen");
  expect(html).toContain("Ø Gap");
});

test("GET /apps/:appStoreId shows empty Competitors block when none linked", async () => {
  const db = makeTestDb();
  seedDefault(db);
  const app = makeApp({ config: mockConfig(), db, journalMode: "wal" });
  const res = await app.request("/apps/6737412117");
  const html = await res.text();
  expect(html).toContain("Keine Competitors für diese App getrackt.");
});

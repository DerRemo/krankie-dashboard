import { test, expect } from "bun:test";
import { makeTestDb, seedApp, seedKeyword, seedRankings } from "./seed";
import { openAscDb } from "../src/asc/db";
import { feedEntries, isSignificantMover, groupFeed } from "../src/data/feed";
import type { App } from "../src/db/types";
import type { AscTodayRow } from "../src/data/asc";
import type { FeedEntry } from "../src/data/feed";

function appFixture(id: number, appStoreId: string, name: string): App {
  return { id, appStoreId, name, developer: null, platform: "iphone", isOwn: true, trackKeywords: true };
}

function ascTodayFixture(over: Partial<AscTodayRow>): AscTodayRow {
  return {
    appStoreId: "111", date: "2026-07-08", impressionsDate: "2026-07-08", downloadsDate: "2026-07-08",
    impressions: 100, downloads: 10, impressionsSource: "analytics", downloadsSource: "sales",
    isPartial: false, impressionsDelta7dPct: null, downloadsDelta7dPct: null,
    trendImpressions: [], trendDownloads: [], proceeds30d: 0, trendProceeds: [],
    ...over,
  };
}

test("isSignificantMover: |delta| >= 3 or top-10 boundary crossed", () => {
  expect(isSignificantMover(20, 15)).toBe(true);   // delta 5
  expect(isSignificantMover(20, 19)).toBe(false);  // delta 1, no cross
  expect(isSignificantMover(11, 10)).toBe(true);   // crossed into top 10
  expect(isSignificantMover(10, 11)).toBe(true);   // crossed out of top 10
  expect(isSignificantMover(5, 4)).toBe(false);    // delta 1 inside top 10
});

test("feedEntries: significant movers first, sorted by |delta| desc", () => {
  const db = makeTestDb();
  const appId = seedApp(db, { appStoreId: "111", name: "TestApp", platform: "iphone", isOwn: true });
  const k1 = seedKeyword(db, { appId, keyword: "big mover", store: "de" });
  const k2 = seedKeyword(db, { appId, keyword: "small mover", store: "de" });
  const k3 = seedKeyword(db, { appId, keyword: "tiny mover", store: "de" });
  seedRankings(db, k1, [{ daysAgo: 2, rank: 40 }, { daysAgo: 0, rank: 20 }]); // delta 20
  seedRankings(db, k2, [{ daysAgo: 2, rank: 15 }, { daysAgo: 0, rank: 11 }]); // delta 4
  seedRankings(db, k3, [{ daysAgo: 2, rank: 30 }, { daysAgo: 0, rank: 29 }]); // delta 1 → filtered

  const entries = feedEntries(db, "7d", { ascDb: null, ascToday: [], apps: [appFixture(appId, "111", "TestApp")] });
  const movers = entries.filter((e) => e.kind === "mover");
  expect(movers.map((m) => m.keyword)).toEqual(["big mover", "small mover"]);
});

test("feedEntries: reviews within window come from asc db, with snippet", () => {
  const db = makeTestDb();
  const ascDb = openAscDb(":memory:");
  ascDb.run(
    "INSERT INTO asc_apps (app_store_id, apple_id, name, fetched_at) VALUES ('111', '111', 'TestApp', '2026-07-08')",
  );
  const recent = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const old = new Date(Date.now() - 20 * 86_400_000).toISOString();
  const longBody = "x".repeat(200);
  ascDb.run(
    "INSERT INTO reviews_raw (app_store_id, review_id, territory, rating, title, body, reviewer_nickname, created_at) VALUES " +
    "('111', 'r1', 'DEU', 5, 'Super', ?, 'nick', ?), ('111', 'r2', 'DEU', 4, 'Alt', 'old body', 'nick', ?)",
    [longBody, recent, old],
  );

  const entries = feedEntries(db, "7d", { ascDb, ascToday: [], apps: [] });
  const reviews = entries.filter((e) => e.kind === "review");
  expect(reviews).toHaveLength(1);
  expect(reviews[0]!.title).toBe("Super");
  expect(reviews[0]!.appName).toBe("TestApp");
  expect(reviews[0]!.snippet!.length).toBeLessThanOrEqual(141); // 140 + ellipsis
});

test("feedEntries: asc anomalies over ±30% become entries", () => {
  const db = makeTestDb();
  const ascToday = [
    ascTodayFixture({ appStoreId: "111", impressionsDelta7dPct: 247.4, downloadsDelta7dPct: -10 }),
    ascTodayFixture({ appStoreId: "222", impressionsDelta7dPct: 5, downloadsDelta7dPct: -50 }),
  ];
  const apps = [appFixture(1, "111", "A"), appFixture(2, "222", "B")];
  const entries = feedEntries(db, "7d", { ascDb: null, ascToday, apps });
  const asc = entries.filter((e) => e.kind === "asc");
  expect(asc).toHaveLength(2);
  expect(asc.find((a) => a.appStoreId === "111")!.metric).toBe("impressions");
  expect(asc.find((a) => a.appStoreId === "222")!.metric).toBe("downloads");
});

test("feedEntries: reviews and asc anomalies merge chronologically, newest first", () => {
  const db = makeTestDb();
  const ascDb = openAscDb(":memory:");
  ascDb.run(
    "INSERT INTO asc_apps (app_store_id, apple_id, name, fetched_at) VALUES ('111', '111', 'TestApp', '2026-07-08')",
  );
  const dayIso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  // One review older than the asc anomaly date, one newer.
  ascDb.run(
    "INSERT INTO reviews_raw (app_store_id, review_id, territory, rating, title, body, reviewer_nickname, created_at) VALUES " +
    "('111', 'r-old', 'DEU', 5, 'Old review', 'b', 'nick', ?), ('111', 'r-new', 'DEU', 4, 'New review', 'b', 'nick', ?)",
    [dayIso(5), dayIso(0)],
  );
  const ascToday = [
    ascTodayFixture({ appStoreId: "111", date: dayIso(2).slice(0, 10), impressionsDelta7dPct: 100 }),
  ];

  const entries = feedEntries(db, "7d", { ascDb, ascToday, apps: [appFixture(1, "111", "TestApp")] });
  const tail = entries.filter((e) => e.kind !== "mover");
  expect(tail.map((e) => (e.kind === "review" ? e.title : "asc"))).toEqual([
    "New review", // today
    "asc",        // 2 days ago
    "Old review", // 5 days ago
  ]);
});

test("feedEntries: asc anomaly with null date sorts after dated entries", () => {
  const db = makeTestDb();
  const ascDb = openAscDb(":memory:");
  ascDb.run(
    "INSERT INTO asc_apps (app_store_id, apple_id, name, fetched_at) VALUES ('111', '111', 'TestApp', '2026-07-08')",
  );
  ascDb.run(
    "INSERT INTO reviews_raw (app_store_id, review_id, territory, rating, title, body, reviewer_nickname, created_at) VALUES " +
    "('111', 'r1', 'DEU', 5, 'Review', 'b', 'nick', ?)",
    [new Date(Date.now() - 3 * 86_400_000).toISOString()],
  );
  const ascToday = [
    ascTodayFixture({ appStoreId: "222", date: null, downloadsDelta7dPct: -40 }),
  ];

  const entries = feedEntries(db, "7d", { ascDb, ascToday, apps: [] });
  const tail = entries.filter((e) => e.kind !== "mover");
  expect(tail.map((e) => e.kind)).toEqual(["review", "asc"]);
});

test("feedEntries: empty everything gives empty array", () => {
  const db = makeTestDb();
  expect(feedEntries(db, "7d", { ascDb: null, ascToday: [], apps: [] })).toEqual([]);
});

function moverEntry(keyword: string, delta: number): FeedEntry {
  return { kind: "mover", keywordId: 1, keyword, store: "de", appStoreId: "111", appName: "A", previousRank: 20, currentRank: 20 - delta, delta };
}
function ascEntry(metric: "impressions" | "downloads", deltaPct: number, date: string): FeedEntry {
  return { kind: "asc", appStoreId: "111", appName: "A", metric, deltaPct, current: 100, date };
}
function reviewEntry(rating: number, createdAt: string): FeedEntry {
  return { kind: "review", appStoreId: "111", appName: "A", rating, title: "t", snippet: null, territory: "DE", createdAt };
}

test("groupFeed: partitions entries into keywords/impressions/downloads/reviews", () => {
  const entries: FeedEntry[] = [
    moverEntry("kw1", 20),
    ascEntry("impressions", 247, "2026-07-08"),
    ascEntry("downloads", -50, "2026-07-08"),
    reviewEntry(5, "2026-07-06T10:00:00Z"),
    moverEntry("kw2", 4),
  ];
  const g = groupFeed(entries);
  expect(g.keywords.map((m) => m.keyword)).toEqual(["kw1", "kw2"]);
  expect(g.impressions).toHaveLength(1);
  expect(g.impressions[0]!.metric).toBe("impressions");
  expect(g.downloads).toHaveLength(1);
  expect(g.downloads[0]!.metric).toBe("downloads");
  expect(g.reviews).toHaveLength(1);
  expect(g.reviews[0]!.rating).toBe(5);
});

test("groupFeed: keywords keep incoming order (already sorted by |delta| desc)", () => {
  const g = groupFeed([moverEntry("big", 20), moverEntry("small", 4)]);
  expect(g.keywords.map((m) => m.keyword)).toEqual(["big", "small"]);
});

test("groupFeed: impressions/downloads sorted by |deltaPct| desc", () => {
  const g = groupFeed([
    ascEntry("impressions", 40, "2026-07-08"),
    ascEntry("impressions", -300, "2026-07-08"),
    ascEntry("downloads", 35, "2026-07-08"),
    ascEntry("downloads", -80, "2026-07-08"),
  ]);
  expect(g.impressions.map((e) => e.deltaPct)).toEqual([-300, 40]);
  expect(g.downloads.map((e) => e.deltaPct)).toEqual([-80, 35]);
});

test("groupFeed: reviews sorted by createdAt desc", () => {
  const g = groupFeed([
    reviewEntry(3, "2026-07-01T00:00:00Z"),
    reviewEntry(5, "2026-07-07T00:00:00Z"),
    reviewEntry(4, "2026-07-04T00:00:00Z"),
  ]);
  expect(g.reviews.map((r) => r.rating)).toEqual([5, 4, 3]);
});

test("groupFeed: empty input gives four empty groups", () => {
  const g = groupFeed([]);
  expect(g.keywords).toEqual([]);
  expect(g.impressions).toEqual([]);
  expect(g.downloads).toEqual([]);
  expect(g.reviews).toEqual([]);
});

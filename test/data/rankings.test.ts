import { test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { makeTestDb, seedApp, seedKeyword, seedRankings } from "../seed";
import { currentRankings, movers } from "../../src/data/rankings";

let db: Database;
beforeEach(() => { db = makeTestDb(); });

test("currentRankings returns latest rank with 24h and 7d deltas + 14-day trend", () => {
  const a = seedApp(db, { appStoreId: "111", name: "A", platform: "iphone" });
  const k = seedKeyword(db, { appId: a, keyword: "x", store: "us" });
  // Today: 30, yesterday: 35 (improved by 5), 7 days ago: 42 (improved by 12)
  seedRankings(db, k, [
    { daysAgo: 14, rank: 60 },
    { daysAgo: 10, rank: 55 },
    { daysAgo: 7, rank: 42 },
    { daysAgo: 3, rank: 40 },
    { daysAgo: 1, rank: 35 },
    { daysAgo: 0, rank: 30 },
  ]);

  const rows = currentRankings(db);
  expect(rows).toHaveLength(1);
  const r = rows[0]!;
  expect(r.currentRank).toBe(30);
  expect(r.delta24h).toBe(5);   // 35 - 30
  expect(r.delta7d).toBe(12);   // 42 - 30
  expect(r.trend.length).toBeGreaterThanOrEqual(2);
  expect(r.trend.length).toBeLessThanOrEqual(14);
  // trend is oldest first
  expect(r.trend[0]!.at < r.trend[r.trend.length - 1]!.at).toBe(true);
  expect(r.appStoreId).toBe("111");
});

test("currentRankings computes deltas relative to the latest check when data is stale", () => {
  const a = seedApp(db, { appStoreId: "111", name: "A", platform: "iphone" });
  const k = seedKeyword(db, { appId: a, keyword: "x", store: "us" });
  db.run("INSERT INTO rankings (keyword_id, rank, checked_at) VALUES (?, ?, ?)", [k, 42, "2024-01-03 00:00:00"]);
  db.run("INSERT INTO rankings (keyword_id, rank, checked_at) VALUES (?, ?, ?)", [k, 35, "2024-01-09 00:00:00"]);
  db.run("INSERT INTO rankings (keyword_id, rank, checked_at) VALUES (?, ?, ?)", [k, 30, "2024-01-10 00:00:00"]);

  const r = currentRankings(db)[0]!;
  expect(r.currentRank).toBe(30);
  expect(r.delta24h).toBe(5);
  expect(r.delta7d).toBe(12);
});

test("currentRankings handles null current rank", () => {
  const a = seedApp(db, { appStoreId: "111", name: "A", platform: "iphone" });
  const k = seedKeyword(db, { appId: a, keyword: "x", store: "us" });
  seedRankings(db, k, [
    { daysAgo: 1, rank: 50 },
    { daysAgo: 0, rank: null },
  ]);
  const rows = currentRankings(db);
  expect(rows[0]!.currentRank).toBeNull();
  expect(rows[0]!.delta24h).toBeNull();   // can't delta against null
});

test("currentRankings handles keyword without any rankings", () => {
  const a = seedApp(db, { appStoreId: "111", name: "A", platform: "iphone" });
  seedKeyword(db, { appId: a, keyword: "fresh", store: "us" });
  const rows = currentRankings(db);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.currentRank).toBeNull();
  expect(rows[0]!.delta24h).toBeNull();
  expect(rows[0]!.trend).toEqual([]);
});

test("currentRankings filters by appStoreId", () => {
  const a1 = seedApp(db, { appStoreId: "111", name: "A", platform: "iphone" });
  const a2 = seedApp(db, { appStoreId: "222", name: "B", platform: "iphone" });
  const k1 = seedKeyword(db, { appId: a1, keyword: "x", store: "us" });
  const k2 = seedKeyword(db, { appId: a2, keyword: "y", store: "us" });
  seedRankings(db, k1, [{ daysAgo: 0, rank: 10 }]);
  seedRankings(db, k2, [{ daysAgo: 0, rank: 20 }]);
  expect(currentRankings(db, { appStoreId: "111" })).toHaveLength(1);
});

test("movers returns biggest absolute changes within window, both directions", () => {
  const a = seedApp(db, { appStoreId: "111", name: "A", platform: "iphone" });
  const big = seedKeyword(db, { appId: a, keyword: "big", store: "us" });
  const small = seedKeyword(db, { appId: a, keyword: "small", store: "us" });
  seedRankings(db, big, [
    { daysAgo: 2, rank: 100 },
    { daysAgo: 0, rank: 20 },        // improved by 80
  ]);
  seedRankings(db, small, [
    { daysAgo: 2, rank: 30 },
    { daysAgo: 0, rank: 33 },        // worsened by 3
  ]);

  const moved = movers(db, { window: "7d" });
  expect(moved).toHaveLength(2);
  expect(moved[0]!.keyword).toBe("big");
  expect(moved[0]!.delta).toBe(80);
  expect(moved[1]!.keyword).toBe("small");
  expect(moved[1]!.delta).toBe(-3);
});

test("movers uses each keyword's latest check as the window anchor", () => {
  const a = seedApp(db, { appStoreId: "111", name: "A", platform: "iphone" });
  const k = seedKeyword(db, { appId: a, keyword: "stale", store: "us" });
  db.run("INSERT INTO rankings (keyword_id, rank, checked_at) VALUES (?, ?, ?)", [k, 100, "2024-01-05 00:00:00"]);
  db.run("INSERT INTO rankings (keyword_id, rank, checked_at) VALUES (?, ?, ?)", [k, 20, "2024-01-10 00:00:00"]);

  const moved = movers(db, { window: "7d" });
  expect(moved).toHaveLength(1);
  expect(moved[0]!.keyword).toBe("stale");
  expect(moved[0]!.delta).toBe(80);
});

test("movers excludes keywords missing endpoints in the window", () => {
  const a = seedApp(db, { appStoreId: "111", name: "A", platform: "iphone" });
  const k = seedKeyword(db, { appId: a, keyword: "k", store: "us" });
  seedRankings(db, k, [
    { daysAgo: 30, rank: 50 },     // outside 7d window — should not anchor
    { daysAgo: 0, rank: 30 },
  ]);
  expect(movers(db, { window: "7d" })).toHaveLength(0);
});

test("movers ignores null endpoints", () => {
  const a = seedApp(db, { appStoreId: "111", name: "A", platform: "iphone" });
  const k = seedKeyword(db, { appId: a, keyword: "k", store: "us" });
  seedRankings(db, k, [
    { daysAgo: 2, rank: null },
    { daysAgo: 0, rank: 30 },
  ]);
  expect(movers(db, { window: "7d" })).toHaveLength(0);
});

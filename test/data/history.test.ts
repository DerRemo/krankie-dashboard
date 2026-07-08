import { test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { makeTestDb, seedApp, seedKeyword, seedRankings } from "../seed";
import { keywordHistory } from "../../src/data/history";

let db: Database;
beforeEach(() => { db = makeTestDb(); });

test("keywordHistory returns oldest-first time series within range", () => {
  const a = seedApp(db, { appStoreId: "111", name: "A", platform: "iphone" });
  const k = seedKeyword(db, { appId: a, keyword: "x", store: "us" });
  seedRankings(db, k, [
    { daysAgo: 100, rank: 80 },
    { daysAgo: 40, rank: 60 },
    { daysAgo: 20, rank: 50 },
    { daysAgo: 5, rank: 40 },
    { daysAgo: 1, rank: 35 },
    { daysAgo: 0, rank: null },
  ]);

  const h7 = keywordHistory(db, k, "7d");
  expect(h7.map((p) => p.rank)).toEqual([40, 35, null]);

  const h30 = keywordHistory(db, k, "30d");
  expect(h30).toHaveLength(4);

  const hAll = keywordHistory(db, k, "all");
  expect(hAll).toHaveLength(6);
  expect(hAll[0]!.rank).toBe(80);                      // oldest first
  expect(hAll[hAll.length - 1]!.rank).toBeNull();
});

test("keywordHistory anchors ranges to the keyword's latest check when data is stale", () => {
  const a = seedApp(db, { appStoreId: "111", name: "A", platform: "iphone" });
  const k = seedKeyword(db, { appId: a, keyword: "x", store: "us" });
  db.run("INSERT INTO rankings (keyword_id, rank, checked_at) VALUES (?, ?, ?)", [k, 80, "2024-01-01 00:00:00"]);
  db.run("INSERT INTO rankings (keyword_id, rank, checked_at) VALUES (?, ?, ?)", [k, 60, "2024-01-04 00:00:00"]);
  db.run("INSERT INTO rankings (keyword_id, rank, checked_at) VALUES (?, ?, ?)", [k, 40, "2024-01-10 00:00:00"]);

  const h7 = keywordHistory(db, k, "7d");
  expect(h7.map((p) => p.rank)).toEqual([60, 40]);
});

test("keywordHistory returns empty array for unknown keyword id", () => {
  expect(keywordHistory(db, 999, "30d")).toEqual([]);
});

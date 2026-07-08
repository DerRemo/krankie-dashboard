import { test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { makeTestDb, seedApp, seedKeyword, seedRankings } from "../seed";
import { lastCheck, dbStats, schemaSmokeCheck } from "../../src/data/system";

let db: Database;
beforeEach(() => { db = makeTestDb(); });

test("lastCheck returns null when no rankings", () => {
  expect(lastCheck(db)).toBeNull();
});

test("lastCheck returns most recent ranking timestamp", () => {
  const a = seedApp(db, { appStoreId: "111", name: "A", platform: "iphone" });
  const k = seedKeyword(db, { appId: a, keyword: "x", store: "us" });
  seedRankings(db, k, [{ daysAgo: 2, rank: 10 }, { daysAgo: 0, rank: 5 }]);
  const ts = lastCheck(db);
  expect(ts).not.toBeNull();
  // Within last few minutes
  expect(Date.now() - new Date(ts!).getTime()).toBeLessThan(5 * 60 * 1000);
});

test("dbStats counts rows", () => {
  const a = seedApp(db, { appStoreId: "111", name: "A", platform: "iphone" });
  const k = seedKeyword(db, { appId: a, keyword: "x", store: "us" });
  seedRankings(db, k, [{ daysAgo: 0, rank: 5 }]);
  const s = dbStats(db);
  expect(s.apps).toBe(1);
  expect(s.keywords).toBe(1);
  expect(s.rankings).toBe(1);
  expect(s.dbSizeBytes).toBeGreaterThanOrEqual(0);
});

test("schemaSmokeCheck passes on full schema", () => {
  expect(schemaSmokeCheck(db)).toEqual({ ok: true, missingTables: [] });
});

test("schemaSmokeCheck reports missing tables", () => {
  const broken = new Database(":memory:");
  broken.exec("CREATE TABLE apps (id INTEGER PRIMARY KEY)");
  const result = schemaSmokeCheck(broken);
  expect(result.ok).toBe(false);
  expect(result.missingTables).toEqual(expect.arrayContaining(["keywords", "rankings"]));
});

import { test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { makeTestDb, seedApp, seedKeyword, seedRankings } from "../seed";
import { listApps, getAppByAppStoreId, appStats, portfolioRankingStats } from "../../src/data/apps";

let db: Database;

beforeEach(() => {
  db = makeTestDb();
});

test("listApps returns apps with at least one tracked keyword", () => {
  const ownAppId = seedApp(db, { appStoreId: "111", name: "Own", platform: "iphone", isOwn: true });
  seedApp(db, { appStoreId: "222", name: "OrphanApp", platform: "iphone", isOwn: false });
  seedKeyword(db, { appId: ownAppId, keyword: "alpha", store: "us" });

  const apps = listApps(db);
  expect(apps).toHaveLength(1);
  expect(apps[0]!.appStoreId).toBe("111");
  expect(apps[0]!.isOwn).toBe(true);
  expect(apps[0]!.name).toBe("Own");
  expect(apps[0]!.platform).toBe("iphone");
});

test("getAppByAppStoreId returns app or null", () => {
  seedApp(db, { appStoreId: "333", name: "X", platform: "ipad" });
  expect(getAppByAppStoreId(db, "333")?.appStoreId).toBe("333");
  expect(getAppByAppStoreId(db, "999")).toBeNull();
});

test("appStats summarizes keyword distribution", () => {
  const aId = seedApp(db, { appStoreId: "111", name: "A", platform: "iphone" });
  const k1 = seedKeyword(db, { appId: aId, keyword: "a", store: "us" });
  const k2 = seedKeyword(db, { appId: aId, keyword: "b", store: "us" });
  const k3 = seedKeyword(db, { appId: aId, keyword: "c", store: "us" });
  const k4 = seedKeyword(db, { appId: aId, keyword: "d", store: "us" });
  seedRankings(db, k1, [{ daysAgo: 0, rank: 5 }]);     // top-10
  seedRankings(db, k2, [{ daysAgo: 0, rank: 30 }]);    // top-50 only
  seedRankings(db, k3, [{ daysAgo: 0, rank: 120 }]);   // outside top-50
  seedRankings(db, k4, [{ daysAgo: 0, rank: null }]);  // unranked

  const stats = appStats(db, "111");
  expect(stats?.keywordCount).toBe(4);
  expect(stats?.top10Count).toBe(1);
  expect(stats?.top50Count).toBe(2);     // ranks 5 and 30
  expect(stats?.avgRank).toBeCloseTo((5 + 30 + 120) / 3, 1);
});

test("portfolioRankingStats sums top10/top50 across apps", () => {
  const aId = seedApp(db, { appStoreId: "111", name: "A", platform: "iphone" });
  const bId = seedApp(db, { appStoreId: "222", name: "B", platform: "iphone" });
  const k1 = seedKeyword(db, { appId: aId, keyword: "a", store: "us" });
  const k2 = seedKeyword(db, { appId: bId, keyword: "b", store: "us" });
  seedRankings(db, k1, [{ daysAgo: 0, rank: 3 }]);   // top-10
  seedRankings(db, k2, [{ daysAgo: 0, rank: 40 }]);  // top-50 only

  const apps = listApps(db);
  const stats = portfolioRankingStats(db, apps);
  expect(stats.top10Count).toBe(1);
  expect(stats.top50Count).toBe(2); // rank 3 and rank 40 are both <= 50
});

test("portfolioRankingStats returns zeros for an empty app list", () => {
  const stats = portfolioRankingStats(db, []);
  expect(stats.top10Count).toBe(0);
  expect(stats.top50Count).toBe(0);
});

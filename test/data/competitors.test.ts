import { test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
  makeTestDb, seedApp, seedKeyword, seedRankings,
  seedCompetitor, linkCompetitor, seedCompetitorRankings,
} from "../seed";
import { competitorBenchmark, linkedCompetitors, ownAppWithCompetitors } from "../../src/data/competitors";

let db: Database;
beforeEach(() => { db = makeTestDb(); });

/** Comet-shaped fixture: own app "OWN1" with 2 keywords + 2 linked competitors. */
function setup() {
  const own = seedApp(db, { appStoreId: "OWN1", name: "Comet", platform: "iphone" });
  const kUs = seedKeyword(db, { appId: own, keyword: "packing list", store: "us" });
  const kDe = seedKeyword(db, { appId: own, keyword: "camping", store: "de" });
  seedRankings(db, kUs, [{ daysAgo: 1, rank: 50 }, { daysAgo: 0, rank: 40 }]);
  seedRankings(db, kDe, [{ daysAgo: 1, rank: 90 }, { daysAgo: 0, rank: 78 }]);

  const rival1 = seedCompetitor(db, { appStoreId: "RIVAL1", name: "Packr" });
  const rival2 = seedCompetitor(db, { appStoreId: "RIVAL2", name: "Packup" });
  linkCompetitor(db, own, rival1);
  linkCompetitor(db, own, rival2);

  return { own, kUs, kDe, rival1, rival2 };
}

test("linkedCompetitors returns linked apps in stable id order", () => {
  const { rival1, rival2 } = setup();
  const list = linkedCompetitors(db, "OWN1");
  expect(list.map((c) => c.id)).toEqual([rival1, rival2]);
  expect(list.map((c) => c.appStoreId)).toEqual(["RIVAL1", "RIVAL2"]);
  expect(list.map((c) => c.name)).toEqual(["Packr", "Packup"]);
});

test("linkedCompetitors returns empty array when none linked", () => {
  seedApp(db, { appStoreId: "OWN2", name: "Solo", platform: "iphone" });
  expect(linkedCompetitors(db, "OWN2")).toEqual([]);
});

test("competitorBenchmark returns null for unknown own app", () => {
  expect(competitorBenchmark(db, "NOPE")).toBeNull();
});

test("competitorBenchmark builds a grid of own keywords x linked competitors, aligned to column order", () => {
  const { rival1, rival2 } = setup();
  seedCompetitorRankings(db, rival1, { keyword: "camping", store: "de" }, [{ daysAgo: 0, rank: 1 }]);
  seedCompetitorRankings(db, rival2, { keyword: "camping", store: "de" }, [{ daysAgo: 0, rank: 4 }]);

  const b = competitorBenchmark(db, "OWN1")!;
  expect(b.competitors.map((c) => c.id)).toEqual([rival1, rival2]);
  const row = b.rows.find((r) => r.keyword === "camping" && r.store === "de")!;
  expect(row.competitors).toHaveLength(2);
  expect(row.competitors[0]!.currentRank).toBe(1); // aligned to b.competitors[0] = rival1
  expect(row.competitors[1]!.currentRank).toBe(4); // aligned to b.competitors[1] = rival2
});

test("competitor cell carries latest rank and up to 14-point trend, oldest first", () => {
  const { rival1 } = setup();
  const samples: Array<{ daysAgo: number; rank: number | null }> = [];
  for (let d = 20; d >= 0; d--) samples.push({ daysAgo: d, rank: 10 + d });
  seedCompetitorRankings(db, rival1, { keyword: "camping", store: "de" }, samples);

  const b = competitorBenchmark(db, "OWN1")!;
  const row = b.rows.find((r) => r.keyword === "camping" && r.store === "de")!;
  const cell = row.competitors[0]!;
  expect(cell.currentRank).toBe(10); // daysAgo 0 -> rank 10
  expect(cell.trend.length).toBeLessThanOrEqual(14);
  expect(cell.trend[0]!.at < cell.trend[cell.trend.length - 1]!.at).toBe(true);
});

test("null handling: competitor outside top-200 and own null both render as currentRank null", () => {
  const own = seedApp(db, { appStoreId: "OWN3", name: "X", platform: "iphone" });
  const k = seedKeyword(db, { appId: own, keyword: "kw", store: "us" });
  seedRankings(db, k, [{ daysAgo: 0, rank: null }]);
  const rival = seedCompetitor(db, { appStoreId: "RIVALX", name: "Rival" });
  linkCompetitor(db, own, rival);
  seedCompetitorRankings(db, rival, { keyword: "kw", store: "us" }, [{ daysAgo: 0, rank: null }]);

  const b = competitorBenchmark(db, "OWN3")!;
  const row = b.rows[0]!;
  expect(row.own.currentRank).toBeNull();
  expect(row.competitors[0]!.currentRank).toBeNull();
  expect(row.gap).toBeNull();
});

test("only linked competitors appear in the grid — an unlinked is_own=0 app is excluded", () => {
  setup();
  const unlinked = seedCompetitor(db, { appStoreId: "UNLINKED", name: "Ghost" });
  seedCompetitorRankings(db, unlinked, { keyword: "camping", store: "de" }, [{ daysAgo: 0, rank: 2 }]);

  const b = competitorBenchmark(db, "OWN1")!;
  expect(b.competitors.map((c) => c.appStoreId)).not.toContain("UNLINKED");
  const row = b.rows.find((r) => r.keyword === "camping" && r.store === "de")!;
  expect(row.competitors).toHaveLength(2); // still just rival1+rival2
});

test("bestCompetitorRank is the min non-null competitor rank; gap = own - best", () => {
  const { rival1, rival2 } = setup();
  seedCompetitorRankings(db, rival1, { keyword: "camping", store: "de" }, [{ daysAgo: 0, rank: 5 }]);
  seedCompetitorRankings(db, rival2, { keyword: "camping", store: "de" }, [{ daysAgo: 0, rank: 1 }]);

  const b = competitorBenchmark(db, "OWN1")!;
  const row = b.rows.find((r) => r.keyword === "camping" && r.store === "de")!;
  expect(row.own.currentRank).toBe(78);
  expect(row.bestCompetitorRank).toBe(1);
  expect(row.gap).toBe(77); // 78 - 1
});

test("bestCompetitorRank/gap are null when all competitors are null", () => {
  const { rival1, rival2 } = setup();
  seedCompetitorRankings(db, rival1, { keyword: "camping", store: "de" }, [{ daysAgo: 0, rank: null }]);
  seedCompetitorRankings(db, rival2, { keyword: "camping", store: "de" }, [{ daysAgo: 0, rank: null }]);

  const b = competitorBenchmark(db, "OWN1")!;
  const row = b.rows.find((r) => r.keyword === "camping" && r.store === "de")!;
  expect(row.bestCompetitorRank).toBeNull();
  expect(row.gap).toBeNull();
});

test("summary counts weLead / weTrail / weAbsentButRivalRanks and averages gap", () => {
  const own = seedApp(db, { appStoreId: "OWN4", name: "X", platform: "iphone" });
  const kLead = seedKeyword(db, { appId: own, keyword: "lead-kw", store: "us" });
  const kTrail = seedKeyword(db, { appId: own, keyword: "trail-kw", store: "us" });
  const kAbsent = seedKeyword(db, { appId: own, keyword: "absent-kw", store: "us" });
  seedRankings(db, kLead, [{ daysAgo: 0, rank: 5 }]);
  seedRankings(db, kTrail, [{ daysAgo: 0, rank: 50 }]);
  seedRankings(db, kAbsent, [{ daysAgo: 0, rank: null }]);

  const rival = seedCompetitor(db, { appStoreId: "RIVAL4", name: "Rival" });
  linkCompetitor(db, own, rival);
  seedCompetitorRankings(db, rival, { keyword: "lead-kw", store: "us" }, [{ daysAgo: 0, rank: 20 }]);   // we lead: 5 < 20
  seedCompetitorRankings(db, rival, { keyword: "trail-kw", store: "us" }, [{ daysAgo: 0, rank: 10 }]);  // we trail: 10 < 50
  seedCompetitorRankings(db, rival, { keyword: "absent-kw", store: "us" }, [{ daysAgo: 0, rank: 30 }]); // absent but rival ranks

  const b = competitorBenchmark(db, "OWN4")!;
  expect(b.summary.keywordCount).toBe(3);
  expect(b.summary.weLead).toBe(1);
  expect(b.summary.weTrail).toBe(1);
  expect(b.summary.weAbsentButRivalRanks).toBe(1);
  expect(b.summary.avgGap).toBe(12.5); // lead-kw gap=5-20=-15, trail-kw gap=50-10=40, avg=12.5
});

test("text-join: a competitor ranking for a keyword the own app doesn't track is ignored", () => {
  const { rival1 } = setup();
  seedCompetitorRankings(db, rival1, { keyword: "totally different keyword", store: "us" }, [{ daysAgo: 0, rank: 3 }]);

  const b = competitorBenchmark(db, "OWN1")!;
  expect(b.rows.map((r) => r.keyword)).not.toContain("totally different keyword");
  expect(b.rows).toHaveLength(2); // still just our 2 own keywords
});

test("own app with no competitors: competitors is empty, rows still present with empty competitor arrays", () => {
  const own = seedApp(db, { appStoreId: "SOLO", name: "Solo", platform: "iphone" });
  const k = seedKeyword(db, { appId: own, keyword: "solo-kw", store: "us" });
  seedRankings(db, k, [{ daysAgo: 0, rank: 12 }]);

  const b = competitorBenchmark(db, "SOLO")!;
  expect(b.competitors).toEqual([]);
  expect(b.rows).toHaveLength(1);
  expect(b.rows[0]!.competitors).toEqual([]);
  expect(b.rows[0]!.bestCompetitorRank).toBeNull();
  expect(b.rows[0]!.gap).toBeNull();
});

test("rows sort by gap descending (biggest deficit first), null gaps last, then keyword", () => {
  const own = seedApp(db, { appStoreId: "SORT1", name: "X", platform: "iphone" });
  const kBig = seedKeyword(db, { appId: own, keyword: "big-gap", store: "us" });
  const kSmall = seedKeyword(db, { appId: own, keyword: "small-gap", store: "us" });
  const kNone = seedKeyword(db, { appId: own, keyword: "no-gap", store: "us" });
  seedRankings(db, kBig, [{ daysAgo: 0, rank: 100 }]);
  seedRankings(db, kSmall, [{ daysAgo: 0, rank: 20 }]);
  seedRankings(db, kNone, [{ daysAgo: 0, rank: null }]);

  const rival = seedCompetitor(db, { appStoreId: "RIVALSORT", name: "Rival" });
  linkCompetitor(db, own, rival);
  seedCompetitorRankings(db, rival, { keyword: "big-gap", store: "us" }, [{ daysAgo: 0, rank: 1 }]);   // gap 99
  seedCompetitorRankings(db, rival, { keyword: "small-gap", store: "us" }, [{ daysAgo: 0, rank: 15 }]); // gap 5

  const b = competitorBenchmark(db, "SORT1")!;
  expect(b.rows.map((r) => r.keyword)).toEqual(["big-gap", "small-gap", "no-gap"]);
});

test("ownAppWithCompetitors resolves the app_id of the own app that has linked competitors", () => {
  setup();
  expect(ownAppWithCompetitors(db)).toBe("OWN1");
});

test("ownAppWithCompetitors returns null when nothing is linked anywhere", () => {
  seedApp(db, { appStoreId: "SOLO2", name: "Solo", platform: "iphone" });
  expect(ownAppWithCompetitors(db)).toBeNull();
});

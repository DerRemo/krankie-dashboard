import { test, expect } from "bun:test";
import { makeTestDb, seedDefault } from "./seed";

test("seed helper builds a populated in-memory DB", () => {
  const db = makeTestDb();
  const { appId, keywordIds } = seedDefault(db);
  expect(appId).toBeGreaterThan(0);
  expect(keywordIds).toHaveLength(3);
  const rankCount = db.query("SELECT COUNT(*) as n FROM rankings").get() as { n: number };
  expect(rankCount.n).toBe(3 * 31);
});

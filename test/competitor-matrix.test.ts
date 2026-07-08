import { test, expect } from "bun:test";
import { prepareMatrix } from "../src/data/competitors";
import type { CompetitorApp, BenchmarkRow } from "../src/data/competitors";

const comp = (id: number, name: string): CompetitorApp => ({ id, appStoreId: String(id), name });
const row = (keyword: string, own: number | null, cells: Array<number | null>): BenchmarkRow => ({
  keywordId: 1, keyword, store: "de",
  own: { currentRank: own, delta24h: null, delta7d: null, trend: [] },
  competitors: cells.map((r) => ({ currentRank: r, trend: [] })),
  bestCompetitorRank: cells.filter((c): c is number => c !== null).sort((a, b) => a - b)[0] ?? null,
  gap: null,
});

test("prepareMatrix: drops all-null rows, splits absent rivals, realigns cells", () => {
  const competitors = [comp(1, "RivalA"), comp(2, "GhostRival")];
  const rows = [
    row("both rank", 5, [3, null]),
    row("nobody ranks", null, [null, null]),
    row("only we rank", 7, [null, null]),
  ];
  const prepared = prepareMatrix(competitors, rows);
  expect(prepared.rows.map((r) => r.keyword)).toEqual(["both rank", "only we rank"]);
  expect(prepared.activeCompetitors.map((c) => c.name)).toEqual(["RivalA"]);
  expect(prepared.absentCompetitors.map((c) => c.name)).toEqual(["GhostRival"]);
  // cells realigned: only RivalA's cell remains per row
  expect(prepared.rows[0]!.competitors).toHaveLength(1);
  expect(prepared.rows[0]!.competitors[0]!.currentRank).toBe(3);
});

test("prepareMatrix: no rivals ranked anywhere keeps rows where we rank", () => {
  const competitors = [comp(1, "GhostRival")];
  const rows = [row("we rank", 4, [null]), row("dead", null, [null])];
  const prepared = prepareMatrix(competitors, rows);
  expect(prepared.activeCompetitors).toHaveLength(0);
  expect(prepared.absentCompetitors).toHaveLength(1);
  expect(prepared.rows.map((r) => r.keyword)).toEqual(["we rank"]);
});

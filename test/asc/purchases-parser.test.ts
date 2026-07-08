import { describe, test, expect } from "bun:test";
import { parsePurchasesCsv } from "../../src/asc/purchases-parser";

const FIXTURE = await Bun.file(new URL("../fixtures/asc/purchases-segment.tsv", import.meta.url)).text();

describe("parsePurchasesCsv", () => {
  test("aggregates per app/date/territory and sums metrics", () => {
    const rows = parsePurchasesCsv(FIXTURE);
    const lm = rows.find((r) => r.appStoreId === "1000000001")!;
    expect(lm.date).toBe("2026-06-15");
    expect(lm.territory).toBe("DE");
    expect(lm.purchases).toBe(2);
    expect(lm.proceedsUsd).toBeCloseTo(3.98);
    expect(lm.salesUsd).toBeCloseTo(5.98);
    expect(lm.payingUsers).toBe(2);
    const pk = rows.find((r) => r.appStoreId === "1000000002")!;
    expect(pk.proceedsUsd).toBeCloseTo(0.70);
    expect(pk.payingUsers).toBe(1);
  });

  test("filterAppStoreIds keeps only tracked apps", () => {
    const rows = parsePurchasesCsv(FIXTURE, { filterAppStoreIds: new Set(["1000000001"]) });
    expect(rows.every((r) => r.appStoreId === "1000000001")).toBe(true);
  });

  test("throws on a CSV without Proceeds in USD (wrong report routed here)", () => {
    const wrong = "Date\tApp Apple Identifier\tTerritory\tCounts\n2026-06-15\t111\tDE\t5";
    expect(() => parsePurchasesCsv(wrong)).toThrow(/missing required columns/);
  });
});

import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { parseSalesTsv } from "../../src/asc/sales-parser";

const FIXTURE_USD = readFileSync(join(import.meta.dir, "../fixtures/asc/sales-2024-01-15.tsv"), "utf8");
const FIXTURE_EUR = readFileSync(join(import.meta.dir, "../fixtures/asc/sales-2024-01-15-eur.tsv"), "utf8");
const FIXTURE_IAP = readFileSync(join(import.meta.dir, "../fixtures/asc/sales-iap-parent.tsv"), "utf8");

describe("parseSalesTsv", () => {
  test("USD bucket: proceedsLocal and proceedsUsd both populated", () => {
    const { rows } = parseSalesTsv(FIXTURE_USD);
    const us111 = rows.find((r) => r.appStoreId === "111" && r.territory === "US");
    expect(us111).toBeDefined();
    expect(us111!.proceedsCurrency).toBe("USD");
    expect(Math.round(us111!.proceedsLocal * 100)).toBe(350);
    expect(Math.round(us111!.proceedsUsd! * 100)).toBe(350);
    expect(Math.round(us111!.iapProceedsLocal * 100)).toBe(280);
    expect(Math.round(us111!.iapProceedsUsd! * 100)).toBe(280);
  });

  test("non-USD bucket: proceedsLocal populated, proceedsUsd null pending FX", () => {
    const { rows } = parseSalesTsv(FIXTURE_EUR);
    const de111 = rows.find((r) => r.appStoreId === "111" && r.territory === "DE");
    expect(de111).toBeDefined();
    expect(de111!.proceedsCurrency).toBe("EUR");
    expect(de111!.proceedsLocal).toBeGreaterThan(0);
    expect(de111!.proceedsUsd).toBeNull();
    expect(de111!.units).toBe(2);
  });

  test("aggregates units and local proceeds within a bucket", () => {
    const { rows } = parseSalesTsv(FIXTURE_USD);
    const us111 = rows.find((r) => r.appStoreId === "111" && r.territory === "US");
    expect(us111!.units).toBe(6);        // was 5; the 1F row is now a sale
    expect(us111!.redownloads).toBe(0);  // was 1; 1F is not a redownload
    expect(us111!.updates).toBe(3);
    expect(us111!.iapUnits).toBe(2);     // IA1 row uses Apple Identifier 111 directly → still attributed
  });

  test("filters to specified app_store_ids", () => {
    const { rows } = parseSalesTsv(FIXTURE_USD, { filterAppStoreIds: new Set(["111"]) });
    expect(rows.every((r) => r.appStoreId === "111")).toBe(true);
  });

  test("1T product type row counts as a sale with proceeds", () => {
    const tsv = [
      "Apple Identifier\tProduct Type Identifier\tUnits\tDeveloper Proceeds\tBegin Date\tCountry Code\tCurrency of Proceeds",
      "111\t1T\t1\t0.99\t01/15/2024\tUS\tUSD",
    ].join("\n");
    const { rows } = parseSalesTsv(tsv);
    const r = rows.find((x) => x.appStoreId === "111" && x.territory === "US")!;
    expect(r.units).toBe(1);
    expect(r.redownloads).toBe(0);
    expect(r.proceedsLocal).toBe(0.99);
  });

  test("mixed currencies within a bucket: first wins, mismatchedBuckets counter increments", () => {
    const mixed = [
      "Apple Identifier\tProduct Type Identifier\tUnits\tDeveloper Proceeds\tBegin Date\tCountry Code\tCurrency of Proceeds",
      "111\t1\t1\t0.70\t01/15/2024\tDE\tEUR",
      "111\t1\t1\t1.00\t01/15/2024\tDE\tGBP",
    ].join("\n");
    const { rows, mixedCurrencyBuckets } = parseSalesTsv(mixed);
    expect(mixedCurrencyBuckets).toBe(1);
    const r = rows.find((x) => x.appStoreId === "111" && x.territory === "DE");
    expect(r!.proceedsCurrency).toBe("EUR");
    expect(r!.units).toBe(1);
  });

  test("1F/1T paid downloads count as sales with proceeds, not redownloads", () => {
    const { rows } = parseSalesTsv(FIXTURE_IAP, { filterAppStoreIds: new Set(["111", "222"]) });
    const r = rows.find((x) => x.appStoreId === "111" && x.territory === "DE")!;
    expect(r.units).toBe(1);
    expect(r.redownloads).toBe(0);
    expect(Math.round(r.proceedsLocal * 100)).toBe(176);
  });

  test("IAP rows attribute to the parent app via Parent Identifier SKU", () => {
    const skuToAppStoreId = new Map([["beta-ios", "222"]]);
    const { rows } = parseSalesTsv(FIXTURE_IAP, { filterAppStoreIds: new Set(["111", "222"]), skuToAppStoreId });
    const beta = rows.find((x) => x.appStoreId === "222" && x.territory === "DE")!;
    expect(beta.iapUnits).toBe(2);
    expect(Math.round(beta.iapProceedsLocal * 100)).toBe(234);   // 2 * 1.17
  });

  test("IAP parent SKU learned from an in-file non-IAP row is attributed, not dropped", () => {
    const { rows, droppedUnknownParent } = parseSalesTsv(FIXTURE_IAP, { filterAppStoreIds: new Set(["111", "222"]) });
    // no skuToAppStoreId, no in-file non-IAP row that maps 'com.dev.beta.premium' -> so via parent 'beta-ios'
    // 'beta-ios' IS learned from the row for app 222, so this IAP IS attributed; assert it is NOT dropped:
    expect(droppedUnknownParent).toBe(0);
    expect(rows.find((x) => x.appStoreId === "222")!.iapUnits).toBe(2);
  });

  test("IAP whose parent SKU is unknown resolves to a filtered-out app and increments droppedUnknownParent", () => {
    const tsv = [
      "Apple Identifier\tProduct Type Identifier\tUnits\tDeveloper Proceeds\tBegin Date\tCountry Code\tCurrency of Proceeds\tSKU\tParent Identifier",
      "999\tIA1\t1\t0.99\t01/15/2024\tUS\tUSD\tghost-sku-iap\tghost-sku",
    ].join("\n");
    const { rows, droppedUnknownParent } = parseSalesTsv(tsv, { filterAppStoreIds: new Set(["111", "222"]) });
    // 'ghost-sku' is not in skuMap (no skuToAppStoreId passed, no non-IAP row maps it),
    // so appStoreId falls back to Apple Identifier 999, which is not in filterAppStoreIds → dropped.
    expect(droppedUnknownParent).toBe(1);
    expect(rows.length).toBe(0);
  });

  test("a single unparseable-date row is skipped, not fatal — the rest of the day survives", () => {
    const tsv = [
      "Apple Identifier\tProduct Type Identifier\tUnits\tDeveloper Proceeds\tBegin Date\tCountry Code\tCurrency of Proceeds",
      "111\t1\t1\t0.99\tGARBAGE\tUS\tUSD",     // unparseable Begin Date
      "111\t1\t2\t1.98\t01/15/2024\tUS\tUSD",  // valid row, same bucket
    ].join("\n");
    const { rows, droppedMalformed } = parseSalesTsv(tsv);
    expect(droppedMalformed).toBe(1);
    const r = rows.find((x) => x.appStoreId === "111" && x.territory === "US")!;
    expect(r).toBeDefined();
    expect(r.units).toBe(2); // only the valid row counted
  });

  test("a row with non-numeric Units/Proceeds is skipped, not summed as NaN", () => {
    const tsv = [
      "Apple Identifier\tProduct Type Identifier\tUnits\tDeveloper Proceeds\tBegin Date\tCountry Code\tCurrency of Proceeds",
      "111\t1\tNOTANUM\t0.99\t01/15/2024\tUS\tUSD", // bad Units
      "111\t1\t2\t1.98\t01/15/2024\tUS\tUSD",        // valid row
    ].join("\n");
    const { rows, droppedMalformed } = parseSalesTsv(tsv);
    expect(droppedMalformed).toBe(1);
    const r = rows.find((x) => x.appStoreId === "111" && x.territory === "US")!;
    expect(r.units).toBe(2);
    expect(Number.isFinite(r.proceedsLocal)).toBe(true);
  });

  test("returns empty result on empty input", () => {
    expect(parseSalesTsv("").rows).toEqual([]);
  });

  test("throws on missing required columns", () => {
    expect(() => parseSalesTsv("foo\tbar\nbaz\tqux")).toThrow(/missing required column/);
  });
});

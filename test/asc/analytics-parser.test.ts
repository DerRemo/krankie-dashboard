import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { parseAnalyticsCsv } from "../../src/asc/analytics-parser";

const ENGAGEMENT = readFileSync(join(import.meta.dir, "../fixtures/asc/engagement-segment.csv"), "utf8");
const USAGE = readFileSync(join(import.meta.dir, "../fixtures/asc/usage-segment.csv"), "utf8");
const COMMERCE_DOWNLOADS = readFileSync(join(import.meta.dir, "../fixtures/asc/commerce-downloads-segment.tsv"), "utf8");
const ENGAGEMENT_COUNTS = readFileSync(join(import.meta.dir, "../fixtures/asc/engagement-counts-segment.tsv"), "utf8");

describe("parseAnalyticsCsv", () => {
  test("parses APP_STORE_ENGAGEMENT and only fills impressions/page views", () => {
    const rows = parseAnalyticsCsv(ENGAGEMENT, "APP_STORE_ENGAGEMENT");
    expect(rows.length).toBe(3);
    const us = rows.find((r) => r.appStoreId === "111" && r.territory === "US")!;
    expect(us.impressions).toBe(12000);
    expect(us.productPageViews).toBe(800);
    expect(us.sessions).toBeNull();
    expect(us.crashes).toBeNull();
  });

  test("parses real APP_STORE_ENGAGEMENT count rows from tab-delimited reports", () => {
    const rows = parseAnalyticsCsv(ENGAGEMENT_COUNTS, "APP_STORE_ENGAGEMENT");
    const us = rows.find((r) => r.appStoreId === "111" && r.territory === "US")!;
    expect(rows.length).toBe(1);
    expect(us.impressions).toBe(1000);
    expect(us.productPageViews).toBe(100);
    expect(us.firstTimeDownloads).toBeNull();
  });

  test("parses COMMERCE App Store Downloads first-time downloads from Counts", () => {
    const rows = parseAnalyticsCsv(COMMERCE_DOWNLOADS, "COMMERCE");
    const us = rows.find((r) => r.appStoreId === "111" && r.territory === "US")!;
    const de = rows.find((r) => r.appStoreId === "111" && r.territory === "DE")!;
    expect(us.firstTimeDownloads).toBe(7);
    expect(de.firstTimeDownloads).toBe(3);
  });

  test("accepts plural download type and comma-formatted counts", () => {
    const report = [
      "Date\tApp Apple Identifier\tTerritory\tDownload Type\tCounts",
      "2024-01-15\t111\tUS\tFirst-Time Downloads\t1,234",
    ].join("\n");
    const rows = parseAnalyticsCsv(report, "COMMERCE");
    expect(rows[0]!.firstTimeDownloads).toBe(1234);
  });

  test("accepts decorated engagement event labels", () => {
    const report = [
      "Date\tApp Apple Identifier\tTerritory\tEvent\tCounts",
      "2024-01-15\t111\tUS\tApp Store Impressions\t1,200",
      "2024-01-15\t111\tUS\tProduct Page Views\t300",
    ].join("\n");
    const rows = parseAnalyticsCsv(report, "APP_STORE_ENGAGEMENT");
    expect(rows[0]!.impressions).toBe(1200);
    expect(rows[0]!.productPageViews).toBe(300);
  });

  test("parses APP_STORE_COMMERCE category alias", () => {
    const rows = parseAnalyticsCsv(COMMERCE_DOWNLOADS, "APP_STORE_COMMERCE");
    const us = rows.find((r) => r.appStoreId === "111" && r.territory === "US")!;
    expect(us.firstTimeDownloads).toBe(7);
  });

  test("parses APP_USAGE and fills sessions/active/firstDl/crashes", () => {
    const rows = parseAnalyticsCsv(USAGE, "APP_USAGE");
    const us = rows.find((r) => r.appStoreId === "111" && r.territory === "US")!;
    expect(us.sessions).toBe(500);
    expect(us.activeDevices).toBe(300);
    expect(us.firstTimeDownloads).toBe(42);
    expect(us.crashes).toBe(2);
    expect(us.impressions).toBeNull();
  });

  test("filters to specified app_store_ids", () => {
    const rows = parseAnalyticsCsv(USAGE, "APP_USAGE", {
      filterAppStoreIds: new Set(["222"]),
    });
    expect(rows.every((r) => r.appStoreId === "222")).toBe(true);
  });

  test("throws when required columns are missing", () => {
    expect(() => parseAnalyticsCsv("foo,bar\n1,2", "APP_STORE_ENGAGEMENT")).toThrow(/missing required/);
  });
});

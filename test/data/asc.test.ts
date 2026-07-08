import { describe, test, expect } from "bun:test";
import { makeAscDb, seedSales, seedAnalytics, insertSyncRun, seedPurchases } from "../asc/seed";
import {
  ascDailyForApp, ascTodayForApps, ascKpisForApp, ascPortfolioKpis,
  ascSyncStatus, ascCoverage, reapStaleRunningRow, ascDiagnosticsForApps,
  ascRevenueByTerritory,
} from "../../src/data/asc";

function recentDate(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 86400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function first<T>(rows: T[]): T {
  expect(rows.length).toBeGreaterThan(0);
  return rows[0]!;
}

describe("ascDailyForApp", () => {
  test("aggregates across territories", () => {
    const db = makeAscDb();
    seedAnalytics(db, [
      { appStoreId: "111", date: recentDate(2), territory: "US", impressions: 1000, productPageViews: 100, firstTimeDownloads: 10 },
      { appStoreId: "111", date: recentDate(2), territory: "DE", impressions:  300, productPageViews:  30, firstTimeDownloads: 5 },
    ]);
    const out = ascDailyForApp(db, "111", "30d");
    expect(out.length).toBe(1);
    const row = first(out);
    expect(row.impressions).toBe(1300);
    expect(row.pageViews).toBe(130);
    expect(row.firstTimeDownloads).toBe(15);
    expect(row.conversionRate).toBeCloseTo(15 / 130);
  });

  test("anchors ranges to the latest available ASC date", () => {
    const db = makeAscDb();
    seedAnalytics(db, [
      { appStoreId: "111", date: "2024-01-01", territory: "US", impressions: 100 },
      { appStoreId: "111", date: "2024-01-10", territory: "US", impressions: 200 },
    ]);
    const out = ascDailyForApp(db, "111", "7d");
    expect(out.map((p) => p.date)).toEqual(["2024-01-10"]);
    expect(first(out).impressions).toBe(200);
  });

  test("does not mix Sales units into Analytics downloads", () => {
    const db = makeAscDb();
    seedAnalytics(db, [
      { appStoreId: "111", date: recentDate(1), territory: "US", productPageViews: 100, firstTimeDownloads: 0 },
    ]);
    seedSales(db, [
      { appStoreId: "111", date: recentDate(1), territory: "US", units: 5 },
    ]);
    const out = ascDailyForApp(db, "111", "7d");
    const row = first(out);
    expect(row.firstTimeDownloads).toBe(0);
    expect(row.units).toBe(5);
    expect(row.downloadsSource).toBe("analytics");
    expect(row.conversionRate).toBe(0);
  });

  test("totalProceedsUsd combines app + IAP proceeds", () => {
    const db = makeAscDb();
    seedSales(db, [
      { appStoreId: "111", date: "2024-01-10", territory: "US", units: 2, proceedsUsd: 7.4, iapProceedsUsd: 1.6 },
    ]);
    const out = ascDailyForApp(db, "111", "7d");
    expect(first(out).totalProceedsUsd).toBeCloseTo(9.0);
  });

  test("totalProceedsUsd is null on analytics-only days", () => {
    const db = makeAscDb();
    seedAnalytics(db, [
      { appStoreId: "111", date: "2024-01-10", territory: "US", impressions: 100 },
    ]);
    const out = ascDailyForApp(db, "111", "7d");
    expect(first(out).totalProceedsUsd).toBeNull();
  });

  test("keeps missing Analytics metrics null on Sales-only days", () => {
    const db = makeAscDb();
    seedAnalytics(db, [
      { appStoreId: "111", date: "2024-01-09", territory: "US", impressions: 100, productPageViews: 10 },
    ]);
    seedSales(db, [
      { appStoreId: "111", date: "2024-01-10", territory: "US", units: 3, proceedsUsd: 9 },
    ]);
    const out = ascDailyForApp(db, "111", "7d");
    expect(out.map((p) => p.date)).toEqual(["2024-01-09", "2024-01-10"]);
    const row = out[1]!;
    expect(row.impressions).toBeNull();
    expect(row.pageViews).toBeNull();
    expect(row.firstTimeDownloads).toBeNull();
    expect(row.units).toBe(3);
    expect(row.downloadsSource).toBe("missing");
    expect(row.isPartial).toBe(true);
  });
});

describe("ascTodayForApps", () => {
  test("returns latest date and 7d delta (downloads from sales units)", () => {
    const db = makeAscDb();
    seedAnalytics(db, [
      { appStoreId: "111", date: recentDate(8), territory: "US", impressions: 1000, productPageViews: 100, firstTimeDownloads: 10 },
      { appStoreId: "111", date: recentDate(1), territory: "US", impressions: 1500, productPageViews: 150, firstTimeDownloads: 20 },
    ]);
    seedSales(db, [
      { appStoreId: "111", date: recentDate(8), territory: "US", units: 10 },
      { appStoreId: "111", date: recentDate(1), territory: "US", units: 20 },
    ]);
    const row = first(ascTodayForApps(db, ["111"]));
    expect(row.date).toBe(recentDate(1));
    expect(row.impressions).toBe(1500);
    expect(row.downloads).toBe(20);
    expect(row.downloadsSource).toBe("sales");
    expect(row.impressionsDelta7dPct).toBeCloseTo(50);
    expect(row.downloadsDelta7dPct).toBeCloseTo(100);
  });

  test("uses Sales units (not analytics) as latest downloads", () => {
    const db = makeAscDb();
    seedAnalytics(db, [
      { appStoreId: "111", date: "2024-01-09", territory: "US", impressions: 100, firstTimeDownloads: 7 },
    ]);
    seedSales(db, [
      { appStoreId: "111", date: "2024-01-10", territory: "US", units: 4 },
    ]);
    const row = first(ascTodayForApps(db, ["111"]));
    expect(row.impressionsDate).toBe("2024-01-09");
    expect(row.downloadsDate).toBe("2024-01-10");
    expect(row.impressions).toBe(100);
    expect(row.downloads).toBe(4);
    expect(row.impressionsSource).toBe("analytics");
    expect(row.downloadsSource).toBe("sales");
  });

  test("Sales-only app reports its download units and stays visible", () => {
    const db = makeAscDb();
    seedSales(db, [
      { appStoreId: "111", date: "2024-01-10", territory: "US", units: 4 },
    ]);
    const row = first(ascTodayForApps(db, ["111"]));
    expect(row.date).toBe("2024-01-10");
    expect(row.impressions).toBe(0);
    expect(row.downloads).toBe(4);
    expect(row.impressionsSource).toBe("missing");
    expect(row.downloadsSource).toBe("sales");
    expect(row.isPartial).toBe(true);
  });

  test("returns zeros when no data", () => {
    const db = makeAscDb();
    const row = first(ascTodayForApps(db, ["999"]));
    expect(row.date).toBeNull();
    expect(row.impressions).toBe(0);
  });

  test("proceeds30d sums combined proceeds incl. IAP over the 30d window", () => {
    const db = makeAscDb();
    seedSales(db, [
      { appStoreId: "222", date: recentDate(2), territory: "DE", units: 5, proceedsUsd: 0, iapProceedsUsd: 4.62 },
      { appStoreId: "222", date: recentDate(1), territory: "DE", units: 3, proceedsUsd: 0, iapProceedsUsd: 1.5 },
    ]);
    const row = first(ascTodayForApps(db, ["222"]));
    expect(row.proceeds30d).toBeCloseTo(6.12);
    expect(row.trendProceeds.length).toBeLessThanOrEqual(14);
  });

  test("proceeds30d is 0 for an analytics-only app", () => {
    const db = makeAscDb();
    seedAnalytics(db, [
      { appStoreId: "111", date: recentDate(1), territory: "US", impressions: 100 },
    ]);
    const row = first(ascTodayForApps(db, ["111"]));
    expect(row.proceeds30d).toBe(0);
  });
});

describe("ascKpisForApp", () => {
  test("computes deltas vs previous-window totals", () => {
    const db = makeAscDb();
    seedAnalytics(db, [
      { appStoreId: "111", date: recentDate(40), territory: "US", impressions: 1000, productPageViews: 100, firstTimeDownloads: 10 },
      { appStoreId: "111", date: recentDate(5),  territory: "US", impressions: 2000, productPageViews: 200, firstTimeDownloads: 20 },
    ]);
    seedSales(db, [
      { appStoreId: "111", date: recentDate(40), territory: "US", units: 10 },
      { appStoreId: "111", date: recentDate(5),  territory: "US", units: 20 },
    ]);
    const k = ascKpisForApp(db, "111", "30d");
    expect(k.impressions.value).toBe(2000);
    expect(k.impressions.deltaPct).not.toBeNull();
    expect(k.firstTimeDownloads.value).toBe(20);
    expect(k.downloads.value).toBe(20);
    expect(k.downloads.deltaPct).not.toBeNull();
  });

  test("computes stale data relative to the latest available ASC date", () => {
    const db = makeAscDb();
    seedAnalytics(db, [
      { appStoreId: "111", date: "2024-01-01", territory: "US", impressions: 100 },
      { appStoreId: "111", date: "2024-01-10", territory: "US", impressions: 200 },
    ]);
    const k = ascKpisForApp(db, "111", "7d");
    expect(k.impressions.value).toBe(200);
    expect(k.impressions.deltaPct).toBeCloseTo(100);
    expect(k.fromDate).toBe("2024-01-04");
    expect(k.toDate).toBe("2024-01-10");
  });

  test("Proceeds total includes IAP proceeds for an IAP-only app", () => {
    const db = makeAscDb();
    seedSales(db, [
      { appStoreId: "222", date: "2024-01-10", territory: "DE", units: 5, proceedsUsd: 0, iapProceedsUsd: 4.62 },
    ]);
    const k = ascKpisForApp(db, "222", "30d");
    expect(k.proceedsUsd.value).toBeCloseTo(4.62);
  });

  test("Proceeds total sums app + IAP proceeds", () => {
    const db = makeAscDb();
    seedSales(db, [
      { appStoreId: "111", date: "2024-01-10", territory: "DE", units: 3, proceedsUsd: 7.4, iapProceedsUsd: 1.2 },
    ]);
    const k = ascKpisForApp(db, "111", "30d");
    expect(k.proceedsUsd.value).toBeCloseTo(8.6);
  });

  test("ARPD is total proceeds per download", () => {
    const db = makeAscDb();
    seedSales(db, [
      { appStoreId: "111", date: "2024-01-10", territory: "DE", units: 4, proceedsUsd: 7.4, iapProceedsUsd: 0.6 },
    ]);
    const k = ascKpisForApp(db, "111", "30d");
    expect(k.arpd.value).toBeCloseTo(2.0); // 8.00 / 4
  });

  test("ARPD is null when there are no downloads", () => {
    const db = makeAscDb();
    seedSales(db, [
      { appStoreId: "111", date: "2024-01-10", territory: "DE", units: 0, proceedsUsd: 0, iapProceedsUsd: 5 },
    ]);
    const k = ascKpisForApp(db, "111", "30d");
    expect(k.arpd.value).toBeNull();
  });
});

describe("ascPortfolioKpis", () => {
  test("sums impressions/downloads/proceeds across apps", () => {
    const db = makeAscDb();
    seedAnalytics(db, [
      { appStoreId: "111", date: recentDate(5), territory: "US", impressions: 1000, productPageViews: 100, firstTimeDownloads: 10 },
      { appStoreId: "222", date: recentDate(5), territory: "US", impressions: 500, productPageViews: 50, firstTimeDownloads: 5 },
    ]);
    seedSales(db, [
      { appStoreId: "111", date: recentDate(5), territory: "US", units: 10, proceedsUsd: 20 },
      { appStoreId: "222", date: recentDate(5), territory: "US", units: 5, proceedsUsd: 8 },
    ]);
    const p = ascPortfolioKpis(db, ["111", "222"]);
    expect(p.impressions).toBe(1500);
    expect(p.downloads).toBe(15);
    expect(p.proceedsUsd).toBeCloseTo(28);
    expect(p.appsWithData).toBe(2);
    expect(p.appsTotal).toBe(2);
  });

  test("excludes apps with no data from appsWithData but keeps them in appsTotal", () => {
    const db = makeAscDb();
    seedAnalytics(db, [
      { appStoreId: "111", date: recentDate(5), territory: "US", impressions: 1000, productPageViews: 100, firstTimeDownloads: 10 },
    ]);
    const p = ascPortfolioKpis(db, ["111", "222"]);
    expect(p.appsWithData).toBe(1);
    expect(p.appsTotal).toBe(2);
    expect(p.impressions).toBe(1000);
  });

  test("returns all zeros when no apps have synced yet", () => {
    const db = makeAscDb();
    const p = ascPortfolioKpis(db, ["111", "222"]);
    expect(p.impressions).toBe(0);
    expect(p.downloads).toBe(0);
    expect(p.proceedsUsd).toBe(0);
    expect(p.appsWithData).toBe(0);
    expect(p.appsTotal).toBe(2);
  });

  test("empty app list returns zeros and appsTotal 0", () => {
    const db = makeAscDb();
    const p = ascPortfolioKpis(db, []);
    expect(p.appsTotal).toBe(0);
    expect(p.appsWithData).toBe(0);
    expect(p.impressions).toBe(0);
  });
});

describe("ascDiagnosticsForApps", () => {
  test("salesNoActivityLast7d counts days with analytics but no sales", () => {
    const db = makeAscDb();
    // 7-day window anchored on most-recent date = 2024-01-10
    // analytics on 2024-01-10, 2024-01-09; sales only on 2024-01-09
    seedAnalytics(db, [
      { appStoreId: "111", date: "2024-01-10", territory: "US", impressions: 1 },
      { appStoreId: "111", date: "2024-01-09", territory: "US", impressions: 1 },
    ]);
    seedSales(db, [
      { appStoreId: "111", date: "2024-01-09", territory: "US",
        units: 1, proceedsLocal: 0.7, proceedsCurrency: "USD", proceedsUsd: 0.7 },
    ]);
    const [row] = ascDiagnosticsForApps(db, [{ appStoreId: "111", name: "Alpha" }]);
    expect(row!.analyticsLastDate).toBe("2024-01-10");
    expect(row!.salesLastDate).toBe("2024-01-09");
    // 7-day window: 2024-01-04..2024-01-10
    //   2024-01-10 → analytics yes, sales no → noActivity
    //   2024-01-09 → analytics yes, sales yes → neither
    //   2024-01-04..08 → neither → pending
    expect(row!.salesNoActivityLast7d).toBe(1);
    expect(row!.salesPendingLast7d).toBe(5);
    expect(row!.missingAnalyticsLast7d).toBe(5);
  });

  test("pending vs no-activity split sums to total sales-missing days", () => {
    const db = makeAscDb();
    seedAnalytics(db, [{ appStoreId: "222", date: "2024-01-10", territory: "US", impressions: 1 }]);
    const [row] = ascDiagnosticsForApps(db, [{ appStoreId: "222", name: "Beta" }]);
    // window anchored on 2024-01-10: that one day has analytics → noActivity; prior 6 → pending
    expect(row!.salesNoActivityLast7d).toBe(1);
    expect(row!.salesPendingLast7d).toBe(6);
    expect(row!.salesNoActivityLast7d + row!.salesPendingLast7d).toBe(7);
  });

  test("engagementMetricsAvailable is false when only impressions/downloads exist", () => {
    const db = makeAscDb();
    seedAnalytics(db, [
      { appStoreId: "111", date: "2024-01-10", territory: "US", impressions: 100, firstTimeDownloads: 5 },
    ]);
    const [row] = ascDiagnosticsForApps(db, [{ appStoreId: "111", name: "Alpha" }]);
    expect(row!.engagementMetricsAvailable).toBe(false);
  });

  test("engagementMetricsAvailable is true once a sessions/crashes value exists", () => {
    const db = makeAscDb();
    seedAnalytics(db, [
      { appStoreId: "111", date: "2024-01-10", territory: "US", impressions: 100, crashes: 2 },
    ]);
    const [row] = ascDiagnosticsForApps(db, [{ appStoreId: "111", name: "Alpha" }]);
    expect(row!.engagementMetricsAvailable).toBe(true);
  });
});

describe("ascSyncStatus + reapStaleRunningRow", () => {
  test("running:false when no lock held", () => {
    const db = makeAscDb();
    insertSyncRun(db, { trigger: "manual", status: "running" });
    const s = ascSyncStatus(db, false);
    expect(s.running).toBe(false);
  });

  test("reaps a 'running' row when lock is dead", () => {
    const db = makeAscDb();
    insertSyncRun(db, { trigger: "manual", status: "running" });
    reapStaleRunningRow(db, false);
    const r = db.query("SELECT status, error FROM sync_runs").get() as any;
    expect(r.status).toBe("failed");
    expect(r.error).toBe("process disappeared");
  });
});

describe("ascCoverage", () => {
  test("returns last dates and backfill percentages", () => {
    const db = makeAscDb();
    seedSales(db, [{ appStoreId: "111", date: "2024-01-15", territory: "US" }]);
    seedAnalytics(db, [{ appStoreId: "111", date: "2024-01-15", territory: "US", impressions: 10 }]);
    const c = ascCoverage(db);
    expect(c.salesLastDate).toBe("2024-01-15");
    expect(c.analyticsLastDate).toBe("2024-01-15");
    expect(c.salesBackfillPct).toBeCloseTo(1 / 365);
  });
});

describe("paying users + proceeds cross-check", () => {
  test("ascKpisForApp.payingUsers sums purchases_daily over the range", () => {
    const db = makeAscDb();
    seedSales(db, [{ appStoreId: "111", date: "2024-01-10", territory: "DE", units: 1 }]);
    seedPurchases(db, [
      { appStoreId: "111", date: "2024-01-10", territory: "DE", purchases: 1, proceedsUsd: 2, salesUsd: 3, payingUsers: 1 },
      { appStoreId: "111", date: "2024-01-10", territory: "US", purchases: 1, proceedsUsd: 2, salesUsd: 3, payingUsers: 2 },
    ]);
    const k = ascKpisForApp(db, "111", "30d");
    expect(k.payingUsers.value).toBe(3);
  });

  test("a later purchases_daily date does not advance the window anchor (through stays on sales/analytics)", () => {
    const db = makeAscDb();
    seedSales(db, [{ appStoreId: "111", date: "2024-01-10", territory: "DE", units: 1 }]);
    seedPurchases(db, [{ appStoreId: "111", date: "2024-01-12", territory: "DE", purchases: 1, proceedsUsd: 1, salesUsd: 1, payingUsers: 1 }]);
    const k = ascKpisForApp(db, "111", "30d");
    expect(k.toDate).toBe("2024-01-10"); // anchored on sales, NOT advanced to the later purchases date
  });

  test("ascDiagnosticsForApps reports 30d paying users + FX/native proceeds", () => {
    const db = makeAscDb();
    seedSales(db, [{ appStoreId: "111", date: "2024-01-10", territory: "DE", units: 1, proceedsUsd: 2.1, iapProceedsUsd: 0.5 }]);
    seedPurchases(db, [{ appStoreId: "111", date: "2024-01-10", territory: "DE", purchases: 1, proceedsUsd: 2.0, salesUsd: 3.4, payingUsers: 1 }]);
    const [row] = ascDiagnosticsForApps(db, [{ appStoreId: "111", name: "Alpha" }]);
    expect(row!.payingUsers30d).toBe(1);
    expect(row!.salesProceedsUsd30d).toBeCloseTo(2.6);
    expect(row!.purchasesProceedsUsd30d).toBeCloseTo(2.0);
  });
});

describe("ascRevenueByTerritory", () => {
  test("groups by territory, sorts desc, computes share, combines IAP", () => {
    const db = makeAscDb();
    seedSales(db, [
      { appStoreId: "111", date: "2024-01-10", territory: "US", units: 1, proceedsUsd: 6 },
      { appStoreId: "111", date: "2024-01-10", territory: "DE", units: 1, proceedsUsd: 0, iapProceedsUsd: 4 },
      { appStoreId: "111", date: "2024-01-09", territory: "US", units: 1, proceedsUsd: 0 }, // 0 proceeds → ignored
    ]);
    const out = ascRevenueByTerritory(db, "111", "30d");
    expect(out.map((t) => t.territory)).toEqual(["US", "DE"]);
    expect(out[0]!.proceedsUsd).toBeCloseTo(6);
    expect(out[0]!.sharePct).toBeCloseTo(60);
    expect(out[1]!.sharePct).toBeCloseTo(40);
  });

  test("returns [] when the window has no revenue", () => {
    const db = makeAscDb();
    seedSales(db, [{ appStoreId: "111", date: "2024-01-10", territory: "US", units: 3, proceedsUsd: 0 }]);
    expect(ascRevenueByTerritory(db, "111", "30d")).toEqual([]);
  });

  test("bundles territories beyond the top 10 into 'Other'", () => {
    const db = makeAscDb();
    const rows = Array.from({ length: 12 }, (_, i) => ({
      appStoreId: "111", date: "2024-01-10", territory: `T${i}`, units: 1, proceedsUsd: 12 - i,
    }));
    seedSales(db, rows);
    const out = ascRevenueByTerritory(db, "111", "30d");
    expect(out.length).toBe(11); // top 10 + Other
    expect(out[10]!.territory).toBe("Other");
  });
});

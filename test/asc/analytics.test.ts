import { describe, test, expect } from "bun:test";
import { gzipSync } from "zlib";
import { readFileSync } from "fs";
import { join } from "path";
import { makeAscDb } from "./seed";
import {
  ensureReportRequest,
  listPersistedRequests,
  upsertAnalytics,
  syncAnalytics,
  upsertPurchases,
  isPurchasesReport,
} from "../../src/asc/analytics";
import { AscClient } from "../../src/asc/client";

const ENGAGEMENT = readFileSync(join(import.meta.dir, "../fixtures/asc/engagement-segment.csv"), "utf8");
const USAGE = readFileSync(join(import.meta.dir, "../fixtures/asc/usage-segment.csv"), "utf8");
const COMMERCE_DOWNLOADS = readFileSync(join(import.meta.dir, "../fixtures/asc/commerce-downloads-segment.tsv"), "utf8");
const PURCHASES = readFileSync(join(import.meta.dir, "../fixtures/asc/purchases-segment.tsv"), "utf8");

class FakeAuth { async getToken() { return "x"; } }

function mkClient(routes: Record<string, () => Response>): AscClient {
  const handler = (url: string): Response => {
    for (const [pattern, h] of Object.entries(routes)) {
      if (url.includes(pattern)) return h();
    }
    return new Response("404", { status: 404 });
  };
  return new AscClient({
    baseUrl: "https://test.invalid",
    auth: new FakeAuth() as any,
    fetchImpl: ((url: string) => Promise.resolve(handler(url))) as unknown as typeof fetch,
    sleep: async () => {},
  });
}

describe("ensureReportRequest", () => {
  test("creates a new request when none exists, persists the UUID", async () => {
    const db = makeAscDb();
    const client = mkClient({
      "/v1/analyticsReportRequests": () =>
        new Response(JSON.stringify({ data: { id: "req-uuid-1" } }), { status: 200 }),
    });
    const out = await ensureReportRequest(db, client, "111", "ONGOING");
    expect(out.requestId).toBe("req-uuid-1");
    expect(listPersistedRequests(db).length).toBe(1);
  });

  test("returns the cached request without making an API call", async () => {
    const db = makeAscDb();
    let calls = 0;
    const client = mkClient({
      "/v1/analyticsReportRequests": () => {
        calls++;
        return new Response(JSON.stringify({ data: { id: "req-uuid-2" } }), { status: 200 });
      },
    });
    await ensureReportRequest(db, client, "111", "ONGOING");
    await ensureReportRequest(db, client, "111", "ONGOING");
    expect(calls).toBe(1);
  });

  test("sync creates ongoing and snapshot requests per app", async () => {
    const db = makeAscDb();
    let calls = 0;
    const client = mkClient({
      "/v1/analyticsReportRequests/req-1/reports": () =>
        new Response(JSON.stringify({ data: [] }), { status: 200 }),
      "/v1/analyticsReportRequests/req-2/reports": () =>
        new Response(JSON.stringify({ data: [] }), { status: 200 }),
      "/v1/analyticsReportRequests": () => {
        calls++;
        return new Response(JSON.stringify({ data: { id: `req-${calls}` } }), { status: 200 });
      },
    });

    await syncAnalytics(db, client, ["111"]);
    const requests = listPersistedRequests(db);
    expect(requests.map((r) => r.accessType).sort()).toEqual(["ONE_TIME_SNAPSHOT", "ONGOING"]);
  });
});

describe("upsertAnalytics", () => {
  test("upserts rows; idempotent across runs and merges NULL semantics", () => {
    const db = makeAscDb();
    upsertAnalytics(db, [
      { appStoreId: "111", date: "2024-01-15", territory: "US", impressions: 12000, productPageViews: 800 },
    ]);
    upsertAnalytics(db, [
      { appStoreId: "111", date: "2024-01-15", territory: "US", sessions: 500, crashes: 2 },
    ]);
    const r = db.query(
      `SELECT impressions, product_page_views, sessions, crashes
       FROM analytics_daily WHERE app_store_id='111' AND territory='US'`,
    ).get() as any;
    expect(r.impressions).toBe(12000);
    expect(r.product_page_views).toBe(800);
    expect(r.sessions).toBe(500);
    expect(r.crashes).toBe(2);
  });
});

describe("syncAnalytics — full flow", () => {
  test("bootstraps requests, lists reports/instances/segments, dedups, upserts", async () => {
    const db = makeAscDb();
    const engagementUrl = "https://cdn.apple.invalid/engagement.csv.gz";
    const usageUrl = "https://cdn.apple.invalid/usage.csv.gz";
    const commerceUrl = "https://cdn.apple.invalid/commerce.tsv.gz";

    const client = mkClient({
      "/v1/analyticsReportRequests/req-1/reports": () =>
        new Response(JSON.stringify({
          data: [
            { id: "report-eng", attributes: { category: "APP_STORE_ENGAGEMENT", name: "Engagement" } },
            { id: "report-commerce", attributes: { category: "COMMERCE", name: "Downloads" } },
            { id: "report-usage", attributes: { category: "APP_USAGE", name: "Usage" } },
          ],
        }), { status: 200 }),
      "/v1/analyticsReports/report-eng/instances": () =>
        new Response(JSON.stringify({
          data: [{ id: "inst-eng-1", attributes: { granularity: "DAILY", processingDate: "2024-01-15" } }],
        }), { status: 200 }),
      "/v1/analyticsReports/report-usage/instances": () =>
        new Response(JSON.stringify({
          data: [{ id: "inst-usage-1", attributes: { granularity: "DAILY", processingDate: "2024-01-15" } }],
        }), { status: 200 }),
      "/v1/analyticsReports/report-commerce/instances": () =>
        new Response(JSON.stringify({
          data: [{ id: "inst-commerce-1", attributes: { granularity: "DAILY", processingDate: "2024-01-15" } }],
        }), { status: 200 }),
      "/v1/analyticsReportInstances/inst-eng-1/segments": () =>
        new Response(JSON.stringify({ data: [{ attributes: { url: engagementUrl } }] }), { status: 200 }),
      "/v1/analyticsReportInstances/inst-usage-1/segments": () =>
        new Response(JSON.stringify({ data: [{ attributes: { url: usageUrl } }] }), { status: 200 }),
      "/v1/analyticsReportInstances/inst-commerce-1/segments": () =>
        new Response(JSON.stringify({ data: [{ attributes: { url: commerceUrl } }] }), { status: 200 }),
      "engagement.csv.gz": () => new Response(gzipSync(Buffer.from(ENGAGEMENT)), { status: 200 }),
      "usage.csv.gz":      () => new Response(gzipSync(Buffer.from(USAGE)),      { status: 200 }),
      "commerce.tsv.gz":   () => new Response(gzipSync(Buffer.from(COMMERCE_DOWNLOADS)), { status: 200 }),
      "/v1/analyticsReportRequests": () =>
        new Response(JSON.stringify({ data: { id: "req-1" } }), { status: 200 }),
    });

    const out = await syncAnalytics(db, client, ["111"]);
    expect(out.errors).toBe(0);
    expect(out.segmentsFetched).toBe(3);
    expect(out.rowsUpserted).toBeGreaterThan(0);
    expect(out.categoryCounts.COMMERCE).toBeGreaterThan(0);

    const out2 = await syncAnalytics(db, client, ["111"]);
    expect(out2.segmentsFetched).toBe(0);
  });

  test("skips non-relevant categories (e.g. FRAMEWORKS_USAGE)", async () => {
    const db = makeAscDb();
    const client = mkClient({
      "/v1/analyticsReportRequests/req-skip/reports": () =>
        new Response(JSON.stringify({
          data: [{ id: "fw", attributes: { category: "FRAMEWORKS_USAGE", name: "FW" } }],
        }), { status: 200 }),
      "/v1/analyticsReportRequests": () =>
        new Response(JSON.stringify({ data: { id: "req-skip" } }), { status: 200 }),
    });
    const out = await syncAnalytics(db, client, ["111"]);
    expect(out.segmentsFetched).toBe(0);
    expect(out.rowsUpserted).toBe(0);
  });

  test("purchases report routes into purchases_daily and NOT analytics_daily", async () => {
    const db = makeAscDb();
    const purchasesUrl = "https://cdn.apple.invalid/purchases.tsv.gz";

    const client = mkClient({
      "/v1/analyticsReportRequests/req-1/reports": () =>
        new Response(JSON.stringify({
          data: [
            { id: "report-purch", attributes: { category: "COMMERCE", name: "App Store Purchases Standard" } },
          ],
        }), { status: 200 }),
      "/v1/analyticsReports/report-purch/instances": () =>
        new Response(JSON.stringify({
          data: [{ id: "inst-purch-1", attributes: { granularity: "DAILY", processingDate: "2026-06-15" } }],
        }), { status: 200 }),
      "/v1/analyticsReportInstances/inst-purch-1/segments": () =>
        new Response(JSON.stringify({ data: [{ attributes: { url: purchasesUrl } }] }), { status: 200 }),
      "purchases.tsv.gz": () => new Response(gzipSync(Buffer.from(PURCHASES)), { status: 200 }),
      "/v1/analyticsReportRequests": () =>
        new Response(JSON.stringify({ data: { id: "req-1" } }), { status: 200 }),
    });

    const out = await syncAnalytics(db, client, ["111"]);

    // Routing invariant: purchases rows land in purchases_daily, not analytics_daily
    expect(out.errors).toBe(0);
    expect(out.purchasesRows).toBeGreaterThan(0);
    expect(out.segmentsFetched).toBe(1);

    // purchases_daily must have rows with correct paying_users / proceeds_usd
    const deRow = db.query(
      `SELECT paying_users, proceeds_usd FROM purchases_daily WHERE app_store_id='1000000001' AND date='2026-06-15' AND territory='DE'`,
    ).get() as any;
    expect(deRow).not.toBeNull();
    expect(deRow.paying_users).toBe(2);          // two rows aggregated in the parser
    expect(deRow.proceeds_usd).toBeCloseTo(3.98);

    const usRow = db.query(
      `SELECT paying_users, proceeds_usd FROM purchases_daily WHERE app_store_id='1000000002' AND date='2026-06-15' AND territory='US'`,
    ).get() as any;
    expect(usRow).not.toBeNull();
    expect(usRow.paying_users).toBe(1);
    expect(usRow.proceeds_usd).toBeCloseTo(0.70);

    // analytics_daily must have NO rows from the purchases segment
    const analyticsCount = (db.query(`SELECT COUNT(*) as n FROM analytics_daily WHERE date='2026-06-15'`).get() as any).n;
    expect(analyticsCount).toBe(0);
  });

  test("recognizes engagement reports by name when category is unfamiliar", async () => {
    const db = makeAscDb();
    const engagementUrl = "https://cdn.apple.invalid/engagement.csv.gz";
    const client = mkClient({
      "/v1/analyticsReportRequests/req-name/reports": () =>
        new Response(JSON.stringify({
          data: [{
            id: "report-eng",
            attributes: { category: "UNKNOWN_CATEGORY", name: "App Store Discovery and Engagement Detailed" },
          }],
        }), { status: 200 }),
      "/v1/analyticsReports/report-eng/instances": () =>
        new Response(JSON.stringify({
          data: [{ id: "inst-eng-1", attributes: { granularity: "DAILY", processingDate: "2024-01-15" } }],
        }), { status: 200 }),
      "/v1/analyticsReportInstances/inst-eng-1/segments": () =>
        new Response(JSON.stringify({ data: [{ attributes: { url: engagementUrl } }] }), { status: 200 }),
      "engagement.csv.gz": () => new Response(gzipSync(Buffer.from(ENGAGEMENT)), { status: 200 }),
      "/v1/analyticsReportRequests": () =>
        new Response(JSON.stringify({ data: { id: "req-name" } }), { status: 200 }),
    });

    const out = await syncAnalytics(db, client, ["111"]);
    expect(out.errors).toBe(0);
    expect(out.categoryCounts.APP_STORE_ENGAGEMENT).toBeGreaterThan(0);
  });
});

test("isPurchasesReport matches the App Store Purchases reports only", () => {
  expect(isPurchasesReport("App Store Purchases Standard")).toBe(true);
  expect(isPurchasesReport("App Store Purchases Detailed")).toBe(true);
  expect(isPurchasesReport("App Downloads Standard")).toBe(false);
  expect(isPurchasesReport("App Store Pre-Orders Standard")).toBe(false);
});

test("upsertPurchases writes to purchases_daily and replaces on conflict", () => {
  const db = makeAscDb();
  upsertPurchases(db, [{ appStoreId: "111", date: "2024-01-10", territory: "DE", purchases: 1, proceedsUsd: 2, salesUsd: 3, payingUsers: 1 }]);
  upsertPurchases(db, [{ appStoreId: "111", date: "2024-01-10", territory: "DE", purchases: 2, proceedsUsd: 4, salesUsd: 6, payingUsers: 2 }]);
  const row = db.query("SELECT purchases, proceeds_usd, paying_users FROM purchases_daily").get() as any;
  expect(row.purchases).toBe(2);
  expect(row.proceeds_usd).toBeCloseTo(4);
  expect(row.paying_users).toBe(2);
});

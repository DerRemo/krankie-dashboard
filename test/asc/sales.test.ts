import { describe, test, expect } from "bun:test";
import { gzipSync } from "zlib";
import { readFileSync } from "fs";
import { join } from "path";
import { makeAscDb, seedSales } from "./seed";
import { syncSales, computeSalesDaysToFetch, upsertSalesRows } from "../../src/asc/sales";
import { AscClient } from "../../src/asc/client";

const FIXTURE = readFileSync(join(import.meta.dir, "../fixtures/asc/sales-2024-01-15.tsv"), "utf8");

class FakeAuth { async getToken() { return "x"; } }

function mkClient(handler: (url: string) => Response | Promise<Response>): AscClient {
  return new AscClient({
    baseUrl: "https://test.invalid",
    auth: new FakeAuth() as any,
    fetchImpl: ((url: string) => Promise.resolve(handler(url))) as unknown as typeof fetch,
    sleep: async () => {},
    rateLimitPerSecond: 10000,
  });
}

describe("computeSalesDaysToFetch", () => {
  test("fresh DB: returns 365 days ending yesterday", () => {
    const db = makeAscDb();
    const days = computeSalesDaysToFetch(db, new Date("2024-06-01T12:00:00Z"));
    expect(days.length).toBe(365);
    expect(days[days.length - 1]).toBe("2024-05-31");
    expect(days[0]).toBe("2023-06-02");
  });

  test("populated DB: returns rolling 7d re-sync window through yesterday", () => {
    const db = makeAscDb();
    seedSales(db, [{ appStoreId: "111", date: "2024-05-25", territory: "US", units: 1 }]);
    const days = computeSalesDaysToFetch(db, new Date("2024-05-30T12:00:00Z"));
    expect(days[0]).toBe("2024-05-18");
    expect(days[days.length - 1]).toBe("2024-05-29");
  });

  test("populated DB but more than 365 days back: clamps to 365-day horizon", () => {
    const db = makeAscDb();
    seedSales(db, [{ appStoreId: "111", date: "2022-01-01", territory: "US" }]);
    const days = computeSalesDaysToFetch(db, new Date("2024-01-15T12:00:00Z"));
    expect(days.length).toBeLessThanOrEqual(365);
  });

  test("forceFromDays overrides resume logic and fetches N days back from yesterday", () => {
    const db = makeAscDb();
    seedSales(db, [{ appStoreId: "111", date: "2024-05-25", territory: "US" }]);
    const days = computeSalesDaysToFetch(db, new Date("2024-05-30T12:00:00Z"), { forceFromDays: 14 });
    expect(days.length).toBe(14);
    expect(days[days.length - 1]).toBe("2024-05-29");
    expect(days[0]).toBe("2024-05-16");
  });
});

describe("upsertSalesRows", () => {
  test("is idempotent — running twice produces identical row state", () => {
    const db = makeAscDb();
    const row = {
      appStoreId: "111", date: "2024-05-01", territory: "US",
      units: 5, redownloads: 0, updates: 0,
      proceedsLocal: 3.5, iapProceedsLocal: 0, proceedsCurrency: "USD",
      proceedsUsd: 3.5, iapUnits: 0, iapProceedsUsd: 0,
    };
    upsertSalesRows(db, [row]);
    upsertSalesRows(db, [row]);
    const rows = db.query("SELECT * FROM sales_daily").all() as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].units).toBe(5);
  });

  test("overwrites on conflict (re-sync corrects values)", () => {
    const db = makeAscDb();
    upsertSalesRows(db, [{
      appStoreId: "111", date: "2024-05-01", territory: "US",
      units: 1, redownloads: 0, updates: 0,
      proceedsLocal: 0.7, iapProceedsLocal: 0, proceedsCurrency: "USD",
      proceedsUsd: 0.7, iapUnits: 0, iapProceedsUsd: 0,
    }]);
    upsertSalesRows(db, [{
      appStoreId: "111", date: "2024-05-01", territory: "US",
      units: 9, redownloads: 0, updates: 0,
      proceedsLocal: 6.3, iapProceedsLocal: 0, proceedsCurrency: "USD",
      proceedsUsd: 6.3, iapUnits: 0, iapProceedsUsd: 0,
    }]);
    const r = db.query("SELECT units FROM sales_daily").get() as { units: number };
    expect(r.units).toBe(9);
  });
});

describe("syncSales", () => {
  test("fetches days, parses, upserts; returns counts", async () => {
    const db = makeAscDb();
    seedSales(db, [{ appStoreId: "111", date: "2024-01-13", territory: "US" }]);
    const gz = gzipSync(Buffer.from(FIXTURE));
    let calls = 0;
    const client = mkClient(() => { calls++; return new Response(gz, { status: 200 }); });

    const out = await syncSales(db, client, ["111", "222"], {
      vendorNumber: "vn",
      today: new Date("2024-01-16T12:00:00Z"),
    });

    expect(out.daysFetched).toBe(calls);
    expect(out.daysFetched).toBeGreaterThan(0);
    const rows = db.query("SELECT * FROM sales_daily").all() as any[];
    expect(rows.find((r) => r.app_store_id === "111" && r.territory === "US")).toBeDefined();
  });

  test("end-to-end: non-USD sales rows get proceeds_usd via FX after sync", async () => {
    const db = makeAscDb();
    seedSales(db, [{ appStoreId: "111", date: "2024-01-13", territory: "US", proceedsLocal: 0, proceedsCurrency: "USD" }]);

    const fixtureEur = readFileSync(join(import.meta.dir, "../fixtures/asc/sales-2024-01-15-eur.tsv"), "utf8");
    const gz = gzipSync(Buffer.from(fixtureEur));

    const client = mkClient(() => new Response(gz, { status: 200 }));

    let fxCalls = 0;
    const fxFetch = ((url: string) => {
      expect(url).toContain("frankfurter.app");
      expect(url).toContain("from=EUR");
      fxCalls++;
      return Promise.resolve(new Response(JSON.stringify({ rates: { USD: 1.10 } }), { status: 200 }));
    }) as unknown as typeof fetch;

    await syncSales(db, client, ["111", "222"], {
      vendorNumber: "vn",
      today: new Date("2024-01-16T12:00:00Z"),
      fxFetch,
    });

    const de = db.query<{ proceeds_usd: number; proceeds_local: number; proceeds_currency: string }, []>(
      "SELECT proceeds_usd, proceeds_local, proceeds_currency FROM sales_daily WHERE territory='DE' LIMIT 1",
    ).get();
    expect(de?.proceeds_currency).toBe("EUR");
    expect(de?.proceeds_local).toBeGreaterThan(0);
    expect(de?.proceeds_usd).toBeCloseTo(de!.proceeds_local * 1.10);
    expect(fxCalls).toBe(1);
  });

  test("syncSales attributes IAP to parent app via asc_apps.sku", async () => {
    const db = makeAscDb();
    db.run(`INSERT INTO asc_apps (app_store_id, apple_id, name, bundle_id, sku, fetched_at)
            VALUES ('222','222','Beta','com.dev.beta','beta-ios','t')`);
    seedSales(db, [{ appStoreId: "222", date: "2024-01-13", territory: "DE", proceedsCurrency: "EUR" }]);
    // Minimal TSV: only the IAP row + an unrelated non-IAP app (111).
    // Intentionally no non-IAP beta row so in-file SKU learning can't resolve 'beta-ios'.
    // Attribution to app 222 must come from skuToAppStoreId built from asc_apps.sku.
    // Dates match the seeded row (2024-01-13) so the upsert overwrites the seeded iap_units.
    const tsvIapOnly = [
      "Provider\tProvider Country\tSKU\tDeveloper\tTitle\tVersion\tProduct Type Identifier\tUnits\tDeveloper Proceeds\tBegin Date\tEnd Date\tCustomer Currency\tCountry Code\tCurrency of Proceeds\tApple Identifier\tCustomer Price\tPromo Code\tParent Identifier\tSubscription\tPeriod\tCategory\tCMB\tDevice\tSupported Platforms",
      "APPLE\tUS\talpha-ios\tDev\tAlpha\t2.1\t1F\t1\t1.76\t01/13/2024\t01/13/2024\tEUR\tDE\tEUR\t111\t2.99",
      "APPLE\tUS\tcom.dev.beta.premium\tDev\tBeta Premium\t1.0\tIA1\t2\t1.17\t01/13/2024\t01/13/2024\tEUR\tDE\tEUR\t999\t1.99\t\tbeta-ios",
    ].join("\n");
    const gz = gzipSync(Buffer.from(tsvIapOnly));
    const client = mkClient(() => new Response(gz, { status: 200 }));
    await syncSales(db, client, ["111", "222"], {
      vendorNumber: "vn",
      today: new Date("2024-01-16T12:00:00Z"),
      fxFetch: ((u: string) => Promise.resolve(new Response(JSON.stringify({ rates: { USD: 1.1 } }), { status: 200 }))) as any,
    });
    const beta = db.query("SELECT iap_units, iap_proceeds_local FROM sales_daily WHERE app_store_id='222' AND territory='DE'").get() as { iap_units: number; iap_proceeds_local: number };
    expect(beta.iap_units).toBe(2);
  });
});

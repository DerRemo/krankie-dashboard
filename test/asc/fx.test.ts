import { describe, test, expect } from "bun:test";
import { makeAscDb, seedSales } from "./seed";
import { getRate, convertPendingRows } from "../../src/asc/fx";

function mkFetch(handler: (url: string) => { status?: number; body?: unknown }): typeof fetch {
  return (async (input: string) => {
    const { status = 200, body = {} } = handler(input);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

describe("getRate", () => {
  test("fetches from Frankfurter on cache miss, writes cache, returns rate", async () => {
    const db = makeAscDb();
    let calls = 0;
    const fetchImpl = mkFetch((url) => {
      calls++;
      expect(url).toBe("https://api.frankfurter.app/2024-05-07?from=EUR&to=USD");
      return { body: { amount: 1, base: "EUR", date: "2024-05-07", rates: { USD: 1.0823 } } };
    });

    const rate = await getRate(db, fetchImpl, "2024-05-07", "EUR");
    expect(rate).toBeCloseTo(1.0823);
    expect(calls).toBe(1);

    const cached = db.query<{ usd_per_unit: number }, []>(
      "SELECT usd_per_unit FROM fx_rates_daily WHERE date='2024-05-07' AND currency='EUR'",
    ).get();
    expect(cached?.usd_per_unit).toBeCloseTo(1.0823);
  });

  test("uses cache on hit (no fetch call)", async () => {
    const db = makeAscDb();
    db.run(
      "INSERT INTO fx_rates_daily (date, currency, usd_per_unit, fetched_at) VALUES (?, ?, ?, ?)",
      ["2024-05-07", "EUR", 1.0823, "2024-05-08T00:00:00Z"],
    );
    const fetchImpl = mkFetch(() => { throw new Error("fetch must not be called"); });

    const rate = await getRate(db, fetchImpl, "2024-05-07", "EUR");
    expect(rate).toBeCloseTo(1.0823);
  });

  test("throws on HTTP error", async () => {
    const db = makeAscDb();
    const fetchImpl = mkFetch(() => ({ status: 422, body: { message: "unknown currency" } }));
    await expect(getRate(db, fetchImpl, "2024-05-07", "XYZ")).rejects.toThrow(/422/);
  });

  test("throws when response is missing USD rate", async () => {
    const db = makeAscDb();
    const fetchImpl = mkFetch(() => ({ body: { rates: {} } }));
    await expect(getRate(db, fetchImpl, "2024-05-07", "EUR")).rejects.toThrow(/USD rate missing/);
  });

  test("throws a descriptive error when response body is not JSON", async () => {
    const db = makeAscDb();
    const fetchImpl = (async () =>
      new Response("Internal Server Error", { status: 200 })
    ) as unknown as typeof fetch;
    await expect(getRate(db, fetchImpl, "2024-05-07", "EUR")).rejects.toThrow(/EUR.*2024-05-07/);
  });

  test("propagates fetch rejection (network failure)", async () => {
    const db = makeAscDb();
    const fetchImpl = (() => Promise.reject(new Error("network timeout"))) as unknown as typeof fetch;
    await expect(getRate(db, fetchImpl, "2024-05-07", "EUR")).rejects.toThrow("network timeout");
  });
});

describe("convertPendingRows", () => {
  test("converts non-USD rows with proceedsLocal > 0; leaves USD and zero rows untouched", async () => {
    const db = makeAscDb();
    seedSales(db, [
      // USD bucket — already converted
      { appStoreId: "111", date: "2024-05-07", territory: "US",
        proceedsLocal: 3.5, proceedsCurrency: "USD", proceedsUsd: 3.5, units: 5 },
      // EUR bucket with revenue — pending
      { appStoreId: "111", date: "2024-05-07", territory: "DE",
        proceedsLocal: 2.0, iapProceedsLocal: 1.0, proceedsCurrency: "EUR", proceedsUsd: 0, iapProceedsUsd: 0, units: 2 },
      // EUR bucket with zero revenue (free downloads only) — should be skipped
      { appStoreId: "111", date: "2024-05-07", territory: "FR",
        proceedsLocal: 0, proceedsCurrency: "EUR", proceedsUsd: 0, units: 0, redownloads: 1 },
    ]);

    const fetchImpl = (async (url: string) => {
      expect(url).toBe("https://api.frankfurter.app/2024-05-07?from=EUR&to=USD");
      return new Response(JSON.stringify({ rates: { USD: 1.10 } }), { status: 200 });
    }) as unknown as typeof fetch;

    const out = await convertPendingRows(db, fetchImpl);
    expect(out.updated).toBe(1);
    expect(out.failures).toEqual([]);

    const de = db
      .query<{ proceeds_usd: number; iap_proceeds_usd: number }, []>(
        "SELECT proceeds_usd, iap_proceeds_usd FROM sales_daily WHERE territory='DE'",
      )
      .get();
    expect(de?.proceeds_usd).toBeCloseTo(2.0 * 1.10);
    expect(de?.iap_proceeds_usd).toBeCloseTo(1.0 * 1.10);

    const us = db.query<{ proceeds_usd: number }, []>(
      "SELECT proceeds_usd FROM sales_daily WHERE territory='US'",
    ).get();
    expect(us?.proceeds_usd).toBeCloseTo(3.5);

    const fr = db.query<{ proceeds_usd: number }, []>(
      "SELECT proceeds_usd FROM sales_daily WHERE territory='FR'",
    ).get();
    expect(fr?.proceeds_usd).toBe(0);
  });

  test("converts IAP-only non-USD rows (proceedsLocal=0, iapProceedsLocal>0)", async () => {
    const db = makeAscDb();
    seedSales(db, [
      // EUR territory with only subscription IAP (free app, paid subscription)
      { appStoreId: "111", date: "2024-05-07", territory: "DE",
        proceedsLocal: 0, iapProceedsLocal: 4.99, proceedsCurrency: "EUR",
        proceedsUsd: 0, iapProceedsUsd: 0, units: 0, iapUnits: 1 },
    ]);

    const fetchImpl = (async (url: string) => {
      expect(url).toContain("from=EUR");
      return new Response(JSON.stringify({ rates: { USD: 1.10 } }), { status: 200 });
    }) as unknown as typeof fetch;

    const out = await convertPendingRows(db, fetchImpl);
    expect(out.updated).toBe(1);
    expect(out.failures).toEqual([]);

    const de = db.query<{ proceeds_usd: number; iap_proceeds_usd: number }, []>(
      "SELECT proceeds_usd, iap_proceeds_usd FROM sales_daily WHERE territory='DE'",
    ).get();
    expect(de?.proceeds_usd).toBe(0);              // local was 0, stays 0
    expect(de?.iap_proceeds_usd).toBeCloseTo(4.99 * 1.10);
  });

  test("records failures without throwing; partial progress is committed", async () => {
    const db = makeAscDb();
    seedSales(db, [
      { appStoreId: "111", date: "2024-05-07", territory: "DE",
        proceedsLocal: 2.0, proceedsCurrency: "EUR", proceedsUsd: 0, units: 1 },
      { appStoreId: "111", date: "2024-05-07", territory: "GB",
        proceedsLocal: 5.0, proceedsCurrency: "GBP", proceedsUsd: 0, units: 1 },
    ]);

    const fetchImpl = (async (url: string) => {
      if (url.includes("from=EUR")) {
        return new Response(JSON.stringify({ rates: { USD: 1.10 } }), { status: 200 });
      }
      return new Response("upstream down", { status: 503 });
    }) as unknown as typeof fetch;

    const out = await convertPendingRows(db, fetchImpl);
    expect(out.updated).toBe(1);
    expect(out.failures.length).toBe(1);
    expect(out.failures[0]?.currency).toBe("GBP");
    expect(out.failures[0]?.reason).toMatch(/503/);

    const de = db.query<{ proceeds_usd: number }, []>(
      "SELECT proceeds_usd FROM sales_daily WHERE territory='DE'",
    ).get();
    expect(de?.proceeds_usd).toBeCloseTo(2.2);

    const gb = db.query<{ proceeds_usd: number }, []>(
      "SELECT proceeds_usd FROM sales_daily WHERE territory='GB'",
    ).get();
    expect(gb?.proceeds_usd).toBe(0); // unchanged
  });
});

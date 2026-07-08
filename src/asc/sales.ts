import type { Database } from "bun:sqlite";
import type { AscClient } from "./client";
import type { SalesRow } from "./types";
import { parseSalesTsv } from "./sales-parser";
import { convertPendingRows } from "./fx";
import { listAscApps } from "./apps";
import { logger } from "../logger";

const RE_SYNC_DAYS = 7;
const INITIAL_BACKFILL_DAYS = 365;
const DAILY_LATENCY_DAYS = 1;

export interface SyncSalesOpts {
  vendorNumber: string;
  /** Override "today" for tests. Defaults to new Date(). */
  today?: Date;
  /** Override the fetch implementation used for FX lookups (tests inject mocks). */
  fxFetch?: typeof fetch;
  /** When set, ignore the resume-from-MAX(date) logic and fetch the last N days. */
  forceFromDays?: number;
}

export async function syncSales(
  ascDb: Database,
  client: AscClient,
  appStoreIds: string[],
  opts: SyncSalesOpts,
): Promise<{ daysFetched: number; rowsUpserted: number; errors: number }> {
  const filterSet = new Set(appStoreIds);
  const skuToAppStoreId = new Map<string, string>();
  for (const a of listAscApps(ascDb)) {
    if (a.sku) skuToAppStoreId.set(a.sku, a.appStoreId);
  }
  const today = opts.today ?? new Date();
  const days = computeSalesDaysToFetch(ascDb, today, { forceFromDays: opts.forceFromDays });
  let rowsUpserted = 0;
  let errors = 0;
  for (const date of days) {
    try {
      const tsv = await client.getGzippedText("/v1/salesReports", {
        "filter[frequency]":     "DAILY",
        "filter[reportType]":    "SALES",
        "filter[reportSubType]": "SUMMARY",
        "filter[vendorNumber]":  opts.vendorNumber,
        "filter[reportDate]":    date,
        "filter[version]":       "1_1",
      });
      const { rows, mixedCurrencyBuckets, droppedUnknownParent } = parseSalesTsv(tsv, { filterAppStoreIds: filterSet, skuToAppStoreId });
      if (mixedCurrencyBuckets > 0) {
        logger.warn(
          { phase: "sales", date, mixedCurrencyBuckets },
          "sales rows had multiple currencies in the same (app, date, territory) bucket — first currency kept",
        );
      }
      if (droppedUnknownParent > 0) {
        logger.warn(
          { phase: "sales", date, droppedUnknownParent },
          "IAP rows dropped — parent app SKU unresolved or untracked",
        );
      }
      upsertSalesRows(ascDb, rows);
      rowsUpserted += rows.length;
      logger.info({ phase: "sales", date, rows: rows.length }, "sales day synced");
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 404) {
        // No report for that day — typical for days with no sales or pre-launch dates.
        // Not an error, just skip.
        logger.warn({ phase: "sales", date }, "sales report not available (404)");
        continue;
      }
      errors++;
      logger.error({ phase: "sales", date, err: String(err) }, "sales fetch failed");
    }
  }
  try {
    const fxOut = await convertPendingRows(ascDb, opts.fxFetch ?? fetch);
    if (fxOut.failures.length > 0) {
      logger.warn(
        { phase: "fx", failures: fxOut.failures.length, sample: fxOut.failures.slice(0, 3) },
        "fx conversion had failures (will retry next sync)",
      );
    }
    logger.info({ phase: "fx", updated: fxOut.updated }, "fx conversion complete");
  } catch (err) {
    logger.error({ phase: "fx", err: String(err) }, "fx conversion pass aborted");
    errors++;
  }
  return { daysFetched: days.length, rowsUpserted, errors };
}

export function computeSalesDaysToFetch(
  ascDb: Database,
  today: Date,
  opts: { forceFromDays?: number } = {},
): string[] {
  const todayUtc = atUtcMidnight(today);
  const last = todayUtc.getTime() - DAILY_LATENCY_DAYS * 86400_000;
  const lastDate = new Date(last);

  let from: number;
  if (opts.forceFromDays && opts.forceFromDays > 0) {
    from = lastDate.getTime() - (opts.forceFromDays - 1) * 86400_000;
  } else {
    const row = ascDb.query("SELECT MAX(date) AS d FROM sales_daily").get() as
      | { d: string | null }
      | null;
    const mostRecent = row?.d ?? null;

    if (mostRecent) {
      const recent = new Date(`${mostRecent}T00:00:00Z`).getTime();
      const reSyncFrom = recent - RE_SYNC_DAYS * 86400_000;
      const horizon = lastDate.getTime() - (INITIAL_BACKFILL_DAYS - 1) * 86400_000;
      from = Math.max(reSyncFrom, horizon);
    } else {
      from = lastDate.getTime() - (INITIAL_BACKFILL_DAYS - 1) * 86400_000;
    }
  }

  const days: string[] = [];
  for (let t = from; t <= lastDate.getTime(); t += 86400_000) {
    days.push(toIsoDate(new Date(t)));
  }
  return days;
}

function atUtcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function toIsoDate(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function upsertSalesRows(ascDb: Database, rows: SalesRow[]): void {
  if (rows.length === 0) return;
  const stmt = ascDb.prepare(`
    INSERT INTO sales_daily
      (app_store_id, date, territory,
       units, redownloads, updates,
       proceeds_local, iap_proceeds_local, proceeds_currency,
       proceeds_usd, iap_units, iap_proceeds_usd)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(app_store_id, date, territory) DO UPDATE SET
      units = excluded.units, redownloads = excluded.redownloads, updates = excluded.updates,
      proceeds_local = excluded.proceeds_local,
      iap_proceeds_local = excluded.iap_proceeds_local,
      proceeds_currency = excluded.proceeds_currency,
      proceeds_usd = excluded.proceeds_usd,
      iap_units = excluded.iap_units,
      iap_proceeds_usd = excluded.iap_proceeds_usd
  `);
  // null → 0 for the USD columns: sales_daily.proceeds_usd is NOT NULL.
  // The "pending FX" signal is `proceeds_usd = 0 AND proceeds_currency != 'USD'
  // AND (proceeds_local > 0 OR iap_proceeds_local > 0)`;
  // convertPendingRows (src/asc/fx.ts) queries that exact predicate.
  ascDb.transaction(() => {
    for (const r of rows) {
      stmt.run(
        r.appStoreId, r.date, r.territory,
        r.units, r.redownloads, r.updates,
        r.proceedsLocal, r.iapProceedsLocal, r.proceedsCurrency,
        r.proceedsUsd ?? 0, r.iapUnits, r.iapProceedsUsd ?? 0,
      );
    }
  })();
}

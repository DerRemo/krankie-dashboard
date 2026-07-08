import type { Database } from "bun:sqlite";

const FRANKFURTER_BASE = "https://api.frankfurter.app";

interface FrankfurterResponse {
  amount: number;
  base: string;
  date: string;
  rates: Record<string, number>;
}

/**
 * Resolve `1 unit of <currency>` in USD on `date`.
 * Cache-first: returns the cached rate if present, otherwise calls Frankfurter (free,
 * no API key, ECB-backed) and writes the result to `fx_rates_daily`.
 * For weekends/holidays the API silently returns the last business day's rate —
 * we cache under the *requested* date so the next lookup is O(1).
 */
export async function getRate(
  db: Database,
  fetchImpl: typeof fetch,
  date: string,
  currency: string,
): Promise<number> {
  const cached = db
    .query<{ usd_per_unit: number }, [string, string]>(
      "SELECT usd_per_unit FROM fx_rates_daily WHERE date = ? AND currency = ?",
    )
    .get(date, currency);
  if (cached) return cached.usd_per_unit;

  const url = `${FRANKFURTER_BASE}/${date}?from=${currency}&to=USD`;
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`Frankfurter HTTP ${res.status} for ${currency} on ${date}`);
  }
  let data: FrankfurterResponse;
  try {
    data = (await res.json()) as FrankfurterResponse;
  } catch {
    throw new Error(`Frankfurter non-JSON response for ${currency} on ${date}`);
  }
  const rate = data.rates?.USD;
  if (typeof rate !== "number") {
    throw new Error(`Frankfurter USD rate missing for ${currency} on ${date}`);
  }
  db.run(
    "INSERT OR IGNORE INTO fx_rates_daily (date, currency, usd_per_unit, fetched_at) VALUES (?, ?, ?, ?)",
    [date, currency, rate, new Date().toISOString()],
  );
  return rate;
}

export interface ConvertResult {
  updated: number;
  failures: Array<{ date: string; currency: string; reason: string }>;
}

/**
 * Scans sales_daily for rows whose local proceeds are non-zero, the currency is
 * non-USD, and proceeds_usd is still 0 (the "pending FX" signal). Groups by
 * (date, currency), fetches one rate per group via getRate, and issues a single
 * UPDATE statement per group covering all matching rows (atomic as one SQLite statement).
 * Returns counts; per-group failures are logged in the result and do not abort
 * other groups.
 */
export async function convertPendingRows(
  db: Database,
  fetchImpl: typeof fetch,
): Promise<ConvertResult> {
  const groups = db
    .query<{ date: string; currency: string }, []>(
      `SELECT DISTINCT date, proceeds_currency AS currency
         FROM sales_daily
        WHERE proceeds_currency IS NOT NULL
          AND proceeds_currency != 'USD'
          AND (proceeds_local > 0 OR iap_proceeds_local > 0)
          AND proceeds_usd = 0`,
    )
    .all();

  const result: ConvertResult = { updated: 0, failures: [] };
  const updateStmt = db.prepare(
    `UPDATE sales_daily
        SET proceeds_usd     = proceeds_local * ?,
            iap_proceeds_usd = iap_proceeds_local * ?
      WHERE date = ?
        AND proceeds_currency = ?
        AND (proceeds_local > 0 OR iap_proceeds_local > 0)
        AND proceeds_usd = 0`,
  );

  for (const g of groups) {
    try {
      const rate = await getRate(db, fetchImpl, g.date, g.currency);
      const r = updateStmt.run(rate, rate, g.date, g.currency);
      result.updated += Number(r.changes);
    } catch (err) {
      result.failures.push({ date: g.date, currency: g.currency, reason: String(err) });
    }
  }
  return result;
}

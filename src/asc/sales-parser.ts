import type { SalesRow } from "./types";

export interface ParseSalesOpts {
  /** When set, only rows whose resolved app_store_id is in this set are emitted. */
  filterAppStoreIds?: Set<string>;
  /** Maps app SKU (as it appears in "Parent Identifier" on IAP rows) → numeric app_store_id. */
  skuToAppStoreId?: Map<string, string>;
}

const REQUIRED_COLS = [
  "Product Type Identifier",
  "Units",
  "Developer Proceeds",
  "Begin Date",
  "Country Code",
  "Currency of Proceeds",
  "Apple Identifier",
];

function parseDateMmDdYyyy(raw: string): string {
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) throw new Error(`unparseable date: ${raw}`);
  const [, mm, dd, yyyy] = m as RegExpMatchArray & [string, string, string, string];
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

/**
 * Parse a Sales Summary Daily TSV. Aggregates per (appStoreId, date, territory).
 * The first non-empty Currency of Proceeds seen in a bucket fixes that bucket's currency;
 * rows in the same bucket with a different currency are skipped and counted as
 * `mixedCurrencyBuckets` (units NOT summed for skipped rows — see classify()).
 * USD rows populate proceedsUsd inline; non-USD rows leave proceedsUsd null pending FX.
 */
export function parseSalesTsv(text: string, opts: ParseSalesOpts = {}): {
  rows: SalesRow[];
  mixedCurrencyBuckets: number;
  droppedUnknownCol: number;
  droppedUnknownParent: number;
} {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return { rows: [], mixedCurrencyBuckets: 0, droppedUnknownCol: 0, droppedUnknownParent: 0 };
  const header = lines[0]!.split("\t");
  for (const col of REQUIRED_COLS) {
    if (!header.includes(col)) throw new Error(`Sales TSV missing required column: ${col}`);
  }
  const idx = (col: string) => header.indexOf(col);

  const COL_TYPE = idx("Product Type Identifier");
  const COL_UNITS = idx("Units");
  const COL_PROCEEDS = idx("Developer Proceeds");
  const COL_DATE = idx("Begin Date");
  const COL_COUNTRY = idx("Country Code");
  const COL_CURRENCY = idx("Currency of Proceeds");
  const COL_APPLE_ID = idx("Apple Identifier");
  const COL_SKU = idx("SKU");                       // optional → -1 if absent
  const COL_PARENT = idx("Parent Identifier");      // optional → -1 if absent

  // Pass 1: learn SKU → app_store_id from non-IAP rows, seeded with the persisted map.
  const skuMap = new Map<string, string>(opts.skuToAppStoreId ?? []);
  const split: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]!.split("\t");
    split.push(cols);
    if (COL_SKU < 0) continue;
    const ptype = cols[COL_TYPE]?.trim() ?? "";
    if (ptype.startsWith("IA")) continue;
    const sku = cols[COL_SKU]?.trim();
    const appId = cols[COL_APPLE_ID]?.trim();
    if (sku && appId) skuMap.set(sku, appId);
  }

  const agg = new Map<string, SalesRow>();
  const mixedBuckets = new Set<string>();
  let droppedUnknownCol = 0;
  let droppedUnknownParent = 0;

  // Pass 2: classify each row, attributing IAP rows to their parent app.
  for (const cols of split) {
    if (cols.length <= COL_APPLE_ID) { droppedUnknownCol++; continue; }
    const ptype = cols[COL_TYPE]!.trim();
    const isIap = ptype.startsWith("IA");

    let appStoreId = cols[COL_APPLE_ID]?.trim();
    if (isIap) {
      const parent = COL_PARENT >= 0 ? (cols[COL_PARENT]?.trim() ?? "") : "";
      const resolved = parent ? skuMap.get(parent) : undefined;
      if (resolved) appStoreId = resolved;       // else keep Apple Identifier as fallback
    }
    if (!appStoreId) continue;
    if (opts.filterAppStoreIds && !opts.filterAppStoreIds.has(appStoreId)) {
      if (isIap) droppedUnknownParent++;
      continue;
    }

    const currency = cols[COL_CURRENCY]?.trim() || "";
    const date = parseDateMmDdYyyy(cols[COL_DATE]!.trim());
    const territory = cols[COL_COUNTRY]!.trim() || "??";
    const units = Number(cols[COL_UNITS]!.trim() || "0");
    const perUnit = Number(cols[COL_PROCEEDS]!.trim() || "0");

    const key = `${appStoreId}|${date}|${territory}`;
    let row = agg.get(key);
    if (!row) {
      row = {
        appStoreId, date, territory,
        units: 0, redownloads: 0, updates: 0,
        proceedsLocal: 0, iapProceedsLocal: 0,
        proceedsCurrency: currency || null,
        proceedsUsd: currency === "USD" ? 0 : null,
        iapUnits: 0,
        iapProceedsUsd: currency === "USD" ? 0 : null,
      };
      agg.set(key, row);
    }
    if (row.proceedsCurrency !== null && currency && currency !== row.proceedsCurrency) {
      mixedBuckets.add(key);
      continue;
    }
    classify(ptype, units, perUnit, row);
  }

  return { rows: [...agg.values()], mixedCurrencyBuckets: mixedBuckets.size, droppedUnknownCol, droppedUnknownParent };
}

function classify(ptype: string, units: number, perUnit: number, row: SalesRow): void {
  const totalProceeds = units * perUnit;
  const isUsd = row.proceedsCurrency === "USD";

  if (ptype.startsWith("IA")) {
    row.iapUnits += units;
    row.iapProceedsLocal += totalProceeds;
    if (isUsd) row.iapProceedsUsd = (row.iapProceedsUsd ?? 0) + totalProceeds;
    return;
  }
  if (ptype.startsWith("7")) {
    row.updates += units;
    return;
  }
  // 1, 1F, 1T and any other 1* are app first downloads (free or paid) → sale.
  // 3* (e.g. Apple Watch 3F) fall through here too, with 0 proceeds.
  row.units += units;
  row.proceedsLocal += totalProceeds;
  if (isUsd) row.proceedsUsd = (row.proceedsUsd ?? 0) + totalProceeds;
}

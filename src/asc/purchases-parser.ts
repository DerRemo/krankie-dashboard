import type { PurchaseRow } from "./types";
import { detectDelimiter, parseDelimitedLine } from "./analytics-parser";

export interface ParsePurchasesOpts {
  filterAppStoreIds?: Set<string>;
}

const ALIAS = {
  date: ["Date"],
  appleId: ["App Apple Identifier", "App Apple ID"],
  territory: ["Territory", "Country Code"],
  purchases: ["Purchases"],
  proceedsUsd: ["Proceeds in USD"],
  salesUsd: ["Sales in USD"],
  payingUsers: ["Paying Users"],
};

function findIdx(header: string[], aliases: string[]): number {
  for (const a of aliases) {
    const i = header.indexOf(a);
    if (i >= 0) return i;
  }
  return -1;
}

function num(cols: string[], idx: number): number {
  if (idx < 0) return 0;
  const raw = cols[idx]?.trim().replace(/,/g, "");
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export function parsePurchasesCsv(text: string, opts: ParsePurchasesOpts = {}): PurchaseRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 1) return [];
  const delimiter = detectDelimiter(lines[0]!);
  const header = parseDelimitedLine(lines[0]!, delimiter);

  const cDate = findIdx(header, ALIAS.date);
  const cApp = findIdx(header, ALIAS.appleId);
  const cTerr = findIdx(header, ALIAS.territory);
  const cProceeds = findIdx(header, ALIAS.proceedsUsd);
  if (cDate < 0 || cApp < 0 || cTerr < 0 || cProceeds < 0) {
    throw new Error(`purchases CSV missing required columns: header=${header.join(",")}`);
  }
  const cPurch = findIdx(header, ALIAS.purchases);
  const cSales = findIdx(header, ALIAS.salesUsd);
  const cPaying = findIdx(header, ALIAS.payingUsers);

  const agg = new Map<string, PurchaseRow>();
  for (let i = 1; i < lines.length; i++) {
    const cols = parseDelimitedLine(lines[i]!, delimiter);
    const appStoreId = cols[cApp]?.trim();
    if (!appStoreId) continue;
    if (opts.filterAppStoreIds && !opts.filterAppStoreIds.has(appStoreId)) continue;
    const date = cols[cDate]!.trim();
    const territory = cols[cTerr]!.trim() || "??";
    const key = `${appStoreId}|${date}|${territory}`;
    let row = agg.get(key);
    if (!row) {
      row = { appStoreId, date, territory, purchases: 0, proceedsUsd: 0, salesUsd: 0, payingUsers: 0 };
      agg.set(key, row);
    }
    row.purchases += num(cols, cPurch);
    row.proceedsUsd += num(cols, cProceeds);
    row.salesUsd += num(cols, cSales);
    row.payingUsers += num(cols, cPaying);
  }
  return [...agg.values()];
}

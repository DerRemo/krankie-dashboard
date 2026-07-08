import type { AnalyticsCategory, AnalyticsRow } from "./types";

interface ColMap {
  date: string[];
  appleId: string[];
  territory: string[];
  counts?: string[];
  event?: string[];
  downloadType?: string[];
  impressions?: string[];
  productPageViews?: string[];
  firstTimeDownloads?: string[];
  sessions?: string[];
  activeDevices?: string[];
  crashes?: string[];
}

const COL_MAPS: Record<AnalyticsCategory, ColMap> = {
  APP_STORE_ENGAGEMENT: {
    date: ["Date"],
    appleId: ["App Apple Identifier", "App Apple ID"],
    territory: ["Territory", "Country Code"],
    counts: ["Counts", "Count", "Unique Counts"],
    event: ["Event", "Event Type"],
    impressions: ["Impressions"],
    productPageViews: ["Product Page Views"],
  },
  APP_USAGE: {
    date: ["Date", "Install Day"],
    appleId: ["App Apple Identifier", "App Apple ID"],
    territory: ["Territory", "Country Code"],
    sessions: ["Sessions"],
    activeDevices: ["Active Devices"],
    firstTimeDownloads: ["First-time Downloads", "First Time Downloads"],
    crashes: ["Crashes"],
  },
  COMMERCE: {
    date: ["Date"],
    appleId: ["App Apple Identifier", "App Apple ID"],
    territory: ["Territory", "Country Code"],
    counts: ["Counts", "Count", "Unique Counts"],
    downloadType: ["Download Type", "Download type"],
    firstTimeDownloads: ["First-time Downloads", "First Time Downloads"],
  },
  APP_STORE_COMMERCE: {
    date: ["Date"],
    appleId: ["App Apple Identifier", "App Apple ID"],
    territory: ["Territory", "Country Code"],
    counts: ["Counts", "Count", "Unique Counts"],
    downloadType: ["Download Type", "Download type"],
    firstTimeDownloads: ["First-time Downloads", "First Time Downloads"],
  },
  PERFORMANCE: {
    date: ["Date"],
    appleId: ["App Apple Identifier", "App Apple ID"],
    territory: ["Territory", "Country Code"],
    crashes: ["Crashes"],
    sessions: ["Sessions"],
  },
  FRAMEWORKS_USAGE: {
    date: ["Date"],
    appleId: ["App Apple Identifier", "App Apple ID"],
    territory: ["Territory", "Country Code"],
  },
};

export function detectDelimiter(headerLine: string): "," | "\t" {
  return headerLine.split("\t").length > headerLine.split(",").length ? "\t" : ",";
}

export function parseDelimitedLine(line: string, delimiter: "," | "\t"): string[] {
  // Minimal delimited parser: handles quoted fields with delimiters inside. Apple's
  // analytics reports do not embed newlines inside fields.
  const out: string[] = [];
  let buf = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { buf += '"'; i++; }
        else { inQ = false; }
      } else { buf += c; }
    } else {
      if (c === '"') inQ = true;
      else if (c === delimiter) { out.push(buf); buf = ""; }
      else buf += c;
    }
  }
  out.push(buf);
  return out;
}

function findIdx(header: string[], aliases: string[] | undefined): number {
  if (!aliases) return -1;
  for (const a of aliases) {
    const idx = header.indexOf(a);
    if (idx >= 0) return idx;
  }
  return -1;
}

export interface ParseAnalyticsOpts {
  filterAppStoreIds?: Set<string>;
}

export function parseAnalyticsCsv(
  text: string,
  category: AnalyticsCategory,
  opts: ParseAnalyticsOpts = {},
): AnalyticsRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 1) return [];
  const delimiter = detectDelimiter(lines[0]!);
  const header = parseDelimitedLine(lines[0]!, delimiter);
  const map = COL_MAPS[category];

  const colDate = findIdx(header, map.date);
  const colAppleId = findIdx(header, map.appleId);
  const colTerritory = findIdx(header, map.territory);
  if (colDate < 0 || colAppleId < 0 || colTerritory < 0) {
    throw new Error(
      `analytics CSV (${category}) missing required columns: header=${header.join(",")}`,
    );
  }

  const colImpressions = findIdx(header, map.impressions);
  const colPageViews = findIdx(header, map.productPageViews);
  const colFirstDl = findIdx(header, map.firstTimeDownloads);
  const colCounts = findIdx(header, map.counts);
  const colEvent = findIdx(header, map.event);
  const colDownloadType = findIdx(header, map.downloadType);
  const colSessions = findIdx(header, map.sessions);
  const colActive = findIdx(header, map.activeDevices);
  const colCrashes = findIdx(header, map.crashes);

  const rows = new Map<string, AnalyticsRow>();
  for (let i = 1; i < lines.length; i++) {
    const cols = parseDelimitedLine(lines[i]!, delimiter);
    const appStoreId = cols[colAppleId]?.trim();
    if (!appStoreId) continue;
    if (opts.filterAppStoreIds && !opts.filterAppStoreIds.has(appStoreId)) continue;
    const date = cols[colDate]!.trim();
    const territory = cols[colTerritory]!.trim() || "??";
    const key = `${appStoreId}|${date}|${territory}`;
    let row = rows.get(key);
    if (!row) {
      row = {
        appStoreId, date, territory,
        impressions: null, productPageViews: null, firstTimeDownloads: null,
        sessions: null, activeDevices: null, crashes: null,
      };
      rows.set(key, row);
    }

    addMetric(row, "impressions", numOrNull(cols, colImpressions));
    addMetric(row, "productPageViews", numOrNull(cols, colPageViews));
    addMetric(row, "firstTimeDownloads", numOrNull(cols, colFirstDl));
    addMetric(row, "sessions", numOrNull(cols, colSessions));
    addMetric(row, "activeDevices", numOrNull(cols, colActive));
    addMetric(row, "crashes", numOrNull(cols, colCrashes));

    const counts = numOrNull(cols, colCounts);
    const event = normalized(cols[colEvent]);
    const downloadType = normalized(cols[colDownloadType]);
    if (counts !== null && category === "APP_STORE_ENGAGEMENT") {
      if (isImpressionEvent(event)) addMetric(row, "impressions", counts);
      if (isPageViewEvent(event)) addMetric(row, "productPageViews", counts);
    }
    if (counts !== null && isCommerceCategory(category) && isFirstTimeDownload(downloadType)) {
      addMetric(row, "firstTimeDownloads", counts);
    }
  }
  return [...rows.values()];
}

function numOrNull(cols: string[], idx: number): number | null {
  if (idx < 0) return null;
  const raw = cols[idx]?.trim().replace(/,/g, "");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function normalized(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/-/g, " ");
}

function isCommerceCategory(category: AnalyticsCategory): boolean {
  return category === "COMMERCE" || category === "APP_STORE_COMMERCE";
}

function isImpressionEvent(event: string): boolean {
  return event === "impression" || event === "impressions" || event.includes("impression");
}

function isPageViewEvent(event: string): boolean {
  return event === "page view" || event === "page views" || event.includes("page view");
}

function isFirstTimeDownload(downloadType: string): boolean {
  return downloadType === "first time download" || downloadType === "first time downloads";
}

type NumericMetricKey =
  | "impressions"
  | "productPageViews"
  | "firstTimeDownloads"
  | "sessions"
  | "activeDevices"
  | "crashes";

function addMetric(
  row: AnalyticsRow,
  key: NumericMetricKey,
  value: number | null | undefined,
): void {
  if (typeof value !== "number") return;
  const current = row[key];
  row[key] = typeof current === "number" ? current + value : value;
}

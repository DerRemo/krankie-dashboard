import type { Database } from "bun:sqlite";
import type { SyncStatus, SyncTrigger } from "../asc/types";

export type AscRange = "7d" | "30d" | "90d" | "365d";
export type AscMetricSource = "analytics" | "sales" | "missing";

export interface AscDailyPoint {
  date: string;
  impressions: number | null;
  pageViews: number | null;
  firstTimeDownloads: number | null;
  conversionRate: number | null;
  units: number;
  proceedsUsd: number | null;
  iapProceedsUsd: number | null;
  totalProceedsUsd: number | null;
  crashes: number | null;
  sessions: number | null;
  crashRate: number | null;
  hasAnalytics: boolean;
  hasSales: boolean;
  downloadsSource: AscMetricSource;
  isPartial: boolean;
}

export interface AscTodayRow {
  appStoreId: string;
  date: string | null;
  impressionsDate: string | null;
  downloadsDate: string | null;
  impressions: number;
  downloads: number;
  impressionsSource: AscMetricSource;
  downloadsSource: AscMetricSource;
  isPartial: boolean;
  impressionsDelta7dPct: number | null;
  downloadsDelta7dPct: number | null;
  trendImpressions: Array<number | null>;
  trendDownloads: Array<number | null>;
  proceeds30d: number;
  trendProceeds: Array<number | null>;
}

export interface AscSyncRunRow {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  trigger: SyncTrigger;
  status: SyncStatus;
  summaryJson: string | null;
  error: string | null;
}

export interface AscCoverage {
  salesLastDate: string | null;
  analyticsLastDate: string | null;
  salesBackfillPct: number;
  analyticsBackfillPct: number;
}

export interface AscKpis {
  range: AscRange;
  fromDate: string | null;
  toDate: string | null;
  latestDate: string | null;
  isPartial: boolean;
  impressions: { value: number; deltaPct: number | null };
  pageViews: { value: number; deltaPct: number | null };
  conversionRate: { value: number; deltaPct: number | null };
  firstTimeDownloads: { value: number; deltaPct: number | null };
  downloads: { value: number; deltaPct: number | null };
  proceedsUsd: { value: number; deltaPct: number | null };
  arpd: { value: number | null; deltaPct: number | null };
  payingUsers: { value: number; deltaPct: number | null };
  crashRate: { value: number | null; deltaPct: number | null };
}

export interface AscTerritoryRevenue {
  territory: string;
  proceedsUsd: number;
  sharePct: number;
}

export interface AscAppDiagnostics {
  appStoreId: string;
  name: string | null;
  salesLastDate: string | null;
  analyticsLastDate: string | null;
  /** Days in last 7 where analytics is present but sales is absent — Apple-confirmed no paid activity. */
  salesNoActivityLast7d: number;
  /** Days in last 7 where neither analytics nor sales is present — Apple hasn't delivered yet. */
  salesPendingLast7d: number;
  missingAnalyticsLast7d: number;
  /** True iff analytics_daily ever has a non-null sessions/active_devices/crashes for this app. */
  engagementMetricsAvailable: boolean;
  payingUsers30d: number;
  salesProceedsUsd30d: number;
  purchasesProceedsUsd30d: number;
  isStale: boolean;
}

const DAY_MS = 86400_000;

function rangeDays(range: AscRange): number {
  return { "7d": 7, "30d": 30, "90d": 90, "365d": 365 }[range];
}

function toIsoDate(t: number): string {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function addDays(date: string, days: number): string {
  return toIsoDate(new Date(`${date}T00:00:00Z`).getTime() + days * DAY_MS);
}

function latestAscDateForApp(ascDb: Database, appStoreId: string): string | null {
  const row = ascDb.query(
    `SELECT MAX(date) AS d FROM (
       SELECT date FROM analytics_daily WHERE app_store_id = ?
       UNION ALL
       SELECT date FROM sales_daily WHERE app_store_id = ?
     )`,
  ).get(appStoreId, appStoreId) as { d: string | null } | null;
  return row?.d ?? null;
}

function countMissingDays(days: string[], present: Set<string>): number {
  return days.reduce((n, d) => n + (present.has(d) ? 0 : 1), 0);
}

function windowDays(through: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDays(through, -(days - 1 - i)));
}

/** Aggregated per-day series for one app, summing across territories. */
export function ascDailyForApp(ascDb: Database, appStoreId: string, range: AscRange): AscDailyPoint[] {
  const days = rangeDays(range);
  const through = latestAscDateForApp(ascDb, appStoreId);
  if (!through) return [];
  const since = addDays(through, -(days - 1));
  const salesRows = ascDb.query(
    `SELECT date,
            SUM(units) AS units,
            SUM(proceeds_usd) AS proceeds_usd,
            SUM(iap_proceeds_usd) AS iap_proceeds_usd
     FROM sales_daily WHERE app_store_id = ? AND date BETWEEN ? AND ?
     GROUP BY date`,
  ).all(appStoreId, since, through) as Array<{ date: string; units: number; proceeds_usd: number; iap_proceeds_usd: number }>;
  const analyticsRows = ascDb.query(
    `SELECT date,
            SUM(impressions) AS impressions,
            SUM(product_page_views) AS page_views,
            SUM(first_time_downloads) AS first_time_downloads,
            SUM(crashes) AS crashes,
            SUM(sessions) AS sessions,
            COUNT(crashes) AS crashes_count,
            COUNT(sessions) AS sessions_count
     FROM analytics_daily WHERE app_store_id = ? AND date BETWEEN ? AND ?
     GROUP BY date`,
  ).all(appStoreId, since, through) as Array<{
    date: string; impressions: number | null; page_views: number | null; first_time_downloads: number | null;
    crashes: number | null; sessions: number | null; crashes_count: number; sessions_count: number;
  }>;

  const byDate = new Map<string, AscDailyPoint>();
  const ensure = (d: string) => {
    let p = byDate.get(d);
    if (!p) {
      p = {
        date: d, impressions: null, pageViews: null, firstTimeDownloads: null,
        conversionRate: null, units: 0, proceedsUsd: null, iapProceedsUsd: null, totalProceedsUsd: null,
        crashes: null, sessions: null, crashRate: null,
        hasAnalytics: false, hasSales: false, downloadsSource: "missing", isPartial: false,
      };
      byDate.set(d, p);
    }
    return p;
  };

  for (const r of salesRows) {
    const p = ensure(r.date);
    p.hasSales = true;
    p.units = r.units;
    p.proceedsUsd = r.proceeds_usd;
    p.iapProceedsUsd = r.iap_proceeds_usd;
  }
  for (const r of analyticsRows) {
    const p = ensure(r.date);
    p.hasAnalytics = true;
    p.impressions = r.impressions;
    p.pageViews = r.page_views;
    p.firstTimeDownloads = r.first_time_downloads;
    p.conversionRate = r.page_views && r.page_views > 0 && r.first_time_downloads !== null
      ? r.first_time_downloads / r.page_views
      : null;
    p.crashes = r.crashes_count > 0 ? r.crashes : null;
    p.sessions = r.sessions_count > 0 ? r.sessions : null;
    p.crashRate = p.sessions && p.sessions > 0 && p.crashes !== null ? p.crashes / p.sessions : null;
    if (p.firstTimeDownloads !== null) p.downloadsSource = "analytics";
  }
  for (const p of byDate.values()) {
    if (p.firstTimeDownloads === null) p.downloadsSource = "missing";
    p.isPartial = p.hasAnalytics !== p.hasSales;
    p.conversionRate = p.pageViews !== null && p.pageViews > 0 && p.firstTimeDownloads !== null
      ? p.firstTimeDownloads / p.pageViews
      : null;
    p.totalProceedsUsd = p.proceedsUsd === null && p.iapProceedsUsd === null
      ? null
      : (p.proceedsUsd ?? 0) + (p.iapProceedsUsd ?? 0);
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** "Today" = most recent date present. Returns one row per app with deltas + sparkline. */
export function ascTodayForApps(ascDb: Database, appStoreIds: string[]): AscTodayRow[] {
  const out: AscTodayRow[] = [];
  for (const id of appStoreIds) {
    const series = ascDailyForApp(ascDb, id, "30d");
    const latestImpressions = [...series].reverse().find((p) => p.impressions !== null);
    const latestSales = [...series].reverse().find((p) => p.hasSales);
    const last = latestSales ?? latestImpressions ?? series[series.length - 1];
    if (!last) {
      out.push({
        appStoreId: id, date: null, impressionsDate: null, downloadsDate: null,
        impressions: 0, downloads: 0, impressionsSource: "missing", downloadsSource: "missing", isPartial: false,
        impressionsDelta7dPct: null, downloadsDelta7dPct: null,
        trendImpressions: [], trendDownloads: [],
        proceeds30d: 0, trendProceeds: [],
      });
      continue;
    }
    const impressionsTargetDate = latestImpressions ? addDays(latestImpressions.date, -7) : null;
    const downloadsTargetDate = latestSales ? addDays(latestSales.date, -7) : null;
    const impressionsSevenAgo = impressionsTargetDate ? series.find((p) => p.date === impressionsTargetDate) : undefined;
    const downloadsSevenAgo = downloadsTargetDate ? series.find((p) => p.date === downloadsTargetDate) : undefined;
    const currentImpressions = latestImpressions?.impressions ?? 0;
    const currentDownloads = latestSales?.units ?? 0;
    const impDelta = impressionsSevenAgo?.impressions && impressionsSevenAgo.impressions > 0
      ? ((currentImpressions - impressionsSevenAgo.impressions) / impressionsSevenAgo.impressions) * 100
      : null;
    const dlDelta = downloadsSevenAgo?.hasSales && downloadsSevenAgo.units > 0
      ? ((currentDownloads - downloadsSevenAgo.units) / downloadsSevenAgo.units) * 100
      : null;
    const trail = series.slice(-14);
    out.push({
      appStoreId: id,
      date: last.date,
      impressionsDate: latestImpressions?.date ?? null,
      downloadsDate: latestSales?.date ?? null,
      impressions: currentImpressions,
      downloads: currentDownloads,
      impressionsSource: latestImpressions ? "analytics" : "missing",
      downloadsSource: latestSales ? "sales" : "missing",
      isPartial: Boolean(last.isPartial || latestImpressions?.isPartial || latestSales?.isPartial),
      impressionsDelta7dPct: impDelta,
      downloadsDelta7dPct: dlDelta,
      trendImpressions: trail.map((p) => p.impressions),
      trendDownloads: trail.map((p) => (p.hasSales ? p.units : null)),
      proceeds30d: series.reduce((sum, p) => sum + (p.totalProceedsUsd ?? 0), 0),
      trendProceeds: trail.map((p) => (p.hasSales ? p.totalProceedsUsd : null)),
    });
  }
  return out;
}

/** KPI strip — totals over the range plus deltas vs the previous range of the same length. */
export function ascKpisForApp(ascDb: Database, appStoreId: string, range: AscRange): AscKpis {
  const days = rangeDays(range);
  const through = latestAscDateForApp(ascDb, appStoreId);
  const fromDate = through ? addDays(through, -(days - 1)) : null;
  const cur = through
    ? bucketTotals(ascDb, appStoreId, fromDate!, through)
    : emptyBucketTotals();
  const prev = through
    ? bucketTotals(ascDb, appStoreId, addDays(through, -(2 * days - 1)), addDays(through, -days))
    : emptyBucketTotals();
  const pct = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : null);

  const curTotalProceeds = cur.proceedsUsd + cur.iapProceedsUsd;
  const prevTotalProceeds = prev.proceedsUsd + prev.iapProceedsUsd;
  const curArpd = cur.units > 0 ? curTotalProceeds / cur.units : null;
  const prevArpd = prev.units > 0 ? prevTotalProceeds / prev.units : null;

  return {
    range,
    fromDate,
    toDate: through,
    latestDate: through,
    isPartial: through ? ascDailyForApp(ascDb, appStoreId, range).some((p) => p.isPartial) : false,
    impressions: { value: cur.impressions, deltaPct: pct(cur.impressions, prev.impressions) },
    pageViews:   { value: cur.pageViews,   deltaPct: pct(cur.pageViews, prev.pageViews) },
    conversionRate: {
      value: cur.pageViews > 0 ? cur.firstTimeDownloads / cur.pageViews : 0,
      deltaPct: pct(
        cur.pageViews > 0 ? cur.firstTimeDownloads / cur.pageViews : 0,
        prev.pageViews > 0 ? prev.firstTimeDownloads / prev.pageViews : 0,
      ),
    },
    firstTimeDownloads: { value: cur.firstTimeDownloads, deltaPct: pct(cur.firstTimeDownloads, prev.firstTimeDownloads) },
    downloads: { value: cur.units, deltaPct: pct(cur.units, prev.units) },
    proceedsUsd: { value: curTotalProceeds, deltaPct: pct(curTotalProceeds, prevTotalProceeds) },
    arpd: { value: curArpd, deltaPct: pct(curArpd ?? 0, prevArpd ?? 0) },
    payingUsers: { value: cur.payingUsers, deltaPct: pct(cur.payingUsers, prev.payingUsers) },
    crashRate:   { value: cur.crashRate,   deltaPct: pct(cur.crashRate ?? 0, prev.crashRate ?? 0) },
  };
}

export interface AscPortfolioKpis {
  impressions: number;
  downloads: number;
  proceedsUsd: number;
  /** Apps with at least one day of data inside the 30d window. */
  appsWithData: number;
  appsTotal: number;
}

/** Portfolio-wide 30d totals — sums ascKpisForApp across every tracked app. */
export function ascPortfolioKpis(ascDb: Database, appStoreIds: string[]): AscPortfolioKpis {
  let impressions = 0;
  let downloads = 0;
  let proceedsUsd = 0;
  let appsWithData = 0;
  for (const id of appStoreIds) {
    const k = ascKpisForApp(ascDb, id, "30d");
    if (k.latestDate !== null) appsWithData++;
    impressions += k.impressions.value;
    downloads += k.downloads.value;
    proceedsUsd += k.proceedsUsd.value;
  }
  return { impressions, downloads, proceedsUsd, appsWithData, appsTotal: appStoreIds.length };
}

/** Proceeds (app + IAP) grouped by territory over the range; top 10 + "Other", revenue-only. */
export function ascRevenueByTerritory(
  ascDb: Database,
  appStoreId: string,
  range: AscRange,
): AscTerritoryRevenue[] {
  const days = rangeDays(range);
  const through = latestAscDateForApp(ascDb, appStoreId);
  if (!through) return [];
  const since = addDays(through, -(days - 1));
  const rows = ascDb.query(
    `SELECT territory, SUM(proceeds_usd + iap_proceeds_usd) AS proceeds
       FROM sales_daily
      WHERE app_store_id = ? AND date BETWEEN ? AND ?
      GROUP BY territory
      HAVING proceeds > 0
      ORDER BY proceeds DESC`,
  ).all(appStoreId, since, through) as Array<{ territory: string; proceeds: number }>;

  const total = rows.reduce((s, r) => s + r.proceeds, 0);
  if (total <= 0) return [];

  const TOP = 10;
  const out: AscTerritoryRevenue[] = rows.slice(0, TOP).map((r) => ({
    territory: r.territory,
    proceedsUsd: r.proceeds,
    sharePct: (r.proceeds / total) * 100,
  }));
  const restSum = rows.slice(TOP).reduce((s, r) => s + r.proceeds, 0);
  if (restSum > 0) {
    out.push({ territory: "Other", proceedsUsd: restSum, sharePct: (restSum / total) * 100 });
  }
  return out;
}

function emptyBucketTotals() {
  return {
    impressions: 0,
    pageViews: 0,
    firstTimeDownloads: 0,
    units: 0,
    proceedsUsd: 0,
    iapProceedsUsd: 0,
    payingUsers: 0,
    crashRate: null as number | null,
  };
}

function bucketTotals(ascDb: Database, appStoreId: string, fromDate: string, toDate: string) {
  const a = ascDb.query(
    `SELECT
       COALESCE(SUM(impressions), 0) AS impressions,
       COALESCE(SUM(product_page_views), 0) AS page_views,
       COALESCE(SUM(first_time_downloads), 0) AS first_time_downloads,
       COALESCE(SUM(crashes), 0) AS crashes,
       COALESCE(SUM(sessions), 0) AS sessions,
       SUM(CASE WHEN crashes IS NULL THEN 0 ELSE 1 END) AS crashes_count,
       SUM(CASE WHEN sessions IS NULL THEN 0 ELSE 1 END) AS sessions_count
     FROM analytics_daily WHERE app_store_id = ? AND date BETWEEN ? AND ?`,
  ).get(appStoreId, fromDate, toDate) as any;
  const s = ascDb.query(
    `SELECT COALESCE(SUM(proceeds_usd), 0) AS proceeds_usd,
            COALESCE(SUM(iap_proceeds_usd), 0) AS iap_proceeds_usd,
            COALESCE(SUM(units), 0) AS units
     FROM sales_daily WHERE app_store_id = ? AND date BETWEEN ? AND ?`,
  ).get(appStoreId, fromDate, toDate) as any;
  const pu = ascDb.query(
    `SELECT COALESCE(SUM(paying_users), 0) AS paying_users
     FROM purchases_daily WHERE app_store_id = ? AND date BETWEEN ? AND ?`,
  ).get(appStoreId, fromDate, toDate) as any;
  const sessions = a.sessions_count > 0 ? a.sessions : null;
  const crashRate = sessions !== null && sessions > 0 ? a.crashes / sessions : null;
  return {
    impressions: a.impressions as number,
    pageViews: a.page_views as number,
    firstTimeDownloads: a.first_time_downloads as number,
    units: s.units as number,
    proceedsUsd: s.proceeds_usd as number,
    iapProceedsUsd: s.iap_proceeds_usd as number,
    payingUsers: pu.paying_users as number,
    crashRate,
  };
}

export function ascSyncStatus(ascDb: Database, lockHeld: boolean): {
  configured: boolean;
  running: boolean;
  currentRunId: number | null;
  lastRun: AscSyncRunRow | null;
} {
  const lastRow = ascDb.query(
    `SELECT id, started_at, finished_at, trigger, status, summary_json, error
     FROM sync_runs ORDER BY id DESC LIMIT 1`,
  ).get() as any;
  const lastRun: AscSyncRunRow | null = lastRow ? {
    id: lastRow.id,
    startedAt: lastRow.started_at,
    finishedAt: lastRow.finished_at,
    trigger: lastRow.trigger,
    status: lastRow.status,
    summaryJson: lastRow.summary_json,
    error: lastRow.error,
  } : null;
  let running = false;
  let currentRunId: number | null = null;
  if (lockHeld && lastRun?.status === "running") {
    running = true;
    currentRunId = lastRun.id;
  }
  return { configured: true, running, currentRunId, lastRun };
}

export function ascCoverage(ascDb: Database): AscCoverage {
  const sales = ascDb.query("SELECT MAX(date) AS d, COUNT(DISTINCT date) AS n FROM sales_daily").get() as any;
  const analytics = ascDb.query("SELECT MAX(date) AS d, COUNT(DISTINCT date) AS n FROM analytics_daily").get() as any;
  return {
    salesLastDate: sales?.d ?? null,
    analyticsLastDate: analytics?.d ?? null,
    salesBackfillPct: Math.min(1, (sales?.n ?? 0) / 365),
    analyticsBackfillPct: Math.min(1, (analytics?.n ?? 0) / 365),
  };
}

export function ascDiagnosticsForApps(
  ascDb: Database,
  apps: Array<{ appStoreId: string; name: string | null }>,
): AscAppDiagnostics[] {
  const today = toIsoDate(Date.now());
  return apps.map((app) => {
    const salesRows = ascDb.query(
      `SELECT date FROM sales_daily WHERE app_store_id = ? ORDER BY date DESC LIMIT 30`,
    ).all(app.appStoreId) as Array<{ date: string }>;
    const analyticsRows = ascDb.query(
      `SELECT date FROM analytics_daily WHERE app_store_id = ? ORDER BY date DESC LIMIT 30`,
    ).all(app.appStoreId) as Array<{ date: string }>;
    const salesLastDate = salesRows[0]?.date ?? null;
    const analyticsLastDate = analyticsRows[0]?.date ?? null;
    const through = [salesLastDate, analyticsLastDate].filter(Boolean).sort().at(-1) ?? today;
    const days = windowDays(through, 7);
    const salesSet = new Set(salesRows.map((r) => r.date));
    const analyticsSet = new Set(analyticsRows.map((r) => r.date));

    let salesNoActivityLast7d = 0;
    let salesPendingLast7d = 0;
    for (const d of days) {
      if (salesSet.has(d)) continue;
      if (analyticsSet.has(d)) salesNoActivityLast7d++;
      else salesPendingLast7d++;
    }

    const latest = latestAscDateForApp(ascDb, app.appStoreId);
    const ageDays = latest
      ? (new Date(`${today}T00:00:00Z`).getTime() - new Date(`${latest}T00:00:00Z`).getTime()) / DAY_MS
      : Infinity;
    const engRow = ascDb.query(
      `SELECT 1 FROM analytics_daily
        WHERE app_store_id = ?
          AND (sessions IS NOT NULL OR active_devices IS NOT NULL OR crashes IS NOT NULL)
        LIMIT 1`,
    ).get(app.appStoreId);
    const since30 = addDays(through, -29);
    const purch = ascDb.query(
      `SELECT COALESCE(SUM(paying_users),0) AS pu, COALESCE(SUM(proceeds_usd),0) AS pp
       FROM purchases_daily WHERE app_store_id = ? AND date BETWEEN ? AND ?`,
    ).get(app.appStoreId, since30, through) as any;
    const salesProc = ascDb.query(
      `SELECT COALESCE(SUM(proceeds_usd + iap_proceeds_usd),0) AS sp
       FROM sales_daily WHERE app_store_id = ? AND date BETWEEN ? AND ?`,
    ).get(app.appStoreId, since30, through) as any;
    return {
      appStoreId: app.appStoreId,
      name: app.name,
      salesLastDate,
      analyticsLastDate,
      salesNoActivityLast7d,
      salesPendingLast7d,
      missingAnalyticsLast7d: countMissingDays(days, analyticsSet),
      engagementMetricsAvailable: Boolean(engRow),
      payingUsers30d: purch.pu as number,
      salesProceedsUsd30d: salesProc.sp as number,
      purchasesProceedsUsd30d: purch.pp as number,
      isStale: ageDays > 3,
    };
  });
}

/** Healing helper: if last run is 'running' but the lock is dead, mark it failed. */
export function reapStaleRunningRow(ascDb: Database, lockHeld: boolean): void {
  if (lockHeld) return;
  const last = ascDb.query("SELECT id, status FROM sync_runs ORDER BY id DESC LIMIT 1").get() as
    | { id: number; status: string }
    | null;
  if (!last || last.status !== "running") return;
  ascDb.run(
    `UPDATE sync_runs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?`,
    ["process disappeared", new Date().toISOString(), last.id],
  );
}

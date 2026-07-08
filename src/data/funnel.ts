import type { Database } from "bun:sqlite";

export interface FunnelDayRow {
  date: string;
  impressions: number | null;
  productPageViews: number | null;
  firstTimeDownloads: number | null;
  sessions: number | null;
  dau: number | null;
}

export interface FunnelTotals {
  impressions: number;
  productPageViews: number;
  firstTimeDownloads: number;
  sessions: number;
  /** Sum of daily DAU values isn't equal to MAU — expose the latest DAU instead. */
  latestDau: number | null;
}

interface FunnelRawRow {
  date: string;
  impressions: number | null;
  product_page_views: number | null;
  first_time_downloads: number | null;
  sessions: number | null;
  dau: number | null;
}

/**
 * The caller MUST have attached asc.db AS asc before calling this.
 * Returns daily rows for the given window for one ASC app, joined with the TD app
 * mapped to it (if any).
 */
export function listFunnelByAppStore(
  tdDb: Database,
  appStoreId: string,
  days: number,
  refDate = "now",
): FunnelDayRow[] {
  const offset = -(days - 1);
  const stmt = tdDb.prepare<FunnelRawRow, (string | number)[]>(
    `WITH dates AS (
       SELECT date FROM (
         SELECT date(date) AS date FROM asc.analytics_daily
         WHERE app_store_id = ? AND date >= date(?, ? || ' days')
         UNION
         SELECT date FROM td_daily_engagement
         WHERE td_app_id = (SELECT td_app_id FROM td_apps WHERE asc_app_store_id = ?)
           AND date >= date(?, ? || ' days')
       )
     )
     SELECT
       d.date,
       (SELECT SUM(impressions)          FROM asc.analytics_daily a WHERE a.app_store_id = ? AND a.date = d.date) AS impressions,
       (SELECT SUM(product_page_views)   FROM asc.analytics_daily a WHERE a.app_store_id = ? AND a.date = d.date) AS product_page_views,
       (SELECT SUM(first_time_downloads) FROM asc.analytics_daily a WHERE a.app_store_id = ? AND a.date = d.date) AS first_time_downloads,
       e.sessions, e.dau
     FROM dates d
     LEFT JOIN td_apps t ON t.asc_app_store_id = ?
     LEFT JOIN td_daily_engagement e ON e.td_app_id = t.td_app_id AND e.date = d.date
     ORDER BY d.date ASC`,
  );
  return stmt
    .all(
      appStoreId, refDate, offset, appStoreId, refDate, offset,
      appStoreId, appStoreId, appStoreId, appStoreId,
    )
    .map((r) => ({
      date: r.date,
      impressions: r.impressions,
      productPageViews: r.product_page_views,
      firstTimeDownloads: r.first_time_downloads,
      sessions: r.sessions,
      dau: r.dau,
    }));
}

export function getFunnelTotals(
  tdDb: Database,
  appStoreId: string,
  days: number,
  refDate = "now",
): FunnelTotals {
  const rows = listFunnelByAppStore(tdDb, appStoreId, days, refDate);
  let impressions = 0;
  let productPageViews = 0;
  let firstTimeDownloads = 0;
  let sessions = 0;
  let latestDau: number | null = null;
  for (const r of rows) {
    impressions += r.impressions ?? 0;
    productPageViews += r.productPageViews ?? 0;
    firstTimeDownloads += r.firstTimeDownloads ?? 0;
    sessions += r.sessions ?? 0;
    if (r.dau != null) latestDau = r.dau;
  }
  return { impressions, productPageViews, firstTimeDownloads, sessions, latestDau };
}

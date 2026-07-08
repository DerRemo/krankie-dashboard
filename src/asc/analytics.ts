import type { Database } from "bun:sqlite";
import type { AscClient } from "./client";
import type { AccessType, AnalyticsCategory, AnalyticsRow, PurchaseRow, ReportRequest } from "./types";
import { parseAnalyticsCsv } from "./analytics-parser";
import { parsePurchasesCsv } from "./purchases-parser";
import { logger } from "../logger";

const ANALYTICS_SEGMENT_PARSER_VERSION = "v4";

export const RELEVANT_CATEGORIES: AnalyticsCategory[] = [
  "APP_STORE_ENGAGEMENT",
  "APP_STORE_COMMERCE",
  "COMMERCE",
  "APP_USAGE",
];

interface ReportListItem {
  id: string;
  category: AnalyticsCategory;
  rawCategory: string;
  name: string;
}
interface InstanceListItem {
  id: string;
  granularity: string;
  processingDate: string;
}

export interface SyncAnalyticsOpts {
  /** Reserved for future sync tuning. Snapshot requests are always ensured per app. */
  firstRun?: boolean;
}

export async function syncAnalytics(
  ascDb: Database,
  client: AscClient,
  appleIds: string[],
  opts: SyncAnalyticsOpts = {},
): Promise<{
  rowsUpserted: number;
  purchasesRows: number;
  segmentsFetched: number;
  queuedSegments: number;
  errors: number;
  categoryCounts: Partial<Record<AnalyticsCategory, number>>;
  reportCategoryCounts: Partial<Record<AnalyticsCategory, number>>;
  dailyInstanceCategoryCounts: Partial<Record<AnalyticsCategory, number>>;
  segmentCategoryCounts: Partial<Record<AnalyticsCategory, number>>;
  fetchedSegmentCategoryCounts: Partial<Record<AnalyticsCategory, number>>;
  reportSamples: string[];
  errorSamples: string[];
}> {
  let rowsUpserted = 0;
  let purchasesRows = 0;
  let segmentsFetched = 0;
  let queuedSegments = 0;
  let errors = 0;
  const reportSamples: string[] = [];
  const errorSamples: string[] = [];
  const categoryCounts: Partial<Record<AnalyticsCategory, number>> = {};
  const reportCategoryCounts: Partial<Record<AnalyticsCategory, number>> = {};
  const dailyInstanceCategoryCounts: Partial<Record<AnalyticsCategory, number>> = {};
  const segmentCategoryCounts: Partial<Record<AnalyticsCategory, number>> = {};
  const fetchedSegmentCategoryCounts: Partial<Record<AnalyticsCategory, number>> = {};

  for (const appleId of appleIds) {
    try {
      await ensureReportRequest(ascDb, client, appleId, "ONGOING");
      await ensureReportRequest(ascDb, client, appleId, "ONE_TIME_SNAPSHOT");
    } catch (err) {
      errors++;
      pushErrorSample(errorSamples, `bootstrap ${appleId}: ${formatError(err)}`);
      logger.error(
        { phase: "analytics", appleId, err: String(err) },
        "report request bootstrap failed",
      );
    }
  }

  const requests = listPersistedRequests(ascDb);
  for (const req of requests) {
    let reports: ReportListItem[];
    try {
      reports = await listReports(client, req.requestId);
    } catch (err) {
      errors++;
      pushErrorSample(errorSamples, `reports ${req.requestId}: ${formatError(err)}`);
      logger.error({ phase: "analytics", requestId: req.requestId, err: String(err) }, "listReports failed");
      continue;
    }

    for (const report of reports) {
      reportCategoryCounts[report.category] = (reportCategoryCounts[report.category] ?? 0) + 1;
      pushSample(reportSamples, `${report.category}: ${report.name}`);
      if (!RELEVANT_CATEGORIES.includes(report.category)) continue;
      let instances: InstanceListItem[];
      try {
        instances = await listInstances(client, report.id);
      } catch (err) {
        errors++;
        pushErrorSample(errorSamples, `${report.category} instances ${report.name}: ${formatError(err)}`);
        logger.error({ phase: "analytics", reportId: report.id, err: String(err) }, "listInstances failed");
        continue;
      }
      for (const inst of instances) {
        if (inst.granularity !== "DAILY") continue;
        dailyInstanceCategoryCounts[report.category] = (dailyInstanceCategoryCounts[report.category] ?? 0) + 1;
        let segUrls: string[];
        try {
          segUrls = await listSegments(client, inst.id);
        } catch (err) {
          errors++;
          pushErrorSample(errorSamples, `${report.category} segments ${report.name}: ${formatError(err)}`);
          logger.error({ phase: "analytics", instanceId: inst.id, err: String(err) }, "listSegments failed");
          continue;
        }
        if (segUrls.length === 0) {
          queuedSegments++;
          continue;
        }
        segmentCategoryCounts[report.category] = (segmentCategoryCounts[report.category] ?? 0) + segUrls.length;
        for (const url of segUrls) {
          const hash = await sha256Hex(`${ANALYTICS_SEGMENT_PARSER_VERSION}:${url}`);
          if (segmentSeen(ascDb, hash)) continue;
          try {
            const csv = await client.getGzippedUrl(url);
            if (isPurchasesReport(report.name)) {
              const prows = parsePurchasesCsv(csv);
              upsertPurchases(ascDb, prows);
              purchasesRows += prows.length;
            } else {
              const rows = parseAnalyticsCsv(csv, report.category);
              upsertAnalytics(ascDb, rows);
              rowsUpserted += rows.length;
              categoryCounts[report.category] = (categoryCounts[report.category] ?? 0) + rows.length;
            }
            markSegmentSeen(ascDb, hash, req.id, report.category, inst);
            segmentsFetched++;
            fetchedSegmentCategoryCounts[report.category] = (fetchedSegmentCategoryCounts[report.category] ?? 0) + 1;
          } catch (err) {
            errors++;
            pushErrorSample(errorSamples, `${report.category} parse ${report.name}: ${formatError(err)}`);
            logger.error({ phase: "analytics", url, err: String(err) }, "segment fetch/parse failed");
          }
        }
      }
    }
  }

  return {
    rowsUpserted,
    purchasesRows,
    segmentsFetched,
    queuedSegments,
    errors,
    categoryCounts,
    reportCategoryCounts,
    dailyInstanceCategoryCounts,
    segmentCategoryCounts,
    fetchedSegmentCategoryCounts,
    reportSamples,
    errorSamples,
  };
}

export async function ensureReportRequest(
  ascDb: Database,
  client: AscClient,
  appleId: string,
  accessType: AccessType,
): Promise<ReportRequest> {
  const existing = ascDb
    .query(
      `SELECT id, apple_id, access_type, request_id, created_at FROM asc_report_requests
       WHERE apple_id = ? AND access_type = ?`,
    )
    .get(appleId, accessType) as
    | { id: number; apple_id: string; access_type: AccessType; request_id: string; created_at: string }
    | null;
  if (existing) {
    return {
      id: existing.id,
      appleId: existing.apple_id,
      accessType: existing.access_type,
      requestId: existing.request_id,
      createdAt: existing.created_at,
    };
  }
  const res = await client.postJson<{ data: { id: string } }>(
    "/v1/analyticsReportRequests",
    {
      data: {
        type: "analyticsReportRequests",
        attributes: { accessType },
        relationships: { app: { data: { type: "apps", id: appleId } } },
      },
    },
  );
  const requestId = res.data.id;
  const createdAt = new Date().toISOString();
  const r = ascDb.run(
    `INSERT INTO asc_report_requests (apple_id, access_type, request_id, created_at) VALUES (?, ?, ?, ?)`,
    [appleId, accessType, requestId, createdAt],
  );
  return { id: Number(r.lastInsertRowid), appleId, accessType, requestId, createdAt };
}

export function listPersistedRequests(ascDb: Database): ReportRequest[] {
  const rows = ascDb
    .query(`SELECT id, apple_id, access_type, request_id, created_at FROM asc_report_requests`)
    .all() as Array<{ id: number; apple_id: string; access_type: AccessType; request_id: string; created_at: string }>;
  return rows.map((r) => ({
    id: r.id,
    appleId: r.apple_id,
    accessType: r.access_type,
    requestId: r.request_id,
    createdAt: r.created_at,
  }));
}

async function listReports(client: AscClient, requestId: string): Promise<ReportListItem[]> {
  const res = await client.getJson<{
    data: Array<{ id: string; attributes: { category: string; name: string } }>;
  }>(`/v1/analyticsReportRequests/${requestId}/reports`, { limit: "200" });
  return res.data.flatMap((d) => {
    const category = normalizeReportCategory(d.attributes.category, d.attributes.name);
    if (!category) return [];
    return [{
      id: d.id,
      category,
      rawCategory: d.attributes.category,
      name: d.attributes.name,
    }];
  });
}

function normalizeReportCategory(rawCategory: string, name: string): AnalyticsCategory | null {
  if (isKnownCategory(rawCategory)) return rawCategory;

  const n = name.trim().toLowerCase();
  if (n.includes("discovery") && n.includes("engagement")) return "APP_STORE_ENGAGEMENT";
  if (n.includes("web preview")) return "APP_STORE_ENGAGEMENT";
  if (n.includes("download") || n.includes("commerce") || n.includes("purchase")) return "COMMERCE";
  if (n.includes("usage") || n.includes("session") || n.includes("crash") || n.includes("installation")) return "APP_USAGE";
  if (n.includes("performance")) return "PERFORMANCE";
  if (n.includes("framework")) return "FRAMEWORKS_USAGE";
  return null;
}

function isKnownCategory(value: string): value is AnalyticsCategory {
  return (
    value === "APP_STORE_ENGAGEMENT" ||
    value === "APP_STORE_COMMERCE" ||
    value === "APP_USAGE" ||
    value === "FRAMEWORKS_USAGE" ||
    value === "COMMERCE" ||
    value === "PERFORMANCE"
  );
}

async function listInstances(client: AscClient, reportId: string): Promise<InstanceListItem[]> {
  const res = await client.getJson<{
    data: Array<{ id: string; attributes: { granularity: string; processingDate: string } }>;
  }>(`/v1/analyticsReports/${reportId}/instances`, {
    "filter[granularity]": "DAILY",
    limit: "200",
  });
  return res.data.map((d) => ({
    id: d.id,
    granularity: d.attributes.granularity,
    processingDate: d.attributes.processingDate,
  }));
}

async function listSegments(client: AscClient, instanceId: string): Promise<string[]> {
  const res = await client.getJson<{
    data: Array<{ attributes: { url: string } }>;
  }>(`/v1/analyticsReportInstances/${instanceId}/segments`);
  return res.data.map((d) => d.attributes.url);
}

export function segmentSeen(ascDb: Database, hash: string): boolean {
  const row = ascDb
    .query(`SELECT 1 FROM asc_report_segments_seen WHERE segment_url_hash = ?`)
    .get(hash);
  return Boolean(row);
}

export function markSegmentSeen(
  ascDb: Database,
  hash: string,
  requestIdFk: number,
  category: AnalyticsCategory,
  inst: { granularity: string; processingDate: string },
): void {
  ascDb.run(
    `INSERT INTO asc_report_segments_seen
       (segment_url_hash, request_id_fk, category, granularity, processing_date, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [hash, requestIdFk, category, inst.granularity, inst.processingDate, new Date().toISOString()],
  );
}

export function isPurchasesReport(name: string): boolean {
  return /app store purchases/i.test(name);
}

export function upsertPurchases(ascDb: Database, rows: PurchaseRow[]): void {
  if (rows.length === 0) return;
  const stmt = ascDb.prepare(`
    INSERT INTO purchases_daily (app_store_id, date, territory, purchases, proceeds_usd, sales_usd, paying_users)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(app_store_id, date, territory) DO UPDATE SET
      purchases = excluded.purchases, proceeds_usd = excluded.proceeds_usd,
      sales_usd = excluded.sales_usd, paying_users = excluded.paying_users
  `);
  ascDb.transaction(() => {
    for (const r of rows) {
      stmt.run(r.appStoreId, r.date, r.territory, r.purchases, r.proceedsUsd, r.salesUsd, r.payingUsers);
    }
  })();
}

export function upsertAnalytics(ascDb: Database, rows: AnalyticsRow[]): void {
  if (rows.length === 0) return;
  const stmt = ascDb.prepare(`
    INSERT INTO analytics_daily
      (app_store_id, date, territory, impressions, product_page_views, first_time_downloads, sessions, active_devices, crashes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(app_store_id, date, territory) DO UPDATE SET
      impressions = COALESCE(excluded.impressions, analytics_daily.impressions),
      product_page_views = COALESCE(excluded.product_page_views, analytics_daily.product_page_views),
      first_time_downloads = COALESCE(excluded.first_time_downloads, analytics_daily.first_time_downloads),
      sessions = COALESCE(excluded.sessions, analytics_daily.sessions),
      active_devices = COALESCE(excluded.active_devices, analytics_daily.active_devices),
      crashes = COALESCE(excluded.crashes, analytics_daily.crashes)
  `);
  ascDb.transaction(() => {
    for (const r of rows) {
      stmt.run(
        r.appStoreId, r.date, r.territory,
        r.impressions ?? null, r.productPageViews ?? null, r.firstTimeDownloads ?? null,
        r.sessions ?? null, r.activeDevices ?? null, r.crashes ?? null,
      );
    }
  })();
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function pushSample(samples: string[], message: string): void {
  if (samples.length >= 5) return;
  samples.push(message.slice(0, 500));
}

function pushErrorSample(samples: string[], message: string): void {
  pushSample(samples, message);
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

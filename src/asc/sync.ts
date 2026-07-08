import type { Database } from "bun:sqlite";
import type { AscClient } from "./client";
import type { SyncStatus, SyncSummary, SyncTrigger } from "./types";
import { listKrankieApps, ensureAscApps } from "./apps";
import { syncSales } from "./sales";
import { syncAnalytics } from "./analytics";
import { syncReviews, type ReviewsCli } from "./reviews-sync";
import { logger } from "../logger";

export interface RunOpts {
  ascDb: Database;
  krankieDb: Database;
  client: AscClient;
  vendorNumber: string;
  trigger: SyncTrigger;
  /** When provided, this row is updated rather than inserted. */
  runId?: number;
  /** Test seam: today override. */
  today?: Date;
  /** When provided, runs the reviews/ratings ingestion phase via the asc CLI. */
  cli?: ReviewsCli;
}

export async function runSync(opts: RunOpts): Promise<{ runId: number; status: SyncStatus }> {
  const startedAt = new Date().toISOString();
  const runId = opts.runId ?? insertRunningRow(opts.ascDb, opts.trigger, startedAt);

  const krankieApps = listKrankieApps(opts.krankieDb);
  const summary: SyncSummary = {
    apps: 0, salesRows: 0, salesDaysFetched: 0,
    analyticsRows: 0, analyticsCategoryCounts: {},
    queuedSegments: 0, errors: 0,
  };
  let status: SyncStatus = "success";

  try {
    if (krankieApps.length === 0) {
      finishRun(opts.ascDb, runId, "success", summary, null);
      logger.info({ phase: "orchestrator", runId, apps: 0 }, "no krankie apps tracked; sync no-op");
      return { runId, status: "success" };
    }

    const ascApps = await ensureAscApps(opts.ascDb, opts.client, krankieApps);
    summary.apps = ascApps.length;
    const appStoreIds = ascApps.map((a) => a.appStoreId);
    const appleIds = ascApps.map((a) => a.appleId);

    const firstRun = (opts.ascDb.query("SELECT COUNT(*) AS c FROM asc_report_requests").get() as { c: number }).c === 0;

    const [salesRes, analyticsRes] = await Promise.allSettled([
      syncSales(opts.ascDb, opts.client, appStoreIds, {
        vendorNumber: opts.vendorNumber,
        today: opts.today,
      }),
      syncAnalytics(opts.ascDb, opts.client, appleIds, { firstRun }),
    ]);

    if (salesRes.status === "fulfilled") {
      summary.salesRows = salesRes.value.rowsUpserted;
      summary.salesDaysFetched = salesRes.value.daysFetched;
      summary.errors += salesRes.value.errors;
    } else {
      status = "partial";
      summary.errors += 1;
      logger.error({ phase: "sales", err: String(salesRes.reason) }, "sales sync rejected");
    }
    if (analyticsRes.status === "fulfilled") {
      summary.analyticsRows = analyticsRes.value.rowsUpserted;
      summary.purchasesRows = analyticsRes.value.purchasesRows;
      summary.analyticsCategoryCounts = analyticsRes.value.categoryCounts;
      summary.analyticsReportCategoryCounts = analyticsRes.value.reportCategoryCounts;
      summary.analyticsDailyInstanceCategoryCounts = analyticsRes.value.dailyInstanceCategoryCounts;
      summary.analyticsSegmentCategoryCounts = analyticsRes.value.segmentCategoryCounts;
      summary.analyticsFetchedSegmentCategoryCounts = analyticsRes.value.fetchedSegmentCategoryCounts;
      if (analyticsRes.value.reportSamples.length > 0) {
        summary.analyticsReportSamples = analyticsRes.value.reportSamples;
      }
      if (analyticsRes.value.errorSamples.length > 0) {
        summary.analyticsErrorSamples = analyticsRes.value.errorSamples;
      }
      summary.queuedSegments = analyticsRes.value.queuedSegments;
      summary.errors += analyticsRes.value.errors;
    } else {
      status = status === "success" ? "partial" : "failed";
      summary.errors += 1;
      logger.error({ phase: "analytics", err: String(analyticsRes.reason) }, "analytics sync rejected");
    }
    if (salesRes.status === "rejected" && analyticsRes.status === "rejected") {
      status = "failed";
    }

    if (opts.cli) {
      try {
        const today = (opts.today ?? new Date()).toISOString().slice(0, 10);
        const rev = await syncReviews(opts.ascDb, opts.cli, ascApps, today);
        summary.reviewRows = rev.reviewRows;
        summary.ratingSnapshotRows = rev.ratingSnapshotRows;
        summary.summarizationRows = rev.summarizationRows;
        summary.errors += rev.errors;
      } catch (err) {
        summary.errors += 1;
        logger.error({ phase: "reviews", err: String(err) }, "reviews phase rejected");
      }
    }

    if (summary.errors > 0 && status === "success") status = "partial";

    finishRun(opts.ascDb, runId, status, summary, null);
    if (status === "success") {
      opts.ascDb.run(
        `INSERT OR REPLACE INTO asc_meta (key, value) VALUES ('last_successful_sync_at', ?)`,
        [new Date().toISOString()],
      );
    }
    logger.info({ phase: "orchestrator", runId, status, summary }, "sync finished");
    return { runId, status };
  } catch (err) {
    finishRun(opts.ascDb, runId, "failed", summary, String(err));
    logger.error({ phase: "orchestrator", runId, err: String(err) }, "sync failed");
    return { runId, status: "failed" };
  }
}

export function insertRunningRow(ascDb: Database, trigger: SyncTrigger, startedAt: string): number {
  const r = ascDb.run(
    `INSERT INTO sync_runs (started_at, trigger, status) VALUES (?, ?, 'running')`,
    [startedAt, trigger],
  );
  return Number(r.lastInsertRowid);
}

function finishRun(
  ascDb: Database,
  runId: number,
  status: SyncStatus,
  summary: SyncSummary,
  error: string | null,
): void {
  ascDb.run(
    `UPDATE sync_runs SET finished_at = ?, status = ?, summary_json = ?, error = ? WHERE id = ?`,
    [new Date().toISOString(), status, JSON.stringify(summary), error, runId],
  );
}

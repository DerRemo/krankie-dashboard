import type { Database } from "bun:sqlite";
import type { TdClient } from "./client";
import type { TdSyncTrigger, TdSyncStatus, TdSyncSummary } from "./types";
import { syncTdApps, discoverBundles, applyMapping, listTdApps } from "./apps";
import { syncEngagement } from "./engagement";
import { syncCustomEvents } from "./custom-events";
import { syncBreakdowns } from "./breakdowns";
import { logger } from "../logger";

export interface RunTdSyncOpts {
  tdDb: Database;
  ascDb: Database;
  client: TdClient;
  trigger: TdSyncTrigger;
  runId?: number;
  today?: Date;
}

export async function runTdSync(opts: RunTdSyncOpts): Promise<{ runId: number; status: TdSyncStatus }> {
  const startedAt = new Date().toISOString();
  const runId = opts.runId ?? insertRunningRow(opts.tdDb, opts.trigger, startedAt);

  const summary: TdSyncSummary = {
    apps: 0,
    bundlesDiscovered: 0,
    unmatched: 0,
    engagementRows: 0,
    customEventTypes: 0,
    customEventRows: 0,
    breakdownRows: 0,
    mauRows: 0,
    errors: 0,
  };
  let status: TdSyncStatus = "success";

  try {
    // 1. Apps + bundle discovery + mapping (sequential — later concerns need td_apps fresh)
    const apps = await syncTdApps(opts.tdDb, opts.client, opts.today ?? new Date());
    summary.apps = apps.length;

    const bundle = await discoverBundles(opts.tdDb, opts.client, apps, opts.today ?? new Date());
    summary.bundlesDiscovered = bundle.discovered;
    summary.errors += bundle.errors;

    const map = applyMapping(opts.tdDb, opts.ascDb);
    summary.unmatched = map.unmatched;

    // Read back from local DB (no extra network call) for concerns that follow.
    const appsAfterMapping = listTdApps(opts.tdDb);

    // 2. Concerns run in parallel; one failure does not abort the others
    const [eng, evt, brk] = await Promise.allSettled([
      syncEngagement(opts.tdDb, opts.client, appsAfterMapping, { today: opts.today }),
      syncCustomEvents(opts.tdDb, opts.client, appsAfterMapping, { today: opts.today }),
      syncBreakdowns(opts.tdDb, opts.client, appsAfterMapping, { today: opts.today }),
    ]);
    if (eng.status === "fulfilled") {
      summary.engagementRows = eng.value.engagementRows;
      summary.mauRows = eng.value.mauRows;
      summary.errors += eng.value.errors;
    } else {
      status = "partial";
      summary.errors += 1;
      logger.error({ phase: "td-engagement", err: String(eng.reason) }, "engagement concern rejected");
    }
    if (evt.status === "fulfilled") {
      summary.customEventTypes = evt.value.customEventTypes;
      summary.customEventRows = evt.value.customEventRows;
      summary.errors += evt.value.errors;
    } else {
      status = "partial";
      summary.errors += 1;
      logger.error({ phase: "td-events", err: String(evt.reason) }, "custom events concern rejected");
    }
    if (brk.status === "fulfilled") {
      summary.breakdownRows = brk.value.breakdownRows;
      summary.errors += brk.value.errors;
    } else {
      status = "partial";
      summary.errors += 1;
      logger.error({ phase: "td-breakdowns", err: String(brk.reason) }, "breakdowns concern rejected");
    }
    if ([eng, evt, brk].every((r) => r.status === "rejected")) status = "error";
    if (summary.errors > 0 && status === "success") status = "partial";

    finishRun(opts.tdDb, runId, status, summary, null);
    logger.info({ phase: "td-orchestrator", runId, status, summary }, "td sync finished");
    return { runId, status };
  } catch (err) {
    finishRun(opts.tdDb, runId, "error", summary, String(err));
    logger.error({ phase: "td-orchestrator", runId, err: String(err) }, "td sync errored");
    return { runId, status: "error" };
  }
}

export function insertRunningRow(tdDb: Database, trigger: TdSyncTrigger, startedAt: string): number {
  const r = tdDb.run(
    `INSERT INTO td_sync_runs (trigger, started_at, status) VALUES (?, ?, 'running')`,
    [trigger, startedAt],
  );
  return Number(r.lastInsertRowid);
}

function finishRun(
  tdDb: Database,
  runId: number,
  status: TdSyncStatus,
  summary: TdSyncSummary,
  errorMessage: string | null,
): void {
  tdDb.run(
    `UPDATE td_sync_runs SET finished_at = ?, status = ?, summary_json = ?, error_message = ? WHERE id = ?`,
    [new Date().toISOString(), status, JSON.stringify(summary), errorMessage, runId],
  );
}

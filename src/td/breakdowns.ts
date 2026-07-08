import type { Database } from "bun:sqlite";
import type { TdClient } from "./client";
import type { TdApp } from "./types";
import { buildBreakdownQuery, trailingInterval } from "./query-builder";
import { logger } from "../logger";

const DIMENSIONS = ["appVersion", "systemVersion", "modelName"] as const;
type Dimension = (typeof DIMENSIONS)[number];

export interface SyncBreakdownsResult {
  breakdownRows: number;
  errors: number;
}

export interface SyncBreakdownsOpts {
  trailingDays?: number; // default 7
  backfillDays?: number; // default 30 — breakdowns don't need 90d
  topN?: number;         // per dimension, default 20
  today?: Date;
}

export async function syncBreakdowns(
  tdDb: Database,
  client: TdClient,
  apps: TdApp[],
  opts: SyncBreakdownsOpts = {},
): Promise<SyncBreakdownsResult> {
  const today = opts.today ?? new Date();
  const trailing = opts.trailingDays ?? 7;
  const backfill = opts.backfillDays ?? 30;
  const topN = opts.topN ?? 20;

  let breakdownRows = 0;
  let errors = 0;

  for (const a of apps) {
    for (const dim of DIMENSIONS) {
      const hasHistory = (tdDb
        .query(
          "SELECT COUNT(*) AS c FROM td_breakdowns WHERE td_app_id = ? AND dimension = ?",
        )
        .get(a.tdAppId, dim) as { c: number }).c > 0;
      const days = hasHistory ? trailing : backfill;
      const interval = trailingInterval(days, today);
      try {
        const rows = await client.postJson<
          Array<{
            timestamp: string;
            event: Record<string, unknown>;
          }>
        >("/v2/query/", buildBreakdownQuery(a.tdAppId, dim, interval, topN));
        breakdownRows += upsertBreakdown(tdDb, a.tdAppId, dim, rows, today);
      } catch (err) {
        errors += 1;
        logger.warn(
          { phase: "td-breakdowns", tdAppId: a.tdAppId, dimension: dim, err: String(err) },
          "breakdown query failed",
        );
      }
    }
  }
  return { breakdownRows, errors };
}

function upsertBreakdown(
  tdDb: Database,
  tdAppId: string,
  dim: Dimension,
  rows: Array<{ timestamp: string; event: Record<string, unknown> }>,
  now: Date,
): number {
  const stmt = tdDb.prepare(
    `INSERT INTO td_breakdowns (td_app_id, date, dimension, value, users, sessions, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(td_app_id, date, dimension, value) DO UPDATE SET
       users = excluded.users,
       sessions = excluded.sessions,
       fetched_at = excluded.fetched_at`,
  );
  const fetchedAt = now.toISOString();
  let count = 0;
  for (const r of rows) {
    const date = r.timestamp.slice(0, 10);
    const value = String(r.event[dim] ?? "");
    if (!value) continue;
    const users = Number(r.event.users ?? 0);
    const sessions = Number(r.event.sessions ?? 0);
    stmt.run(tdAppId, date, dim, value, users, sessions, fetchedAt);
    count += 1;
  }
  return count;
}

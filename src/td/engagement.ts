import type { Database } from "bun:sqlite";
import type { TdClient } from "./client";
import type { TdApp } from "./types";
import {
  buildEngagementQuery,
  buildMauQuery,
  trailingInterval,
} from "./query-builder";
import { logger } from "../logger";

export interface SyncEngagementResult {
  engagementRows: number;
  mauRows: number;
  errors: number;
}

export interface SyncEngagementOpts {
  /** How many trailing days of engagement to fetch on every run. Default 7. */
  trailingDays?: number;
  /** Backfill on first run for an app (no rows seen). Default 90. */
  backfillDays?: number;
  today?: Date;
}

export async function syncEngagement(
  tdDb: Database,
  client: TdClient,
  apps: TdApp[],
  opts: SyncEngagementOpts = {},
): Promise<SyncEngagementResult> {
  const today = opts.today ?? new Date();
  const trailing = opts.trailingDays ?? 7;
  const backfill = opts.backfillDays ?? 90;

  let engagementRows = 0;
  let mauRows = 0;
  let errors = 0;
  for (const a of apps) {
    try {
      const hasHistory = (tdDb
        .query("SELECT COUNT(*) AS c FROM td_daily_engagement WHERE td_app_id = ?")
        .get(a.tdAppId) as { c: number }).c > 0;
      const days = hasHistory ? trailing : backfill;
      const interval = trailingInterval(days, today);
      const q = buildEngagementQuery(a.tdAppId, interval);
      const rows = await client.postJson<EngagementRow[]>("/v2/query/", q);
      engagementRows += upsertEngagement(tdDb, a.tdAppId, rows, today);
    } catch (err) {
      errors += 1;
      logger.warn(
        { phase: "td-engagement", tdAppId: a.tdAppId, err: String(err) },
        "engagement query failed",
      );
    }
    try {
      const asOf = today.toISOString().slice(0, 10);
      const q = buildMauQuery(a.tdAppId, asOf);
      const rows = await client.postJson<MauRow[]>("/v2/query/", q);
      const mau = rows[0]?.result?.mau;
      if (typeof mau === "number") {
        tdDb.run(
          `INSERT INTO td_mau_cache (td_app_id, as_of_date, mau, fetched_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(td_app_id, as_of_date) DO UPDATE SET mau = excluded.mau, fetched_at = excluded.fetched_at`,
          [a.tdAppId, asOf, mau, today.toISOString()],
        );
        mauRows += 1;
      }
    } catch (err) {
      errors += 1;
      logger.warn(
        { phase: "td-mau", tdAppId: a.tdAppId, err: String(err) },
        "MAU query failed",
      );
    }
  }
  return { engagementRows, mauRows, errors };
}

interface EngagementRow {
  timestamp: string;
  result: { sessions: number | null; dau: number | null };
}
interface MauRow {
  timestamp: string;
  result: { mau: number };
}

function upsertEngagement(
  tdDb: Database,
  tdAppId: string,
  rows: EngagementRow[],
  now: Date,
): number {
  const stmt = tdDb.prepare(
    `INSERT INTO td_daily_engagement (td_app_id, date, sessions, dau, fetched_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(td_app_id, date) DO UPDATE SET
       sessions = excluded.sessions,
       dau = excluded.dau,
       fetched_at = excluded.fetched_at`,
  );
  const fetchedAt = now.toISOString();
  let count = 0;
  for (const r of rows) {
    const date = r.timestamp.slice(0, 10);
    stmt.run(tdAppId, date, r.result.sessions, r.result.dau, fetchedAt);
    count += 1;
  }
  return count;
}

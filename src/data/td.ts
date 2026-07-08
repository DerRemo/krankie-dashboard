import type { Database } from "bun:sqlite";

export interface TdEngagementPoint {
  date: string;
  sessions: number | null;
  dau: number | null;
}

export interface TdEngagementSummary {
  /** Latest day with data, ISO date */
  asOfDate: string | null;
  dau: number | null;
  mau: number | null;
  sessions: number | null;
  /** dau / mau in [0,1], null if either is missing */
  stickiness: number | null;
}

export function getEngagementSummary(tdDb: Database, tdAppId: string): TdEngagementSummary {
  const latest = tdDb
    .query<{ date: string; sessions: number | null; dau: number | null }, [string]>(
      `SELECT date, sessions, dau FROM td_daily_engagement
       WHERE td_app_id = ? ORDER BY date DESC LIMIT 1`,
    )
    .get(tdAppId);
  const mauRow = tdDb
    .query<{ mau: number }, [string]>(
      `SELECT mau FROM td_mau_cache WHERE td_app_id = ? ORDER BY as_of_date DESC LIMIT 1`,
    )
    .get(tdAppId);
  const mau = mauRow?.mau ?? null;
  const dau = latest?.dau ?? null;
  const stickiness = dau != null && mau != null && mau > 0 ? dau / mau : null;
  return {
    asOfDate: latest?.date ?? null,
    dau,
    mau,
    sessions: latest?.sessions ?? null,
    stickiness,
  };
}

export function listEngagement(
  tdDb: Database,
  tdAppId: string,
  days: number,
  refDate = "now",
): TdEngagementPoint[] {
  return tdDb
    .query<{ date: string; sessions: number | null; dau: number | null }, [string, string, number]>(
      `SELECT date, sessions, dau FROM td_daily_engagement
       WHERE td_app_id = ? AND date >= date(?, ? || ' days')
       ORDER BY date ASC`,
    )
    .all(tdAppId, refDate, -(days - 1));
}

export interface TdCustomEventSummary {
  eventType: string;
  totalCount: number;
  uniqueUsers: number | null;
  /** Per-day series (oldest first), used for sparkline. */
  series: Array<{ date: string; count: number }>;
}

export function listCustomEventSummaries(
  tdDb: Database,
  tdAppId: string,
  days: number,
  refDate = "now",
): TdCustomEventSummary[] {
  const rows = tdDb
    .query<
      { date: string; event_type: string; count: number; unique_users: number | null },
      [string, string, number]
    >(
      `SELECT date, event_type, count, unique_users
       FROM td_custom_events
       WHERE td_app_id = ? AND date >= date(?, ? || ' days')
       ORDER BY event_type, date`,
    )
    .all(tdAppId, refDate, -(days - 1));

  const grouped = new Map<string, TdCustomEventSummary>();
  for (const r of rows) {
    let g = grouped.get(r.event_type);
    if (!g) {
      g = { eventType: r.event_type, totalCount: 0, uniqueUsers: null, series: [] };
      grouped.set(r.event_type, g);
    }
    g.totalCount += r.count;
    if (r.unique_users != null) {
      g.uniqueUsers = Math.max(g.uniqueUsers ?? 0, r.unique_users);
    }
    g.series.push({ date: r.date, count: r.count });
  }
  return Array.from(grouped.values()).sort((a, b) => b.totalCount - a.totalCount);
}

export interface TdBreakdownEntry {
  value: string;
  users: number;
  sessions: number;
}

export function listBreakdown(
  tdDb: Database,
  tdAppId: string,
  dimension: "appVersion" | "systemVersion" | "modelName",
  days: number,
  topN = 10,
  refDate = "now",
): TdBreakdownEntry[] {
  return tdDb
    .query<
      { value: string; users: number; sessions: number },
      [string, string, string, number]
    >(
      `SELECT value, MAX(users) AS users, SUM(sessions) AS sessions
       FROM td_breakdowns
       WHERE td_app_id = ? AND dimension = ? AND date >= date(?, ? || ' days')
       GROUP BY value
       ORDER BY users DESC
       LIMIT ${topN}`,
    )
    .all(tdAppId, dimension, refDate, -(days - 1));
}

export interface TdSyncStatusRow {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  summary: Record<string, unknown> | null;
  errorMessage: string | null;
}

export function getLatestTdSyncRun(tdDb: Database): TdSyncStatusRow | null {
  const row = tdDb
    .query<
      {
        id: number;
        started_at: string;
        finished_at: string | null;
        status: string;
        summary_json: string | null;
        error_message: string | null;
      },
      []
    >(`SELECT id, started_at, finished_at, status, summary_json, error_message
        FROM td_sync_runs ORDER BY started_at DESC LIMIT 1`)
    .get();
  if (!row) return null;
  return {
    id: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    summary: row.summary_json ? JSON.parse(row.summary_json) : null,
    errorMessage: row.error_message,
  };
}

export function countUnmatchedTdApps(tdDb: Database): number {
  return (tdDb
    .query("SELECT COUNT(*) AS c FROM td_apps WHERE asc_app_store_id IS NULL")
    .get() as { c: number }).c;
}

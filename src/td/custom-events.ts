import type { Database } from "bun:sqlite";
import type { TdClient } from "./client";
import type { TdApp } from "./types";
import {
  buildSignalTypesQuery,
  buildCustomEventQuery,
  trailingInterval,
} from "./query-builder";
import { logger } from "../logger";

const STANDARD_TYPES = new Set(["newSessionBegan"]);

export interface SyncCustomEventsResult {
  customEventTypes: number;
  customEventRows: number;
  errors: number;
}

export interface SyncCustomEventsOpts {
  /** Trailing days of per-event timeseries to fetch. Default 7. */
  trailingDays?: number;
  /** Backfill on first sight of an event type. Default 90. */
  backfillDays?: number;
  /** Discovery window — looks back this many days for signalType existence. Default 30. */
  discoveryDays?: number;
  today?: Date;
}

export async function syncCustomEvents(
  tdDb: Database,
  client: TdClient,
  apps: TdApp[],
  opts: SyncCustomEventsOpts = {},
): Promise<SyncCustomEventsResult> {
  const today = opts.today ?? new Date();
  const trailing = opts.trailingDays ?? 7;
  const backfill = opts.backfillDays ?? 90;
  const discoveryDays = opts.discoveryDays ?? 30;

  let customEventTypes = 0;
  let customEventRows = 0;
  let errors = 0;

  for (const a of apps) {
    const discoveryInterval = trailingInterval(discoveryDays, today);
    let typeRows: Array<{ event: { type: string; count: number } }>;
    try {
      typeRows = await client.postJson("/v2/query/", buildSignalTypesQuery(a.tdAppId, discoveryInterval));
    } catch (err) {
      errors += 1;
      logger.warn({ phase: "td-events-discovery", tdAppId: a.tdAppId, err: String(err) }, "discovery failed");
      continue;
    }
    const types = typeRows
      .map((r) => r.event.type)
      .filter((t): t is string => typeof t === "string" && !STANDARD_TYPES.has(t));

    upsertSignalTypes(tdDb, a.tdAppId, types, today);

    for (const eventType of types) {
      customEventTypes += 1;
      const seen = (tdDb
        .query(
          "SELECT COUNT(*) AS c FROM td_custom_events WHERE td_app_id = ? AND event_type = ?",
        )
        .get(a.tdAppId, eventType) as { c: number }).c > 0;
      const days = seen ? trailing : backfill;
      const interval = trailingInterval(days, today);
      try {
        const rows = await client.postJson<Array<{
          timestamp: string;
          result: { count: number; unique_users: number | null };
        }>>(
          "/v2/query/",
          buildCustomEventQuery(a.tdAppId, eventType, interval),
        );
        customEventRows += upsertCustomEventRows(tdDb, a.tdAppId, eventType, rows, today);
      } catch (err) {
        errors += 1;
        logger.warn(
          { phase: "td-events", tdAppId: a.tdAppId, eventType, err: String(err) },
          "custom event query failed",
        );
      }
    }
  }
  return { customEventTypes, customEventRows, errors };
}

function upsertSignalTypes(
  tdDb: Database,
  tdAppId: string,
  types: string[],
  now: Date,
): void {
  const ts = now.toISOString();
  const stmt = tdDb.prepare(
    `INSERT INTO td_signal_types (td_app_id, signal_type, first_seen, last_seen)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(td_app_id, signal_type) DO UPDATE SET last_seen = excluded.last_seen`,
  );
  for (const t of types) stmt.run(tdAppId, t, ts, ts);
}

function upsertCustomEventRows(
  tdDb: Database,
  tdAppId: string,
  eventType: string,
  rows: Array<{ timestamp: string; result: { count: number; unique_users: number | null } }>,
  now: Date,
): number {
  const stmt = tdDb.prepare(
    `INSERT INTO td_custom_events (td_app_id, date, event_type, count, unique_users, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(td_app_id, date, event_type) DO UPDATE SET
       count = excluded.count,
       unique_users = excluded.unique_users,
       fetched_at = excluded.fetched_at`,
  );
  const fetchedAt = now.toISOString();
  let count = 0;
  for (const r of rows) {
    const date = r.timestamp.slice(0, 10);
    stmt.run(tdAppId, date, eventType, r.result.count, r.result.unique_users, fetchedAt);
    count += 1;
  }
  return count;
}

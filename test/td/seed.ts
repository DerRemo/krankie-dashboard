import { Database } from "bun:sqlite";
import { openTdDb } from "../../src/td/db";
import type { TdApp } from "../../src/td/types";

export function makeTestTdDb(): Database {
  return openTdDb(":memory:");
}

export function seedTdApp(db: Database, app: Partial<TdApp> & { tdAppId: string; name: string }): void {
  db.run(
    `INSERT INTO td_apps (td_app_id, name, bundle_id, asc_app_store_id, mapping_source, fetched_at, bundle_fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      app.tdAppId,
      app.name,
      app.bundleId ?? null,
      app.ascAppStoreId ?? null,
      app.mappingSource ?? null,
      app.fetchedAt ?? new Date().toISOString(),
      app.bundleFetchedAt ?? null,
    ],
  );
}

export function seedEngagement(
  db: Database,
  rows: Array<{ tdAppId: string; date: string; sessions: number; dau: number }>,
): void {
  const stmt = db.prepare(
    `INSERT INTO td_daily_engagement (td_app_id, date, sessions, dau, fetched_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const now = new Date().toISOString();
  for (const r of rows) stmt.run(r.tdAppId, r.date, r.sessions, r.dau, now);
}

export function seedCustomEvent(
  db: Database,
  row: { tdAppId: string; date: string; eventType: string; count: number; uniqueUsers?: number },
): void {
  db.run(
    `INSERT INTO td_custom_events (td_app_id, date, event_type, count, unique_users, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [row.tdAppId, row.date, row.eventType, row.count, row.uniqueUsers ?? null, new Date().toISOString()],
  );
}

import type { Database } from "bun:sqlite";
import type { AscClient } from "./client";
import type { AscApp } from "./types";
import { logger } from "../logger";

export interface KrankieApp {
  appStoreId: string;
  name: string | null;
  platform: string;
}

/**
 * Read tracked apps from krankie.db (read-only handle). Filters to apps with
 * track_keywords=1 — those are the apps the dashboard cares about.
 */
export function listKrankieApps(krankieDb: Database): KrankieApp[] {
  const rows = krankieDb
    .query(
      `SELECT app_id, name, platform FROM apps WHERE track_keywords = 1 ORDER BY app_id`,
    )
    .all() as Array<{ app_id: string; name: string | null; platform: string }>;
  return rows.map((r) => ({ appStoreId: r.app_id, name: r.name, platform: r.platform }));
}

/**
 * For each krankie app, ensure an `asc_apps` row exists. Apple's `apps` resource is keyed
 * on the App Store numeric ID, so apple_id == app_store_id. We still call `GET /v1/apps/{id}`
 * once per app to verify the app belongs to this team and to fetch its name.
 *
 * Returns the list of apps that ARE accessible via this team's ASC credentials.
 */
export async function ensureAscApps(
  ascDb: Database,
  client: AscClient,
  krankieApps: KrankieApp[],
): Promise<AscApp[]> {
  const out: AscApp[] = [];
  for (const k of krankieApps) {
    const cached = readAscApp(ascDb, k.appStoreId);
    if (cached && cached.bundleId !== null && cached.sku !== null) {
      out.push(cached);
      continue;
    }
    try {
      const res = await client.getJson<{
        data: { id: string; attributes: { name: string; bundleId?: string; sku?: string } };
      }>(`/v1/apps/${k.appStoreId}`);
      const fetchedAt = new Date().toISOString();
      const name = res.data.attributes?.name ?? k.name;
      const bundleId = res.data.attributes?.bundleId ?? null;
      const sku = res.data.attributes?.sku ?? null;
      ascDb.run(
        `INSERT OR REPLACE INTO asc_apps (app_store_id, apple_id, name, bundle_id, sku, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [k.appStoreId, res.data.id, name, bundleId, sku, fetchedAt],
      );
      out.push({
        appStoreId: k.appStoreId,
        appleId: res.data.id,
        name,
        bundleId,
        sku,
        fetchedAt,
      });
    } catch (err) {
      logger.warn(
        { phase: "asc-apps", appStoreId: k.appStoreId, err: String(err) },
        "krankie app not accessible via ASC credentials; skipping",
      );
    }
  }
  return out;
}

export function readAscApp(ascDb: Database, appStoreId: string): AscApp | null {
  const row = ascDb
    .query(
      `SELECT app_store_id, apple_id, name, bundle_id, sku, fetched_at FROM asc_apps WHERE app_store_id = ?`,
    )
    .get(appStoreId) as
    | {
        app_store_id: string;
        apple_id: string;
        name: string | null;
        bundle_id: string | null;
        sku: string | null;
        fetched_at: string;
      }
    | null;
  if (!row) return null;
  return {
    appStoreId: row.app_store_id,
    appleId: row.apple_id,
    name: row.name,
    bundleId: row.bundle_id,
    sku: row.sku,
    fetchedAt: row.fetched_at,
  };
}

export function listAscApps(ascDb: Database): AscApp[] {
  const rows = ascDb
    .query(
      `SELECT app_store_id, apple_id, name, bundle_id, sku, fetched_at FROM asc_apps ORDER BY app_store_id`,
    )
    .all() as Array<{
    app_store_id: string;
    apple_id: string;
    name: string | null;
    bundle_id: string | null;
    sku: string | null;
    fetched_at: string;
  }>;
  return rows.map((r) => ({
    appStoreId: r.app_store_id,
    appleId: r.apple_id,
    name: r.name,
    bundleId: r.bundle_id,
    sku: r.sku,
    fetchedAt: r.fetched_at,
  }));
}

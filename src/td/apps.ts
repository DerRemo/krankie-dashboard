import type { Database } from "bun:sqlite";
import type { TdClient } from "./client";
import type { TdApp, MappingSource } from "./types";
import {
  buildBundleDiscoveryQuery,
  trailingInterval,
} from "./query-builder";
import { logger } from "../logger";

export interface OrgAppDto {
  id: string;
  type: "apps";
  attributes: { name: string };
}

/** Pull the list of apps in the org and upsert into td_apps. Bundle stays untouched. */
export async function syncTdApps(
  tdDb: Database,
  client: TdClient,
  now: Date = new Date(),
): Promise<TdApp[]> {
  const res = await client.getJson<{ data: OrgAppDto[] }>("/v1/organisation/apps");
  const fetchedAt = now.toISOString();
  for (const a of res.data) {
    tdDb.run(
      `INSERT INTO td_apps (td_app_id, name, fetched_at)
       VALUES (?, ?, ?)
       ON CONFLICT(td_app_id) DO UPDATE SET name = excluded.name, fetched_at = excluded.fetched_at`,
      [a.id, a.attributes.name, fetchedAt],
    );
  }
  return listTdApps(tdDb);
}

/** For each TD app, run a bundle-discovery query and persist bundle_id if found. */
export async function discoverBundles(
  tdDb: Database,
  client: TdClient,
  apps: TdApp[],
  today: Date = new Date(),
): Promise<{ discovered: number; errors: number }> {
  const interval = trailingInterval(30, today);
  let discovered = 0;
  let errors = 0;
  for (const a of apps) {
    try {
      const q = buildBundleDiscoveryQuery(a.tdAppId, interval);
      const rows = await client.postJson<Array<{ event: Record<string, unknown> }>>(
        "/v2/query/",
        q,
      );
      const bundle = rows[0]?.event?.["payload.appBundle"];
      if (typeof bundle === "string" && bundle.length > 0) {
        tdDb.run(
          `UPDATE td_apps SET bundle_id = ?, bundle_fetched_at = ? WHERE td_app_id = ?`,
          [bundle, today.toISOString(), a.tdAppId],
        );
        discovered += 1;
      }
    } catch (err) {
      errors += 1;
      logger.warn(
        { phase: "td-bundle-discovery", tdAppId: a.tdAppId, err: String(err) },
        "bundle discovery failed for app",
      );
    }
  }
  return { discovered, errors };
}

/**
 * Re-evaluate mapping for all td_apps where mapping_source != 'manual'.
 * Order: exact bundle, then fuzzy name. Untouched (NULL) if neither matches.
 */
export function applyMapping(
  tdDb: Database,
  ascDb: Database,
): { autoBundle: number; autoName: number; unmatched: number } {
  const ascRows = ascDb
    .query<{ app_store_id: string; name: string | null; bundle_id: string | null }, []>(
      `SELECT app_store_id, name, bundle_id FROM asc_apps`,
    )
    .all();
  const byBundle = new Map<string, string>();
  const byNorm   = new Map<string, string>();
  for (const r of ascRows) {
    if (r.bundle_id) byBundle.set(r.bundle_id, r.app_store_id);
    if (r.name)      byNorm.set(normalizeName(r.name), r.app_store_id);
  }

  const candidates = tdDb
    .query<
      { td_app_id: string; name: string; bundle_id: string | null; mapping_source: string | null },
      []
    >(
      `SELECT td_app_id, name, bundle_id, mapping_source
       FROM td_apps
       WHERE mapping_source IS NULL OR mapping_source != 'manual'`,
    )
    .all();

  let autoBundle = 0;
  let autoName = 0;
  let unmatched = 0;
  for (const c of candidates) {
    let storeId: string | undefined;
    let source: MappingSource | null = null;
    if (c.bundle_id && byBundle.has(c.bundle_id)) {
      storeId = byBundle.get(c.bundle_id);
      source = "auto-bundle";
      autoBundle += 1;
    } else {
      const n = normalizeName(c.name);
      if (byNorm.has(n)) {
        storeId = byNorm.get(n);
        source = "auto-name";
        autoName += 1;
      }
    }
    if (!storeId) {
      unmatched += 1;
      tdDb.run(
        `UPDATE td_apps SET asc_app_store_id = NULL, mapping_source = NULL WHERE td_app_id = ?`,
        [c.td_app_id],
      );
      continue;
    }
    tdDb.run(
      `UPDATE td_apps SET asc_app_store_id = ?, mapping_source = ? WHERE td_app_id = ?`,
      [storeId, source, c.td_app_id],
    );
  }
  return { autoBundle, autoName, unmatched };
}

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*[-–—]\s*(free|lite|pro)\s*$/i, "")
    .trim();
}

export function listTdApps(tdDb: Database): TdApp[] {
  const rows = tdDb
    .query<
      {
        td_app_id: string;
        name: string;
        bundle_id: string | null;
        asc_app_store_id: string | null;
        mapping_source: string | null;
        fetched_at: string;
        bundle_fetched_at: string | null;
      },
      []
    >(
      `SELECT td_app_id, name, bundle_id, asc_app_store_id, mapping_source,
              fetched_at, bundle_fetched_at
       FROM td_apps ORDER BY name`,
    )
    .all();
  return rows.map((r) => ({
    tdAppId: r.td_app_id,
    name: r.name,
    bundleId: r.bundle_id,
    ascAppStoreId: r.asc_app_store_id,
    mappingSource: r.mapping_source as MappingSource | null,
    fetchedAt: r.fetched_at,
    bundleFetchedAt: r.bundle_fetched_at,
  }));
}

/** Set a manual override. Pinned mappings won't be touched by applyMapping later. */
export function setManualMapping(
  tdDb: Database,
  tdAppId: string,
  ascAppStoreId: string | null,
): void {
  tdDb.run(
    `UPDATE td_apps SET asc_app_store_id = ?, mapping_source = ? WHERE td_app_id = ?`,
    [ascAppStoreId, ascAppStoreId ? "manual" : null, tdAppId],
  );
}

/** Reset all non-manual mappings to NULL. Caller usually re-runs applyMapping after. */
export function clearAutoMappings(tdDb: Database): number {
  const r = tdDb.run(
    `UPDATE td_apps
     SET asc_app_store_id = NULL, mapping_source = NULL
     WHERE mapping_source IS NULL OR mapping_source != 'manual'`,
  );
  return Number(r.changes);
}

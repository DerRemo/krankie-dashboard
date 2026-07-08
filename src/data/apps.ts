import type { Database } from "bun:sqlite";
import type { App, AppStats, Platform } from "../db/types";

interface AppRow {
  id: number;
  app_id: string;
  name: string | null;
  developer: string | null;
  platform: string;
  is_own: number;
  track_keywords: number;
}

function rowToApp(r: AppRow): App {
  return {
    id: r.id,
    appStoreId: r.app_id,
    name: r.name,
    developer: r.developer,
    platform: r.platform as Platform,
    isOwn: r.is_own === 1,
    trackKeywords: r.track_keywords === 1,
  };
}

export function listApps(db: Database): App[] {
  const rows = db
    .query<AppRow, []>(
      `SELECT a.id, a.app_id, a.name, a.developer, a.platform, a.is_own, a.track_keywords
       FROM apps a
       WHERE EXISTS (SELECT 1 FROM keywords k WHERE k.app_id = a.id)
       ORDER BY a.is_own DESC, COALESCE(a.name, a.app_id) ASC`,
    )
    .all();
  return rows.map(rowToApp);
}

export function getAppByAppStoreId(db: Database, appStoreId: string): App | null {
  const row = db
    .query<AppRow, [string]>(
      `SELECT id, app_id, name, developer, platform, is_own, track_keywords
       FROM apps WHERE app_id = ?`,
    )
    .get(appStoreId);
  return row ? rowToApp(row) : null;
}

interface StatsRow {
  app_pk: number;
  app_id: string;
  keyword_count: number;
  top10: number;
  top50: number;
  avg_rank: number | null;
}

export function appStats(db: Database, appStoreId: string): AppStats | null {
  const row = db
    .query<StatsRow, [string]>(
      `WITH latest AS (
         SELECT keyword_id, rank,
                ROW_NUMBER() OVER (PARTITION BY keyword_id ORDER BY checked_at DESC) AS rn
         FROM rankings
       )
       SELECT
         a.id AS app_pk,
         a.app_id,
         (SELECT COUNT(*) FROM keywords WHERE app_id = a.id) AS keyword_count,
         SUM(CASE WHEN l.rank IS NOT NULL AND l.rank <= 10 THEN 1 ELSE 0 END) AS top10,
         SUM(CASE WHEN l.rank IS NOT NULL AND l.rank <= 50 THEN 1 ELSE 0 END) AS top50,
         AVG(CASE WHEN l.rank IS NOT NULL THEN l.rank END) AS avg_rank
       FROM apps a
       LEFT JOIN keywords k ON k.app_id = a.id
       LEFT JOIN latest l ON l.keyword_id = k.id AND l.rn = 1
       WHERE a.app_id = ?
       GROUP BY a.id`,
    )
    .get(appStoreId);
  if (!row) return null;
  return {
    appId: row.app_pk,
    appStoreId: row.app_id,
    keywordCount: row.keyword_count,
    top10Count: row.top10 ?? 0,
    top50Count: row.top50 ?? 0,
    avgRank: row.avg_rank,
  };
}

export interface PortfolioRankingStats {
  top10Count: number;
  top50Count: number;
}

/** Portfolio-wide ranking totals — sums appStats across every tracked app. */
export function portfolioRankingStats(db: Database, apps: App[]): PortfolioRankingStats {
  let top10Count = 0;
  let top50Count = 0;
  for (const app of apps) {
    const stats = appStats(db, app.appStoreId);
    if (!stats) continue;
    top10Count += stats.top10Count;
    top50Count += stats.top50Count;
  }
  return { top10Count, top50Count };
}

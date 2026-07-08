import type { Database } from "bun:sqlite";
import type { RankingRow, Mover, Platform, TimePoint } from "../db/types";

interface CurrentRow {
  keyword_id: number;
  keyword: string;
  store: string;
  app_pk: number;
  app_store_id: string;
  app_name: string | null;
  platform: string;
  current_rank: number | null;
  current_at: string | null;
  rank_24h: number | null;
  rank_7d: number | null;
}

interface TrendRow {
  keyword_id: number;
  rank: number | null;
  checked_at: string;
}

export interface CurrentRankingsFilter {
  appStoreId?: string;
  store?: string;
}

export function currentRankings(
  db: Database,
  filter: CurrentRankingsFilter = {},
): RankingRow[] {
  const wheres: string[] = ["1=1"];
  const params: string[] = [];
  if (filter.appStoreId) {
    wheres.push("a.app_id = ?");
    params.push(filter.appStoreId);
  }
  if (filter.store) {
    wheres.push("k.store = ?");
    params.push(filter.store);
  }
  const sql = `
    WITH latest AS (
      SELECT keyword_id, rank, checked_at,
             ROW_NUMBER() OVER (PARTITION BY keyword_id ORDER BY checked_at DESC) AS rn
      FROM rankings
    ),
    latest_rows AS (
      SELECT keyword_id, rank, checked_at
      FROM latest
      WHERE rn = 1
    ),
    last_24h AS (
      SELECT r.keyword_id, r.rank,
             ROW_NUMBER() OVER (PARTITION BY r.keyword_id ORDER BY r.checked_at DESC) AS rn
      FROM rankings r
      JOIN latest_rows l ON l.keyword_id = r.keyword_id
      WHERE r.checked_at <= datetime(l.checked_at, '-24 hours')
    ),
    last_7d AS (
      SELECT r.keyword_id, r.rank,
             ROW_NUMBER() OVER (PARTITION BY r.keyword_id ORDER BY r.checked_at DESC) AS rn
      FROM rankings r
      JOIN latest_rows l ON l.keyword_id = r.keyword_id
      WHERE r.checked_at <= datetime(l.checked_at, '-7 days')
    )
    SELECT
      k.id AS keyword_id, k.keyword, k.store,
      a.id AS app_pk, a.app_id AS app_store_id, a.name AS app_name, a.platform,
      l.rank AS current_rank, l.checked_at AS current_at,
      h24.rank AS rank_24h,
      h7.rank AS rank_7d
    FROM keywords k
    JOIN apps a ON a.id = k.app_id
    LEFT JOIN latest_rows l ON l.keyword_id = k.id
    LEFT JOIN last_24h h24 ON h24.keyword_id = k.id AND h24.rn = 1
    LEFT JOIN last_7d h7 ON h7.keyword_id = k.id AND h7.rn = 1
    WHERE ${wheres.join(" AND ")}
    ORDER BY COALESCE(a.name, a.app_id), k.store, k.keyword
  `;
  const rows = db.query<CurrentRow, string[]>(sql).all(...params);

  // Pull last 14 trend points for every keyword in one query (avoids N+1).
  const ids = rows.map((r) => r.keyword_id);
  const trendsByKeyword = ids.length === 0 ? new Map<number, TimePoint[]>() : loadTrends(db, ids);

  return rows.map((r) => ({
    keywordId: r.keyword_id,
    keyword: r.keyword,
    store: r.store,
    appId: r.app_pk,
    appStoreId: r.app_store_id,
    appName: r.app_name,
    platform: r.platform as Platform,
    currentRank: r.current_rank,
    delta24h: deltaSafe(r.rank_24h, r.current_rank),
    delta7d: deltaSafe(r.rank_7d, r.current_rank),
    trend: trendsByKeyword.get(r.keyword_id) ?? [],
    checkedAt: r.current_at ?? "",
  }));
}

function deltaSafe(prev: number | null, curr: number | null): number | null {
  if (prev === null || curr === null) return null;
  return prev - curr; // positive = improved (rank went down)
}

function loadTrends(db: Database, keywordIds: number[]): Map<number, TimePoint[]> {
  const placeholders = keywordIds.map(() => "?").join(",");
  const rows = db
    .query<TrendRow, number[]>(
      `SELECT keyword_id, rank, checked_at
       FROM (
         SELECT keyword_id, rank, checked_at,
                ROW_NUMBER() OVER (PARTITION BY keyword_id ORDER BY checked_at DESC) AS rn
         FROM rankings
         WHERE keyword_id IN (${placeholders})
       )
       WHERE rn <= 14
       ORDER BY keyword_id, checked_at ASC`,
    )
    .all(...keywordIds);

  const out = new Map<number, TimePoint[]>();
  for (const r of rows) {
    const list = out.get(r.keyword_id) ?? [];
    list.push({ at: r.checked_at, rank: r.rank });
    out.set(r.keyword_id, list);
  }
  return out;
}

export type MoversWindow = "24h" | "7d" | "30d";

interface MoverRow {
  keyword_id: number;
  keyword: string;
  store: string;
  app_store_id: string;
  app_name: string | null;
  prev_rank: number;
  curr_rank: number;
  delta: number;
}

const WINDOW_SQL: Record<MoversWindow, string> = {
  "24h": "-24 hours",
  "7d": "-7 days",
  "30d": "-30 days",
};

export function movers(db: Database, opts: { window: MoversWindow }): Mover[] {
  const since = WINDOW_SQL[opts.window];
  const rows = db
    .query<MoverRow, [string]>(
      `WITH latest AS (
         SELECT keyword_id, rank, checked_at,
                ROW_NUMBER() OVER (PARTITION BY keyword_id ORDER BY checked_at DESC) AS rn
         FROM rankings
       ),
       latest_rows AS (
         SELECT keyword_id, checked_at
         FROM latest
         WHERE rn = 1
       ),
       windowed AS (
         SELECT r.keyword_id, r.rank, r.checked_at,
                ROW_NUMBER() OVER (PARTITION BY r.keyword_id ORDER BY r.checked_at DESC) AS rn_desc,
                ROW_NUMBER() OVER (PARTITION BY r.keyword_id ORDER BY r.checked_at ASC)  AS rn_asc
         FROM rankings r
         JOIN latest_rows l ON l.keyword_id = r.keyword_id
         WHERE r.checked_at >= datetime(l.checked_at, ?)
       ),
       newest AS (SELECT keyword_id, rank FROM windowed WHERE rn_desc = 1),
       oldest AS (SELECT keyword_id, rank FROM windowed WHERE rn_asc = 1)
       SELECT
         k.id AS keyword_id, k.keyword, k.store,
         a.app_id AS app_store_id, a.name AS app_name,
         o.rank AS prev_rank, n.rank AS curr_rank,
         (o.rank - n.rank) AS delta
       FROM keywords k
       JOIN apps a ON a.id = k.app_id
       JOIN newest n ON n.keyword_id = k.id
       JOIN oldest o ON o.keyword_id = k.id
       WHERE n.rank IS NOT NULL AND o.rank IS NOT NULL AND (o.rank - n.rank) != 0
       ORDER BY ABS(o.rank - n.rank) DESC
       LIMIT 100`,
    )
    .all(since);

  const ids = rows.map((r) => r.keyword_id);
  const trends = ids.length === 0 ? new Map<number, TimePoint[]>() : loadTrends(db, ids);

  return rows.map((r) => ({
    keywordId: r.keyword_id,
    keyword: r.keyword,
    store: r.store,
    appStoreId: r.app_store_id,
    appName: r.app_name,
    previousRank: r.prev_rank,
    currentRank: r.curr_rank,
    delta: r.delta,
    trend: trends.get(r.keyword_id) ?? [],
  }));
}

export function currentRankingsForKeyword(db: Database, keywordText: string): RankingRow[] {
  return currentRankings(db).filter((r) => r.keyword.toLowerCase() === keywordText.toLowerCase());
}

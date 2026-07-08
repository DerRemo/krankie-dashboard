import type { Database } from "bun:sqlite";
import type { Keyword, Platform } from "../db/types";

interface Row {
  id: number;
  app_id: number;
  app_store_id: string;
  app_name: string | null;
  platform: string;
  keyword: string;
  store: string;
  created_at: string;
}

function rowToKeyword(r: Row): Keyword {
  return {
    id: r.id,
    appId: r.app_id,
    appStoreId: r.app_store_id,
    appName: r.app_name,
    platform: r.platform as Platform,
    keyword: r.keyword,
    store: r.store,
    createdAt: r.created_at,
  };
}

export interface ListKeywordsFilter {
  appStoreId?: string;
  store?: string;
}

export function listKeywords(db: Database, filter: ListKeywordsFilter = {}): Keyword[] {
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
    SELECT
      k.id, k.app_id, k.keyword, k.store, k.created_at,
      a.app_id AS app_store_id, a.name AS app_name, a.platform
    FROM keywords k
    JOIN apps a ON a.id = k.app_id
    WHERE ${wheres.join(" AND ")}
    ORDER BY COALESCE(a.name, a.app_id) ASC, k.keyword ASC, k.store ASC
  `;
  const rows = db.query<Row, string[]>(sql).all(...params);
  return rows.map(rowToKeyword);
}

export interface KeywordWithCurrent extends Keyword { currentRank: number | null }

export function getKeywordWithCurrentRank(db: Database, id: number): KeywordWithCurrent | null {
  const row = db
    .query<Row & { current_rank: number | null }, [number]>(
      `SELECT k.id, k.app_id, k.keyword, k.store, k.created_at,
              a.app_id AS app_store_id, a.name AS app_name, a.platform,
              (SELECT rank FROM rankings WHERE keyword_id = k.id ORDER BY checked_at DESC LIMIT 1) AS current_rank
       FROM keywords k JOIN apps a ON a.id = k.app_id
       WHERE k.id = ?`,
    )
    .get(id);
  if (!row) return null;
  return { ...rowToKeyword(row), currentRank: row.current_rank };
}

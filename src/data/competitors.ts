import type { Database } from "bun:sqlite";
import type { TimePoint } from "../db/types";
import { getAppByAppStoreId } from "./apps";
import { currentRankings } from "./rankings";

export interface CompetitorApp {
  id: number;
  appStoreId: string;
  name: string | null;
}

export interface BenchmarkCell {
  currentRank: number | null;
  trend: TimePoint[];
}

export interface BenchmarkRow {
  keywordId: number;
  keyword: string;
  store: string;
  own: {
    currentRank: number | null;
    delta24h: number | null;
    delta7d: number | null;
    trend: TimePoint[];
  };
  competitors: BenchmarkCell[]; // aligned 1:1 to CompetitorBenchmark.competitors order
  bestCompetitorRank: number | null;
  gap: number | null; // own.currentRank - bestCompetitorRank; null if either side null
}

export interface BenchmarkSummary {
  keywordCount: number;
  weLead: number;
  weTrail: number;
  weAbsentButRivalRanks: number;
  avgGap: number | null;
}

export interface CompetitorBenchmark {
  ownApp: { appStoreId: string; name: string | null };
  competitors: CompetitorApp[];
  rows: BenchmarkRow[];
  summary: BenchmarkSummary;
}

interface CompetitorAppRow {
  id: number;
  app_id: string;
  name: string | null;
}

export function linkedCompetitors(db: Database, ownAppStoreId: string): CompetitorApp[] {
  const rows = db
    .query<CompetitorAppRow, [string]>(
      `SELECT c.id, c.app_id, c.name
       FROM app_competitors ac
       JOIN apps o ON o.id = ac.own_app_id
       JOIN apps c ON c.id = ac.competitor_app_id
       WHERE o.app_id = ?
       ORDER BY c.id`,
    )
    .all(ownAppStoreId);
  return rows.map((r) => ({ id: r.id, appStoreId: r.app_id, name: r.name }));
}

export function ownAppWithCompetitors(db: Database): string | null {
  const row = db
    .query<{ app_id: string }, []>(
      `SELECT DISTINCT o.app_id
       FROM app_competitors ac
       JOIN apps o ON o.id = ac.own_app_id
       ORDER BY o.app_id
       LIMIT 1`,
    )
    .get();
  return row?.app_id ?? null;
}

interface CompetitorRankRow {
  app_id: number;
  keyword: string;
  store: string;
  rank: number | null;
  checked_at: string;
}

function cellKey(appId: number, keyword: string, store: string): string {
  return `${appId} ${keyword} ${store}`;
}

function loadLatestCompetitorRanks(db: Database, appIds: number[]): Map<string, number | null> {
  const out = new Map<string, number | null>();
  if (appIds.length === 0) return out;
  const placeholders = appIds.map(() => "?").join(",");
  const rows = db
    .query<CompetitorRankRow, number[]>(
      `WITH latest AS (
         SELECT app_id, keyword, store, rank, checked_at,
                ROW_NUMBER() OVER (PARTITION BY app_id, keyword, store ORDER BY checked_at DESC) AS rn
         FROM competitor_rankings
         WHERE app_id IN (${placeholders})
       )
       SELECT app_id, keyword, store, rank, checked_at
       FROM latest WHERE rn = 1`,
    )
    .all(...appIds);
  for (const r of rows) {
    out.set(cellKey(r.app_id, r.keyword, r.store), r.rank);
  }
  return out;
}

function loadCompetitorTrends(db: Database, appIds: number[]): Map<string, TimePoint[]> {
  const out = new Map<string, TimePoint[]>();
  if (appIds.length === 0) return out;
  const placeholders = appIds.map(() => "?").join(",");
  const rows = db
    .query<CompetitorRankRow, number[]>(
      `SELECT app_id, keyword, store, rank, checked_at
       FROM (
         SELECT app_id, keyword, store, rank, checked_at,
                ROW_NUMBER() OVER (PARTITION BY app_id, keyword, store ORDER BY checked_at DESC) AS rn
         FROM competitor_rankings
         WHERE app_id IN (${placeholders})
       )
       WHERE rn <= 14
       ORDER BY app_id, keyword, store, checked_at ASC`,
    )
    .all(...appIds);
  for (const r of rows) {
    const key = cellKey(r.app_id, r.keyword, r.store);
    const list = out.get(key) ?? [];
    list.push({ at: r.checked_at, rank: r.rank });
    out.set(key, list);
  }
  return out;
}

export function competitorBenchmark(db: Database, ownAppStoreId: string): CompetitorBenchmark | null {
  const ownApp = getAppByAppStoreId(db, ownAppStoreId);
  if (!ownApp) return null;

  const competitors = linkedCompetitors(db, ownAppStoreId);
  const ownRows = currentRankings(db, { appStoreId: ownAppStoreId });

  const competitorIds = competitors.map((c) => c.id);
  const latestByKey = loadLatestCompetitorRanks(db, competitorIds);
  const trendsByKey = loadCompetitorTrends(db, competitorIds);

  const rows: BenchmarkRow[] = ownRows.map((own) => {
    const competitorCells: BenchmarkCell[] = competitors.map((c) => {
      const key = cellKey(c.id, own.keyword, own.store);
      return {
        currentRank: latestByKey.get(key) ?? null,
        trend: trendsByKey.get(key) ?? [],
      };
    });
    const rankedCompetitors = competitorCells
      .map((c) => c.currentRank)
      .filter((r): r is number => r !== null);
    const bestCompetitorRank = rankedCompetitors.length > 0 ? Math.min(...rankedCompetitors) : null;
    const gap = own.currentRank !== null && bestCompetitorRank !== null
      ? own.currentRank - bestCompetitorRank
      : null;
    return {
      keywordId: own.keywordId,
      keyword: own.keyword,
      store: own.store,
      own: {
        currentRank: own.currentRank,
        delta24h: own.delta24h,
        delta7d: own.delta7d,
        trend: own.trend,
      },
      competitors: competitorCells,
      bestCompetitorRank,
      gap,
    };
  });

  rows.sort((a, b) => {
    if (a.gap === null && b.gap === null) return a.keyword.localeCompare(b.keyword);
    if (a.gap === null) return 1;
    if (b.gap === null) return -1;
    if (a.gap !== b.gap) return b.gap - a.gap;
    return a.keyword.localeCompare(b.keyword);
  });

  return {
    ownApp: { appStoreId: ownApp.appStoreId, name: ownApp.name },
    competitors,
    rows,
    summary: summarize(rows),
  };
}

export interface PreparedMatrix {
  activeCompetitors: CompetitorApp[];
  /** Rivals with no rank in any row — shown as a chip, not as columns. */
  absentCompetitors: CompetitorApp[];
  /** Rows where at least one side ranks, competitor cells re-aligned to activeCompetitors. */
  rows: BenchmarkRow[];
}

/** View-prep: drop noise (all-null rows, never-ranked rivals) before rendering the matrix. */
export function prepareMatrix(competitors: CompetitorApp[], rows: BenchmarkRow[]): PreparedMatrix {
  const activeIdx: number[] = [];
  const absentCompetitors: CompetitorApp[] = [];
  competitors.forEach((c, i) => {
    const ranksAnywhere = rows.some((r) => r.competitors[i]?.currentRank !== null && r.competitors[i]?.currentRank !== undefined);
    if (ranksAnywhere) activeIdx.push(i);
    else absentCompetitors.push(c);
  });
  const activeCompetitors = activeIdx.map((i) => competitors[i]!);
  const keptRows = rows
    .filter((r) => r.own.currentRank !== null || activeIdx.some((i) => r.competitors[i]?.currentRank !== null))
    .map((r) => ({ ...r, competitors: activeIdx.map((i) => r.competitors[i]!) }));
  return { activeCompetitors, absentCompetitors, rows: keptRows };
}

function summarize(rows: BenchmarkRow[]): BenchmarkSummary {
  let weLead = 0;
  let weTrail = 0;
  let weAbsentButRivalRanks = 0;
  const gaps: number[] = [];
  for (const r of rows) {
    if (r.gap !== null) gaps.push(r.gap);
    if (r.own.currentRank !== null) {
      if (r.bestCompetitorRank === null || r.own.currentRank < r.bestCompetitorRank) weLead++;
      else if (r.bestCompetitorRank < r.own.currentRank) weTrail++;
    } else if (r.bestCompetitorRank !== null) {
      weAbsentButRivalRanks++;
    }
  }
  const avgGap = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
  return { keywordCount: rows.length, weLead, weTrail, weAbsentButRivalRanks, avgGap };
}

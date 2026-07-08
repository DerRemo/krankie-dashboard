// Domain types — what our reader functions return.
// Backed by the krankie schema (mirrored in test/seed.ts) but shaped for the dashboard's needs.

export type Platform = "iphone" | "ipad" | "mac" | "appletv" | "watch";

export interface App {
  /** Internal numeric id from krankie's apps table. */
  id: number;
  /** App Store ID string (e.g. "6737412117"). Used in URLs. */
  appStoreId: string;
  name: string | null;
  developer: string | null;
  platform: Platform;
  isOwn: boolean;
  trackKeywords: boolean;
}

export interface Keyword {
  id: number;
  appId: number;
  appStoreId: string;
  appName: string | null;
  platform: Platform;
  keyword: string;
  store: string;
  createdAt: string;
}

/** Current rank for one keyword with deltas relative to recent history. */
export interface RankingRow {
  keywordId: number;
  keyword: string;
  store: string;
  appId: number;
  appStoreId: string;
  appName: string | null;
  platform: Platform;
  /** Latest known rank (1–200) or null if not in top 200. */
  currentRank: number | null;
  /** Δ since closest sample at least 24h ago. Positive = improved (rank decreased). */
  delta24h: number | null;
  delta7d: number | null;
  /** Up to 14 most-recent points (oldest first), for sparkline. */
  trend: TimePoint[];
  checkedAt: string;
}

export interface Mover {
  keywordId: number;
  keyword: string;
  store: string;
  appStoreId: string;
  appName: string | null;
  previousRank: number;
  currentRank: number;
  /** previousRank - currentRank. Positive = improved. */
  delta: number;
  trend: TimePoint[];
}

export interface TimePoint {
  /** ISO8601 string. */
  at: string;
  /** Rank or null (not in top 200). */
  rank: number | null;
}

export interface AppStats {
  appId: number;
  appStoreId: string;
  keywordCount: number;
  top10Count: number;
  top50Count: number;
  /** Average of non-null current ranks. null if no keywords have a rank. */
  avgRank: number | null;
}

export interface DbStats {
  apps: number;
  keywords: number;
  rankings: number;
  dbSizeBytes: number;
}

export interface HealthSnapshot {
  ok: boolean;
  dbReachable: boolean;
  krankieBinaryFound: boolean;
  schemaOk: boolean;
  /** Hours since last successful check, or null if never. */
  lastCheckAgeHours: number | null;
  journalMode: string;
}

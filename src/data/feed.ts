import type { Database } from "bun:sqlite";
import { movers } from "./rankings";
import type { AscTodayRow } from "./asc";
import type { App } from "../db/types";

export type FeedWindow = "24h" | "7d";

export interface MoverEntry {
  kind: "mover";
  keywordId: number;
  keyword: string;
  store: string;
  appStoreId: string;
  appName: string | null;
  previousRank: number;
  currentRank: number;
  delta: number;
}

export interface ReviewEntry {
  kind: "review";
  appStoreId: string;
  appName: string | null;
  rating: number;
  title: string | null;
  snippet: string | null;
  territory: string;
  createdAt: string;
}

export interface AscEntry {
  kind: "asc";
  appStoreId: string;
  appName: string | null;
  metric: "impressions" | "downloads";
  deltaPct: number;
  current: number;
  date: string | null;
}

export type FeedEntry = MoverEntry | ReviewEntry | AscEntry;

const SIGNIFICANT_DELTA = 3;
const ASC_ANOMALY_PCT = 30;
const SNIPPET_MAX = 140;

export function isSignificantMover(previousRank: number, currentRank: number): boolean {
  const delta = Math.abs(previousRank - currentRank);
  const crossedTop10 = (previousRank > 10) !== (currentRank > 10);
  return delta >= SIGNIFICANT_DELTA || crossedTop10;
}

export interface FeedOpts {
  ascDb: Database | null;
  ascToday: AscTodayRow[];
  apps: App[];
}

/**
 * One sorted list for the overview feed: significant rank movers (by |delta|,
 * the movers() SQL already orders that way), then reviews + ASC anomalies as
 * one combined list sorted chronologically, newest first (reviews by
 * createdAt, ASC entries by date; a null date sorts oldest).
 * ASC anomaly deltas are 7d-based regardless of window — that is the only
 * granularity the daily ASC data supports.
 */
export function feedEntries(db: Database, window: FeedWindow, opts: FeedOpts): FeedEntry[] {
  const nameById = new Map(opts.apps.map((a) => [a.appStoreId, a.name]));

  const moverEntries: MoverEntry[] = movers(db, { window })
    .filter((m) => isSignificantMover(m.previousRank, m.currentRank))
    .map((m) => ({
      kind: "mover" as const,
      keywordId: m.keywordId,
      keyword: m.keyword,
      store: m.store,
      appStoreId: m.appStoreId,
      appName: m.appName,
      previousRank: m.previousRank,
      currentRank: m.currentRank,
      delta: m.delta,
    }));

  const reviewEntries = opts.ascDb ? recentReviews(opts.ascDb, window, nameById) : [];

  const ascEntries: AscEntry[] = [];
  for (const row of opts.ascToday) {
    for (const metric of ["impressions", "downloads"] as const) {
      const pct = metric === "impressions" ? row.impressionsDelta7dPct : row.downloadsDelta7dPct;
      if (pct !== null && Math.abs(pct) >= ASC_ANOMALY_PCT) {
        ascEntries.push({
          kind: "asc",
          appStoreId: row.appStoreId,
          appName: nameById.get(row.appStoreId) ?? null,
          metric,
          deltaPct: pct,
          current: metric === "impressions" ? row.impressions : row.downloads,
          date: row.date,
        });
      }
    }
  }

  const chronological = [...reviewEntries, ...ascEntries].sort(
    (a, b) => entryTimestamp(b).localeCompare(entryTimestamp(a)),
  );

  return [...moverEntries, ...chronological];
}

/** Sort key for the chronological tail; null dates sort oldest. */
function entryTimestamp(e: ReviewEntry | AscEntry): string {
  return e.kind === "review" ? e.createdAt : e.date ?? "";
}

export interface GroupedFeed {
  keywords: MoverEntry[];
  impressions: AscEntry[];
  downloads: AscEntry[];
  reviews: ReviewEntry[];
}

/**
 * Split a flat feed into the four overview groups. Keywords keep the incoming
 * order (feedEntries already sorts movers by |delta| desc); impressions and
 * downloads are re-sorted by |deltaPct| desc; reviews by createdAt desc.
 */
export function groupFeed(entries: FeedEntry[]): GroupedFeed {
  const keywords: MoverEntry[] = [];
  const impressions: AscEntry[] = [];
  const downloads: AscEntry[] = [];
  const reviews: ReviewEntry[] = [];
  for (const e of entries) {
    if (e.kind === "mover") keywords.push(e);
    else if (e.kind === "review") reviews.push(e);
    else if (e.metric === "impressions") impressions.push(e);
    else downloads.push(e);
  }
  const byMagnitude = (a: AscEntry, b: AscEntry) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct);
  impressions.sort(byMagnitude);
  downloads.sort(byMagnitude);
  reviews.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { keywords, impressions, downloads, reviews };
}

interface RawReview {
  appStoreId: string;
  rating: number;
  title: string | null;
  body: string | null;
  territory: string;
  createdAt: string;
  ascName: string | null;
}

function recentReviews(ascDb: Database, window: FeedWindow, nameById: Map<string, string | null>): ReviewEntry[] {
  const cutoffDays = window === "24h" ? 1 : 7;
  const cutoff = new Date(Date.now() - cutoffDays * 86_400_000).toISOString();
  const rows = ascDb.query(
    `SELECT r.app_store_id AS appStoreId, r.rating, r.title, r.body, r.territory,
            r.created_at AS createdAt, a.name AS ascName
       FROM reviews_raw r
       LEFT JOIN asc_apps a ON a.app_store_id = r.app_store_id
      WHERE r.created_at >= ?
      ORDER BY r.created_at DESC`,
  ).all(cutoff) as RawReview[];
  return rows.map((r) => ({
    kind: "review" as const,
    appStoreId: r.appStoreId,
    appName: nameById.get(r.appStoreId) ?? r.ascName,
    rating: r.rating,
    title: r.title,
    snippet: r.body === null ? null : r.body.length > SNIPPET_MAX ? r.body.slice(0, SNIPPET_MAX) + "…" : r.body,
    territory: r.territory,
    createdAt: r.createdAt,
  }));
}

import type { Database } from "bun:sqlite";
import type { ReviewRow } from "../asc/types";

export interface RatingSummary { average: number; count: number }
export interface ReviewHistogram { counts: [number, number, number, number, number]; total: number }

interface SnapRow { average: number; count: number }

export function ratingSummary(db: Database, appStoreId: string, territory: string | null): RatingSummary | null {
  // Latest snapshot date for this app (all territories are written on the same sync day).
  const latest = db.query(
    "SELECT MAX(date) AS d FROM rating_snapshots_daily WHERE app_store_id = ?",
  ).get(appStoreId) as { d: string | null } | null;
  if (!latest?.d) return null;

  const terrFilter = territory ? "AND territory = ?" : "";
  const args = territory ? [appStoreId, latest.d, territory] : [appStoreId, latest.d];
  const rows = db.query(
    `SELECT average, count FROM rating_snapshots_daily
      WHERE app_store_id = ? AND date = ? ${terrFilter}`,
  ).all(...args) as SnapRow[];
  if (rows.length === 0) return null;

  let count = 0, weighted = 0;
  for (const r of rows) { count += r.count; weighted += r.average * r.count; }
  return { average: count > 0 ? weighted / count : 0, count };
}

// 1→5★ distribution built from the fetched written reviews (Apple's ratings API exposes
// no star breakdown). This is the distribution of REVIEW authors, not all raters.
export function reviewHistogram(db: Database, appStoreId: string, territory: string | null): ReviewHistogram {
  const terrFilter = territory ? "AND territory = ?" : "";
  const args = territory ? [appStoreId, territory] : [appStoreId];
  const rows = db.query(
    `SELECT rating, COUNT(*) AS c FROM reviews_raw
      WHERE app_store_id = ? ${terrFilter} GROUP BY rating`,
  ).all(...args) as { rating: number; c: number }[];
  const counts: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let total = 0;
  for (const r of rows) {
    if (r.rating >= 1 && r.rating <= 5) { counts[r.rating - 1] = r.c; total += r.c; }
  }
  return { counts, total };
}

export function latestSummarization(db: Database, appStoreId: string, territory: string | null): string | null {
  if (territory) {
    const r = db.query(
      "SELECT summary_text AS t FROM review_summarizations WHERE app_store_id = ? AND territory = ?",
    ).get(appStoreId, territory) as { t: string } | null;
    return r?.t ?? null;
  }
  // No territory selected: pick the territory with the most ratings, else any row.
  const r = db.query(
    `SELECT s.summary_text AS t
       FROM review_summarizations s
       LEFT JOIN (
         SELECT territory, MAX(count) AS c FROM rating_snapshots_daily
          WHERE app_store_id = ? GROUP BY territory
       ) r ON r.territory = s.territory
      WHERE s.app_store_id = ?
      ORDER BY r.c DESC NULLS LAST
      LIMIT 1`,
  ).get(appStoreId, appStoreId) as { t: string } | null;
  return r?.t ?? null;
}

export function latestReviews(db: Database, appStoreId: string, territory: string | null, limit = 25): ReviewRow[] {
  const terrFilter = territory ? "AND territory = ?" : "";
  const args = territory ? [appStoreId, territory, limit] : [appStoreId, limit];
  return db.query(
    `SELECT app_store_id AS appStoreId, review_id AS reviewId, territory, rating,
            title, body, reviewer_nickname AS reviewerNickname, created_at AS createdAt
       FROM reviews_raw
      WHERE app_store_id = ? ${terrFilter}
      ORDER BY created_at DESC
      LIMIT ?`,
  ).all(...args) as ReviewRow[];
}

import type { Database } from "bun:sqlite";
import type { AscApp } from "./types";
import { parseReviewsJson, parseRatingsJson, parseSummarizationsJson } from "./reviews-parser";
import { toAlpha2 } from "./territory";
import { logger } from "../logger";

export interface ReviewsCli { runJson<T>(args: string[]): Promise<T> }
export interface ReviewsSyncResult { reviewRows: number; ratingSnapshotRows: number; summarizationRows: number; errors: number }

export async function syncReviews(ascDb: Database, cli: ReviewsCli, apps: AscApp[], today: string): Promise<ReviewsSyncResult> {
  const result: ReviewsSyncResult = { reviewRows: 0, ratingSnapshotRows: 0, summarizationRows: 0, errors: 0 };

  const upReview = ascDb.prepare(`
    INSERT INTO reviews_raw (app_store_id, review_id, territory, rating, title, body, reviewer_nickname, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(app_store_id, review_id) DO UPDATE SET
      territory = excluded.territory, rating = excluded.rating, title = excluded.title,
      body = excluded.body, reviewer_nickname = excluded.reviewer_nickname,
      created_at = excluded.created_at, fetched_at = CURRENT_TIMESTAMP`);
  const upSnap = ascDb.prepare(`
    INSERT OR REPLACE INTO rating_snapshots_daily
      (app_store_id, date, territory, average, count, stars_1, stars_2, stars_3, stars_4, stars_5)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const upSumm = ascDb.prepare(`
    INSERT INTO review_summarizations (app_store_id, territory, summary_text)
    VALUES (?, ?, ?)
    ON CONFLICT(app_store_id, territory) DO UPDATE SET
      summary_text = excluded.summary_text, fetched_at = CURRENT_TIMESTAMP`);

  for (const app of apps) {
    try {
      const id = app.appStoreId;

      const reviewsRaw = await cli.runJson<unknown>(["reviews", "list", "--app", id, "--paginate", "--sort", "-createdDate"]);
      const { rows: reviews } = parseReviewsJson(reviewsRaw, id);
      const reviewTerritories = new Set<string>();
      for (const r of reviews) {
        const terr = toAlpha2(r.territory); // reviews list returns 3-letter; normalize
        reviewTerritories.add(terr);
        upReview.run(r.appStoreId, r.reviewId, terr, r.rating, r.title, r.body, r.reviewerNickname, r.createdAt);
      }
      result.reviewRows += reviews.length;

      const ratingsRaw = await cli.runJson<unknown>(["reviews", "ratings", "--app", id, "--all"]);
      const ratings = parseRatingsJson(ratingsRaw, id);
      for (const s of ratings) {
        upSnap.run(id, today, toAlpha2(s.territory), s.average, s.count, s.stars1, s.stars2, s.stars3, s.stars4, s.stars5);
      }
      result.ratingSnapshotRows += ratings.length;

      // Summarizations relate to written reviews — drive the loop from the reviews'
      // (normalized 2-letter) territories, passing the 2-letter code to --territory.
      for (const terr of reviewTerritories) {
        try {
          const summRaw = await cli.runJson<unknown>(["reviews", "summarizations", "--app", id, "--platform", "IOS", "--territory", terr]);
          const summ = parseSummarizationsJson(summRaw, id, terr);
          for (const row of summ) { upSumm.run(row.appStoreId, row.territory, row.summaryText); }
          result.summarizationRows += summ.length;
        } catch (err) {
          // Summarizations 404 for most territories (below Apple's threshold) — tolerate silently.
          logger.debug({ phase: "reviews", app: id, territory: terr, err: String(err) }, "summarization unavailable");
        }
      }
    } catch (err) {
      result.errors += 1;
      logger.warn({ phase: "reviews", app: app.appStoreId, err: String(err) }, "reviews sync failed for app");
    }
  }
  return result;
}

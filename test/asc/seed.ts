import { Database } from "bun:sqlite";
import { openAscDb } from "../../src/asc/db";

export function makeAscDb(): Database {
  return openAscDb(":memory:");
}

export function seedSales(db: Database, rows: Array<{
  appStoreId: string; date: string; territory: string;
  units?: number; redownloads?: number; updates?: number;
  proceedsLocal?: number; iapProceedsLocal?: number;
  proceedsCurrency?: string | null;
  proceedsUsd?: number; iapUnits?: number; iapProceedsUsd?: number;
}>): void {
  const stmt = db.prepare(`
    INSERT INTO sales_daily
      (app_store_id, date, territory,
       units, redownloads, updates,
       proceeds_local, iap_proceeds_local, proceeds_currency,
       proceeds_usd, iap_units, iap_proceeds_usd)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(app_store_id, date, territory) DO UPDATE SET
      units = excluded.units, redownloads = excluded.redownloads, updates = excluded.updates,
      proceeds_local = excluded.proceeds_local,
      iap_proceeds_local = excluded.iap_proceeds_local,
      proceeds_currency = excluded.proceeds_currency,
      proceeds_usd = excluded.proceeds_usd,
      iap_units = excluded.iap_units,
      iap_proceeds_usd = excluded.iap_proceeds_usd
  `);
  for (const r of rows) {
    stmt.run(
      r.appStoreId, r.date, r.territory,
      r.units ?? 0, r.redownloads ?? 0, r.updates ?? 0,
      r.proceedsLocal ?? r.proceedsUsd ?? 0,
      r.iapProceedsLocal ?? r.iapProceedsUsd ?? 0,
      r.proceedsCurrency ?? "USD",
      r.proceedsUsd ?? 0, r.iapUnits ?? 0, r.iapProceedsUsd ?? 0,
    );
  }
}

export function seedAnalytics(db: Database, rows: Array<{
  appStoreId: string; date: string; territory: string;
  impressions?: number | null; productPageViews?: number | null;
  firstTimeDownloads?: number | null; sessions?: number | null;
  activeDevices?: number | null; crashes?: number | null;
}>): void {
  const stmt = db.prepare(`
    INSERT INTO analytics_daily
      (app_store_id, date, territory, impressions, product_page_views, first_time_downloads, sessions, active_devices, crashes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(app_store_id, date, territory) DO UPDATE SET
      impressions = COALESCE(excluded.impressions, analytics_daily.impressions),
      product_page_views = COALESCE(excluded.product_page_views, analytics_daily.product_page_views),
      first_time_downloads = COALESCE(excluded.first_time_downloads, analytics_daily.first_time_downloads),
      sessions = COALESCE(excluded.sessions, analytics_daily.sessions),
      active_devices = COALESCE(excluded.active_devices, analytics_daily.active_devices),
      crashes = COALESCE(excluded.crashes, analytics_daily.crashes)
  `);
  for (const r of rows) {
    stmt.run(
      r.appStoreId, r.date, r.territory,
      r.impressions ?? null, r.productPageViews ?? null, r.firstTimeDownloads ?? null,
      r.sessions ?? null, r.activeDevices ?? null, r.crashes ?? null,
    );
  }
}

export function seedPurchases(db: Database, rows: Array<{
  appStoreId: string; date: string; territory: string;
  purchases?: number; proceedsUsd?: number; salesUsd?: number; payingUsers?: number;
}>): void {
  const stmt = db.prepare(`
    INSERT INTO purchases_daily (app_store_id, date, territory, purchases, proceeds_usd, sales_usd, paying_users)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(app_store_id, date, territory) DO UPDATE SET
      purchases = excluded.purchases, proceeds_usd = excluded.proceeds_usd,
      sales_usd = excluded.sales_usd, paying_users = excluded.paying_users
  `);
  for (const r of rows) {
    stmt.run(r.appStoreId, r.date, r.territory, r.purchases ?? 0, r.proceedsUsd ?? 0, r.salesUsd ?? 0, r.payingUsers ?? 0);
  }
}

export function insertSyncRun(db: Database, args: {
  trigger: "cron" | "manual"; status: "running" | "success" | "partial" | "failed";
  startedAt?: string; finishedAt?: string | null;
  summaryJson?: string | null; error?: string | null;
}): number {
  const r = db.run(
    `INSERT INTO sync_runs (started_at, finished_at, trigger, status, summary_json, error)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      args.startedAt ?? new Date().toISOString(),
      args.finishedAt ?? null,
      args.trigger,
      args.status,
      args.summaryJson ?? null,
      args.error ?? null,
    ],
  );
  return Number(r.lastInsertRowid);
}

export function seedReviews(db: Database, rows: Array<{
  appStoreId: string; reviewId: string; territory: string; rating: number;
  title?: string | null; body?: string | null; reviewerNickname?: string | null;
  createdAt: string; fetchedAt?: string;
}>): void {
  const stmt = db.prepare(`
    INSERT INTO reviews_raw
      (app_store_id, review_id, territory, rating, title, body, reviewer_nickname, created_at, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(app_store_id, review_id) DO UPDATE SET
      territory = excluded.territory, rating = excluded.rating, title = excluded.title,
      body = excluded.body, reviewer_nickname = excluded.reviewer_nickname,
      created_at = excluded.created_at, fetched_at = excluded.fetched_at
  `);
  for (const r of rows) {
    stmt.run(
      r.appStoreId, r.reviewId, r.territory, r.rating,
      r.title ?? null, r.body ?? null, r.reviewerNickname ?? null,
      r.createdAt, r.fetchedAt ?? new Date().toISOString(),
    );
  }
}

export function seedRatingSnapshots(db: Database, rows: Array<{
  appStoreId: string; date: string; territory: string; average: number; count: number;
  stars1?: number; stars2?: number; stars3?: number; stars4?: number; stars5?: number;
}>): void {
  const stmt = db.prepare(`
    INSERT INTO rating_snapshots_daily
      (app_store_id, date, territory, average, count, stars_1, stars_2, stars_3, stars_4, stars_5)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(app_store_id, date, territory) DO UPDATE SET
      average = excluded.average, count = excluded.count,
      stars_1 = excluded.stars_1, stars_2 = excluded.stars_2, stars_3 = excluded.stars_3,
      stars_4 = excluded.stars_4, stars_5 = excluded.stars_5
  `);
  for (const r of rows) {
    stmt.run(
      r.appStoreId, r.date, r.territory, r.average, r.count,
      r.stars1 ?? 0, r.stars2 ?? 0, r.stars3 ?? 0, r.stars4 ?? 0, r.stars5 ?? 0,
    );
  }
}

export function seedReviewSummarization(db: Database, rows: Array<{
  appStoreId: string; territory: string; summaryText: string; fetchedAt?: string;
}>): void {
  const stmt = db.prepare(`
    INSERT INTO review_summarizations (app_store_id, territory, summary_text, fetched_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(app_store_id, territory) DO UPDATE SET
      summary_text = excluded.summary_text, fetched_at = excluded.fetched_at
  `);
  for (const r of rows) {
    stmt.run(r.appStoreId, r.territory, r.summaryText, r.fetchedAt ?? new Date().toISOString());
  }
}

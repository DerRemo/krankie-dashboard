import { test, expect } from "bun:test";
import { makeAscDb, seedReviews, seedRatingSnapshots, seedReviewSummarization } from "../asc/seed";
import {
  ratingSummary, reviewHistogram, latestSummarization, latestReviews,
} from "../../src/data/reviews";

const APP = "1000000001";

function seedApps(db: ReturnType<typeof makeAscDb>) {
  db.run(
    "INSERT INTO asc_apps (app_store_id, apple_id, name, fetched_at) VALUES (?, ?, ?, ?)",
    [APP, "1000000001", "Aurora", new Date().toISOString()],
  );
}

test("ratingSummary returns the latest per-territory snapshot", () => {
  const db = makeAscDb();
  seedApps(db);
  seedRatingSnapshots(db, [
    { appStoreId: APP, date: "2026-07-05", territory: "DE", average: 4.7, count: 128, stars5: 92, stars4: 21, stars3: 8, stars2: 3, stars1: 4 },
    { appStoreId: APP, date: "2026-07-06", territory: "DE", average: 4.6, count: 130, stars5: 90, stars4: 25, stars3: 8, stars2: 3, stars1: 4 },
  ]);
  const s = ratingSummary(db, APP, "DE");
  expect(s).not.toBeNull();
  expect(s!.count).toBe(130);
  expect(s!.average).toBeCloseTo(4.6, 5);
});

test("ratingSummary(null) aggregates worldwide with a count-weighted average", () => {
  const db = makeAscDb();
  seedApps(db);
  seedRatingSnapshots(db, [
    { appStoreId: APP, date: "2026-07-06", territory: "DE", average: 4.0, count: 100 },
    { appStoreId: APP, date: "2026-07-06", territory: "US", average: 5.0, count: 100 },
  ]);
  const s = ratingSummary(db, APP, null);
  expect(s!.count).toBe(200);
  expect(s!.average).toBeCloseTo(4.5, 5); // (4.0*100 + 5.0*100)/200
});

test("reviewHistogram counts reviews_raw ratings by star (1..5), filtered by territory", () => {
  const db = makeAscDb();
  seedApps(db);
  seedReviews(db, [
    { appStoreId: APP, reviewId: "a", territory: "DE", rating: 5, createdAt: "2026-07-01T00:00:00Z" },
    { appStoreId: APP, reviewId: "b", territory: "DE", rating: 5, createdAt: "2026-07-02T00:00:00Z" },
    { appStoreId: APP, reviewId: "c", territory: "DE", rating: 3, createdAt: "2026-07-03T00:00:00Z" },
    { appStoreId: APP, reviewId: "d", territory: "US", rating: 1, createdAt: "2026-07-04T00:00:00Z" },
  ]);
  expect(reviewHistogram(db, APP, "DE")).toEqual({ counts: [0, 0, 1, 0, 2], total: 3 });
  expect(reviewHistogram(db, APP, null)).toEqual({ counts: [1, 0, 1, 0, 2], total: 4 });
});

test("ratingSummary returns null when no snapshot", () => {
  const db = makeAscDb();
  seedApps(db);
  expect(ratingSummary(db, APP, "DE")).toBeNull();
});

test("latestReviews orders newest-first and filters by territory", () => {
  const db = makeAscDb();
  seedApps(db);
  seedReviews(db, [
    { appStoreId: APP, reviewId: "a", territory: "DE", rating: 5, title: "Top", createdAt: "2026-07-01T00:00:00Z" },
    { appStoreId: APP, reviewId: "b", territory: "DE", rating: 4, title: "Neu", createdAt: "2026-07-03T00:00:00Z" },
    { appStoreId: APP, reviewId: "c", territory: "US", rating: 3, title: "Other", createdAt: "2026-07-05T00:00:00Z" },
  ]);
  const de = latestReviews(db, APP, "DE");
  expect(de.map((r) => r.reviewId)).toEqual(["b", "a"]);
  const all = latestReviews(db, APP, null);
  expect(all.map((r) => r.reviewId)).toEqual(["c", "b", "a"]);
});

test("latestSummarization returns text or null", () => {
  const db = makeAscDb();
  seedApps(db);
  expect(latestSummarization(db, APP, "DE")).toBeNull();
  seedReviewSummarization(db, [{ appStoreId: APP, territory: "DE", summaryText: "Nutzer loben die Bedienung." }]);
  expect(latestSummarization(db, APP, "DE")).toBe("Nutzer loben die Bedienung.");
});

test("latestSummarization(null) picks highest-count territory summary", () => {
  const db = makeAscDb();
  seedApps(db);

  // Assert: no summarizations exist initially
  expect(latestSummarization(db, APP, null)).toBeNull();

  // Seed rating snapshots for two territories with different counts
  seedRatingSnapshots(db, [
    { appStoreId: APP, date: "2026-07-06", territory: "DE", average: 4.5, count: 100 },
    { appStoreId: APP, date: "2026-07-06", territory: "US", average: 4.0, count: 10 },
  ]);

  // Seed review_summarizations for both territories with distinct text
  seedReviewSummarization(db, [
    { appStoreId: APP, territory: "DE", summaryText: "Deutsche Nutzer loben die Bedienung." },
    { appStoreId: APP, territory: "US", summaryText: "Users like the interface." },
  ]);

  // Assert: should return the higher-count territory's summary (DE with count=100)
  expect(latestSummarization(db, APP, null)).toBe("Deutsche Nutzer loben die Bedienung.");
});

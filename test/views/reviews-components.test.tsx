import { test, expect } from "bun:test";
import { StarRating } from "../../src/views/components/StarRating";
import { RatingHistogram } from "../../src/views/components/RatingHistogram";
import { RatingSummary } from "../../src/views/components/RatingSummary";
import { ReviewCard } from "../../src/views/components/ReviewCard";
import { ReviewsSummarization } from "../../src/views/components/ReviewsSummarization";

test("StarRating renders filled + empty stars for a rounded value", () => {
  const html = String(StarRating({ value: 4 }));
  expect((html.match(/★/g) ?? []).length).toBe(4);
  expect((html.match(/☆/g) ?? []).length).toBe(1);
});

test("RatingSummary shows average, count and the reviews-by-star caption", () => {
  const html = String(RatingSummary({ average: 4.66, count: 128, histogram: { counts: [0, 0, 2, 3, 9], total: 14 } }));
  expect(html).toContain("4.7");
  expect(html).toContain("128");
  expect(html).toContain("Reviews nach Sternen");
  expect(html).toContain("14");
});

test("RatingSummary omits the histogram when no written reviews (total 0)", () => {
  const html = String(RatingSummary({ average: 4.66, count: 128, histogram: { counts: [0, 0, 0, 0, 0], total: 0 } }));
  expect(html).not.toContain("Reviews nach Sternen");
});

test("RatingHistogram renders five rows", () => {
  const html = String(RatingHistogram({ counts: [0, 0, 2, 3, 9] }));
  expect((html.match(/histogram-row/g) ?? []).length).toBe(5);
});

test("ReviewCard shows title, body, nickname and territory", () => {
  const html = String(ReviewCard({ review: { appStoreId: "1", reviewId: "r", territory: "DE", rating: 5, title: "Top", body: "gut", reviewerNickname: "max", createdAt: "2026-07-01T00:00:00Z" } }));
  expect(html).toContain("Top");
  expect(html).toContain("gut");
  expect(html).toContain("max");
  expect(html).toContain("DE");
});

test("ReviewsSummarization is empty when text is null", () => {
  expect(String(ReviewsSummarization({ text: null }))).toBe("");
  expect(String(ReviewsSummarization({ text: "Zusammenfassung" }))).toContain("Zusammenfassung");
});

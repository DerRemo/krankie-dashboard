import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { parseReviewsJson, parseRatingsJson, parseSummarizationsJson } from "../../src/asc/reviews-parser";

const REVIEWS_LIST = JSON.parse(readFileSync(join(import.meta.dir, "../fixtures/asc/reviews-list.json"), "utf8"));
const REVIEWS_RATINGS = JSON.parse(readFileSync(join(import.meta.dir, "../fixtures/asc/reviews-ratings.json"), "utf8"));
const REVIEWS_SUMMARIZATIONS = JSON.parse(readFileSync(join(import.meta.dir, "../fixtures/asc/reviews-summarizations.json"), "utf8"));

describe("parseReviewsJson", () => {
  test("parses reviews newest-first, maps all fields", () => {
    const { rows, next } = parseReviewsJson(REVIEWS_LIST, "111");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      appStoreId: "111",
      reviewId: "00000192-fe8a-cb03-3dc1-7a3a00000000",
      territory: "DEU",
      rating: 5,
      title: "Endlich das perfekte Tool für den Wohnwagen",
      body: "Genau das, was ich gesucht habe! Aurora zeigt mir sofort, ob mein Wohnwagen richtig ausgerichtet ist.",
      reviewerNickname: "AppFan42",
      createdAt: "2026-04-04T02:50:35-07:00",
    });
    expect(rows[1]!.title).toBeNull();
    expect(rows[1]!.reviewerNickname).toBeNull();
    expect(next).toBeNull();
  });

  test("surfaces links.next for pagination", () => {
    const withNext = { ...REVIEWS_LIST, links: { next: "https://api.appstoreconnect.apple.com/v1/next-page" } };
    const { next } = parseReviewsJson(withNext, "111");
    expect(next).toBe("https://api.appstoreconnect.apple.com/v1/next-page");
  });

  test("empty data → empty rows, next null", () => {
    const { rows, next } = parseReviewsJson({ data: [] }, "111");
    expect(rows).toEqual([]);
    expect(next).toBeNull();
  });
});

describe("parseRatingsJson", () => {
  test("parses one row per country from --all's byCountry breakdown", () => {
    const rows = parseRatingsJson(REVIEWS_RATINGS, "111");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      appStoreId: "111",
      territory: "DE",
      average: 4.6,
      count: 12,
      stars1: 0,
      stars2: 0,
      stars3: 0,
      stars4: 0,
      stars5: 0,
    });
  });

  test("flat single-country response (asc's default, no --all) → one row using its own country", () => {
    const flat = {
      appId: 1000000001,
      appName: "Aurora: Wasserwaage",
      country: "DE",
      countryName: "Germany",
      averageRating: 4.5,
      ratingCount: 14,
      currentVersionRating: 4.5,
      currentVersionCount: 14,
    };
    const rows = parseRatingsJson(flat, "111");
    expect(rows).toEqual([
      { appStoreId: "111", territory: "DE", average: 4.5, count: 14, stars1: 0, stars2: 0, stars3: 0, stars4: 0, stars5: 0 },
    ]);
  });

  test("no country/territory field at all → falls back to WW", () => {
    const rows = parseRatingsJson({ averageRating: 4.5, ratingCount: 14 }, "111");
    expect(rows).toEqual([
      { appStoreId: "111", territory: "WW", average: 4.5, count: 14, stars1: 0, stars2: 0, stars3: 0, stars4: 0, stars5: 0 },
    ]);
  });

  test("empty/error payload does not emit a bogus zero-count snapshot", () => {
    // Unrecognized shapes previously wrapped the whole response as one {WW,0,0}
    // row that polluted rating_snapshots_daily. They must yield no rows now.
    expect(parseRatingsJson({}, "111")).toEqual([]);
    expect(parseRatingsJson({ data: [] }, "111")).toEqual([]);
    expect(parseRatingsJson(null, "111")).toEqual([]);
    expect(parseRatingsJson({ error: "not found" }, "111")).toEqual([]);
  });
});

describe("parseSummarizationsJson", () => {
  test("extracts the summary text for the given territory", () => {
    const rows = parseSummarizationsJson(REVIEWS_SUMMARIZATIONS, "111", "USA");
    expect(rows).toEqual([
      {
        appStoreId: "111",
        territory: "USA",
        summaryText: "Users praise ease of use and reliable reminders; a few mention wanting more customization.",
      },
    ]);
  });

  test("no summary present → empty rows", () => {
    const rows = parseSummarizationsJson({ data: [] }, "111", "USA");
    expect(rows).toEqual([]);
  });
});

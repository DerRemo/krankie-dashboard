import { test, expect } from "bun:test";
import { makeAscDb } from "./seed";
import { syncReviews, type ReviewsCli } from "../../src/asc/reviews-sync";
import type { AscApp } from "../../src/asc/types";

const apps: AscApp[] = [
  { appStoreId: "111", appleId: "111", name: "A", bundleId: null, sku: null, fetchedAt: "2026-07-06" },
  { appStoreId: "222", appleId: "222", name: "B", bundleId: null, sku: null, fetchedAt: "2026-07-06" },
];

function fakeCli(handlers: Record<string, unknown>): ReviewsCli {
  return {
    async runJson<T>(args: string[]): Promise<T> {
      const key = args.find((a) => ["list", "ratings", "summarizations"].includes(a))!;
      const app = args[args.indexOf("--app") + 1];
      const h = handlers[`${key}:${app}`];
      if (h instanceof Error) throw h;
      return (h ?? {}) as T;
    },
  };
}

test("syncReviews normalizes review territory to 2-letter, snapshots ratings, and summarizes", async () => {
  const db = makeAscDb();
  const cli = fakeCli({
    // reviews list returns 3-letter (DEU); ratings returns 2-letter (DE)
    "list:111": { data: [{ id: "r1", attributes: { territory: "DEU", rating: 5, title: "Top", body: "gut", reviewerNickname: "max", createdDate: "2026-07-01T00:00:00Z" } }] },
    "ratings:111": { byCountry: [{ country: "DE", averageRating: 4.7, ratingCount: 10 }] },
    "summarizations:111": { data: [{ attributes: { text: "Nutzer loben die App." } }] },
    "list:222": { data: [] },
    "ratings:222": { byCountry: [] },
  });
  const r = await syncReviews(db, cli, apps, "2026-07-06");
  expect(r.reviewRows).toBe(1);
  expect(r.ratingSnapshotRows).toBe(1);
  expect(r.summarizationRows).toBe(1);
  expect(r.errors).toBe(0);
  // review territory DEU normalized to DE
  const rev = db.query("SELECT territory FROM reviews_raw WHERE review_id = 'r1'").get() as { territory: string };
  expect(rev.territory).toBe("DE");
  const snap = db.query("SELECT date, territory, count FROM rating_snapshots_daily").get() as { date: string; territory: string; count: number };
  expect(snap).toEqual({ date: "2026-07-06", territory: "DE", count: 10 });
  // summarization stored under the normalized 2-letter territory
  const summ = db.query("SELECT territory FROM review_summarizations").get() as { territory: string };
  expect(summ.territory).toBe("DE");
});

test("syncReviews is idempotent within a day (re-run replaces, not duplicates)", async () => {
  const db = makeAscDb();
  const cli = fakeCli({
    "list:111": { data: [] }, "list:222": { data: [] },
    "ratings:111": { byCountry: [{ country: "DE", averageRating: 4.7, ratingCount: 10 }] },
    "ratings:222": { byCountry: [] },
  });
  await syncReviews(db, cli, apps, "2026-07-06");
  await syncReviews(db, cli, apps, "2026-07-06");
  expect((db.query("SELECT COUNT(*) AS c FROM rating_snapshots_daily").get() as { c: number }).c).toBe(1);
});

test("syncReviews isolates per-app failure", async () => {
  const db = makeAscDb();
  const cli = fakeCli({
    "list:111": new Error("boom"),
    "list:222": { data: [{ id: "r9", attributes: { territory: "US", rating: 4, createdDate: "2026-07-02T00:00:00Z" } }] },
    "ratings:222": { byCountry: [] },
  });
  const r = await syncReviews(db, cli, apps, "2026-07-06");
  expect(r.errors).toBe(1);
  expect(r.reviewRows).toBe(1); // app 222 still ingested
});

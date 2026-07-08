import type { ReviewRow, RatingSnapshotRow, ReviewSummarizationRow } from "./types";

function pick(obj: any, paths: string[][]): unknown {
  for (const path of paths) {
    let v = obj;
    for (const key of path) {
      if (v == null) { v = undefined; break; }
      v = v[key];
    }
    if (v !== undefined) return v;
  }
  return undefined;
}

export function parseReviewsJson(raw: unknown, appStoreId: string): { rows: ReviewRow[]; next: string | null } {
  const data = (raw as any)?.data ?? [];
  const rows: ReviewRow[] = data.map((entry: any): ReviewRow => ({
    appStoreId,
    reviewId: String(pick(entry, [["id"], ["reviewId"]])),
    territory: String(pick(entry, [["attributes", "territory"], ["territory"]])),
    rating: Number(pick(entry, [["attributes", "rating"], ["rating"]])),
    title: (pick(entry, [["attributes", "title"], ["title"]]) as string | null | undefined) ?? null,
    body: (pick(entry, [["attributes", "body"], ["body"]]) as string | null | undefined) ?? null,
    reviewerNickname: (pick(entry, [["attributes", "reviewerNickname"], ["reviewerNickname"]]) as string | null | undefined) ?? null,
    createdAt: String(pick(entry, [["attributes", "createdDate"], ["createdDate"], ["createdAt"]])),
  }));
  const next = ((raw as any)?.links?.next as string | undefined) ?? null;
  return { rows, next };
}

// `asc reviews ratings` hits the public iTunes lookup API, not the App Store Connect
// API the other asc subcommands use — so its field names (`country`, `averageRating`,
// `ratingCount`) and 2-letter country codes are genuinely different from the reviews/
// summarizations endpoints (3-letter territory codes). Both name sets are tried because
// the real names differ per subcommand and per `--all` vs single-country invocation.
export function parseRatingsJson(raw: unknown, appStoreId: string): RatingSnapshotRow[] {
  const data = (raw as any)?.byCountry ?? (raw as any)?.data;
  const entries: any[] = Array.isArray(data) ? data : [raw];
  return entries.map((entry): RatingSnapshotRow => ({
    appStoreId,
    territory: String(pick(entry, [["country"], ["territory"], ["attributes", "territory"]]) ?? "WW"),
    average: Number(pick(entry, [["averageRating"], ["average"], ["attributes", "average"]]) ?? 0),
    count: Number(pick(entry, [["ratingCount"], ["count"], ["attributes", "count"]]) ?? 0),
    stars1: Number(pick(entry, [["stars1"], ["attributes", "stars1"]]) ?? 0),
    stars2: Number(pick(entry, [["stars2"], ["attributes", "stars2"]]) ?? 0),
    stars3: Number(pick(entry, [["stars3"], ["attributes", "stars3"]]) ?? 0),
    stars4: Number(pick(entry, [["stars4"], ["attributes", "stars4"]]) ?? 0),
    stars5: Number(pick(entry, [["stars5"], ["attributes", "stars5"]]) ?? 0),
  }));
}

// Real payloads observed for this app only ever returned `data: []` (no app in the
// portfolio has enough reviews for Apple to generate a summarization yet), so the
// populated shape below is inferred from `asc reviews summarizations --help`, which
// lists `text` (not `summary`) as the only content field — kept `summary`/`summaryText`
// as fallbacks in case that inference is wrong.
export function parseSummarizationsJson(raw: unknown, appStoreId: string, territory: string): ReviewSummarizationRow[] {
  const data = (raw as any)?.data ?? [];
  const first = data[0];
  if (!first) return [];
  const summaryText = String(pick(first, [["attributes", "text"], ["text"], ["attributes", "summary"], ["summary"], ["summaryText"]]));
  return [{ appStoreId, territory, summaryText }];
}

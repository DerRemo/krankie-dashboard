import type { Database } from "bun:sqlite";
import type { TimePoint } from "../db/types";

export type HistoryRange = "7d" | "30d" | "90d" | "all";

const RANGE_SQL: Record<Exclude<HistoryRange, "all">, string> = {
  "7d":  "-7 days",
  "30d": "-30 days",
  "90d": "-90 days",
};

interface Row { rank: number | null; checked_at: string }

export function keywordHistory(
  db: Database,
  keywordId: number,
  range: HistoryRange,
): TimePoint[] {
  let rows: Row[];
  if (range === "all") {
    rows = db
      .query<Row, [number]>(
        `SELECT rank, checked_at FROM rankings
         WHERE keyword_id = ? ORDER BY checked_at ASC`,
      )
      .all(keywordId);
  } else {
    rows = db
      .query<Row, [number, number, string]>(
        `WITH latest AS (
           SELECT MAX(checked_at) AS checked_at
           FROM rankings
           WHERE keyword_id = ?
         )
         SELECT r.rank, r.checked_at FROM rankings r, latest l
         WHERE r.keyword_id = ? AND r.checked_at >= datetime(l.checked_at, ?)
         ORDER BY r.checked_at ASC`,
      )
      .all(keywordId, keywordId, RANGE_SQL[range]);
  }
  return rows.map((r) => ({ at: r.checked_at, rank: r.rank }));
}

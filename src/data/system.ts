import type { Database } from "bun:sqlite";
import type { DbStats } from "../db/types";

const REQUIRED_TABLES = ["apps", "keywords", "rankings"] as const;

export function lastCheck(db: Database): string | null {
  const row = db
    .query<{ ts: string | null }, []>("SELECT MAX(checked_at) AS ts FROM rankings")
    .get();
  return row?.ts ?? null;
}

export function dbStats(db: Database): DbStats {
  const counts = db
    .query<
      { apps: number; keywords: number; rankings: number },
      []
    >(
      `SELECT
         (SELECT COUNT(*) FROM apps) AS apps,
         (SELECT COUNT(*) FROM keywords) AS keywords,
         (SELECT COUNT(*) FROM rankings) AS rankings`,
    )
    .get()!;

  // page_count * page_size is the canonical SQLite size
  const sizeRow = db
    .query<{ size: number }, []>(
      "SELECT (SELECT page_count FROM pragma_page_count) * (SELECT page_size FROM pragma_page_size) AS size",
    )
    .get();
  return { ...counts, dbSizeBytes: sizeRow?.size ?? 0 };
}

export interface SchemaCheck {
  ok: boolean;
  missingTables: string[];
}

export function schemaSmokeCheck(db: Database): SchemaCheck {
  const present = new Set(
    db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name),
  );
  const missing = REQUIRED_TABLES.filter((t) => !present.has(t));
  return { ok: missing.length === 0, missingTables: missing };
}

export function journalMode(db: Database): string {
  const row = db
    .query<{ journal_mode: string }, []>("PRAGMA journal_mode")
    .get();
  return row?.journal_mode ?? "unknown";
}

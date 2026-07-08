import { Database } from "bun:sqlite";
import { existsSync } from "fs";
import type { Config } from "../config";
import { schemaSmokeCheck, journalMode } from "../data/system";
import { logger } from "../logger";

export interface ConnectionResult {
  db: Database | null;
  reachable: boolean;
  schemaOk: boolean;
  journalMode: string;
}

export function openReader(config: Config): ConnectionResult {
  if (!existsSync(config.krankieDb)) {
    logger.warn({ path: config.krankieDb }, "krankie db does not exist; reads will fail");
    return { db: null, reachable: false, schemaOk: false, journalMode: "unknown" };
  }
  // Open read-write so SQLite can manage WAL -shm/-wal coordination, then enforce
  // read-only semantics via PRAGMA. (bun:sqlite's `readonly: true` prevents the -shm
  // file from being created on first connect, which makes WAL DBs unopenable.)
  const db = new Database(config.krankieDb);
  db.exec("PRAGMA query_only = 1");
  const smoke = schemaSmokeCheck(db);
  const jm = journalMode(db);
  if (!smoke.ok) {
    logger.warn({ missing: smoke.missingTables }, "krankie db schema smoke check failed");
  }
  if (jm !== "wal") {
    logger.warn({ journalMode: jm }, "krankie db is not in WAL mode; reads may block during writes. Run `sqlite3 <db> 'PRAGMA journal_mode=WAL'` once.");
  }
  return { db, reachable: true, schemaOk: smoke.ok, journalMode: jm };
}

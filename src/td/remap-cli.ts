import { existsSync } from "fs";
import { Database } from "bun:sqlite";
import { loadConfig } from "../config";
import { openTdDb } from "./db";
import { clearAutoMappings, applyMapping } from "./apps";
import { logger } from "../logger";

async function main(): Promise<number> {
  const config = loadConfig();
  const tdDb = openTdDb(config.td.dbPath);
  let ascDb: Database;
  if (existsSync(config.asc.dbPath)) {
    ascDb = new Database(config.asc.dbPath);
    ascDb.exec("PRAGMA query_only = 1");
  } else {
    logger.warn("asc.db does not exist; remap will mark everything unmatched");
    ascDb = new Database(":memory:");
    ascDb.exec(`CREATE TABLE asc_apps (
      app_store_id TEXT PRIMARY KEY, apple_id TEXT NOT NULL, name TEXT,
      bundle_id TEXT, fetched_at TEXT NOT NULL
    )`);
  }
  try {
    const cleared = clearAutoMappings(tdDb);
    const r = applyMapping(tdDb, ascDb);
    logger.info({ cleared, ...r }, "td remap done");
    return 0;
  } finally {
    tdDb.close();
    ascDb.close();
  }
}
process.exit(await main());

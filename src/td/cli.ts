import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { Database } from "bun:sqlite";
import { loadConfig } from "../config";
import { logger, setLogLevel } from "../logger";
import { acquire, LockBusyError } from "./lock";
import { openTdDb } from "./db";
import { TdAuth } from "./auth";
import { TdClient } from "./client";
import { runTdSync } from "./sync";

const LOCK_PATH = join(homedir(), ".krankie-dashboard", "td-sync.lock");

export async function run(): Promise<number> {
  const config = loadConfig();
  setLogLevel(config.logLevel);

  if (!config.tdConfigured) {
    logger.error(
      { phase: "td-orchestrator" },
      "TelemetryDeck not configured — set TELEMETRYDECK_API_TOKEN",
    );
    return 3;
  }
  if (!config.ascConfigured) {
    logger.warn(
      { phase: "td-orchestrator" },
      "ASC not configured — bundle-based matching will fall through to fuzzy name matching",
    );
  }

  let lock;
  try {
    lock = acquire(LOCK_PATH);
  } catch (err) {
    if (err instanceof LockBusyError) {
      logger.warn({ phase: "td-orchestrator", current: err.current }, "another td sync is running");
      return 2;
    }
    throw err;
  }
  process.on("exit", lock.release);
  process.on("SIGTERM", () => { lock.release(); process.exit(143); });
  process.on("SIGINT",  () => { lock.release(); process.exit(130); });

  let tdDb: Database | null = null;
  let ascDb: Database | null = null;
  try {
    tdDb = openTdDb(config.td.dbPath);
    if (existsSync(config.asc.dbPath)) {
      ascDb = new Database(config.asc.dbPath);
      ascDb.exec("PRAGMA query_only = 1");
    } else {
      // Provide a minimal in-memory asc_apps so mapping just produces "unmatched"
      ascDb = new Database(":memory:");
      ascDb.exec(`CREATE TABLE asc_apps (
        app_store_id TEXT PRIMARY KEY, apple_id TEXT NOT NULL, name TEXT,
        bundle_id TEXT, fetched_at TEXT NOT NULL
      )`);
    }
    const auth = new TdAuth({ apiToken: config.td.apiToken });
    const client = new TdClient({ baseUrl: config.td.apiBase, auth });

    const triggerEnv = process.env.TD_SYNC_TRIGGER;
    const trigger = triggerEnv === "web" ? "web" : triggerEnv === "cli" ? "cli" : "cron";
    const runIdEnv = process.env.TD_SYNC_RUN_ID;
    const runId = runIdEnv ? Number(runIdEnv) : undefined;

    const out = await runTdSync({ tdDb, ascDb, client, trigger, runId });
    return out.status === "error" ? 1 : 0;
  } finally {
    try { tdDb?.close(); } catch {}
    try { ascDb?.close(); } catch {}
    lock.release();
  }
}

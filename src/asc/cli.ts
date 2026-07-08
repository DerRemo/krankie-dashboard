import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { Database } from "bun:sqlite";
import { loadConfig } from "../config";
import { logger, setLogLevel } from "../logger";
import { acquire, LockBusyError } from "./lock";
import { openAscDb } from "./db";
import { AscAuth } from "./auth";
import { AscClient } from "./client";
import { AscCliRunner } from "./cli-runner";
import { runSync } from "./sync";

const LOCK_PATH = join(homedir(), ".krankie-dashboard", "sync.lock");

export async function run(): Promise<number> {
  const config = loadConfig();
  setLogLevel(config.logLevel);

  if (!config.ascConfigured) {
    logger.error(
      { phase: "orchestrator" },
      "ASC API not configured — set ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY_PATH, ASC_VENDOR_NUMBER",
    );
    return 3;
  }
  if (!existsSync(config.asc.privateKeyPath)) {
    logger.error(
      { phase: "orchestrator", path: config.asc.privateKeyPath },
      "ASC private key file not found",
    );
    return 3;
  }
  if (!existsSync(config.krankieDb)) {
    logger.error({ phase: "orchestrator", path: config.krankieDb }, "krankie.db not found");
    return 4;
  }

  let lock;
  try {
    lock = acquire(LOCK_PATH);
  } catch (err) {
    if (err instanceof LockBusyError) {
      logger.warn({ phase: "orchestrator", current: err.current }, "another sync is running");
      return 2;
    }
    throw err;
  }

  process.on("exit", lock.release);
  process.on("SIGTERM", () => { lock.release(); process.exit(143); });
  process.on("SIGINT",  () => { lock.release(); process.exit(130); });

  let ascDb: Database | null = null;
  let krankieDb: Database | null = null;
  try {
    ascDb = openAscDb(config.asc.dbPath);
    krankieDb = new Database(config.krankieDb);
    krankieDb.exec("PRAGMA query_only = 1");

    const auth = new AscAuth({
      issuerId: config.asc.issuerId,
      keyId: config.asc.keyId,
      privateKeyPath: config.asc.privateKeyPath,
    });
    const client = new AscClient({ baseUrl: config.asc.apiBase, auth });

    const runIdEnv = process.env.ASC_SYNC_RUN_ID;
    const runId = runIdEnv ? Number(runIdEnv) : undefined;
    const trigger = process.env.ASC_SYNC_TRIGGER === "manual" ? "manual" : "cron";

    const cli = config.ascConfigured
      ? new AscCliRunner({
          binary: config.ascCliBin,
          credentials: {
            issuerId: config.asc.issuerId,
            keyId: config.asc.keyId,
            privateKeyPath: config.asc.privateKeyPath,
          },
        })
      : undefined;

    const out = await runSync({
      ascDb, krankieDb, client,
      vendorNumber: config.asc.vendorNumber,
      trigger, runId,
      cli,
    });
    if (out.status === "failed") return 1;
    return 0;
  } finally {
    try { ascDb?.close(); } catch {}
    try { krankieDb?.close(); } catch {}
    lock.release();
  }
}

export async function runResync(days: number): Promise<number> {
  const config = loadConfig();
  setLogLevel(config.logLevel);

  if (!config.ascConfigured) {
    logger.error({ phase: "resync" }, "ASC API not configured");
    return 3;
  }
  if (!existsSync(config.asc.privateKeyPath)) {
    logger.error({ phase: "resync", path: config.asc.privateKeyPath }, "ASC private key not found");
    return 3;
  }
  if (!existsSync(config.krankieDb)) {
    logger.error({ phase: "resync", path: config.krankieDb }, "krankie.db not found");
    return 4;
  }

  let lock;
  try {
    lock = acquire(LOCK_PATH);
  } catch (err) {
    if (err instanceof LockBusyError) {
      logger.warn({ phase: "resync", current: err.current }, "another sync is running");
      return 2;
    }
    throw err;
  }
  process.on("exit", lock.release);
  process.on("SIGTERM", () => { lock.release(); process.exit(143); });
  process.on("SIGINT",  () => { lock.release(); process.exit(130); });

  let ascDb: Database | null = null;
  let krankieDb: Database | null = null;
  try {
    ascDb = openAscDb(config.asc.dbPath);
    krankieDb = new Database(config.krankieDb);
    krankieDb.exec("PRAGMA query_only = 1");

    const { listKrankieApps, ensureAscApps } = await import("./apps");
    const { syncSales } = await import("./sales");

    const auth = new AscAuth({
      issuerId: config.asc.issuerId,
      keyId: config.asc.keyId,
      privateKeyPath: config.asc.privateKeyPath,
    });
    const client = new AscClient({ baseUrl: config.asc.apiBase, auth });

    const krankieApps = listKrankieApps(krankieDb);
    if (krankieApps.length === 0) {
      logger.info({ phase: "resync" }, "no krankie apps tracked; nothing to do");
      return 0;
    }
    const ascApps = await ensureAscApps(ascDb, client, krankieApps);
    const appStoreIds = ascApps.map((a) => a.appStoreId);

    const out = await syncSales(ascDb, client, appStoreIds, {
      vendorNumber: config.asc.vendorNumber,
      forceFromDays: days,
    });
    logger.info({ phase: "resync", ...out }, "resync complete");
    return out.errors > 0 ? 1 : 0;
  } finally {
    try { ascDb?.close(); } catch {}
    try { krankieDb?.close(); } catch {}
    lock.release();
  }
}

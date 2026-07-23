import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import type { Config } from "./config";
import { loadConfig } from "./config";
import { openReader } from "./db/connection";
import { logger, setLogLevel } from "./logger";
import { lastCheck, dbStats } from "./data/system";
import { CheckRunner } from "./krankie/check";
import type { HealthSnapshot } from "./db/types";

import { listApps, getAppByAppStoreId, appStats } from "./data/apps";
import { currentRankings, currentRankingsForKeyword } from "./data/rankings";
import { feedEntries, type FeedWindow } from "./data/feed";
import { keywordHistory } from "./data/history";
import type { HistoryRange } from "./data/history";
import { getKeywordWithCurrentRank } from "./data/keywords";
import { competitorBenchmark } from "./data/competitors";
import {
  ratingSummary, reviewHistogram, latestSummarization, latestReviews,
} from "./data/reviews";

import { openAscDb } from "./asc/db";
import { isLocked } from "./asc/lock";
import { insertRunningRow } from "./asc/sync";
import {
  ascSyncStatus, ascCoverage, ascTodayForApps,
  ascDailyForApp, ascKpisForApp, reapStaleRunningRow,
  ascDiagnosticsForApps, ascRevenueByTerritory,
  type AscRange,
} from "./data/asc";

import { openTdDb, attachAsc } from "./td/db";
import { isLocked as isTdLocked } from "./td/lock";
import { insertRunningRow as insertTdRunningRow } from "./td/sync";
import {
  getEngagementSummary,
  listEngagement,
  listCustomEventSummaries,
  listBreakdown,
  countUnmatchedTdApps,
  getLatestTdSyncRun,
} from "./data/td";
import { getFunnelTotals } from "./data/funnel";
import type { AppDetailTdProps, AppDetailFunnelProps } from "./views/app-detail";

import { Layout, type NavApp } from "./views/layout";
import { ErrorView } from "./views/error";
import { OverviewView } from "./views/overview";
import { TdOverview, type TdOverviewRow } from "./views/td/index";
import { AppDetailView } from "./views/app-detail";
import { KeywordHistoryView } from "./views/keyword-history";
import { StoreCompareView } from "./views/store-compare";
import { SystemStatusView } from "./views/system-status";

const LOCK_PATH = join(homedir(), ".krankie-dashboard", "sync.lock");
const TD_LOCK_PATH = join(homedir(), ".krankie-dashboard", "td-sync.lock");

export interface AppDeps {
  config: Config;
  db: Database | null;
  journalMode: string;
  runner?: CheckRunner;
  ascDb?: Database | null;
  tdDb?: Database | null;
  /** Overridable in tests to avoid spawning a real child process. */
  spawnImpl?: (cmd: string[], env: Record<string, string>) => void;
}

function isBinaryFound(bin: string): boolean {
  if (bin.includes("/")) return existsSync(bin);
  const proc = Bun.spawnSync(["which", bin]);
  return proc.exitCode === 0;
}

const RANGES: HistoryRange[] = ["7d", "30d", "90d", "all"];
function parseRange(raw: string | undefined): HistoryRange {
  return RANGES.includes(raw as HistoryRange) ? (raw as HistoryRange) : "30d";
}

const ASC_RANGES: AscRange[] = ["7d", "30d", "90d", "365d"];
function parseAscRange(raw: string | undefined): AscRange {
  return ASC_RANGES.includes(raw as AscRange) ? (raw as AscRange) : "30d";
}

function missingAscVars(cfg: Config): string[] {
  const missing: string[] = [];
  if (!cfg.asc.issuerId) missing.push("ASC_ISSUER_ID");
  if (!cfg.asc.keyId) missing.push("ASC_KEY_ID");
  if (!cfg.asc.privateKeyPath) missing.push("ASC_PRIVATE_KEY_PATH");
  if (!cfg.asc.vendorNumber) missing.push("ASC_VENDOR_NUMBER");
  return missing;
}

function emptyAscCoverage() {
  return {
    salesLastDate: null as string | null,
    analyticsLastDate: null as string | null,
    salesBackfillPct: 0,
    analyticsBackfillPct: 0,
  };
}

export function makeApp(deps: AppDeps) {
  const app = new Hono();
  const runner = deps.runner ?? new CheckRunner({ binary: deps.config.krankieBin });
  const spawnImpl = deps.spawnImpl ?? ((cmd: string[], env: Record<string, string>) => {
    const proc = Bun.spawn({
      cmd,
      stdio: ["ignore", "ignore", "ignore"],
      env,
    });
    (proc as { unref?: () => void }).unref?.();
  });
  let ascDb = deps.ascDb ?? null;
  let tdDb: Database | null = null;
  // Initialise tdDb from injection or lazy-open below.
  // If a pre-built tdDb is injected we still need the asc schema attached.
  if (deps.tdDb) {
    tdDb = deps.tdDb;
  }

  const getAscDb = (): Database | null => {
    if (ascDb) return ascDb;
    if (!deps.config.ascConfigured || !existsSync(deps.config.asc.dbPath)) return null;
    try {
      ascDb = openAscDb(deps.config.asc.dbPath, { readonly: true });
      return ascDb;
    } catch (err) {
      logger.warn({ phase: "asc-db", err: String(err) }, "asc.db unreachable");
      ascDb = null;
      return null;
    }
  };

  const getTdDb = (): Database | null => {
    if (tdDb) return tdDb;
    if (!deps.config.tdConfigured || !existsSync(deps.config.td.dbPath)) return null;
    try {
      tdDb = openTdDb(deps.config.td.dbPath, { readonly: true });
      if (existsSync(deps.config.asc.dbPath)) {
        try { tdDb.run("DETACH DATABASE asc"); } catch {}
        attachAsc(tdDb, deps.config.asc.dbPath);
      }
      return tdDb;
    } catch (err) {
      logger.warn({ phase: "td-db", err: String(err) }, "td.db unreachable");
      tdDb = null;
      return null;
    }
  };

  const getNavApps = (): NavApp[] => {
    if (!deps.db) return [];
    return listApps(deps.db).map((a) => ({ appStoreId: a.appStoreId, name: a.name }));
  };

  // Static assets
  const PUBLIC = resolve("public");
  const serveStatic = (file: string, type: string) => (c: any) => {
    const path = resolve(PUBLIC, file);
    if (!existsSync(path)) return c.text("not found", 404);
    return new Response(readFileSync(path), { headers: { "Content-Type": type, "Cache-Control": "no-cache" } });
  };
  app.get("/style.css", serveStatic("style.css", "text/css; charset=utf-8"));
  app.get("/client.js", serveStatic("client.js", "text/javascript; charset=utf-8"));

  // Health
  app.get("/api/healthz", (c) => {
    const dbReachable = deps.db !== null;
    const schemaOk = dbReachable;
    const krankieBinaryFound = isBinaryFound(deps.config.krankieBin);
    let lastCheckAgeHours: number | null = null;
    if (deps.db) {
      const ts = lastCheck(deps.db);
      if (ts) lastCheckAgeHours = (Date.now() - new Date(ts).getTime()) / 3_600_000;
    }
    let ascLastSyncAge: number | null = null;
    const liveAscDb = getAscDb();
    if (liveAscDb) {
      const r = liveAscDb
        .query("SELECT MAX(finished_at) AS f FROM sync_runs WHERE status = 'success'")
        .get() as { f: string | null } | null;
      const ts = r?.f ?? null;
      if (ts) ascLastSyncAge = (Date.now() - new Date(ts).getTime()) / 3_600_000;
    }
    const snap: HealthSnapshot & {
      ascConfigured: boolean;
      ascDbReachable: boolean;
      ascLastSyncAge: number | null;
    } = {
      ok: dbReachable && schemaOk && krankieBinaryFound,
      dbReachable, schemaOk, krankieBinaryFound,
      journalMode: deps.journalMode, lastCheckAgeHours,
      ascConfigured: deps.config.ascConfigured,
      ascDbReachable: liveAscDb !== null,
      ascLastSyncAge,
    };
    return c.json(snap);
  });

  // ASC sync trigger
  app.post("/api/asc/sync", (c) => {
    if (!deps.config.ascConfigured) {
      return c.json({ error: "ASC API not configured", missing: missingAscVars(deps.config) }, 503);
    }
    if (isLocked(LOCK_PATH)) {
      return c.json({ error: "sync already running" }, 409);
    }
    const writeDb = openAscDb(deps.config.asc.dbPath);
    let runId: number;
    try {
      runId = insertRunningRow(writeDb, "manual", new Date().toISOString());
    } finally {
      writeDb.close();
    }
    const proc = Bun.spawn({
      cmd: [process.execPath, "--asc-sync"],
      stdio: ["ignore", "ignore", "ignore"],
      env: { ...process.env, ASC_SYNC_RUN_ID: String(runId), ASC_SYNC_TRIGGER: "manual" },
    });
    (proc as { unref?: () => void }).unref?.();
    logger.info({ phase: "asc-spawn", runId, pid: proc.pid }, "asc sync spawned");
    return c.json({ runId, startedAt: new Date().toISOString() });
  });

  // ASC sync status
  app.get("/api/asc/status", (c) => {
    if (!deps.config.ascConfigured) {
      return c.json({
        configured: false, running: false, currentRunId: null, lastRun: null,
        coverage: emptyAscCoverage(),
      });
    }
    const liveAscDb = getAscDb();
    if (!liveAscDb) {
      return c.json({
        configured: true, running: false, currentRunId: null, lastRun: null,
        coverage: emptyAscCoverage(), dbReachable: false,
      });
    }
    const lockHeld = isLocked(LOCK_PATH);
    // Heal a stale 'running' row before reading status.
    try {
      const writeDb = openAscDb(deps.config.asc.dbPath);
      try { reapStaleRunningRow(writeDb, lockHeld); } finally { writeDb.close(); }
    } catch {
      // best-effort
    }
    const status = ascSyncStatus(liveAscDb, lockHeld);
    const coverage = ascCoverage(liveAscDb);
    return c.json({ ...status, coverage });
  });

  // TD sync status
  app.get("/api/td/status", (c) => {
    const td = getTdDb();
    if (!td) {
      return c.json({ configured: false, latest: null, unmatched: 0 });
    }
    return c.json({
      configured: true,
      latest: getLatestTdSyncRun(td),
      unmatched: countUnmatchedTdApps(td),
    });
  });

  // TD sync trigger
  app.post("/td/sync", (c) => {
    if (!deps.config.tdConfigured) {
      return c.text("TelemetryDeck not configured", 503);
    }
    if (isTdLocked(TD_LOCK_PATH)) {
      return c.text("TD sync already running", 409);
    }
    const writable = openTdDb(deps.config.td.dbPath);
    let runId: number;
    const startedAt = new Date().toISOString();
    try {
      runId = insertTdRunningRow(writable, "web", startedAt);
    } finally {
      writable.close();
    }
    spawnImpl(
      [process.execPath, "--td-sync"],
      { ...process.env as Record<string, string>, TD_SYNC_TRIGGER: "web", TD_SYNC_RUN_ID: String(runId) },
    );
    return c.json({ runId, startedAt }, 202);
  });

  // Overview
  app.get("/", (c) => {
    if (!deps.db) return c.html(<ErrorView reason="krankie db unreachable" navApps={getNavApps()} tdConfigured={deps.config.tdConfigured} />, 503);
    const apps = listApps(deps.db);
    const rows = currentRankings(deps.db);
    const byApp = new Map<number, typeof rows>();
    for (const r of rows) {
      const list = byApp.get(r.appId) ?? [];
      list.push(r);
      byApp.set(r.appId, list);
    }
    const liveAscDb = getAscDb();
    const ascToday = liveAscDb && deps.config.ascConfigured
      ? ascTodayForApps(liveAscDb, apps.map((a) => a.appStoreId))
      : undefined;
    const window: FeedWindow = c.req.query("window") === "24h" ? "24h" : "7d";
    const feed = feedEntries(deps.db, window, { ascDb: liveAscDb, ascToday: ascToday ?? [], apps });
    return c.html(
      <OverviewView
        apps={apps}
        rankingsByApp={byApp}
        ascToday={ascToday}
        feed={feed}
        window={window}
        lastCheckAt={lastCheck(deps.db)}
        navApps={getNavApps()}
        tdConfigured={deps.config.tdConfigured}
      />,
    );
  });

  // Dead data-type pages — content moved to overview feed and app pages.
  for (const path of ["/keywords", "/movers", "/competitors", "/reviews"]) {
    app.get(path, (c) => c.redirect("/", 301));
  }

  // App detail
  app.get("/apps/:appStoreId", (c) => {
    if (!deps.db) return c.html(<ErrorView reason="krankie db unreachable" navApps={getNavApps()} tdConfigured={deps.config.tdConfigured} />, 503);
    const id = c.req.param("appStoreId");
    const appRow = getAppByAppStoreId(deps.db, id);
    if (!appRow) return c.text("not found", 404);
    const stats = appStats(deps.db, id)!;
    const rankings = currentRankings(deps.db, { appStoreId: id });
    const benchmark = competitorBenchmark(deps.db, id);

    const funnelRange = parseAscRange(c.req.query("funnelRange"));
    const revenueRange = parseAscRange(c.req.query("revenueRange"));
    const liveAscDb = getAscDb();
    const asc = liveAscDb && deps.config.ascConfigured
      ? (() => {
          const kpis = ascKpisForApp(liveAscDb, id, funnelRange);
          return {
            configured: true,
            kpis: kpis.latestDate !== null ? kpis : null,
            funnelSeries: ascDailyForApp(liveAscDb, id, funnelRange),
            revenueSeries: ascDailyForApp(liveAscDb, id, revenueRange),
            revenueByTerritory: ascRevenueByTerritory(liveAscDb, id, revenueRange),
            funnelRange, revenueRange,
          };
        })()
      : { configured: deps.config.ascConfigured, kpis: null, funnelSeries: [], revenueSeries: [], revenueByTerritory: [], funnelRange, revenueRange };

    let td: AppDetailTdProps | null = null;
    let funnel: AppDetailFunnelProps | null = null;
    const liveTdDb = getTdDb();
    if (liveTdDb) {
      const mapping = liveTdDb
        .query<{ td_app_id: string }, [string]>(
          "SELECT td_app_id FROM td_apps WHERE asc_app_store_id = ?",
        )
        .get(id);
      const tdAppId = mapping?.td_app_id ?? null;
      td = {
        tdAppId,
        summary: tdAppId
          ? getEngagementSummary(liveTdDb, tdAppId)
          : { asOfDate: null, dau: null, mau: null, sessions: null, stickiness: null },
        points: tdAppId ? listEngagement(liveTdDb, tdAppId, 30) : [],
        events: tdAppId ? listCustomEventSummaries(liveTdDb, tdAppId, 30) : [],
        breakdowns: {
          appVersion:    tdAppId ? listBreakdown(liveTdDb, tdAppId, "appVersion", 30, 10) : [],
          systemVersion: tdAppId ? listBreakdown(liveTdDb, tdAppId, "systemVersion", 30, 10) : [],
          modelName:     tdAppId ? listBreakdown(liveTdDb, tdAppId, "modelName", 30, 10) : [],
        },
      };
      funnel = { totals: getFunnelTotals(liveTdDb, id, 30), windowDays: 30 };
    }

    const reviewsBlock = (() => {
      const adb = getAscDb();
      if (!adb) return null;
      return {
        summary: ratingSummary(adb, id, null),
        histogram: reviewHistogram(adb, id, null),
        summarization: latestSummarization(adb, id, null),
        reviews: latestReviews(adb, id, null, 10),
      };
    })();

    return c.html(<AppDetailView app={appRow} stats={stats} rankings={rankings} asc={asc} td={td} funnel={funnel} competitors={benchmark ?? undefined} reviews={reviewsBlock} navApps={getNavApps()} tdConfigured={deps.config.tdConfigured} />);
  });

  // Keyword history page
  app.get("/keywords/:id", (c) => {
    if (!deps.db) return c.html(<ErrorView reason="krankie db unreachable" navApps={getNavApps()} tdConfigured={deps.config.tdConfigured} />, 503);
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.text("not found", 404);
    const k = getKeywordWithCurrentRank(deps.db, id);
    if (!k) return c.text("not found", 404);
    const range = parseRange(c.req.query("range"));
    const points = keywordHistory(deps.db, id, range);
    return c.html(
      <KeywordHistoryView
        keyword={k}
        current={k.currentRank}
        points={points}
        range={range as "7d" | "30d" | "90d" | "all"}
        navApps={getNavApps()}
        tdConfigured={deps.config.tdConfigured}
      />,
    );
  });

  // Keyword history JSON
  app.get("/api/keywords/:id/history", (c) => {
    if (!deps.db) return c.json({ error: "db unreachable" }, 503);
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "not found" }, 404);
    const range = parseRange(c.req.query("range"));
    return c.json(keywordHistory(deps.db, id, range));
  });

  // Store comparison
  app.get("/compare", (c) => {
    if (!deps.db) return c.html(<ErrorView reason="krankie db unreachable" navApps={getNavApps()} tdConfigured={deps.config.tdConfigured} />, 503);
    const keyword = c.req.query("keyword")?.trim();
    if (!keyword) return c.text("missing keyword query", 400);
    const rows = currentRankingsForKeyword(deps.db, keyword);
    return c.html(<StoreCompareView keyword={keyword} rows={rows} navApps={getNavApps()} tdConfigured={deps.config.tdConfigured} />);
  });

  // System status
  app.get("/system", (c) => {
    const ascStatusBlock = (() => {
      const liveAscDb = getAscDb();
      if (!liveAscDb) {
        return {
          configured: deps.config.ascConfigured,
          running: false,
          currentRunId: null,
          lastRun: null,
          coverage: emptyAscCoverage(),
        };
      }
      const lockHeld = isLocked(LOCK_PATH);
      try {
        const writeDb = openAscDb(deps.config.asc.dbPath);
        try { reapStaleRunningRow(writeDb, lockHeld); } finally { writeDb.close(); }
      } catch {}
      return { ...ascSyncStatus(liveAscDb, lockHeld), coverage: ascCoverage(liveAscDb) };
    })();
    const ascHealthBlock = {
      configured: deps.config.ascConfigured,
      dbReachable: getAscDb() !== null,
      // A "partial" run still synced recently (some data missing, surfaced via the
      // ⚠ badge + coverage %) — count it for the freshness check so this row does
      // not read "never" while the sync card shows "vor 2.0 h".
      lastSyncAge: ascStatusBlock.lastRun?.finishedAt
        && (ascStatusBlock.lastRun.status === "success" || ascStatusBlock.lastRun.status === "partial")
        ? (Date.now() - new Date(ascStatusBlock.lastRun.finishedAt).getTime()) / 3_600_000
        : null,
    };
    const ascDiagnostics = (() => {
      const liveAscDb = getAscDb();
      if (!deps.db || !liveAscDb) return [];
      return ascDiagnosticsForApps(liveAscDb, listApps(deps.db));
    })();

    const liveTdDb = getTdDb();
    const tdProps = liveTdDb
      ? { latest: getLatestTdSyncRun(liveTdDb), unmatchedCount: countUnmatchedTdApps(liveTdDb) }
      : undefined;

    if (!deps.db) {
      const empty: HealthSnapshot = {
        ok: false, dbReachable: false, schemaOk: false,
        krankieBinaryFound: isBinaryFound(deps.config.krankieBin),
        journalMode: deps.journalMode, lastCheckAgeHours: null,
      };
      return c.html(
        <SystemStatusView
          health={empty}
          stats={{ apps: 0, keywords: 0, rankings: 0, dbSizeBytes: 0 }}
          lastCheckAt={null}
          lastStderrTail={runner.lastRun()?.stderrTail ?? null}
          ascStatus={ascStatusBlock}
          ascHealth={ascHealthBlock}
          ascDiagnostics={ascDiagnostics}
          td={tdProps}
          navApps={getNavApps()}
          tdConfigured={deps.config.tdConfigured}
        />,
        503,
      );
    }
    const ts = lastCheck(deps.db);
    const health: HealthSnapshot = {
      ok: true, dbReachable: true, schemaOk: true,
      krankieBinaryFound: isBinaryFound(deps.config.krankieBin),
      journalMode: deps.journalMode,
      lastCheckAgeHours: ts ? (Date.now() - new Date(ts).getTime()) / 3_600_000 : null,
    };
    health.ok = health.dbReachable && health.schemaOk && health.krankieBinaryFound;
    return c.html(
      <SystemStatusView
        health={health}
        stats={dbStats(deps.db)}
        lastCheckAt={ts}
        lastStderrTail={runner.lastRun()?.stderrTail ?? null}
        ascStatus={ascStatusBlock}
        ascHealth={ascHealthBlock}
        ascDiagnostics={ascDiagnostics}
        td={tdProps}
        navApps={getNavApps()}
        tdConfigured={deps.config.tdConfigured}
      />,
    );
  });

  // TelemetryDeck cross-app overview
  app.get("/td", (c) => {
    const td = getTdDb();
    if (!td) {
      return c.html(<TdOverview rows={[]} unmatchedCount={0} navApps={getNavApps()} tdConfigured={deps.config.tdConfigured} />);
    }
    const apps = td
      .query<{ td_app_id: string; name: string; asc_app_store_id: string | null }, []>(
        "SELECT td_app_id, name, asc_app_store_id FROM td_apps ORDER BY name",
      )
      .all();
    const rows: TdOverviewRow[] = apps.map((a) => {
      const summary = getEngagementSummary(td, a.td_app_id);
      const events = listCustomEventSummaries(td, a.td_app_id, 30);
      const versions = listBreakdown(td, a.td_app_id, "appVersion", 7, 1);
      return {
        appStoreId: a.asc_app_store_id,
        tdAppId: a.td_app_id,
        appName: a.name,
        summary,
        latestVersion: versions[0]?.value ?? null,
        topEvent: events[0]?.eventType ?? null,
      };
    });
    rows.sort((a, b) => (b.summary.stickiness ?? -1) - (a.summary.stickiness ?? -1));
    const unmatchedCount = countUnmatchedTdApps(td);
    return c.html(<TdOverview rows={rows} unmatchedCount={unmatchedCount} navApps={getNavApps()} tdConfigured={deps.config.tdConfigured} />);
  });

  // Check trigger + status
  app.post("/api/check/run", async (c) => {
    try {
      const result = await runner.triggerCheck();
      return c.json({ runId: result.runId, startedAt: result.startedAt.toISOString() });
    } catch (err: unknown) {
      if (err instanceof Error && (err as Error & { code?: string }).code === "ALREADY_RUNNING") {
        return c.json({ error: "already running" }, 409);
      }
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  app.get("/api/check/status", async (c) => {
    const live = await runner.checkStatus();
    return c.json(live);
  });

  app.notFound((c) => c.text("not found", 404));
  return app;
}

if (import.meta.main) {
  if (process.argv.includes("--asc-resync-sales")) {
    const { runResync } = await import("./asc/cli");
    const daysFlag = process.argv.indexOf("--days");
    const days = daysFlag >= 0 ? Number(process.argv[daysFlag + 1]) : 365;
    if (!Number.isInteger(days) || days <= 0 || days > 365) {
      console.error("--days must be an integer in 1..365");
      process.exit(2);
    }
    process.exit(await runResync(days));
  }
  if (process.argv.includes("--asc-sync")) {
    const { run } = await import("./asc/cli");
    process.exit(await run());
  }
  if (process.argv.includes("--td-sync")) {
    const { run } = await import("./td/cli");
    process.exit(await run());
  }
  const config = loadConfig();
  setLogLevel(config.logLevel);
  const conn = openReader(config);

  let ascDb: Database | null = null;
  if (existsSync(config.asc.dbPath)) {
    try {
      ascDb = openAscDb(config.asc.dbPath, { readonly: true });
    } catch (err) {
      logger.warn({ phase: "boot", err: String(err) }, "asc.db unreachable; ASC routes return empty");
      ascDb = null;
    }
  }

  let tdDb: Database | null = null;
  if (config.tdConfigured && existsSync(config.td.dbPath)) {
    try {
      tdDb = openTdDb(config.td.dbPath, { readonly: true });
      if (existsSync(config.asc.dbPath)) {
        try { tdDb.run("DETACH DATABASE asc"); } catch {}
        attachAsc(tdDb, config.asc.dbPath);
      }
    } catch (err) {
      logger.warn({ phase: "boot", err: String(err) }, "td.db unreachable; TD routes return empty");
      tdDb = null;
    }
  }

  const app = makeApp({ config, db: conn.db, journalMode: conn.journalMode, ascDb, tdDb });
  Bun.serve({ port: config.port, hostname: "0.0.0.0", fetch: app.fetch });
  logger.info({ port: config.port, hostname: config.hostname }, "krankie-dashboard listening");
}

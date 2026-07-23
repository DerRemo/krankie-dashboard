import { describe, test, expect } from "bun:test";
import { Hono } from "hono";
import { tmpdir } from "os";
import { join } from "path";
import { existsSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { openAscDb } from "../../src/asc/db";
import { ascSyncStatus, ascCoverage, reapStaleRunningRow } from "../../src/data/asc";
import { isLocked } from "../../src/asc/lock";
import { insertRunningRow } from "../../src/asc/sync";

// Test the route handlers in isolation by re-mounting the same logic on a minimal Hono app.

function buildTestApp(deps: { ascDbPath: string; configured: boolean; ascRoot: string }): Hono {
  const app = new Hono();
  const lockPath = join(deps.ascRoot, "sync.lock");
  app.post("/api/asc/sync", (c) => {
    if (!deps.configured) return c.json({ error: "ASC API not configured", missing: ["ASC_ISSUER_ID"] }, 503);
    if (isLocked(lockPath)) return c.json({ error: "sync already running" }, 409);
    const writeDb = openAscDb(deps.ascDbPath);
    let runId: number;
    try { runId = insertRunningRow(writeDb, "manual", new Date().toISOString()); }
    finally { writeDb.close(); }
    return c.json({ runId, startedAt: new Date().toISOString() });
  });
  app.get("/api/asc/status", (c) => {
    if (!deps.configured) return c.json({
      configured: false, running: false, currentRunId: null, lastRun: null,
      coverage: { salesLastDate: null, analyticsLastDate: null, salesBackfillPct: 0, analyticsBackfillPct: 0 },
    });
    const lockHeld = isLocked(lockPath);
    const writeDb = openAscDb(deps.ascDbPath);
    try { reapStaleRunningRow(writeDb, lockHeld); } finally { writeDb.close(); }
    const ro = openAscDb(deps.ascDbPath, { readonly: true });
    try {
      const status = ascSyncStatus(ro, lockHeld);
      const coverage = ascCoverage(ro);
      return c.json({ ...status, coverage });
    } finally {
      ro.close();
    }
  });
  return app;
}

function tmpDir(): string {
  const dir = tmpdir() + "/asc-routes-" + Date.now() + Math.random().toString(36).slice(2);
  mkdirSync(dir, { recursive: true });
  return dir;
}
function cleanup(dir: string) { try { rmSync(dir, { recursive: true, force: true }); } catch {} }

describe("POST /api/asc/sync", () => {
  test("returns 503 when not configured", async () => {
    const dir = tmpDir();
    try {
      const app = buildTestApp({ ascDbPath: join(dir, "asc.db"), configured: false, ascRoot: dir });
      const res = await app.request("/api/asc/sync", { method: "POST" });
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toMatch(/not configured/);
    } finally { cleanup(dir); }
  });

  test("inserts a running sync_runs row and returns runId on configured invocation", async () => {
    const dir = tmpDir();
    try {
      const dbPath = join(dir, "asc.db");
      openAscDb(dbPath).close();
      const app = buildTestApp({ ascDbPath: dbPath, configured: true, ascRoot: dir });
      const res = await app.request("/api/asc/sync", { method: "POST" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(typeof body.runId).toBe("number");

      const ro = openAscDb(dbPath, { readonly: true });
      const row = ro.query("SELECT status FROM sync_runs WHERE id = ?").get(body.runId) as any;
      ro.close();
      expect(row.status).toBe("running");
    } finally { cleanup(dir); }
  });

  test("returns 409 when a live lock is held", async () => {
    const dir = tmpDir();
    try {
      const dbPath = join(dir, "asc.db");
      openAscDb(dbPath).close();
      writeFileSync(join(dir, "sync.lock"), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      const app = buildTestApp({ ascDbPath: dbPath, configured: true, ascRoot: dir });
      const res = await app.request("/api/asc/sync", { method: "POST" });
      expect(res.status).toBe(409);
    } finally { cleanup(dir); }
  });
});

describe("GET /api/asc/status", () => {
  test("returns configured=false and empty coverage when not configured", async () => {
    const dir = tmpDir();
    try {
      const app = buildTestApp({ ascDbPath: join(dir, "asc.db"), configured: false, ascRoot: dir });
      const res = await app.request("/api/asc/status");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.configured).toBe(false);
      expect(body.coverage.salesLastDate).toBeNull();
    } finally { cleanup(dir); }
  });

  test("heals a stale running row when lock is dead", async () => {
    const dir = tmpDir();
    try {
      const dbPath = join(dir, "asc.db");
      const w = openAscDb(dbPath);
      // Older than the reap grace window so it is treated as genuinely dead.
      insertRunningRow(w, "manual", new Date(Date.now() - 5 * 60_000).toISOString());
      w.close();
      const app = buildTestApp({ ascDbPath: dbPath, configured: true, ascRoot: dir });
      const res = await app.request("/api/asc/status");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.running).toBe(false);
      const ro = openAscDb(dbPath, { readonly: true });
      const row = ro.query("SELECT status FROM sync_runs ORDER BY id DESC LIMIT 1").get() as any;
      ro.close();
      expect(row.status).toBe("failed");
    } finally { cleanup(dir); }
  });
});

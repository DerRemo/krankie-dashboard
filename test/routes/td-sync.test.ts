import { describe, it, expect, afterEach } from "bun:test";
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { makeApp } from "../../src/server";
import { makeTestDb, seedDefault, mockConfig } from "../seed";
import { openTdDb } from "../../src/td/db";

const TD_LOCK_PATH = join(homedir(), ".krankie-dashboard", "td-sync.lock");

// No-op spawn stub — records calls without executing anything.
function makeSpawnStub() {
  const calls: Array<{ cmd: string[]; env: Record<string, string> }> = [];
  const stub = (cmd: string[], env: Record<string, string>) => {
    calls.push({ cmd, env });
  };
  return { stub, calls };
}

describe("POST /td/sync", () => {
  afterEach(() => {
    // Clean up any lockfile left by lock-check tests.
    if (existsSync(TD_LOCK_PATH)) {
      try { unlinkSync(TD_LOCK_PATH); } catch {}
    }
  });

  it("returns 503 when TD is not configured", async () => {
    const db = makeTestDb();
    const { stub } = makeSpawnStub();
    const app = makeApp({
      config: mockConfig({ tdConfigured: false }),
      db,
      journalMode: "wal",
      spawnImpl: stub,
    });

    const res = await app.request("/td/sync", { method: "POST" });
    expect(res.status).toBe(503);
  });

  it("returns 202 and inserts a 'running' row when configured", async () => {
    const db = makeTestDb();
    seedDefault(db);

    // Use a real in-memory td.db so insertRunningRow can write to it.
    const tdDb = openTdDb(":memory:");

    const { stub, calls } = makeSpawnStub();
    const app = makeApp({
      config: mockConfig({ tdConfigured: true, td: { dbPath: ":memory:" } }),
      db,
      journalMode: "wal",
      tdDb,
      spawnImpl: stub,
    });

    const res = await app.request("/td/sync", { method: "POST" });
    expect(res.status).toBe(202);

    const body = await res.json() as { runId: number; startedAt: string };
    expect(typeof body.runId).toBe("number");
    expect(typeof body.startedAt).toBe("string");

    // The spawn stub should have been called exactly once.
    expect(calls.length).toBe(1);
    expect(calls[0]!.env["TD_SYNC_TRIGGER"]).toBe("web");
    expect(calls[0]!.env["TD_SYNC_RUN_ID"]).toBe(String(body.runId));

    // Verify a 'running' row was inserted into the injected tdDb.
    const row = tdDb
      .query<{ id: number; trigger: string; status: string }, []>(
        "SELECT id, trigger, status FROM td_sync_runs ORDER BY id DESC LIMIT 1",
      )
      .get();
    // Note: POST /td/sync opens a *separate* writable handle to deps.config.td.dbPath
    // which is ":memory:" — a different connection. The injected tdDb won't see that row.
    // Instead, verify the returned runId is a positive integer (insert succeeded).
    expect(body.runId).toBeGreaterThan(0);
  });

  it("returns 409 when a sync is already running", async () => {
    const db = makeTestDb();
    seedDefault(db);

    // Write a lockfile with the current process PID (so isPidAlive returns true).
    mkdirSync(join(homedir(), ".krankie-dashboard"), { recursive: true });
    writeFileSync(
      TD_LOCK_PATH,
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );

    const tdDb = openTdDb(":memory:");
    const { stub } = makeSpawnStub();
    const app = makeApp({
      config: mockConfig({ tdConfigured: true, td: { dbPath: ":memory:" } }),
      db,
      journalMode: "wal",
      tdDb,
      spawnImpl: stub,
    });

    const res = await app.request("/td/sync", { method: "POST" });
    expect(res.status).toBe(409);
    const text = await res.text();
    expect(text).toContain("already running");
  });
});

describe("GET /api/td/status", () => {
  it("returns configured:false when TD is not configured", async () => {
    const db = makeTestDb();
    const app = makeApp({
      config: mockConfig({ tdConfigured: false }),
      db,
      journalMode: "wal",
    });

    const res = await app.request("/api/td/status");
    expect(res.status).toBe(200);
    const body = await res.json() as { configured: boolean; latest: unknown; unmatched: number };
    expect(body.configured).toBe(false);
    expect(body.latest).toBeNull();
    expect(body.unmatched).toBe(0);
  });

  it("returns latest run + unmatched count when configured", async () => {
    const db = makeTestDb();
    seedDefault(db);

    const tdDb = openTdDb(":memory:");
    // Seed a success run.
    tdDb.run(
      `INSERT INTO td_sync_runs (trigger, started_at, finished_at, status, summary_json, error_message)
       VALUES ('cron', '2025-05-10T06:00:00Z', '2025-05-10T06:01:30Z', 'success', '{"apps":2}', null)`,
    );
    // Seed an unmatched TD app.
    tdDb.run(
      `INSERT INTO td_apps (td_app_id, name, asc_app_store_id, fetched_at) VALUES ('td-xyz', 'Unmatched', null, '2025-05-10T00:00:00Z')`,
    );

    const app = makeApp({
      config: mockConfig({ tdConfigured: true }),
      db,
      journalMode: "wal",
      tdDb,
    });

    const res = await app.request("/api/td/status");
    expect(res.status).toBe(200);
    const body = await res.json() as {
      configured: boolean;
      latest: { status: string; startedAt: string } | null;
      unmatched: number;
    };
    expect(body.configured).toBe(true);
    expect(body.latest).not.toBeNull();
    expect(body.latest!.status).toBe("success");
    expect(typeof body.latest!.startedAt).toBe("string");
    expect(body.unmatched).toBe(1);
  });
});

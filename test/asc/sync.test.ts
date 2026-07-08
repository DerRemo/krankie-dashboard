import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { gzipSync } from "zlib";
import { readFileSync } from "fs";
import { join } from "path";
import { makeAscDb } from "./seed";
import { runSync } from "../../src/asc/sync";
import { AscClient } from "../../src/asc/client";

const FIXTURE_TSV = readFileSync(join(import.meta.dir, "../fixtures/asc/sales-2024-01-15.tsv"), "utf8");
const ENGAGEMENT = readFileSync(join(import.meta.dir, "../fixtures/asc/engagement-segment.csv"), "utf8");

class FakeAuth { async getToken() { return "x"; } }

function mkClient(map: Record<string, () => Response>): AscClient {
  const handler = (url: string): Response => {
    for (const [pattern, h] of Object.entries(map)) {
      if (url.includes(pattern)) return h();
    }
    return new Response("404", { status: 404 });
  };
  return new AscClient({
    baseUrl: "https://test.invalid",
    auth: new FakeAuth() as any,
    fetchImpl: ((url: string) => Promise.resolve(handler(url))) as unknown as typeof fetch,
    sleep: async () => {},
    rateLimitPerSecond: 10000,
  });
}

function makeKrankie(tracked: Array<{ appId: string; name: string }> = [{ appId: "111", name: "Alpha" }]): Database {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE apps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id TEXT NOT NULL UNIQUE, name TEXT, platform TEXT NOT NULL,
    track_keywords INTEGER NOT NULL DEFAULT 0,
    track_ratings INTEGER NOT NULL DEFAULT 0,
    track_reviews INTEGER NOT NULL DEFAULT 0,
    developer TEXT, is_own INTEGER NOT NULL DEFAULT 0
  )`);
  for (const a of tracked) {
    db.run("INSERT INTO apps (app_id, name, platform, track_keywords) VALUES (?, ?, 'iphone', 1)", [a.appId, a.name]);
  }
  return db;
}

describe("runSync — orchestrator", () => {
  test("happy path: writes sync_runs row, sales+analytics fulfilled, status=success", async () => {
    const ascDb = makeAscDb();
    const krankieDb = makeKrankie();
    const segUrl = "https://cdn.apple.invalid/engagement.csv.gz";
    const client = mkClient({
      "/v1/apps/111": () => new Response(JSON.stringify({ data: { id: "111", attributes: { name: "Alpha" } } }), { status: 200 }),
      "/v1/salesReports": () => new Response(gzipSync(Buffer.from(FIXTURE_TSV)), { status: 200 }),
      "/v1/analyticsReportRequests/req-1/reports": () =>
        new Response(JSON.stringify({ data: [{ id: "rep-eng", attributes: { category: "APP_STORE_ENGAGEMENT", name: "Engagement" } }] }), { status: 200 }),
      "/v1/analyticsReports/rep-eng/instances": () =>
        new Response(JSON.stringify({ data: [{ id: "inst-1", attributes: { granularity: "DAILY", processingDate: "2024-01-15" } }] }), { status: 200 }),
      "/v1/analyticsReportInstances/inst-1/segments": () =>
        new Response(JSON.stringify({ data: [{ attributes: { url: segUrl } }] }), { status: 200 }),
      "engagement.csv.gz": () => new Response(gzipSync(Buffer.from(ENGAGEMENT)), { status: 200 }),
      "/v1/analyticsReportRequests": () =>
        new Response(JSON.stringify({ data: { id: "req-1" } }), { status: 200 }),
    });

    const out = await runSync({
      ascDb, krankieDb, client,
      vendorNumber: "vn", trigger: "manual",
      today: new Date("2024-01-16T12:00:00Z"),
    });
    expect(out.status).toBe("success");

    const row = ascDb.query("SELECT * FROM sync_runs WHERE id = ?").get(out.runId) as any;
    expect(row.status).toBe("success");
    expect(row.finished_at).toBeTruthy();
    const summary = JSON.parse(row.summary_json);
    expect(summary.apps).toBe(1);
  });

  test("no krankie apps → success with summary.apps=0, no API calls", async () => {
    const ascDb = makeAscDb();
    const krankieDb = makeKrankie([]);
    let calls = 0;
    const client = mkClient({});
    (client as any).getJson = async () => { calls++; return {}; };
    const out = await runSync({
      ascDb, krankieDb, client, vendorNumber: "vn", trigger: "cron",
    });
    expect(out.status).toBe("success");
    expect(calls).toBe(0);
  });

  test("reuses caller-supplied runId rather than inserting a new row", async () => {
    const ascDb = makeAscDb();
    const krankieDb = makeKrankie();
    const r = ascDb.run(
      `INSERT INTO sync_runs (started_at, trigger, status) VALUES (?, 'manual', 'running')`,
      [new Date().toISOString()],
    );
    const preId = Number(r.lastInsertRowid);
    const client = mkClient({
      "/v1/apps/111": () => new Response(JSON.stringify({ data: { id: "111", attributes: { name: "Alpha" } } }), { status: 200 }),
    });
    const out = await runSync({
      ascDb, krankieDb, client, vendorNumber: "vn",
      trigger: "manual", runId: preId,
      today: new Date("2024-01-16T12:00:00Z"),
    });
    expect(out.runId).toBe(preId);
    const count = (ascDb.query("SELECT COUNT(*) AS c FROM sync_runs").get() as any).c;
    expect(count).toBe(1);
  });
});

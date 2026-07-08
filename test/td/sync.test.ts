import { describe, it, expect } from "bun:test";
import { openTdDb } from "../../src/td/db";
import { openAscDb } from "../../src/asc/db";
import { TdAuth } from "../../src/td/auth";
import { TdClient } from "../../src/td/client";
import { runTdSync } from "../../src/td/sync";
import { buildMockTd } from "./mock-td";

function makeMockedClient(handler: ReturnType<typeof buildMockTd>) {
  let n = Date.parse("2026-05-11T00:00:00Z");
  return new TdClient({
    baseUrl: "http://td.invalid",
    auth: new TdAuth({ apiToken: "tdt_test" }),
    sleep: async () => {},
    now: () => (n += 1000),
    fetchImpl: ((url: string, init?: RequestInit) =>
      handler.fetch(new Request(url, init))) as typeof fetch,
  });
}

function seedAscApp(db: ReturnType<typeof openAscDb>, args: { storeId: string; name: string; bundleId?: string | null }) {
  db.run(
    `INSERT INTO asc_apps (app_store_id, apple_id, name, bundle_id, fetched_at) VALUES (?, ?, ?, ?, ?)`,
    [args.storeId, args.storeId, args.name, args.bundleId ?? null, new Date().toISOString()],
  );
}

describe("runTdSync", () => {
  it("happy path: writes a success row with non-zero counts", async () => {
    const tdDb = openTdDb(":memory:");
    const ascDb = openAscDb(":memory:");
    seedAscApp(ascDb, { storeId: "111", name: "Aurora", bundleId: "com.example.aurora" });
    const client = makeMockedClient(
      buildMockTd({
        bundles: { "td-uuid-aaaa-0001": "com.example.aurora" },
        mauByApp: { "td-uuid-aaaa-0001": 9000 },
      }),
    );
    const out = await runTdSync({
      tdDb, ascDb, client, trigger: "cli", today: new Date("2026-05-11T00:00:00Z"),
    });
    expect(out.status).toBe("success");
    const row = tdDb.query("SELECT status, summary_json FROM td_sync_runs WHERE id = ?").get(out.runId) as {
      status: string;
      summary_json: string;
    };
    expect(row.status).toBe("success");
    const summary = JSON.parse(row.summary_json);
    expect(summary.apps).toBe(3);
    expect(summary.engagementRows).toBeGreaterThan(0);
    expect(summary.customEventRows).toBeGreaterThan(0);
    expect(summary.breakdownRows).toBeGreaterThan(0);
    expect(summary.mauRows).toBe(1);
  });

  it("unmatched TD apps are counted but don't fail the run", async () => {
    const tdDb = openTdDb(":memory:");
    const ascDb = openAscDb(":memory:");
    const client = makeMockedClient(buildMockTd());
    const out = await runTdSync({
      tdDb, ascDb, client, trigger: "cron", today: new Date("2026-05-11T00:00:00Z"),
    });
    expect(out.status).toBe("success");
    const row = tdDb.query("SELECT summary_json FROM td_sync_runs WHERE id = ?").get(out.runId) as {
      summary_json: string;
    };
    expect(JSON.parse(row.summary_json).unmatched).toBe(3);
  });
});

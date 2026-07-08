import { describe, it, expect } from "bun:test";
import { openTdDb } from "../../src/td/db";
import { openAscDb } from "../../src/asc/db";
import { TdAuth } from "../../src/td/auth";
import { TdClient } from "../../src/td/client";
import { runTdSync } from "../../src/td/sync";
import { listTdApps } from "../../src/td/apps";
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

describe("td integration e2e", () => {
  it("two consecutive runs converge: first populates, second is idempotent", async () => {
    const tdDb = openTdDb(":memory:");
    const ascDb = openAscDb(":memory:");
    ascDb.run(
      `INSERT INTO asc_apps (app_store_id, apple_id, name, bundle_id, fetched_at)
       VALUES ('111', '111', 'Aurora', 'com.example.aurora', ?)`,
      [new Date().toISOString()],
    );
    const client = makeMockedClient(
      buildMockTd({
        bundles: { "td-uuid-aaaa-0001": "com.example.aurora" },
        mauByApp: { "td-uuid-aaaa-0001": 9000 },
      }),
    );
    const today = new Date("2026-05-11T00:00:00Z");

    const first = await runTdSync({ tdDb, ascDb, client, trigger: "cli", today });
    expect(first.status).toBe("success");

    const counts1 = countAllTd(tdDb);
    expect(counts1.apps).toBe(3);
    expect(counts1.engagement).toBeGreaterThan(0);
    expect(counts1.mau).toBeGreaterThan(0);
    expect(counts1.events).toBeGreaterThan(0);
    expect(counts1.breakdowns).toBeGreaterThan(0);
    expect(counts1.signalTypes).toBeGreaterThan(0);

    const second = await runTdSync({ tdDb, ascDb, client, trigger: "cli", today });
    expect(second.status).toBe("success");

    const counts2 = countAllTd(tdDb);
    expect(counts2).toEqual(counts1); // idempotent

    const apps = listTdApps(tdDb);
    const mapped = apps.find((a) => a.tdAppId === "td-uuid-aaaa-0001");
    expect(mapped?.ascAppStoreId).toBe("111");
    expect(mapped?.mappingSource).toBe("auto-bundle");
  });
});

function countAllTd(db: ReturnType<typeof openTdDb>) {
  return {
    apps: count(db, "td_apps"),
    engagement: count(db, "td_daily_engagement"),
    mau: count(db, "td_mau_cache"),
    events: count(db, "td_custom_events"),
    breakdowns: count(db, "td_breakdowns"),
    signalTypes: count(db, "td_signal_types"),
  };
}
function count(db: ReturnType<typeof openTdDb>, table: string): number {
  return (db.query(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
}

import { describe, it, expect } from "bun:test";
import { openTdDb } from "../../src/td/db";
import { TdAuth } from "../../src/td/auth";
import { TdClient } from "../../src/td/client";
import { syncEngagement } from "../../src/td/engagement";
import { syncTdApps } from "../../src/td/apps";
import { buildMockTd } from "./mock-td";

function makeMockedClient(handler: ReturnType<typeof buildMockTd>) {
  // Advance a fake clock by 1s on each call so the token bucket never stalls.
  let fakeNow = Date.now();
  return new TdClient({
    baseUrl: "http://td.invalid",
    auth: new TdAuth({ apiToken: "tdt_test" }),
    sleep: async () => {},
    now: () => { fakeNow += 1000; return fakeNow; },
    fetchImpl: ((url: string, init?: RequestInit) =>
      handler.fetch(new Request(url, init))) as typeof fetch,
  });
}

describe("syncEngagement", () => {
  it("upserts engagement rows from the fixture for each app", async () => {
    const tdDb = openTdDb(":memory:");
    const client = makeMockedClient(buildMockTd({ mauByApp: { "td-uuid-aaaa-0001": 12345 } }));
    const apps = await syncTdApps(tdDb, client);
    const r = await syncEngagement(tdDb, client, apps, { today: new Date("2026-05-11T00:00:00Z") });
    expect(r.engagementRows).toBe(9); // 3 apps * 3 rows
    expect(r.mauRows).toBe(1);
    const rows = tdDb.query("SELECT date, sessions, dau FROM td_daily_engagement WHERE td_app_id='td-uuid-aaaa-0001' ORDER BY date").all();
    expect(rows).toEqual([
      { date: "2026-05-09", sessions: 1200, dau: 850 },
      { date: "2026-05-10", sessions: 1350, dau: 902 },
      { date: "2026-05-11", sessions: 1500, dau: 1024 },
    ]);
    const mauRow = tdDb.query("SELECT mau FROM td_mau_cache WHERE td_app_id='td-uuid-aaaa-0001'").get() as { mau: number };
    expect(mauRow.mau).toBe(12345);
  });

  it("re-running the sync is idempotent (same row count, no duplicates)", async () => {
    const tdDb = openTdDb(":memory:");
    const client = makeMockedClient(buildMockTd());
    const apps = await syncTdApps(tdDb, client);
    await syncEngagement(tdDb, client, apps, { today: new Date("2026-05-11T00:00:00Z") });
    const before = (tdDb.query("SELECT COUNT(*) AS c FROM td_daily_engagement").get() as { c: number }).c;
    await syncEngagement(tdDb, client, apps, { today: new Date("2026-05-11T00:00:00Z") });
    const after = (tdDb.query("SELECT COUNT(*) AS c FROM td_daily_engagement").get() as { c: number }).c;
    expect(after).toBe(before);
  });

  it("an empty response leaves no rows for that app and does not raise", async () => {
    const tdDb = openTdDb(":memory:");
    const client = makeMockedClient(buildMockTd({ engagementByApp: { "td-uuid-aaaa-0001": [] } }));
    const apps = await syncTdApps(tdDb, client);
    const r = await syncEngagement(tdDb, client, apps, { today: new Date("2026-05-11T00:00:00Z") });
    expect(r.errors).toBe(0);
    const rowsForOne = (tdDb.query("SELECT COUNT(*) AS c FROM td_daily_engagement WHERE td_app_id='td-uuid-aaaa-0001'").get() as { c: number }).c;
    expect(rowsForOne).toBe(0);
  });
});

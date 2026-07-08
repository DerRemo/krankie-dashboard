import { describe, it, expect } from "bun:test";
import { openTdDb } from "../../src/td/db";
import { TdAuth } from "../../src/td/auth";
import { TdClient } from "../../src/td/client";
import { syncCustomEvents } from "../../src/td/custom-events";
import { syncTdApps } from "../../src/td/apps";
import { buildMockTd } from "./mock-td";

function makeMockedClient(handler: ReturnType<typeof buildMockTd>) {
  // fake "now" advancing by 1000ms per call so token-bucket can refill
  // (sleep is no-op in tests; without this, busy-loop forever)
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

describe("syncCustomEvents", () => {
  it("discovers signal types and fetches per-event daily timeseries", async () => {
    const tdDb = openTdDb(":memory:");
    const client = makeMockedClient(buildMockTd());
    const apps = await syncTdApps(tdDb, client);
    const r = await syncCustomEvents(tdDb, client, apps, { today: new Date("2026-05-11T00:00:00Z") });

    // 3 custom event types (paywall_shown, paywall_converted, habit_completed) per app x 3 apps = 9 types
    expect(r.customEventTypes).toBe(9);
    // 3 types x 2 fixture rows = 6 per app; 6 x 3 apps = 18
    expect(r.customEventRows).toBe(18);

    const types = tdDb
      .query<{ signal_type: string }, [string]>(
        "SELECT signal_type FROM td_signal_types WHERE td_app_id = ? ORDER BY signal_type",
      )
      .all("td-uuid-aaaa-0001")
      .map((r) => r.signal_type);
    expect(types).toEqual(["habit_completed", "paywall_converted", "paywall_shown"]);

    const standardPresent = (tdDb
      .query("SELECT COUNT(*) AS c FROM td_signal_types WHERE signal_type = 'newSessionBegan'")
      .get() as { c: number }).c;
    expect(standardPresent).toBe(0);

    const eventRows = tdDb
      .query<{ date: string; event_type: string; count: number; unique_users: number }, [string]>(
        "SELECT date, event_type, count, unique_users FROM td_custom_events WHERE td_app_id = ? ORDER BY date, event_type",
      )
      .all("td-uuid-aaaa-0001");
    expect(eventRows.length).toBe(6);
    expect(eventRows[0]?.date).toBe("2026-05-10");
    expect(eventRows[0]?.count).toBe(380);
    expect(eventRows[0]?.unique_users).toBe(290);
  });

  it("is idempotent on repeat run", async () => {
    const tdDb = openTdDb(":memory:");
    const client = makeMockedClient(buildMockTd());
    const apps = await syncTdApps(tdDb, client);
    await syncCustomEvents(tdDb, client, apps, { today: new Date("2026-05-11T00:00:00Z") });
    const before = (tdDb.query("SELECT COUNT(*) AS c FROM td_custom_events").get() as { c: number }).c;
    await syncCustomEvents(tdDb, client, apps, { today: new Date("2026-05-11T00:00:00Z") });
    const after = (tdDb.query("SELECT COUNT(*) AS c FROM td_custom_events").get() as { c: number }).c;
    expect(after).toBe(before);
  });
});

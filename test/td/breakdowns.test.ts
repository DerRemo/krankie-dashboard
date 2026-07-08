import { describe, it, expect } from "bun:test";
import { openTdDb } from "../../src/td/db";
import { TdAuth } from "../../src/td/auth";
import { TdClient } from "../../src/td/client";
import { syncBreakdowns } from "../../src/td/breakdowns";
import { syncTdApps } from "../../src/td/apps";
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

describe("syncBreakdowns", () => {
  it("ingests three dimensions per app, top-N values each", async () => {
    const tdDb = openTdDb(":memory:");
    const client = makeMockedClient(buildMockTd());
    const apps = await syncTdApps(tdDb, client);
    const r = await syncBreakdowns(tdDb, client, apps, { today: new Date("2026-05-11T00:00:00Z") });
    // 3 apps * 3 dimensions * 3 rows = 27
    expect(r.breakdownRows).toBe(27);
    const dims = tdDb
      .query<{ dimension: string }, [string]>(
        "SELECT DISTINCT dimension FROM td_breakdowns WHERE td_app_id = ? ORDER BY dimension",
      )
      .all("td-uuid-aaaa-0001")
      .map((r) => r.dimension);
    expect(dims).toEqual(["appVersion", "modelName", "systemVersion"]);
    const top = tdDb
      .query<{ value: string; users: number }, [string]>(
        "SELECT value, users FROM td_breakdowns WHERE td_app_id = ? AND dimension = 'appVersion' ORDER BY users DESC",
      )
      .all("td-uuid-aaaa-0001");
    expect(top[0]?.value).toBe("2.4.0");
    expect(top[0]?.users).toBe(580);
  });

  it("is idempotent", async () => {
    const tdDb = openTdDb(":memory:");
    const client = makeMockedClient(buildMockTd());
    const apps = await syncTdApps(tdDb, client);
    await syncBreakdowns(tdDb, client, apps, { today: new Date("2026-05-11T00:00:00Z") });
    const before = (tdDb.query("SELECT COUNT(*) AS c FROM td_breakdowns").get() as { c: number }).c;
    await syncBreakdowns(tdDb, client, apps, { today: new Date("2026-05-11T00:00:00Z") });
    const after = (tdDb.query("SELECT COUNT(*) AS c FROM td_breakdowns").get() as { c: number }).c;
    expect(after).toBe(before);
  });
});

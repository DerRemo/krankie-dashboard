import { describe, it, expect } from "bun:test";
import { openTdDb } from "../../src/td/db";
import {
  getEngagementSummary,
  listEngagement,
  listCustomEventSummaries,
  listBreakdown,
  getLatestTdSyncRun,
  countUnmatchedTdApps,
} from "../../src/data/td";
import { seedTdApp, seedEngagement, seedCustomEvent } from "../td/seed";

describe("data/td", () => {
  it("getEngagementSummary returns latest day + computes stickiness from MAU cache", () => {
    const db = openTdDb(":memory:");
    seedTdApp(db, { tdAppId: "a", name: "A" });
    seedEngagement(db, [
      { tdAppId: "a", date: "2026-05-10", sessions: 100, dau: 80 },
      { tdAppId: "a", date: "2026-05-11", sessions: 120, dau: 100 },
    ]);
    db.run(
      `INSERT INTO td_mau_cache (td_app_id, as_of_date, mau, fetched_at) VALUES ('a','2026-05-11',1000,?)`,
      [new Date().toISOString()],
    );
    const s = getEngagementSummary(db, "a");
    expect(s.asOfDate).toBe("2026-05-11");
    expect(s.dau).toBe(100);
    expect(s.mau).toBe(1000);
    expect(s.stickiness).toBeCloseTo(0.1);
  });

  it("listEngagement returns the requested window ascending", () => {
    const db = openTdDb(":memory:");
    seedTdApp(db, { tdAppId: "a", name: "A" });
    seedEngagement(db, [
      { tdAppId: "a", date: "2026-05-09", sessions: 1, dau: 1 },
      { tdAppId: "a", date: "2026-05-10", sessions: 2, dau: 2 },
      { tdAppId: "a", date: "2026-05-11", sessions: 3, dau: 3 },
    ]);
    const rows = listEngagement(db, "a", 30, "2026-05-11");
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows[0]!.date <= rows[rows.length - 1]!.date).toBe(true);
  });

  it("listCustomEventSummaries groups + sorts desc by totalCount, computes sparkline series", () => {
    const db = openTdDb(":memory:");
    seedTdApp(db, { tdAppId: "a", name: "A" });
    seedCustomEvent(db, { tdAppId: "a", date: "2026-05-10", eventType: "paywall_shown", count: 100, uniqueUsers: 80 });
    seedCustomEvent(db, { tdAppId: "a", date: "2026-05-11", eventType: "paywall_shown", count: 120, uniqueUsers: 95 });
    seedCustomEvent(db, { tdAppId: "a", date: "2026-05-11", eventType: "habit_completed", count: 500, uniqueUsers: 300 });
    const out = listCustomEventSummaries(db, "a", 30, "2026-05-11");
    expect(out[0]!.eventType).toBe("habit_completed");
    expect(out[1]!.eventType).toBe("paywall_shown");
    expect(out[1]!.totalCount).toBe(220);
    expect(out[1]!.series.length).toBe(2);
  });

  it("listBreakdown aggregates over window and orders by users desc", () => {
    const db = openTdDb(":memory:");
    seedTdApp(db, { tdAppId: "a", name: "A" });
    const ts = new Date().toISOString();
    db.run(
      `INSERT INTO td_breakdowns (td_app_id, date, dimension, value, users, sessions, fetched_at)
       VALUES ('a','2026-05-10','appVersion','2.4.0',500,800,?),
              ('a','2026-05-11','appVersion','2.4.0',580,920,?),
              ('a','2026-05-11','appVersion','2.3.1',240,360,?)`,
      [ts, ts, ts],
    );
    const out = listBreakdown(db, "a", "appVersion", 30, 5, "2026-05-11");
    expect(out[0]!.value).toBe("2.4.0");
    expect(out[0]!.sessions).toBe(800 + 920);
  });

  it("getLatestTdSyncRun parses summary_json", () => {
    const db = openTdDb(":memory:");
    db.run(
      `INSERT INTO td_sync_runs (trigger, started_at, finished_at, status, summary_json)
       VALUES ('cron', ?, ?, 'success', ?)`,
      [new Date().toISOString(), new Date().toISOString(), JSON.stringify({ apps: 3 })],
    );
    const r = getLatestTdSyncRun(db);
    expect(r?.status).toBe("success");
    expect(r?.summary).toEqual({ apps: 3 });
  });

  it("countUnmatchedTdApps returns the count of NULL mappings", () => {
    const db = openTdDb(":memory:");
    seedTdApp(db, { tdAppId: "a", name: "A" });
    seedTdApp(db, { tdAppId: "b", name: "B", ascAppStoreId: "111", mappingSource: "auto-bundle" });
    expect(countUnmatchedTdApps(db)).toBe(1);
  });
});

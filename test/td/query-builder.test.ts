import { describe, it, expect } from "bun:test";
import {
  buildEngagementQuery,
  buildMauQuery,
  buildSignalTypesQuery,
  buildCustomEventQuery,
  buildBundleDiscoveryQuery,
  buildBreakdownQuery,
  trailingInterval,
  addDays,
} from "../../src/td/query-builder";

describe("query-builder", () => {
  const APP = "td-app-uuid-1";
  const INT = { startDate: "2026-04-11", endDate: "2026-05-12" };

  it("addDays moves UTC dates forward and backward", () => {
    expect(addDays("2026-05-11", 1)).toBe("2026-05-12");
    expect(addDays("2026-05-11", -1)).toBe("2026-05-10");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("trailingInterval(7) yields [today-6, today+1) i.e. 7 days inclusive", () => {
    const today = new Date("2026-05-11T15:00:00Z");
    const i = trailingInterval(7, today);
    expect(i.startDate).toBe("2026-05-05");
    expect(i.endDate).toBe("2026-05-12");
  });

  it("buildEngagementQuery includes count(sessions) + cardinality(dau) + app+type filter", () => {
    const q = buildEngagementQuery(APP, INT) as any;
    expect(q.queryType).toBe("timeseries");
    expect(q.granularity).toBe("day");
    expect(q.intervals).toEqual(["2026-04-11/2026-05-12"]);
    expect(q.filter.fields[0]).toEqual({ type: "selector", dimension: "appID", value: APP });
    expect(q.filter.fields[1]).toEqual({
      type: "selector",
      dimension: "type",
      value: "newSessionBegan",
    });
    expect(q.aggregations).toEqual([
      { type: "count", name: "sessions" },
      { type: "cardinality", name: "dau", fields: ["clientUser"] },
    ]);
  });

  it("buildMauQuery uses a 28d single bucket ending on asOfDate (inclusive)", () => {
    const q = buildMauQuery(APP, "2026-05-11") as any;
    expect(q.queryType).toBe("timeseries");
    expect(q.granularity).toEqual({ type: "all" });
    expect(q.intervals).toEqual(["2026-04-14/2026-05-12"]);
    expect(q.aggregations).toEqual([
      { type: "cardinality", name: "mau", fields: ["clientUser"] },
    ]);
  });

  it("buildSignalTypesQuery groups by `type` over the given interval", () => {
    const q = buildSignalTypesQuery(APP, INT) as any;
    expect(q.queryType).toBe("groupBy");
    expect(q.dimensions).toEqual(["type"]);
    expect(q.filter).toEqual({ type: "selector", dimension: "appID", value: APP });
  });

  it("buildCustomEventQuery filters on type=<event>", () => {
    const q = buildCustomEventQuery(APP, "paywall_shown", INT) as any;
    expect(q.filter.fields[1]).toEqual({
      type: "selector",
      dimension: "type",
      value: "paywall_shown",
    });
    expect(q.aggregations[1].name).toBe("unique_users");
  });

  it("buildBundleDiscoveryQuery groups by payload.appBundle and limits 5", () => {
    const q = buildBundleDiscoveryQuery(APP, INT) as any;
    expect(q.dimensions).toEqual(["payload.appBundle"]);
    expect(q.limitSpec.limit).toBe(5);
  });

  it("buildBreakdownQuery groups by the requested dimension, daily granularity", () => {
    const q = buildBreakdownQuery(APP, "appVersion", INT, 10) as any;
    expect(q.dimensions).toEqual(["appVersion"]);
    expect(q.granularity).toBe("day");
    expect(q.limitSpec.limit).toBe(10);
  });
});

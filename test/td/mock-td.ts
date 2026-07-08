import { Hono } from "hono";
import { readFileSync } from "fs";
import { join } from "path";

const FIX = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dir, `../fixtures/td/${name}`), "utf8"));

export interface MockTdOpts {
  /** Map of td_app_id -> appBundle for groupBy bundle discovery */
  bundles?: Record<string, string>;
  /** Override which apps the org returns */
  orgAppsFixture?: string;
  /** Engagement timeseries response (keyed by td_app_id; defaults to the fixture for any app). */
  engagementByApp?: Record<string, unknown>;
  /** MAU response per app (just the integer; mock wraps it in the timeseries envelope). */
  mauByApp?: Record<string, number>;
}

export function buildMockTd(opts: MockTdOpts = {}): Hono {
  const app = new Hono();

  app.get("/v1/organisation/apps", (c) => {
    return c.json(FIX(opts.orgAppsFixture ?? "org-apps.json"));
  });

  app.post("/v2/query/", async (c) => {
    const body = await c.req.json() as any;
    const filter = body.filter;
    const dimensions = body.dimensions as string[] | undefined;

    const appId = extractAppId(filter);

    const aggs = body.aggregations as Array<{ name: string }> | undefined;
    const hasMauAgg = aggs?.some((a) => a.name === "mau");
    if (body.queryType === "timeseries" && hasMauAgg) {
      const mau = (opts.mauByApp ?? {})[appId];
      if (mau == null) return c.json([]);
      return c.json([
        {
          version: "v1",
          timestamp: body.intervals[0].split("/")[0] + "T00:00:00.000Z",
          result: { mau },
        },
      ]);
    }

    const hasSessionsAgg = aggs?.some((a) => a.name === "sessions");
    const hasDauAgg = aggs?.some((a) => a.name === "dau");
    if (body.queryType === "timeseries" && body.granularity === "day" && hasSessionsAgg && hasDauAgg) {
      const override = (opts.engagementByApp ?? {})[appId];
      if (override !== undefined) return c.json(override);
      return c.json(FIX("query-timeseries-engagement.json"));
    }

    if (dimensions && dimensions.length === 1 && dimensions[0] === "payload.appBundle") {
      const bundle = (opts.bundles ?? {})[appId];
      if (!bundle) return c.json([]);
      return c.json([
        {
          version: "v1",
          timestamp: "2026-04-11T00:00:00.000Z",
          event: { "payload.appBundle": bundle, count: 100 },
        },
      ]);
    }

    // Breakdown: groupBy on appVersion|systemVersion|modelName with sessions + users aggregations
    const isBreakdownDim =
      dimensions?.length === 1 &&
      (dimensions[0] === "appVersion" ||
       dimensions[0] === "systemVersion" ||
       dimensions[0] === "modelName");
    if (body.queryType === "groupBy" && isBreakdownDim) {
      const data = FIX("query-groupby-version.json") as Array<{ event: Record<string, unknown> }>;
      const dim = dimensions![0] as string;
      return c.json(
        data.map((row) => ({
          ...row,
          event: { [dim]: row.event["appVersion"], users: row.event.users, sessions: row.event.sessions },
        })),
      );
    }

    // signalTypes discovery: groupBy on "type"
    if (body.queryType === "groupBy" && dimensions?.length === 1 && dimensions[0] === "type") {
      return c.json(FIX("query-segment-metadata.json"));
    }

    // Custom-event timeseries: timeseries with 'count' + 'unique_users' aggregations
    const hasUniqueUsersAgg = aggs?.some((a) => a.name === "unique_users");
    if (body.queryType === "timeseries" && body.granularity === "day" && hasUniqueUsersAgg) {
      return c.json(FIX("query-timeseries-event.json"));
    }

    return c.json([]);
  });

  return app;
}

function extractAppId(filter: any): string {
  if (!filter) return "";
  if (filter.type === "selector" && filter.dimension === "appID") return filter.value;
  if (filter.type === "and") {
    for (const f of filter.fields as any[]) {
      if (f.type === "selector" && f.dimension === "appID") return f.value;
    }
  }
  return "";
}

export interface DruidInterval {
  /** ISO date YYYY-MM-DD (inclusive). */
  startDate: string;
  /** ISO date YYYY-MM-DD (exclusive end — Druid convention). */
  endDate: string;
}

export function intervalString(i: DruidInterval): string {
  return `${i.startDate}/${i.endDate}`;
}

const SIGNALS_TABLE = "telemetry-signals";

function appFilter(appId: string) {
  return { type: "selector", dimension: "appID", value: appId };
}

function andFilter(...fields: unknown[]) {
  return { type: "and", fields };
}

/**
 * Daily sessions + DAU for an app.
 * sessions = count of signals of type 'newSessionBegan'
 * dau      = cardinality of clientUser among those signals
 */
export function buildEngagementQuery(appId: string, interval: DruidInterval): unknown {
  return {
    queryType: "timeseries",
    dataSource: { type: "table", name: SIGNALS_TABLE },
    intervals: [intervalString(interval)],
    granularity: "day",
    filter: andFilter(
      appFilter(appId),
      { type: "selector", dimension: "type", value: "newSessionBegan" },
    ),
    aggregations: [
      { type: "count", name: "sessions" },
      { type: "cardinality", name: "dau", fields: ["clientUser"] },
    ],
  };
}

/** Single-bucket MAU over the trailing 28d window ending on (and including) asOfDate. */
export function buildMauQuery(appId: string, asOfDate: string): unknown {
  const end = addDays(asOfDate, 1);
  const start = addDays(asOfDate, -27);
  return {
    queryType: "timeseries",
    dataSource: { type: "table", name: SIGNALS_TABLE },
    intervals: [`${start}/${end}`],
    granularity: { type: "all" },
    filter: andFilter(
      appFilter(appId),
      { type: "selector", dimension: "type", value: "newSessionBegan" },
    ),
    aggregations: [
      { type: "cardinality", name: "mau", fields: ["clientUser"] },
    ],
  };
}

/** Discover which signal types this app emits — needed to find custom events. */
export function buildSignalTypesQuery(appId: string, interval: DruidInterval): unknown {
  return {
    queryType: "groupBy",
    dataSource: { type: "table", name: SIGNALS_TABLE },
    intervals: [intervalString(interval)],
    granularity: { type: "all" },
    dimensions: ["type"],
    filter: appFilter(appId),
    aggregations: [{ type: "count", name: "count" }],
  };
}

/** Daily count+uniques for a single event_type. */
export function buildCustomEventQuery(
  appId: string,
  eventType: string,
  interval: DruidInterval,
): unknown {
  return {
    queryType: "timeseries",
    dataSource: { type: "table", name: SIGNALS_TABLE },
    intervals: [intervalString(interval)],
    granularity: "day",
    filter: andFilter(
      appFilter(appId),
      { type: "selector", dimension: "type", value: eventType },
    ),
    aggregations: [
      { type: "count", name: "count" },
      { type: "cardinality", name: "unique_users", fields: ["clientUser"] },
    ],
  };
}

/** Discover the bundle identifier this TD app emits in its signal payload. */
export function buildBundleDiscoveryQuery(appId: string, interval: DruidInterval): unknown {
  return {
    queryType: "groupBy",
    dataSource: { type: "table", name: SIGNALS_TABLE },
    intervals: [intervalString(interval)],
    granularity: { type: "all" },
    dimensions: ["payload.appBundle"],
    filter: appFilter(appId),
    aggregations: [{ type: "count", name: "count" }],
    limitSpec: {
      type: "default",
      limit: 5,
      columns: [{ dimension: "count", direction: "descending" }],
    },
  };
}

/**
 * Top-N breakdown of users + sessions by a TD dimension.
 * dimension: 'appVersion' | 'systemVersion' | 'modelName'
 */
export function buildBreakdownQuery(
  appId: string,
  dimension: "appVersion" | "systemVersion" | "modelName",
  interval: DruidInterval,
  limit = 20,
): unknown {
  return {
    queryType: "groupBy",
    dataSource: { type: "table", name: SIGNALS_TABLE },
    intervals: [intervalString(interval)],
    granularity: "day",
    dimensions: [dimension],
    filter: andFilter(
      appFilter(appId),
      { type: "selector", dimension: "type", value: "newSessionBegan" },
    ),
    aggregations: [
      { type: "count", name: "sessions" },
      { type: "cardinality", name: "users", fields: ["clientUser"] },
    ],
    limitSpec: {
      type: "default",
      limit,
      columns: [{ dimension: "users", direction: "descending" }],
    },
  };
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Build a [start, end-exclusive] interval ending today (or pinned `today`), spanning `days`. */
export function trailingInterval(days: number, today?: Date): DruidInterval {
  const t = today ?? new Date();
  const endIso = t.toISOString().slice(0, 10);
  const end = addDays(endIso, 1); // make end exclusive of today
  const start = addDays(endIso, -days + 1);
  return { startDate: start, endDate: end };
}

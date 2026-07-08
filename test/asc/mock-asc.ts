import { Hono } from "hono";
import { gzipSync } from "zlib";
import { readFileSync } from "fs";
import { join } from "path";

export interface MockAscOpts {
  /** Optional override of the apps the mock pretends to know about. Defaults to ["111"]. */
  knownApps?: string[];
  /** When set, /v1/apps/{id} returns 404 for any not in this set. */
  rejectApps?: Set<string>;
}

const SALES = readFileSync(
  join(import.meta.dir, "../fixtures/asc/sales-2024-01-15.tsv"),
  "utf8",
);
const ENGAGEMENT = readFileSync(
  join(import.meta.dir, "../fixtures/asc/engagement-segment.csv"),
  "utf8",
);
const USAGE = readFileSync(
  join(import.meta.dir, "../fixtures/asc/usage-segment.csv"),
  "utf8",
);
const COMMERCE_DOWNLOADS = readFileSync(
  join(import.meta.dir, "../fixtures/asc/commerce-downloads-segment.tsv"),
  "utf8",
);

export function buildMockAsc(opts: MockAscOpts = {}): Hono {
  const app = new Hono();
  const known = new Set(opts.knownApps ?? ["111"]);

  app.get("/v1/apps/:id", (c) => {
    const id = c.req.param("id");
    if (opts.rejectApps?.has(id) || !known.has(id)) {
      return c.json({ errors: [{ status: "404" }] }, 404);
    }
    return c.json({ data: { id, attributes: { name: `App ${id}`, bundleId: `com.test.app${id}` } } });
  });

  app.get("/v1/salesReports", () => {
    return new Response(gzipSync(Buffer.from(SALES)), {
      status: 200,
      headers: { "content-type": "application/a-gzip" },
    });
  });

  app.post("/v1/analyticsReportRequests", async (c) => {
    const body = await c.req.json();
    const appleId = body?.data?.relationships?.app?.data?.id ?? "unknown";
    const accessType = body?.data?.attributes?.accessType ?? "ONGOING";
    return c.json({
      data: { id: `req-${appleId}-${accessType.toLowerCase()}` },
    });
  });

  app.get("/v1/analyticsReportRequests/:rid/reports", (c) => {
    return c.json({
      data: [
        { id: `${c.req.param("rid")}-eng`,   attributes: { category: "APP_STORE_ENGAGEMENT", name: "Engagement" } },
        { id: `${c.req.param("rid")}-commerce`, attributes: { category: "COMMERCE", name: "Downloads" } },
        { id: `${c.req.param("rid")}-usage`, attributes: { category: "APP_USAGE",            name: "Usage" } },
      ],
    });
  });

  app.get("/v1/analyticsReports/:repId/instances", (c) => {
    return c.json({
      data: [{ id: `${c.req.param("repId")}-inst`, attributes: { granularity: "DAILY", processingDate: "2024-01-15" } }],
    });
  });

  app.get("/v1/analyticsReportInstances/:instId/segments", (c) => {
    const id = c.req.param("instId");
    const isUsage = id.includes("usage");
    const isCommerce = id.includes("commerce");
    return c.json({
      data: [{
        attributes: {
          url: `${new URL(c.req.url).origin}/segments/${id}.txt.gz?kind=${
            isCommerce ? "commerce" : isUsage ? "usage" : "engagement"
          }`,
        },
      }],
    });
  });

  app.get("/segments/:id", (c) => {
    const kind = c.req.query("kind");
    const csv = kind === "commerce" ? COMMERCE_DOWNLOADS : kind === "usage" ? USAGE : ENGAGEMENT;
    return new Response(gzipSync(Buffer.from(csv)), { status: 200 });
  });

  return app;
}

/** Serve the mock on a random localhost port; returns the base URL and a stop() function. */
export async function startMockAsc(opts: MockAscOpts = {}): Promise<{ baseUrl: string; stop: () => void }> {
  const app = buildMockAsc(opts);
  const server = Bun.serve({ port: 0, fetch: app.fetch });
  return {
    baseUrl: `http://${server.hostname}:${server.port}`,
    stop: () => { server.stop(true); },
  };
}

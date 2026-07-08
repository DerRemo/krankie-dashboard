import { describe, it, expect } from "bun:test";
import { Hono } from "hono";
import { TdAuth } from "../../src/td/auth";
import { TdClient, TdApiError } from "../../src/td/client";

function makeClient(
  handler: Hono,
  overrides: Partial<ConstructorParameters<typeof TdClient>[0]> = {},
) {
  return new TdClient({
    baseUrl: "http://td.invalid",
    auth: new TdAuth({ apiToken: "tdt_test_abcdef" }),
    sleep: async () => {},
    fetchImpl: ((url: string, init?: RequestInit) =>
      handler.fetch(new Request(url, init))) as typeof fetch,
    ...overrides,
  });
}

describe("TdClient", () => {
  it("sends Bearer authorization header on POST", async () => {
    let seenAuth = "";
    const app = new Hono();
    app.post("/v2/query/", async (c) => {
      seenAuth = c.req.header("authorization") ?? "";
      return c.json({ ok: true });
    });
    const cli = makeClient(app);
    const res = await cli.postJson("/v2/query/", { foo: 1 });
    expect(seenAuth).toBe("Bearer tdt_test_abcdef");
    expect(res).toEqual({ ok: true });
  });

  it("throws TdApiError(401) on auth failure with token fingerprint in message", async () => {
    const app = new Hono();
    app.post("/v2/query/", (c) => c.json({ error: "nope" }, 401));
    const cli = makeClient(app);
    let err: unknown;
    try {
      await cli.postJson("/v2/query/", {});
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TdApiError);
    expect((err as TdApiError).status).toBe(401);
    expect((err as TdApiError).message).toContain("cdef"); // last 6 chars of token
  });

  it("retries on 429 with backoff and then succeeds", async () => {
    let calls = 0;
    const app = new Hono();
    app.post("/v2/query/", (c) => {
      calls += 1;
      if (calls < 3) return c.json({ error: "rate" }, 429);
      return c.json({ ok: true });
    });
    const cli = makeClient(app, { maxRetries: 4 });
    const res = await cli.postJson("/v2/query/", {});
    expect(res).toEqual({ ok: true });
    expect(calls).toBe(3);
  });

  it("retries on 5xx with exponential backoff, gives up after maxRetries", async () => {
    let calls = 0;
    const app = new Hono();
    app.post("/v2/query/", (c) => {
      calls += 1;
      return c.json({ err: "boom" }, 503);
    });
    const cli = makeClient(app, { maxRetries: 2 });
    let err: unknown;
    try {
      await cli.postJson("/v2/query/", {});
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TdApiError);
    expect((err as TdApiError).status).toBe(503);
    expect(calls).toBe(3); // initial + 2 retries
  });
});

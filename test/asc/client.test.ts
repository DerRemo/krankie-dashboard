import { describe, test, expect } from "bun:test";
import { gzipSync } from "zlib";
import { AscClient, AscApiError } from "../../src/asc/client";

class FakeAuth {
  async getToken() { return "fake-jwt"; }
}

function makeFetch(handler: (req: { url: string; init?: RequestInit }) => Response | Promise<Response>) {
  return ((url: string, init?: RequestInit) => Promise.resolve(handler({ url, init }))) as unknown as typeof fetch;
}

describe("AscClient", () => {
  test("getJson sends Bearer token and parses response", async () => {
    let capturedAuth = "";
    const fetchImpl = makeFetch(({ init }) => {
      capturedAuth = (init?.headers as Record<string, string>)?.["Authorization"] ?? "";
      return new Response(JSON.stringify({ hello: "world" }), { status: 200 });
    });
    const c = new AscClient({
      baseUrl: "https://test.invalid",
      auth: new FakeAuth() as any,
      fetchImpl,
      sleep: async () => {},
    });
    const out = await c.getJson<{ hello: string }>("/v1/foo");
    expect(out.hello).toBe("world");
    expect(capturedAuth).toBe("Bearer fake-jwt");
  });

  test("decodes gzipped TSV with getGzippedText", async () => {
    const tsv = "Apple Identifier\tUnits\n1234\t10\n";
    const gz = gzipSync(Buffer.from(tsv));
    const fetchImpl = makeFetch(() => new Response(gz, { status: 200 }));
    const c = new AscClient({
      baseUrl: "https://test.invalid",
      auth: new FakeAuth() as any,
      fetchImpl,
      sleep: async () => {},
    });
    const out = await c.getGzippedText("/v1/salesReports", { foo: "bar" });
    expect(out).toBe(tsv);
  });

  test("retries on 503 with exponential backoff and eventually succeeds", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const fetchImpl = makeFetch(() => {
      calls++;
      if (calls < 3) return new Response("err", { status: 503 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const c = new AscClient({
      baseUrl: "https://test.invalid",
      auth: new FakeAuth() as any,
      fetchImpl,
      sleep: async (ms) => { sleeps.push(ms); },
    });
    const out = await c.getJson<{ ok: boolean }>("/v1/x");
    expect(out.ok).toBe(true);
    expect(calls).toBe(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  test("retries on 429", async () => {
    let calls = 0;
    const fetchImpl = makeFetch(() => {
      calls++;
      if (calls < 2) return new Response("rate", { status: 429 });
      return new Response(JSON.stringify({}), { status: 200 });
    });
    const c = new AscClient({
      baseUrl: "https://test.invalid",
      auth: new FakeAuth() as any,
      fetchImpl,
      sleep: async () => {},
    });
    await c.getJson("/v1/x");
    expect(calls).toBe(2);
  });

  test("does NOT retry on 401/403/404 — throws AscApiError immediately", async () => {
    let calls = 0;
    const fetchImpl = makeFetch(() => {
      calls++;
      return new Response("nope", { status: 401 });
    });
    const c = new AscClient({
      baseUrl: "https://test.invalid",
      auth: new FakeAuth() as any,
      fetchImpl,
      sleep: async () => {},
    });
    let err: unknown;
    try { await c.getJson("/v1/x"); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(AscApiError);
    expect((err as AscApiError).status).toBe(401);
    expect(calls).toBe(1);
  });

  test("respects token bucket — pauses when sustained rate exceeded", async () => {
    let mockTime = 0;
    const sleeps: number[] = [];
    const fetchImpl = makeFetch(() => new Response("{}", { status: 200 }));
    const c = new AscClient({
      baseUrl: "https://test.invalid",
      auth: new FakeAuth() as any,
      fetchImpl,
      rateLimitPerSecond: 2,
      sleep: async (ms) => { sleeps.push(ms); mockTime += ms; },
      now: () => mockTime,
    });
    await c.getJson("/a");
    await c.getJson("/b");
    await c.getJson("/c");   // bucket empty here, should sleep before this one
    expect(sleeps.length).toBeGreaterThan(0);
  });
});

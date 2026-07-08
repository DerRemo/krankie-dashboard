import { gunzipSync } from "zlib";
import type { AscAuth } from "./auth";
import { logger } from "../logger";

export interface ClientOpts {
  baseUrl: string;
  auth: AscAuth;
  /** Sustained request rate ceiling (req/sec). Defaults to 3. */
  rateLimitPerSecond?: number;
  /** Max parallel in-flight requests. Defaults to 4. */
  concurrency?: number;
  /** Max retries on 5xx/429. Defaults to 4. */
  maxRetries?: number;
  /** Sleep function (test seam). Defaults to setTimeout-based. */
  sleep?: (ms: number) => Promise<void>;
  /** fetch implementation (test seam). Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  /** Now function (test seam). Defaults to Date.now. */
  now?: () => number;
}

export class AscApiError extends Error {
  constructor(public readonly status: number, public readonly body: string, message: string) {
    super(message);
    this.name = "AscApiError";
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class AscClient {
  private rateLimit: number;
  private concurrency: number;
  private maxRetries: number;
  private sleep: (ms: number) => Promise<void>;
  private fetchImpl: typeof fetch;
  private now: () => number;

  // Token bucket: tokens replenish at rateLimit/sec, capped at rateLimit.
  private tokens: number;
  private lastRefillMs: number;

  // Concurrency gate: an array of resolvers waiting for an in-flight slot.
  private inFlight = 0;
  private waiters: Array<() => void> = [];

  constructor(private opts: ClientOpts) {
    this.rateLimit = opts.rateLimitPerSecond ?? 3;
    this.concurrency = opts.concurrency ?? 4;
    this.maxRetries = opts.maxRetries ?? 4;
    this.sleep = opts.sleep ?? defaultSleep;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.now = opts.now ?? (() => Date.now());
    this.tokens = this.rateLimit;
    this.lastRefillMs = this.now();
  }

  /** GET a JSON endpoint. Returns parsed body. */
  async getJson<T = unknown>(path: string, query?: Record<string, string>): Promise<T> {
    const res = await this.request("GET", path, { query });
    const text = new TextDecoder().decode(res.body);
    if (!text) return undefined as unknown as T;
    return JSON.parse(text) as T;
  }

  /** POST a JSON body, return parsed JSON response. */
  async postJson<T = unknown>(path: string, body: unknown): Promise<T> {
    const res = await this.request("POST", path, { jsonBody: body });
    const text = new TextDecoder().decode(res.body);
    return JSON.parse(text) as T;
  }

  /** GET an endpoint that returns a gzipped TSV/CSV payload. Returns the decoded text. */
  async getGzippedText(path: string, query?: Record<string, string>): Promise<string> {
    const res = await this.request("GET", path, { query, expectGzip: true });
    return new TextDecoder().decode(res.body);
  }

  /** GET an arbitrary URL (e.g. an Analytics segment download URL on Apple's CDN). */
  async getGzippedUrl(url: string): Promise<string> {
    const res = await this.request("GET", url, { absolute: true, expectGzip: true, skipAuth: true });
    return new TextDecoder().decode(res.body);
  }

  private async request(
    method: "GET" | "POST",
    pathOrUrl: string,
    opts: {
      query?: Record<string, string>;
      jsonBody?: unknown;
      expectGzip?: boolean;
      absolute?: boolean;
      skipAuth?: boolean;
    },
  ): Promise<{ status: number; body: Uint8Array }> {
    const url = this.buildUrl(pathOrUrl, opts);
    let attempt = 0;

    while (true) {
      await this.acquireToken();
      await this.acquireSlot();
      try {
        const headers: Record<string, string> = {};
        if (!opts.skipAuth) {
          headers["Authorization"] = `Bearer ${await this.opts.auth.getToken()}`;
        }
        if (opts.jsonBody !== undefined) {
          headers["Content-Type"] = "application/json";
        }
        const res = await this.fetchImpl(url, {
          method,
          headers,
          body: opts.jsonBody !== undefined ? JSON.stringify(opts.jsonBody) : undefined,
        });
        const buf = new Uint8Array(await res.arrayBuffer());

        if (res.status >= 200 && res.status < 300) {
          const body = opts.expectGzip && buf.byteLength >= 2 && buf[0] === 0x1f && buf[1] === 0x8b
            ? new Uint8Array(gunzipSync(Buffer.from(buf)))
            : buf;
          return { status: res.status, body };
        }

        const bodyText = new TextDecoder().decode(buf);
        if ((res.status === 429 || res.status >= 500) && attempt < this.maxRetries) {
          const delayMs = backoff(attempt);
          logger.warn(
            { phase: "asc-client", url, status: res.status, attempt, delayMs },
            "asc client retrying",
          );
          attempt++;
          await this.sleep(delayMs);
          continue;
        }

        throw new AscApiError(res.status, bodyText, `ASC ${method} ${url} → ${res.status}`);
      } catch (err) {
        if (err instanceof AscApiError) throw err;
        if (attempt < 1) {
          attempt++;
          logger.warn(
            { phase: "asc-client", url, err: String(err), attempt },
            "asc client network retry",
          );
          await this.sleep(5000);
          continue;
        }
        throw err;
      } finally {
        this.releaseSlot();
      }
    }
  }

  private buildUrl(pathOrUrl: string, opts: { query?: Record<string, string>; absolute?: boolean }): string {
    const base = opts.absolute ? pathOrUrl : `${this.opts.baseUrl}${pathOrUrl}`;
    if (!opts.query) return base;
    const u = new URL(base);
    for (const [k, v] of Object.entries(opts.query)) u.searchParams.set(k, v);
    return u.toString();
  }

  private async acquireToken(): Promise<void> {
    while (true) {
      const now = this.now();
      const elapsed = now - this.lastRefillMs;
      if (elapsed > 0) {
        this.tokens = Math.min(this.rateLimit, this.tokens + (elapsed / 1000) * this.rateLimit);
        this.lastRefillMs = now;
      }
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const waitMs = Math.ceil(((1 - this.tokens) / this.rateLimit) * 1000);
      await this.sleep(waitMs);
    }
  }

  private async acquireSlot(): Promise<void> {
    if (this.inFlight < this.concurrency) {
      this.inFlight++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.inFlight++;
  }

  private releaseSlot(): void {
    this.inFlight--;
    const next = this.waiters.shift();
    if (next) next();
  }
}

function backoff(attempt: number): number {
  return 1000 * Math.pow(2, attempt);   // 1s, 2s, 4s, 8s
}

import type { TdAuth } from "./auth";
import { logger } from "../logger";

export interface TdClientOpts {
  baseUrl: string;
  auth: TdAuth;
  /** Sustained request rate ceiling (req/sec). Defaults to 2. */
  rateLimitPerSecond?: number;
  /** Max parallel in-flight requests. Defaults to 2. */
  concurrency?: number;
  /** Max retries on 5xx/429. Defaults to 3. */
  maxRetries?: number;
  /** Sleep function (test seam). Defaults to setTimeout-based. */
  sleep?: (ms: number) => Promise<void>;
  /** fetch implementation (test seam). Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  /** Now function (test seam). Defaults to Date.now. */
  now?: () => number;
}

export class TdApiError extends Error {
  constructor(public readonly status: number, public readonly body: string, message: string) {
    super(message);
    this.name = "TdApiError";
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class TdClient {
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

  constructor(private opts: TdClientOpts) {
    this.rateLimit = opts.rateLimitPerSecond ?? 2;
    this.concurrency = opts.concurrency ?? 2;
    this.maxRetries = opts.maxRetries ?? 3;
    this.sleep = opts.sleep ?? defaultSleep;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.now = opts.now ?? (() => Date.now());
    this.tokens = this.rateLimit;
    this.lastRefillMs = this.now();
  }

  /** POST a JSON body, return parsed JSON response. */
  async postJson<T = unknown>(path: string, body: unknown): Promise<T> {
    const res = await this.request("POST", path, body);
    return JSON.parse(new TextDecoder().decode(res)) as T;
  }

  /** GET a JSON endpoint. */
  async getJson<T = unknown>(path: string): Promise<T> {
    const res = await this.request("GET", path, undefined);
    return JSON.parse(new TextDecoder().decode(res)) as T;
  }

  private async request(method: "GET" | "POST", path: string, jsonBody: unknown): Promise<Uint8Array> {
    await this.acquireSlot();
    try {
      let lastError: unknown = null;
      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        await this.waitForToken();
        const url = `${this.opts.baseUrl}${path}`;
        const headers: Record<string, string> = {
          Authorization: this.opts.auth.authHeader(),
          Accept: "application/json",
        };
        const init: RequestInit = { method, headers };
        if (jsonBody !== undefined) {
          headers["Content-Type"] = "application/json";
          init.body = JSON.stringify(jsonBody);
        }
        let res: Response;
        try {
          res = await this.fetchImpl(url, init);
        } catch (err) {
          lastError = err;
          if (attempt < this.maxRetries) {
            logger.warn(
              { phase: "td-client", url, err: String(err), attempt },
              "TD network error, retrying",
            );
            await this.sleep(backoffMs(attempt));
            continue;
          }
          throw err;
        }
        if (res.status === 401) {
          const text = await res.text();
          throw new TdApiError(
            401,
            text,
            `TD auth failed (token fingerprint=${this.opts.auth.fingerprint()})`,
          );
        }
        if (res.status === 429 || res.status >= 500) {
          const text = await res.text();
          lastError = new TdApiError(res.status, text, `TD ${res.status}: ${text.slice(0, 200)}`);
          if (attempt < this.maxRetries) {
            const wait = res.status === 429 ? 30_000 : backoffMs(attempt);
            logger.warn(
              { phase: "td-client", url, status: res.status, attempt, wait },
              "TD retrying",
            );
            await this.sleep(wait);
            continue;
          }
          throw lastError;
        }
        if (!res.ok) {
          const text = await res.text();
          throw new TdApiError(res.status, text, `TD ${res.status}: ${text.slice(0, 200)}`);
        }
        return new Uint8Array(await res.arrayBuffer());
      }
      throw lastError ?? new Error("TD request failed without recorded error");
    } finally {
      this.releaseSlot();
    }
  }

  private async waitForToken(): Promise<void> {
    while (true) {
      const nowMs = this.now();
      const elapsed = nowMs - this.lastRefillMs;
      if (elapsed > 0) {
        this.tokens = Math.min(this.rateLimit, this.tokens + (elapsed / 1000) * this.rateLimit);
        this.lastRefillMs = nowMs;
      }
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const waitMs = Math.ceil(((1 - this.tokens) / this.rateLimit) * 1000);
      await this.sleep(Math.max(10, waitMs));
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

function backoffMs(attempt: number): number {
  return Math.min(30_000, 1000 * Math.pow(2, attempt)); // 1s, 2s, 4s, …, capped at 30s
}

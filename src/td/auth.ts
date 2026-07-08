export interface TdAuthOptions {
  apiToken: string;
}

export class TdAuthError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "TdAuthError";
  }
}

export class TdAuth {
  constructor(private opts: TdAuthOptions) {
    if (!opts.apiToken || opts.apiToken.length === 0) {
      throw new TdAuthError(
        "TELEMETRYDECK_API_TOKEN is empty. Create one at https://telemetrydeck.com/api-tokens",
      );
    }
  }

  /** Authorization header value to send with each request. */
  authHeader(): string {
    return `Bearer ${this.opts.apiToken}`;
  }

  /** Last 6 chars only — for logs that need to identify which token without leaking it. */
  fingerprint(): string {
    return this.opts.apiToken.slice(-6);
  }
}

import { readFileSync } from "fs";

const TOKEN_TTL_SEC = 600;        // 10 minutes (Apple max is 20)
const REFRESH_BEFORE_SEC = 30;    // refresh 30s before expiry

export interface AuthOptions {
  issuerId: string;
  keyId: string;
  privateKeyPath: string;
}

interface CachedToken {
  jwt: string;
  expiresAt: number; // unix seconds
}

export class AscAuth {
  private cached: CachedToken | null = null;
  private privateKey: CryptoKey | null = null;

  constructor(private opts: AuthOptions) {}

  async getToken(now = Math.floor(Date.now() / 1000)): Promise<string> {
    if (this.cached && this.cached.expiresAt - now > REFRESH_BEFORE_SEC) {
      return this.cached.jwt;
    }
    const jwt = await this.signFresh(now);
    this.cached = { jwt, expiresAt: now + TOKEN_TTL_SEC };
    return jwt;
  }

  async signFresh(now: number): Promise<string> {
    const key = await this.loadKey();
    const header = { alg: "ES256", kid: this.opts.keyId, typ: "JWT" };
    const payload = {
      iss: this.opts.issuerId,
      iat: now,
      exp: now + TOKEN_TTL_SEC,
      aud: "appstoreconnect-v1",
    };
    const encHeader = b64url(JSON.stringify(header));
    const encPayload = b64url(JSON.stringify(payload));
    const signingInput = `${encHeader}.${encPayload}`;
    const sig = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new TextEncoder().encode(signingInput),
    );
    const encSig = b64urlBytes(new Uint8Array(sig));
    return `${signingInput}.${encSig}`;
  }

  private async loadKey(): Promise<CryptoKey> {
    if (this.privateKey) return this.privateKey;
    const pem = readFileSync(this.opts.privateKeyPath, "utf8");
    const der = pemToDer(pem);
    this.privateKey = await crypto.subtle.importKey(
      "pkcs8",
      der,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
    return this.privateKey;
  }

  /** Test seam: clear the in-memory cache so the next call re-signs. */
  invalidate(): void {
    this.cached = null;
  }
}

function b64url(input: string): string {
  return b64urlBytes(new TextEncoder().encode(input));
}

function b64urlBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): ArrayBuffer {
  const cleaned = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const bytes = Buffer.from(cleaned, "base64");
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

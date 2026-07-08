import { describe, test, expect } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { writeFileSync, rmSync } from "fs";
import { AscAuth } from "../../src/asc/auth";
import { makeKeyFixture } from "./fixture-keys";

function decodeB64Url(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const buf = Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
  const out = new Uint8Array(new ArrayBuffer(buf.byteLength));
  out.set(buf);
  return out;
}

function decodeJson(s: string): any {
  return JSON.parse(new TextDecoder().decode(decodeB64Url(s)));
}

describe("AscAuth", () => {
  test("produces a JWT with ES256 header, correct claims, and a verifiable signature", async () => {
    const fix = await makeKeyFixture();
    const path = join(tmpdir(), `asc-key-${Date.now()}-${Math.random().toString(36).slice(2)}.p8`);
    writeFileSync(path, fix.privateKeyPem);
    try {
      const auth = new AscAuth({ issuerId: "issuer-uuid", keyId: "ABCDEFGHIJ", privateKeyPath: path });
      const now = 1700000000;
      const jwt = await auth.signFresh(now);
      const [h, p, s] = jwt.split(".") as [string, string, string];
      const header = decodeJson(h);
      const payload = decodeJson(p);

      expect(header).toEqual({ alg: "ES256", kid: "ABCDEFGHIJ", typ: "JWT" });
      expect(payload.iss).toBe("issuer-uuid");
      expect(payload.iat).toBe(now);
      expect(payload.exp).toBe(now + 600);
      expect(payload.aud).toBe("appstoreconnect-v1");

      const sig = decodeB64Url(s);
      const ok = await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        fix.publicKey,
        sig,
        new TextEncoder().encode(`${h}.${p}`),
      );
      expect(ok).toBe(true);
    } finally {
      rmSync(path);
    }
  });

  test("caches the token and reuses it across calls within the TTL window", async () => {
    const fix = await makeKeyFixture();
    const path = join(tmpdir(), `asc-key-${Date.now()}-${Math.random().toString(36).slice(2)}-cache.p8`);
    writeFileSync(path, fix.privateKeyPem);
    try {
      const auth = new AscAuth({ issuerId: "i", keyId: "k", privateKeyPath: path });
      const now = 1700000000;
      const a = await auth.getToken(now);
      const b = await auth.getToken(now + 60);
      expect(a).toBe(b);
    } finally {
      rmSync(path);
    }
  });

  test("re-signs once the token is within the refresh window of expiry", async () => {
    const fix = await makeKeyFixture();
    const path = join(tmpdir(), `asc-key-${Date.now()}-${Math.random().toString(36).slice(2)}-refresh.p8`);
    writeFileSync(path, fix.privateKeyPem);
    try {
      const auth = new AscAuth({ issuerId: "i", keyId: "k", privateKeyPath: path });
      const now = 1700000000;
      const a = await auth.getToken(now);
      const b = await auth.getToken(now + 600);
      expect(a).not.toBe(b);
    } finally {
      rmSync(path);
    }
  });
});

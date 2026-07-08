import { describe, it, expect } from "bun:test";
import { TdAuth, TdAuthError } from "../../src/td/auth";

describe("TdAuth", () => {
  it("constructs with a non-empty token", () => {
    const a = new TdAuth({ apiToken: "tdt_abc123def456" });
    expect(a.authHeader()).toBe("Bearer tdt_abc123def456");
  });

  it("throws TdAuthError on empty token", () => {
    expect(() => new TdAuth({ apiToken: "" })).toThrow(TdAuthError);
  });

  it("fingerprint exposes only last 6 chars", () => {
    const a = new TdAuth({ apiToken: "tdt_abcdefghijklmnop" });
    expect(a.fingerprint()).toBe("klmnop");
    expect(a.fingerprint()).not.toContain("abc");
  });
});

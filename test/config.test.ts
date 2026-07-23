import { test, it, expect, describe } from "bun:test";
import { loadConfig } from "../src/config";

test("loadConfig applies defaults", () => {
  const c = loadConfig({});
  expect(c.port).toBe(3737);
  expect(c.logLevel).toBe("info");
  expect(c.krankieBin).toBe("krankie");
  expect(c.hostname).toBe("krankie.local");
  expect(c.krankieDb).toMatch(/\.krankie\/krankie\.db$/);
});

test("loadConfig parses PORT", () => {
  expect(loadConfig({ PORT: "8080" }).port).toBe(8080);
});

test("loadConfig rejects invalid PORT", () => {
  expect(() => loadConfig({ PORT: "abc" })).toThrow();
  expect(() => loadConfig({ PORT: "0" })).toThrow();
});

test("loadConfig treats empty-string PORT as unset (default 3737)", () => {
  expect(loadConfig({ PORT: "" }).port).toBe(3737);
});

test("loadConfig rejects invalid LOG_LEVEL", () => {
  expect(() => loadConfig({ LOG_LEVEL: "loud" })).toThrow();
});

test("loadConfig treats empty-string LOG_LEVEL as unset (default info)", () => {
  expect(loadConfig({ LOG_LEVEL: "" }).logLevel).toBe("info");
});

describe("loadConfig — ASC", () => {
  test("returns ascConfigured=false when any required ASC var is empty", () => {
    const c = loadConfig({});
    expect(c.ascConfigured).toBe(false);
    expect(c.asc.apiBase).toBe("https://api.appstoreconnect.apple.com");
  });

  test("returns ascConfigured=true only when all four required vars are set", () => {
    const c = loadConfig({
      ASC_ISSUER_ID: "issuer-uuid",
      ASC_KEY_ID: "ABCDEFGHIJ",
      ASC_PRIVATE_KEY_PATH: "/tmp/AuthKey_ABCDEFGHIJ.p8",
      ASC_VENDOR_NUMBER: "12345678",
    });
    expect(c.ascConfigured).toBe(true);
    expect(c.asc.issuerId).toBe("issuer-uuid");
    expect(c.asc.privateKeyPath).toBe("/tmp/AuthKey_ABCDEFGHIJ.p8");
  });

  test("expands ~/ in ASC_PRIVATE_KEY_PATH and ASC_DB", () => {
    const c = loadConfig({
      ASC_ISSUER_ID: "x", ASC_KEY_ID: "y", ASC_VENDOR_NUMBER: "1",
      ASC_PRIVATE_KEY_PATH: "~/AuthKey.p8",
      ASC_DB: "~/asc.db",
    });
    expect(c.asc.privateKeyPath.startsWith("/")).toBe(true);
    expect(c.asc.privateKeyPath.endsWith("/AuthKey.p8")).toBe(true);
    expect(c.asc.dbPath.endsWith("/asc.db")).toBe(true);
  });

  test("defaults dbPath to ~/.krankie-dashboard/asc.db", () => {
    const c = loadConfig({});
    expect(c.asc.dbPath.endsWith("/.krankie-dashboard/asc.db")).toBe(true);
  });

  test("uses ASC_API_BASE override (for tests)", () => {
    const c = loadConfig({ ASC_API_BASE: "http://localhost:9999" });
    expect(c.asc.apiBase).toBe("http://localhost:9999");
  });
});

describe("loadConfig — TelemetryDeck", () => {
  it("returns tdConfigured=false when token is empty", () => {
    const c = loadConfig({});
    expect(c.tdConfigured).toBe(false);
    expect(c.td.apiBase).toBe("https://api.telemetrydeck.com");
    expect(c.td.dbPath.endsWith("/.krankie-dashboard/td.db")).toBe(true);
  });

  it("returns tdConfigured=true when token is set", () => {
    const c = loadConfig({ TELEMETRYDECK_API_TOKEN: "tdt_abc123" });
    expect(c.tdConfigured).toBe(true);
    expect(c.td.apiToken).toBe("tdt_abc123");
  });

  it("uses TELEMETRYDECK_API_BASE override (for tests)", () => {
    const c = loadConfig({ TELEMETRYDECK_API_BASE: "http://localhost:9999" });
    expect(c.td.apiBase).toBe("http://localhost:9999");
  });

  it("treats empty-string TELEMETRYDECK_API_BASE as unset (falls back to default)", () => {
    const c = loadConfig({ TELEMETRYDECK_API_BASE: "" });
    expect(c.td.apiBase).toBe("https://api.telemetrydeck.com");
  });

  it("expands ~/ in TD_DB", () => {
    const c = loadConfig({ TD_DB: "~/foo/td.db" });
    expect(c.td.dbPath.startsWith("/")).toBe(true);
    expect(c.td.dbPath.endsWith("/foo/td.db")).toBe(true);
  });
});

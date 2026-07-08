import { test, expect } from "bun:test";
import { makeApp } from "../src/server";
import { makeTestDb, seedDefault, mockKrankieBin, mockAscBin } from "./seed";
import type { Config } from "../src/config";

const TEST_CONFIG: Config = {
  port: 3737,
  krankieBin: mockKrankieBin(),
  krankieDb: ":memory:",
  logLevel: "warn",
  hostname: "test.local",
  ascCliBin: mockAscBin(),
  asc: {
    issuerId: "", keyId: "", privateKeyPath: "", vendorNumber: "",
    apiBase: "https://api.appstoreconnect.apple.com",
    dbPath: "/tmp/asc-smoke-not-used.db",
  },
  ascConfigured: false,
  td: {
    apiToken: "",
    apiBase: "https://api.telemetrydeck.com",
    dbPath: "/tmp/td-smoke-not-used.db",
  },
  tdConfigured: false,
};

test("smoke: full app boots and serves all main routes", async () => {
  const db = makeTestDb();
  seedDefault(db);
  const app = makeApp({ config: TEST_CONFIG, db, journalMode: "wal" });

  for (const path of ["/", "/system", "/api/healthz", "/apps/6737412117"]) {
    const res = await app.request(path);
    expect(res.status).toBeLessThan(500);
  }
});

test("dead pages redirect to overview", async () => {
  const db = makeTestDb();
  seedDefault(db);
  const app = makeApp({ config: TEST_CONFIG, db, journalMode: "wal" });
  for (const path of ["/keywords", "/movers", "/competitors", "/reviews"]) {
    const res = await app.request(path, { redirect: "manual" });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/");
  }
});

test("smoke: /api/healthz includes ASC fields", async () => {
  const db = makeTestDb();
  seedDefault(db);
  const app = makeApp({ config: TEST_CONFIG, db, journalMode: "wal" });
  const res = await app.request("/api/healthz");
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty("ascConfigured");
  expect(body).toHaveProperty("ascDbReachable");
  expect(body).toHaveProperty("ascLastSyncAge");
});

test("smoke: /api/asc/status returns documented shape", async () => {
  const db = makeTestDb();
  seedDefault(db);
  const app = makeApp({ config: TEST_CONFIG, db, journalMode: "wal" });
  const res = await app.request("/api/asc/status");
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty("configured");
  expect(body).toHaveProperty("running");
  expect(body).toHaveProperty("coverage");
  expect(body.configured).toBe(false);
});

test("smoke: /api/td/status responds with JSON shape", async () => {
  const db = makeTestDb();
  seedDefault(db);
  const app = makeApp({ config: TEST_CONFIG, db, journalMode: "wal" });
  const res = await app.request("/api/td/status");
  expect(res.status).toBe(200);
  const json = await res.json() as any;
  expect(typeof json.configured).toBe("boolean");
});

test("nav: app links appear, old data-type links gone", async () => {
  const db = makeTestDb();
  seedDefault(db);
  const app = makeApp({ config: TEST_CONFIG, db, journalMode: "wal" });
  const res = await app.request("/");
  const html = await res.text();
  expect(html).toContain('href="/apps/6737412117"');
  expect(html).toContain("TestApp");
  expect(html).not.toContain('href="/movers"');
  expect(html).not.toContain('href="/keywords"');
  expect(html).not.toContain('href="/competitors"');
});

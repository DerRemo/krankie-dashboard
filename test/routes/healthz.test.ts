import { test, expect } from "bun:test";
import { makeApp } from "../../src/server";
import { makeTestDb, seedDefault, mockKrankieBin, mockConfig } from "../seed";

test("GET /api/healthz reports component health", async () => {
  const db = makeTestDb();
  seedDefault(db);
  const app = makeApp({
    config: mockConfig(),
    db,
    journalMode: "wal",
  });
  const res = await app.request("/api/healthz");
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.dbReachable).toBe(true);
  expect(body.schemaOk).toBe(true);
  expect(body.krankieBinaryFound).toBe(true);
  expect(body.journalMode).toBe("wal");
  expect(typeof body.lastCheckAgeHours).toBe("number");
});

test("GET /api/healthz reports unhealthy state when db missing", async () => {
  const app = makeApp({
    config: mockConfig({ krankieBin: "nonexistent-binary-xyz" }),
    db: null,
    journalMode: "unknown",
  });
  const res = await app.request("/api/healthz");
  const body = await res.json();
  expect(body.dbReachable).toBe(false);
  expect(body.krankieBinaryFound).toBe(false);
});

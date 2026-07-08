import { test, expect } from "bun:test";
import { makeApp } from "../../src/server";
import { makeTestDb, seedDefault, mockKrankieBin, mockConfig } from "../seed";
import { CheckRunner } from "../../src/krankie/check";
import { makeAscDb, seedAnalytics } from "../asc/seed";

test("GET /system renders health cards + run button", async () => {
  const db = makeTestDb();
  seedDefault(db);
  const app = makeApp({
    config: mockConfig(),
    db, journalMode: "wal",
  });
  const res = await app.request("/system");
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain("Last check");
  expect(html).toContain("DB size");
  expect(html).toContain('id="system-run-check"');
  expect(html).toContain('id="check-status"');
});

test("GET /system renders ASC data coverage diagnostics", async () => {
  const db = makeTestDb();
  seedDefault(db);
  const ascDb = makeAscDb();
  seedAnalytics(ascDb, [{ appStoreId: "6737412117", date: "2024-01-10", territory: "US", impressions: 1 }]);
  const app = makeApp({
    config: mockConfig({ ascConfigured: true }),
    db, journalMode: "wal", ascDb,
  });
  const res = await app.request("/system");
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain("ASC Data Coverage");
  expect(html).toContain("Missing Analytics 7d");
});

test("POST /api/check/run triggers a run, GET /api/check/status reports", async () => {
  const db = makeTestDb();
  const runner = new CheckRunner({ binary: mockKrankieBin(), timeoutMs: 30_000 });
  const app = makeApp({
    config: mockConfig(),
    db, journalMode: "wal", runner,
  });
  const res = await app.request("/api/check/run", { method: "POST" });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.runId).toMatch(/^run-/);

  const conflict = await app.request("/api/check/run", { method: "POST" });
  expect(conflict.status).toBe(409);

  await runner.waitForIdle(2000);

  const status = await (await app.request("/api/check/status")).json();
  expect(status.running).toBe(false);
});

import { test, expect } from "bun:test";
import { makeApp } from "../../src/server";
import { makeTestDb, seedDefault, mockKrankieBin, mockConfig } from "../seed";

test("GET /keywords/:id renders chart placeholder + table", async () => {
  const db = makeTestDb();
  const { keywordIds } = seedDefault(db);
  const id = keywordIds[0]!.id;
  const app = makeApp({
    config: mockConfig(),
    db, journalMode: "wal",
  });
  const res = await app.request(`/keywords/${id}?range=30d`);
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain("habit tracker");
  expect(html).toContain('id="history-chart"');
  expect(html).toContain(`data-keyword-id="${id}"`);
  expect(html).toContain("?range=7d");
});

test("GET /api/keywords/:id/history returns time points", async () => {
  const db = makeTestDb();
  const { keywordIds } = seedDefault(db);
  const id = keywordIds[0]!.id;
  const app = makeApp({
    config: mockConfig(),
    db, journalMode: "wal",
  });
  const res = await app.request(`/api/keywords/${id}/history?range=30d`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
  expect(body.length).toBeGreaterThan(0);
  expect(body[0]).toHaveProperty("at");
  expect(body[0]).toHaveProperty("rank");
});

test("GET /keywords/:id 404 on unknown keyword", async () => {
  const db = makeTestDb();
  const app = makeApp({
    config: mockConfig(),
    db, journalMode: "wal",
  });
  const res = await app.request("/keywords/999999");
  expect(res.status).toBe(404);
});

import { test, expect } from "bun:test";
import { makeApp } from "../../src/server";
import { makeTestDb, seedDefault, mockKrankieBin, mockConfig } from "../seed";

test("GET /compare?keyword=habit%20tracker shows multiple stores", async () => {
  const db = makeTestDb();
  seedDefault(db);
  const app = makeApp({
    config: mockConfig(),
    db, journalMode: "wal",
  });
  const res = await app.request("/compare?keyword=habit%20tracker");
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain("habit tracker");
  expect(html).toContain('data-store="us"');
  expect(html).toContain('data-store="de"');
});

test("GET /compare without keyword returns 400", async () => {
  const db = makeTestDb();
  const app = makeApp({
    config: mockConfig(),
    db, journalMode: "wal",
  });
  const res = await app.request("/compare");
  expect(res.status).toBe(400);
});

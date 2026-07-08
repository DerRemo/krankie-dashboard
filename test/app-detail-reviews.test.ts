import { test, expect } from "bun:test";
import { makeApp } from "../src/server";
import { makeTestDb, seedDefault, mockConfig } from "./seed";
import { openAscDb } from "../src/asc/db";

test("app detail: renders reviews section from asc db, no rating chart", async () => {
  const db = makeTestDb();
  seedDefault(db); // seeds app 6737412117
  const ascDb = openAscDb(":memory:");
  ascDb.run("INSERT INTO asc_apps (app_store_id, apple_id, name, fetched_at) VALUES ('6737412117', '6737412117', 'TestApp', '2026-07-08')");
  ascDb.run(
    "INSERT INTO reviews_raw (app_store_id, review_id, territory, rating, title, body, reviewer_nickname, created_at) " +
    "VALUES ('6737412117', 'r1', 'DEU', 5, 'Super App', 'Gefällt mir sehr.', 'nick', '2026-07-01T10:00:00Z')",
  );
  ascDb.run(
    "INSERT INTO rating_snapshots_daily (app_store_id, date, territory, average, count) VALUES ('6737412117', '2026-07-08', 'DEU', 5.0, 1)",
  );

  const app = makeApp({ config: mockConfig({ ascConfigured: true }), db, journalMode: "wal", ascDb });
  const res = await app.request("/apps/6737412117");
  const html = await res.text();
  expect(res.status).toBe(200);
  expect(html).toContain("Super App");
  expect(html).not.toContain("rating-chart");
});

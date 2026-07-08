import { describe, it, expect } from "bun:test";
import { makeApp } from "../../src/server";
import { makeTestDb, seedDefault, mockConfig } from "../seed";
import { openTdDb } from "../../src/td/db";

describe("/td overview", () => {
  it("renders the overview with rows for mapped TD apps", async () => {
    const db = makeTestDb();
    seedDefault(db);

    const tdDb = openTdDb(":memory:");
    tdDb.run(
      "INSERT INTO td_apps (td_app_id, name, asc_app_store_id, fetched_at) VALUES (?, ?, ?, ?)",
      ["td-app-abc", "TestApp", "6737412117", "2024-01-10T00:00:00Z"],
    );
    tdDb.run(
      "INSERT INTO td_daily_engagement (td_app_id, date, sessions, dau, fetched_at) VALUES (?, ?, ?, ?, ?)",
      ["td-app-abc", "2024-01-10", 50, 20, "2024-01-10T12:00:00Z"],
    );
    tdDb.run(
      "INSERT INTO td_mau_cache (td_app_id, as_of_date, mau, fetched_at) VALUES (?, ?, ?, ?)",
      ["td-app-abc", "2024-01-10", 200, "2024-01-10T12:00:00Z"],
    );

    const app = makeApp({
      config: mockConfig({ tdConfigured: true }),
      db,
      journalMode: "wal",
      tdDb,
    });

    const res = await app.request("/td");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("TelemetryDeck");
    expect(html).toContain("Stickiness");
    expect(html).toContain("TestApp");
    // App link points to /apps/:appStoreId#td
    expect(html).toContain('/apps/6737412117#td');
  });

  it("shows unmatched notice when there are unmapped TD apps", async () => {
    const db = makeTestDb();

    const tdDb = openTdDb(":memory:");
    // App with no asc_app_store_id — unmatched
    tdDb.run(
      "INSERT INTO td_apps (td_app_id, name, asc_app_store_id, fetched_at) VALUES (?, ?, ?, ?)",
      ["td-app-unmatched", "UnmappedApp", null, "2024-01-10T00:00:00Z"],
    );

    const app = makeApp({
      config: mockConfig({ tdConfigured: true }),
      db,
      journalMode: "wal",
      tdDb,
    });

    const res = await app.request("/td");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("TD app(s) are not mapped");
  });

  it("shows empty state when no TD apps exist", async () => {
    const db = makeTestDb();

    const tdDb = openTdDb(":memory:");

    const app = makeApp({
      config: mockConfig({ tdConfigured: true }),
      db,
      journalMode: "wal",
      tdDb,
    });

    const res = await app.request("/td");
    expect(res.status).toBe(200);
    const html = await res.text();
    // Empty state is a proper empty-block, not a skeletal table with an empty row.
    expect(html).toContain('class="empty-block"');
    expect(html).toContain("Noch keine TelemetryDeck-Daten");
    expect(html).not.toContain("rankings-table");
  });
});

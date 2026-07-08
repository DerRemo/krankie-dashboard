import { describe, it, expect } from "bun:test";
import { openTdDb, getSchemaVersion } from "../../src/td/db";

describe("td.db", () => {
  it("creates v1 schema on fresh :memory: db", () => {
    const db = openTdDb(":memory:");
    expect(getSchemaVersion(db)).toBe(1);
    const tables = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all()
      .map((r) => r.name);
    expect(tables).toContain("td_apps");
    expect(tables).toContain("td_daily_engagement");
    expect(tables).toContain("td_mau_cache");
    expect(tables).toContain("td_custom_events");
    expect(tables).toContain("td_breakdowns");
    expect(tables).toContain("td_signal_types");
    expect(tables).toContain("td_sync_runs");
    expect(tables).toContain("td_meta");
  });

  it("readonly mode rejects writes", () => {
    const path = `/tmp/td-test-${Date.now()}.db`;
    openTdDb(path).close(); // create
    const ro = openTdDb(path, { readonly: true });
    expect(() => ro.run("INSERT INTO td_meta(key, value) VALUES ('x','y')")).toThrow();
    ro.close();
  });

  it("rejects future schema_version", () => {
    const path = `/tmp/td-test-future-${Date.now()}.db`;
    const db = openTdDb(path);
    db.run("UPDATE td_meta SET value = '99' WHERE key = 'schema_version'");
    db.close();
    expect(() => openTdDb(path)).toThrow(/newer than this binary/);
  });
});

import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { makeAscDb } from "./seed";
import { ensureAscApps, listKrankieApps, readAscApp, listAscApps, type KrankieApp } from "../../src/asc/apps";

function makeKrankieFixture(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE apps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id TEXT NOT NULL UNIQUE,
      name TEXT, platform TEXT NOT NULL,
      track_keywords INTEGER NOT NULL DEFAULT 0,
      track_ratings INTEGER NOT NULL DEFAULT 0,
      track_reviews INTEGER NOT NULL DEFAULT 0,
      developer TEXT, is_own INTEGER NOT NULL DEFAULT 0
    );
  `);
  db.run("INSERT INTO apps (app_id, name, platform, track_keywords) VALUES ('111', 'Alpha', 'iphone', 1)");
  db.run("INSERT INTO apps (app_id, name, platform, track_keywords) VALUES ('222', 'Beta',  'iphone', 1)");
  db.run("INSERT INTO apps (app_id, name, platform, track_keywords) VALUES ('333', 'Gamma', 'iphone', 0)");
  return db;
}

class FakeClient {
  public calls: string[] = [];
  constructor(private knownIds: Set<string>) {}
  async getJson<T>(path: string): Promise<T> {
    this.calls.push(path);
    const id = path.split("/").pop()!;
    if (!this.knownIds.has(id)) {
      const e = new Error(`404 ${id}`); (e as any).status = 404; throw e;
    }
    return { data: { id, attributes: { name: `App ${id}`, bundleId: `com.test.app${id}`, sku: `sku-${id}` } } } as unknown as T;
  }
}

describe("listKrankieApps", () => {
  test("returns only apps with track_keywords=1", () => {
    const db = makeKrankieFixture();
    const apps = listKrankieApps(db);
    expect(apps.map((a) => a.appStoreId)).toEqual(["111", "222"]);
  });
});

describe("ensureAscApps", () => {
  test("fetches and caches each missing app, skips apps not in the team", async () => {
    const ascDb = makeAscDb();
    const client = new FakeClient(new Set(["111"])) as any;
    const out = await ensureAscApps(ascDb, client, [
      { appStoreId: "111", name: "Alpha", platform: "iphone" },
      { appStoreId: "222", name: "Beta", platform: "iphone" },
    ]);
    expect(out.map((a) => a.appStoreId)).toEqual(["111"]);
    expect(client.calls).toEqual(["/v1/apps/111", "/v1/apps/222"]);
    expect(readAscApp(ascDb, "111")?.name).toBe("App 111");
  });

  test("captures bundleId from /v1/apps/{id} and persists it", async () => {
    const ascDb = makeAscDb();
    const client = new FakeClient(new Set(["111"])) as any;
    const out = await ensureAscApps(ascDb, client, [
      { appStoreId: "111", name: "Alpha", platform: "iphone" },
    ]);
    expect(out[0]?.bundleId).toBe("com.test.app111");
    expect(readAscApp(ascDb, "111")?.bundleId).toBe("com.test.app111");
  });

  test("re-fetches /v1/apps/{id} for rows with bundleId IS NULL (post-migration backfill)", async () => {
    const ascDb = makeAscDb();
    // Simulate a v1-era row that survived the v1→v2 migration: bundle_id is NULL
    ascDb.run(
      `INSERT INTO asc_apps (app_store_id, apple_id, name, bundle_id, fetched_at)
       VALUES ('111', '111', 'Alpha', NULL, '2024-01-01T00:00:00.000Z')`,
    );
    const client = new FakeClient(new Set(["111"])) as any;
    const out = await ensureAscApps(ascDb, client, [
      { appStoreId: "111", name: "Alpha", platform: "iphone" },
    ]);
    // Should have re-fetched and backfilled bundleId
    expect(client.calls).toEqual(["/v1/apps/111"]);
    expect(out[0]?.bundleId).toBe("com.test.app111");
    expect(readAscApp(ascDb, "111")?.bundleId).toBe("com.test.app111");
  });

  test("captures sku from /v1/apps/{id} and persists it", async () => {
    const ascDb = makeAscDb();
    const client = new FakeClient(new Set(["111"])) as any;
    const out = await ensureAscApps(ascDb, client, [
      { appStoreId: "111", name: "Alpha", platform: "iphone" },
    ]);
    expect(out[0]?.sku).toBe("sku-111");
    expect(readAscApp(ascDb, "111")?.sku).toBe("sku-111");
  });

  test("uses the cache on a second call (no extra API hits)", async () => {
    const ascDb = makeAscDb();
    const client = new FakeClient(new Set(["111", "222"])) as any;
    const apps: KrankieApp[] = [
      { appStoreId: "111", name: "Alpha", platform: "iphone" },
      { appStoreId: "222", name: "Beta",  platform: "iphone" },
    ];
    await ensureAscApps(ascDb, client, apps);
    client.calls = [];
    const out = await ensureAscApps(ascDb, client, apps);
    expect(out.length).toBe(2);
    expect(client.calls).toEqual([]);
  });
});

describe("listAscApps", () => {
  test("returns all cached apps sorted by app_store_id", async () => {
    const ascDb = makeAscDb();
    const client = new FakeClient(new Set(["111", "222"])) as any;
    await ensureAscApps(ascDb, client, [
      { appStoreId: "222", name: "Beta",  platform: "iphone" },
      { appStoreId: "111", name: "Alpha", platform: "iphone" },
    ]);
    const apps = listAscApps(ascDb);
    expect(apps.map((a) => a.appStoreId)).toEqual(["111", "222"]);
  });
});

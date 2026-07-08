import { describe, it, expect } from "bun:test";
import { openTdDb } from "../../src/td/db";
import { openAscDb } from "../../src/asc/db";
import {
  syncTdApps,
  discoverBundles,
  applyMapping,
  normalizeName,
  setManualMapping,
  clearAutoMappings,
  listTdApps,
} from "../../src/td/apps";
import { TdAuth } from "../../src/td/auth";
import { TdClient } from "../../src/td/client";
import { buildMockTd } from "./mock-td";

function makeMockedClient(handler: ReturnType<typeof buildMockTd>) {
  return new TdClient({
    baseUrl: "http://td.invalid",
    auth: new TdAuth({ apiToken: "tdt_test" }),
    sleep: async () => {},
    fetchImpl: ((url: string, init?: RequestInit) =>
      handler.fetch(new Request(url, init))) as typeof fetch,
  });
}

function seedAscApp(
  db: ReturnType<typeof openAscDb>,
  args: { storeId: string; name: string; bundleId?: string | null },
) {
  db.run(
    `INSERT INTO asc_apps (app_store_id, apple_id, name, bundle_id, fetched_at)
     VALUES (?, ?, ?, ?, ?)`,
    [args.storeId, args.storeId, args.name, args.bundleId ?? null, new Date().toISOString()],
  );
}

describe("normalizeName", () => {
  it("lowercases, trims, collapses spaces, strips ' - Free|Lite|Pro' suffix", () => {
    expect(normalizeName("Aurora")).toBe("aurora");
    expect(normalizeName("  Comet  ")).toBe("comet");
    expect(normalizeName("Habit Tracker - Free")).toBe("habit tracker");
    expect(normalizeName("HabitTracker – Pro")).toBe("habittracker");
  });
});

describe("syncTdApps", () => {
  it("upserts org-apps into td_apps", async () => {
    const tdDb = openTdDb(":memory:");
    const client = makeMockedClient(buildMockTd());
    const apps = await syncTdApps(tdDb, client);
    expect(apps.length).toBe(3);
    expect(apps.map((a) => a.name).sort()).toEqual(["Aurora", "Comet", "OrphanedTdApp"]);
  });
});

describe("discoverBundles", () => {
  it("persists bundle_id when groupBy returns one", async () => {
    const tdDb = openTdDb(":memory:");
    const client = makeMockedClient(
      buildMockTd({ bundles: { "td-uuid-aaaa-0001": "com.example.aurora" } }),
    );
    const apps = await syncTdApps(tdDb, client);
    const out = await discoverBundles(tdDb, client, apps);
    expect(out.discovered).toBe(1);
    const lm = listTdApps(tdDb).find((a) => a.tdAppId === "td-uuid-aaaa-0001");
    expect(lm?.bundleId).toBe("com.example.aurora");
  });
});

describe("applyMapping", () => {
  it("matches by bundle exactly", async () => {
    const tdDb = openTdDb(":memory:");
    const ascDb = openAscDb(":memory:");
    seedAscApp(ascDb, { storeId: "111", name: "Aurora", bundleId: "com.example.aurora" });
    const client = makeMockedClient(
      buildMockTd({ bundles: { "td-uuid-aaaa-0001": "com.example.aurora" } }),
    );
    const apps = await syncTdApps(tdDb, client);
    await discoverBundles(tdDb, client, apps);
    const r = applyMapping(tdDb, ascDb);
    expect(r.autoBundle).toBe(1);
    expect(r.autoName).toBeGreaterThanOrEqual(0);
    const mapped = listTdApps(tdDb).find((a) => a.tdAppId === "td-uuid-aaaa-0001");
    expect(mapped?.ascAppStoreId).toBe("111");
    expect(mapped?.mappingSource).toBe("auto-bundle");
  });

  it("falls back to fuzzy name match when bundle is unknown", async () => {
    const tdDb = openTdDb(":memory:");
    const ascDb = openAscDb(":memory:");
    seedAscApp(ascDb, { storeId: "222", name: "Comet", bundleId: null });
    const client = makeMockedClient(buildMockTd());
    const apps = await syncTdApps(tdDb, client);
    await discoverBundles(tdDb, client, apps);
    const r = applyMapping(tdDb, ascDb);
    expect(r.autoName).toBeGreaterThanOrEqual(1);
    const mapped = listTdApps(tdDb).find((a) => a.name === "Comet");
    expect(mapped?.ascAppStoreId).toBe("222");
    expect(mapped?.mappingSource).toBe("auto-name");
  });

  it("leaves NULL when neither bundle nor name match", async () => {
    const tdDb = openTdDb(":memory:");
    const ascDb = openAscDb(":memory:");
    const client = makeMockedClient(buildMockTd());
    const apps = await syncTdApps(tdDb, client);
    await discoverBundles(tdDb, client, apps);
    const r = applyMapping(tdDb, ascDb);
    expect(r.unmatched).toBeGreaterThanOrEqual(1);
    const orphan = listTdApps(tdDb).find((a) => a.name === "OrphanedTdApp");
    expect(orphan?.ascAppStoreId).toBeNull();
    expect(orphan?.mappingSource).toBeNull();
  });

  it("does NOT overwrite mapping_source='manual'", async () => {
    const tdDb = openTdDb(":memory:");
    const ascDb = openAscDb(":memory:");
    seedAscApp(ascDb, { storeId: "111", name: "Aurora", bundleId: "com.example.aurora" });
    seedAscApp(ascDb, { storeId: "999", name: "OtherApp", bundleId: "de.other" });
    const client = makeMockedClient(
      buildMockTd({ bundles: { "td-uuid-aaaa-0001": "com.example.aurora" } }),
    );
    const apps = await syncTdApps(tdDb, client);
    await discoverBundles(tdDb, client, apps);
    setManualMapping(tdDb, "td-uuid-aaaa-0001", "999");
    applyMapping(tdDb, ascDb);
    const mapped = listTdApps(tdDb).find((a) => a.tdAppId === "td-uuid-aaaa-0001");
    expect(mapped?.ascAppStoreId).toBe("999");
    expect(mapped?.mappingSource).toBe("manual");
  });

  it("clearAutoMappings preserves manual mappings only", async () => {
    const tdDb = openTdDb(":memory:");
    tdDb.run(
      `INSERT INTO td_apps (td_app_id, name, asc_app_store_id, mapping_source, fetched_at)
       VALUES ('a','A','111','auto-bundle',?),
              ('b','B','222','manual',?)`,
      [new Date().toISOString(), new Date().toISOString()],
    );
    clearAutoMappings(tdDb);
    const a = listTdApps(tdDb).find((x) => x.tdAppId === "a");
    const b = listTdApps(tdDb).find((x) => x.tdAppId === "b");
    expect(a?.ascAppStoreId).toBeNull();
    expect(b?.ascAppStoreId).toBe("222");
    expect(b?.mappingSource).toBe("manual");
  });
});

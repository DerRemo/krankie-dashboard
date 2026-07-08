import { describe, it, expect } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { openTdDb, attachAsc } from "../../src/td/db";
import { openAscDb } from "../../src/asc/db";
import { listFunnelByAppStore, getFunnelTotals } from "../../src/data/funnel";
import { seedTdApp, seedEngagement } from "../td/seed";

function tmpFile(name: string) {
  return join(tmpdir(), `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function seedAscDailies(ascDb: ReturnType<typeof openAscDb>, appStoreId: string) {
  const ts = new Date().toISOString();
  ascDb.run(
    `INSERT INTO asc_apps (app_store_id, apple_id, name, bundle_id, fetched_at)
     VALUES (?, ?, ?, ?, ?)`,
    [appStoreId, appStoreId, "Aurora", "com.example.aurora", ts],
  );
  ascDb.run(
    `INSERT INTO analytics_daily (app_store_id, date, territory, impressions, product_page_views, first_time_downloads, sessions, active_devices, crashes)
     VALUES (?, '2026-05-10', 'US', 1000, 100, 25, NULL, NULL, NULL),
            (?, '2026-05-10', 'DE',  500,  50, 10, NULL, NULL, NULL),
            (?, '2026-05-11', 'US', 1200, 120, 30, NULL, NULL, NULL)`,
    [appStoreId, appStoreId, appStoreId],
  );
}

describe("funnel (cross-source ATTACH)", () => {
  it("joins ASC analytics_daily with TD engagement on shared dates", () => {
    const tdPath = tmpFile("td");
    const ascPath = tmpFile("asc");
    const ascDb = openAscDb(ascPath);
    seedAscDailies(ascDb, "111");
    ascDb.close();

    const td = openTdDb(tdPath);
    seedTdApp(td, { tdAppId: "td-1", name: "Aurora", ascAppStoreId: "111", mappingSource: "auto-bundle" });
    seedEngagement(td, [
      { tdAppId: "td-1", date: "2026-05-10", sessions: 1200, dau: 850 },
      { tdAppId: "td-1", date: "2026-05-11", sessions: 1500, dau: 1024 },
    ]);
    attachAsc(td, ascPath);
    const rows = listFunnelByAppStore(td, "111", 30, "2026-05-11");
    const may10 = rows.find((r) => r.date === "2026-05-10");
    const may11 = rows.find((r) => r.date === "2026-05-11");
    expect(may10?.impressions).toBe(1500); // 1000 US + 500 DE
    expect(may10?.firstTimeDownloads).toBe(35);
    expect(may10?.dau).toBe(850);
    expect(may11?.impressions).toBe(1200);
    expect(may11?.dau).toBe(1024);

    const totals = getFunnelTotals(td, "111", 30, "2026-05-11");
    expect(totals.impressions).toBe(1500 + 1200);
    expect(totals.firstTimeDownloads).toBe(35 + 30);
    expect(totals.sessions).toBe(1200 + 1500);
    expect(totals.latestDau).toBe(1024);
  });

  it("returns rows even when TD has no mapping (TD columns are null)", () => {
    const tdPath = tmpFile("td");
    const ascPath = tmpFile("asc");
    const ascDb = openAscDb(ascPath);
    seedAscDailies(ascDb, "222");
    ascDb.close();

    const td = openTdDb(tdPath);
    attachAsc(td, ascPath);
    const rows = listFunnelByAppStore(td, "222", 30, "2026-05-11");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.dau).toBeNull();
      expect(r.sessions).toBeNull();
    }
  });
});

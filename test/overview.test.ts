import { test, expect } from "bun:test";
import { makeApp } from "../src/server";
import { makeTestDb, seedApp, seedKeyword, seedRankings, mockConfig } from "./seed";

test("overview: h1 says Overview, feed shows significant mover", async () => {
  const db = makeTestDb();
  const appId = seedApp(db, { appStoreId: "111", name: "TestApp", platform: "iphone", isOwn: true });
  const k = seedKeyword(db, { appId, keyword: "wasserwaage", store: "de" });
  seedRankings(db, k, [{ daysAgo: 2, rank: 40 }, { daysAgo: 0, rank: 20 }]);

  const app = makeApp({ config: mockConfig(), db, journalMode: "wal" });
  const res = await app.request("/");
  const html = await res.text();
  expect(html).toContain("<h1>Overview</h1>");
  expect(html).toContain("wasserwaage");
  expect(html).toContain("#40");
  expect(html).toContain("#20");
});

test("overview: non-empty feed splits into labeled groups", async () => {
  const db = makeTestDb();
  const appId = seedApp(db, { appStoreId: "111", name: "TestApp", platform: "iphone", isOwn: true });
  const k = seedKeyword(db, { appId, keyword: "wasserwaage", store: "de" });
  seedRankings(db, k, [{ daysAgo: 2, rank: 40 }, { daysAgo: 0, rank: 20 }]);

  const app = makeApp({ config: mockConfig(), db, journalMode: "wal" });
  const html = await (await app.request("/")).text();
  // All four group labels present; keyword mover lands in the Keywords group,
  // the three metric/review cards render (empty em-dash) rather than mixing in.
  expect(html).toContain(">Keywords</h3>");
  expect(html).toContain(">Impressionen</h3>");
  expect(html).toContain(">Downloads</h3>");
  expect(html).toContain(">Reviews</h3>");
  expect(html).toContain('class="feed-metrics-row"');
  expect(html).toContain("wasserwaage");
});

test("overview: keyword movers split into Aufsteiger / Absteiger columns", async () => {
  const db = makeTestDb();
  const appId = seedApp(db, { appStoreId: "111", name: "TestApp", platform: "iphone", isOwn: true });
  const up = seedKeyword(db, { appId, keyword: "climber", store: "de" });
  const down = seedKeyword(db, { appId, keyword: "sinker", store: "de" });
  seedRankings(db, up, [{ daysAgo: 2, rank: 40 }, { daysAgo: 0, rank: 20 }]);   // delta +20 → Aufsteiger
  seedRankings(db, down, [{ daysAgo: 2, rank: 20 }, { daysAgo: 0, rank: 40 }]);  // delta -20 → Absteiger

  const app = makeApp({ config: mockConfig(), db, journalMode: "wal" });
  const html = await (await app.request("/")).text();
  expect(html).toContain(">Aufsteiger</h4>");
  expect(html).toContain(">Absteiger</h4>");
  // climber sits in the Aufsteiger column (before the Absteiger header),
  // sinker in the Absteiger column (after it).
  const split = html.indexOf(">Absteiger</h4>");
  expect(html.slice(0, split)).toContain("climber");
  expect(html.slice(split)).toContain("sinker");
  expect(html.slice(0, split)).not.toContain("sinker");
});

test("overview: empty feed renders honest empty line, no dead cards", async () => {
  const db = makeTestDb();
  seedApp(db, { appStoreId: "111", name: "TestApp", platform: "iphone", isOwn: true });
  const app = makeApp({ config: mockConfig(), db, journalMode: "wal" });
  const res = await app.request("/?window=24h");
  const html = await res.text();
  expect(html).toContain("Keine Bewegung in diesem Fenster.");
});

test("overview: window toggle defaults to 7d", async () => {
  const db = makeTestDb();
  seedApp(db, { appStoreId: "111", name: "TestApp", platform: "iphone", isOwn: true });
  const app = makeApp({ config: mockConfig(), db, journalMode: "wal" });
  const html = await (await app.request("/")).text();
  // Tabs marks the active item with aria-current="page" and omits the
  // attribute on inactive items. Without ?window, 7d must be the active tab
  // and 24h must not be — this fails if the default ever flips to 24h.
  expect(html).toMatch(/<a[^>]*href="\/\?window=7d"[^>]*aria-current="page"[^>]*>7d<\/a>/);
  expect(html).not.toMatch(/<a[^>]*href="\/\?window=24h"[^>]*aria-current/);
});

test("overview: app row shows labeled metric columns + details link, no rank bar", async () => {
  const db = makeTestDb();
  const appId = seedApp(db, { appStoreId: "111", name: "TestApp", platform: "iphone", isOwn: true });
  const kTop3 = seedKeyword(db, { appId, keyword: "kw-top3", store: "de" });
  const kTop10 = seedKeyword(db, { appId, keyword: "kw-top10", store: "de" });
  const kUnranked = seedKeyword(db, { appId, keyword: "kw-unranked", store: "de" });
  seedRankings(db, kTop3, [{ daysAgo: 0, rank: 2 }]);      // top3 + top10 + ranked
  seedRankings(db, kTop10, [{ daysAgo: 0, rank: 8 }]);     // top10 + ranked
  seedRankings(db, kUnranked, [{ daysAgo: 0, rank: null }]); // tracked, unranked

  const app = makeApp({ config: mockConfig(), db, journalMode: "wal" });
  const html = await (await app.request("/")).text();

  // Labeled metric columns
  expect(html).toContain(">Keywords</span>");
  expect(html).toContain(">Platziert</span>");
  expect(html).toContain(">Top 10</span>");
  expect(html).toContain(">Top 3</span>");
  expect(html).toContain(">Impressions</span>");
  expect(html).toContain(">Downloads</span>");
  // Details link points at the app page; row wrapper is a div, not an anchor
  expect(html).toContain('class="ov-strip-link" href="/apps/111"');
  expect(html).toContain('<div class="card ov-strip-row"');
  // Platform badge present
  expect(html).toContain('class="ov-strip-platform"');
  // Old cryptic bar is gone
  expect(html).not.toContain("ov-rank-bar");
  expect(html).not.toContain("ov-rank-seg");
  // Without ASC configured, Impr./Downl. show the em dash, not a crash
  expect(html).toContain("—");
});

test("overview: feed caps at 15 visible items, rest behind details", async () => {
  const db = makeTestDb();
  const appId = seedApp(db, { appStoreId: "111", name: "TestApp", platform: "iphone", isOwn: true });
  // 17 significant movers (|delta| >= 3 each) — 15 visible, 2 in the tail.
  for (let i = 0; i < 17; i++) {
    const k = seedKeyword(db, { appId, keyword: `kw${String(i).padStart(2, "0")}`, store: "de" });
    seedRankings(db, k, [{ daysAgo: 2, rank: 50 + i }, { daysAgo: 0, rank: 20 + i }]);
  }

  const app = makeApp({ config: mockConfig(), db, journalMode: "wal" });
  const html = await (await app.request("/")).text();

  const detailsStart = html.indexOf('<details class="feed-more">');
  expect(detailsStart).toBeGreaterThan(-1);
  const head = html.slice(0, detailsStart);
  const tail = html.slice(detailsStart);

  // Exactly 15 feed items render before the details element ...
  expect(head.match(/class="feed-item"/g)?.length).toBe(15);
  // ... the summary announces the correct remainder ...
  expect(tail).toContain("<summary>2 weitere anzeigen</summary>");
  // ... and the remaining 2 items render inside the details.
  expect(tail.match(/class="feed-item"/g)?.length).toBe(2);
});

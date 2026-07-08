import { test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { makeTestDb, seedApp, seedKeyword } from "../seed";
import { listKeywords } from "../../src/data/keywords";

let db: Database;
beforeEach(() => { db = makeTestDb(); });

test("listKeywords returns all keywords joined with app info, sorted", () => {
  const a1 = seedApp(db, { appStoreId: "111", name: "Alpha", platform: "iphone" });
  const a2 = seedApp(db, { appStoreId: "222", name: "Beta", platform: "ipad" });
  seedKeyword(db, { appId: a1, keyword: "habit", store: "us" });
  seedKeyword(db, { appId: a1, keyword: "habit", store: "de" });
  seedKeyword(db, { appId: a2, keyword: "level", store: "us" });

  const kws = listKeywords(db);
  expect(kws).toHaveLength(3);
  expect(kws.map((k) => `${k.appName}:${k.keyword}:${k.store}`)).toEqual([
    "Alpha:habit:de",
    "Alpha:habit:us",
    "Beta:level:us",
  ]);
  expect(kws[0]!.platform).toBe("iphone");
  expect(kws[2]!.appStoreId).toBe("222");
});

test("listKeywords filters by appStoreId", () => {
  const a1 = seedApp(db, { appStoreId: "111", name: "Alpha", platform: "iphone" });
  const a2 = seedApp(db, { appStoreId: "222", name: "Beta", platform: "iphone" });
  seedKeyword(db, { appId: a1, keyword: "x", store: "us" });
  seedKeyword(db, { appId: a2, keyword: "y", store: "us" });
  expect(listKeywords(db, { appStoreId: "111" })).toHaveLength(1);
});

test("listKeywords filters by store", () => {
  const a1 = seedApp(db, { appStoreId: "111", name: "Alpha", platform: "iphone" });
  seedKeyword(db, { appId: a1, keyword: "x", store: "us" });
  seedKeyword(db, { appId: a1, keyword: "y", store: "de" });
  expect(listKeywords(db, { store: "de" })).toHaveLength(1);
});

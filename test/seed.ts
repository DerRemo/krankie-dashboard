import { Database } from "bun:sqlite";
import { resolve } from "path";
import type { Config } from "../src/config";

/** Mirror of krankie@SCHEMA_VERSION=5 (incl. app_competitors/competitor_rankings). Update if krankie changes its schema. */
const SCHEMA_SQL = `
CREATE TABLE apps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT NOT NULL UNIQUE,
  name TEXT, developer TEXT, platform TEXT NOT NULL,
  is_own INTEGER NOT NULL DEFAULT 0,
  track_keywords INTEGER NOT NULL DEFAULT 0,
  track_ratings INTEGER NOT NULL DEFAULT 0,
  track_reviews INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL, store TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(app_id, keyword, store)
);
CREATE TABLE rankings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  rank INTEGER, checked_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE app_competitors (
  own_app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  competitor_app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (own_app_id, competitor_app_id)
);
CREATE TABLE competitor_rankings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  store TEXT NOT NULL,
  rank INTEGER,
  checked_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX idx_rankings_keyword_time ON rankings(keyword_id, checked_at DESC);
CREATE INDEX idx_keywords_app ON keywords(app_id);
CREATE INDEX idx_comp_rankings_app_kw ON competitor_rankings(app_id, keyword, store, checked_at DESC);
`;

export function makeTestDb(): Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  db.run("INSERT INTO metadata (key, value) VALUES ('schema_version', '5')");
  return db;
}

export function seedApp(
  db: Database,
  args: { appStoreId: string; name: string; platform: string; isOwn?: boolean },
): number {
  const result = db.run(
    "INSERT INTO apps (app_id, name, platform, is_own, track_keywords) VALUES (?, ?, ?, ?, 1)",
    [args.appStoreId, args.name, args.platform, args.isOwn === false ? 0 : 1],
  );
  return Number(result.lastInsertRowid);
}

export function seedKeyword(
  db: Database,
  args: { appId: number; keyword: string; store: string },
): number {
  const result = db.run(
    "INSERT INTO keywords (app_id, keyword, store) VALUES (?, ?, ?)",
    [args.appId, args.keyword, args.store],
  );
  return Number(result.lastInsertRowid);
}

/**
 * Seed a series of rankings. `samples` is oldest first; each entry's `daysAgo` is converted
 * to a `checked_at` of `now - daysAgo` (UTC, ISO with seconds resolution).
 */
export function seedRankings(
  db: Database,
  keywordId: number,
  samples: Array<{ daysAgo: number; rank: number | null }>,
): void {
  const stmt = db.prepare(
    "INSERT INTO rankings (keyword_id, rank, checked_at) VALUES (?, ?, datetime('now', ?))",
  );
  for (const s of samples) {
    stmt.run(keywordId, s.rank, `-${s.daysAgo} days`);
  }
}

/** Seeds a competitor app (is_own=0). Mirrors seedApp but fixes is_own. */
export function seedCompetitor(
  db: Database,
  args: { appStoreId: string; name: string; platform?: string },
): number {
  const result = db.run(
    "INSERT INTO apps (app_id, name, platform, is_own, track_keywords) VALUES (?, ?, ?, 0, 1)",
    [args.appStoreId, args.name, args.platform ?? "iphone"],
  );
  return Number(result.lastInsertRowid);
}

export function linkCompetitor(db: Database, ownId: number, competitorId: number): void {
  db.run(
    "INSERT INTO app_competitors (own_app_id, competitor_app_id) VALUES (?, ?)",
    [ownId, competitorId],
  );
}

/**
 * Seed a series of competitor rankings. `samples` is oldest first; each entry's `daysAgo`
 * is converted to a `checked_at` of `now - daysAgo`, same shape as seedRankings.
 */
export function seedCompetitorRankings(
  db: Database,
  competitorId: number,
  target: { keyword: string; store: string },
  samples: Array<{ daysAgo: number; rank: number | null }>,
): void {
  const stmt = db.prepare(
    "INSERT INTO competitor_rankings (app_id, keyword, store, rank, checked_at) VALUES (?, ?, ?, ?, datetime('now', ?))",
  );
  for (const s of samples) {
    stmt.run(competitorId, target.keyword, target.store, s.rank, `-${s.daysAgo} days`);
  }
}

/** Convenience: seeds one own app + N keywords + 30 days of plausible rankings. */
export function seedDefault(db: Database): {
  appId: number;
  keywordIds: { id: number; keyword: string; store: string }[];
} {
  const appId = seedApp(db, {
    appStoreId: "6737412117",
    name: "TestApp",
    platform: "iphone",
    isOwn: true,
  });
  const keywords = [
    { keyword: "habit tracker", store: "us" },
    { keyword: "habit tracker", store: "de" },
    { keyword: "level up", store: "us" },
  ];
  const keywordIds = keywords.map((k) => ({
    id: seedKeyword(db, { appId, ...k }),
    ...k,
  }));
  for (const { id } of keywordIds) {
    const samples: Array<{ daysAgo: number; rank: number | null }> = [];
    for (let d = 30; d >= 0; d--) {
      const r = 50 + Math.round(Math.sin(d / 3) * 10) + (id % 5);
      samples.push({ daysAgo: d, rank: d === 15 ? null : r });
    }
    seedRankings(db, id, samples);
  }
  return { appId, keywordIds };
}

export function mockKrankieBin(): string {
  return resolve(import.meta.dir, "fixtures/bin/krankie-mock");
}

export function mockAscBin(): string {
  return resolve(import.meta.dir, "fixtures/bin/asc-mock");
}

type ConfigOverrides = Partial<Omit<Config, "asc" | "td">> & {
  asc?: Partial<Config["asc"]>;
  td?: Partial<Config["td"]>;
};

export function mockConfig(overrides: ConfigOverrides = {}): Config {
  const base: Config = {
    port: 3737,
    krankieBin: mockKrankieBin(),
    krankieDb: ":memory:",
    logLevel: "warn",
    hostname: "test.local",
    ascCliBin: mockAscBin(),
    ascConfigured: false,
    asc: {
      issuerId: "",
      keyId: "",
      privateKeyPath: "",
      vendorNumber: "",
      apiBase: "https://test.invalid",
      dbPath: ":memory:",
    },
    tdConfigured: false,
    td: {
      apiToken: "",
      apiBase: "https://td.test.invalid",
      dbPath: ":memory:",
    },
  };
  return {
    ...base,
    ...overrides,
    asc: { ...base.asc, ...overrides.asc },
    td: { ...base.td, ...overrides.td },
  };
}

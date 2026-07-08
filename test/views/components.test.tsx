import { test, expect } from "bun:test";
import { OverviewView } from "../../src/views/overview";
import type { App, RankingRow } from "../../src/db/types";
import type { AscTodayRow } from "../../src/data/asc";
import { AscRevenueByTerritory } from "../../src/views/components/AscRevenueByTerritory";
import type { AscTerritoryRevenue } from "../../src/data/asc";
import { AscKpiStrip } from "../../src/views/components/AscKpiStrip";
import type { AscKpis } from "../../src/data/asc";
import { AscDailyTable } from "../../src/views/components/AscDailyTable";
import { AscRevenueChart } from "../../src/views/components/AscRevenueChart";
import type { AscDailyPoint } from "../../src/data/asc";
import { RankPill } from "../../src/views/components/RankPill";
import { DeltaBadge } from "../../src/views/components/DeltaBadge";
import { StoreBadge } from "../../src/views/components/StoreBadge";
import { KpiTile } from "../../src/views/components/KpiTile";
import { Card } from "../../src/views/components/Card";
import { Sparkline } from "../../src/views/components/Sparkline";
import { Tabs } from "../../src/views/components/Tabs";
import { RangeSelector } from "../../src/views/components/RangeSelector";
import { engagementLabel, proceedsCrossCheckLabel } from "../../src/views/system-status";
import { CompetitorMatrix } from "../../src/views/components/CompetitorMatrix";
import { BenchmarkSummary } from "../../src/views/components/BenchmarkSummary";
import type { BenchmarkRow, CompetitorApp, BenchmarkSummary as BenchmarkSummaryData } from "../../src/data/competitors";

test("proceedsCrossCheckLabel: dash when no purchases data", () => {
  expect(proceedsCrossCheckLabel({ purchasesProceedsUsd30d: 0, salesProceedsUsd30d: 0, payingUsers30d: 0 })).toBe("—");
});

test("proceedsCrossCheckLabel: shows FX vs native when purchases exist", () => {
  const s = proceedsCrossCheckLabel({ purchasesProceedsUsd30d: 11, salesProceedsUsd30d: 12, payingUsers30d: 3 });
  expect(s).toContain("$12");
  expect(s).toContain("$11");
});

test("engagementLabel: available when metrics present", () => {
  expect(engagementLabel({ engagementMetricsAvailable: true, analyticsLastDate: "2026-06-29" })).toBe("available");
});

test("engagementLabel: n/a (Apple) when analytics flows but no engagement", () => {
  expect(engagementLabel({ engagementMetricsAvailable: false, analyticsLastDate: "2026-06-29" })).toBe("n/a (Apple)");
});

test("engagementLabel: dash when no analytics yet", () => {
  expect(engagementLabel({ engagementMetricsAvailable: false, analyticsLastDate: null })).toBe("—");
});

test("RankPill shows '—' when null", () => {
  expect(String(<RankPill rank={null} />)).toContain("—");
});

test("RankPill flags top-10 ranks", () => {
  expect(String(<RankPill rank={5} />)).toContain('data-tier="top-10"');
});

test("DeltaBadge formats positive (improved) with arrow", () => {
  expect(String(<DeltaBadge delta={3} />)).toMatch(/[▲▼]|↑|↓/);
  expect(String(<DeltaBadge delta={null} />)).toContain("—");
});

test("StoreBadge renders ISO code", () => {
  expect(String(<StoreBadge store="de" />)).toContain("DE");
});

test("KpiTile renders label + value", () => {
  const html = String(<KpiTile label="Top 10" value={42} />);
  expect(html).toContain("Top 10");
  expect(html).toContain("42");
});

test("Card wraps children", () => {
  expect(String(<Card><p>x</p></Card>)).toContain("<p>x</p>");
});

test("Sparkline draws SVG with given points", () => {
  const html = String(<Sparkline points={[{ at: "a", rank: 10 }, { at: "b", rank: 12 }]} />);
  expect(html).toContain("<svg");
  expect(html).toContain("polyline");
});

test("Sparkline handles empty points", () => {
  const html = String(<Sparkline points={[]} />);
  expect(html).toContain("<svg");
  expect(html).not.toContain("polyline");
});

test("Tabs marks active tab", () => {
  const html = String(
    <Tabs items={[
      { label: "A", href: "?w=a" },
      { label: "B", href: "?w=b" },
    ]} active={1} />,
  );
  expect(html).toContain('aria-current="page"');
});

test("RangeSelector emits 7d/30d/90d/all", () => {
  const html = String(<RangeSelector active="30d" basePath="/keywords/1" />);
  expect(html).toContain("?range=7d");
  expect(html).toContain("?range=30d");
  expect(html).toContain("?range=90d");
  expect(html).toContain("?range=all");
});

function baseKpis(over: Partial<AscKpis> = {}): AscKpis {
  return {
    range: "30d", fromDate: "2024-01-01", toDate: "2024-01-30", latestDate: "2024-01-30", isPartial: false,
    impressions: { value: 0, deltaPct: null },
    pageViews: { value: 0, deltaPct: null },
    conversionRate: { value: 0, deltaPct: null },
    firstTimeDownloads: { value: 0, deltaPct: null },
    downloads: { value: 0, deltaPct: null },
    proceedsUsd: { value: 0, deltaPct: null },
    arpd: { value: null, deltaPct: null },
    payingUsers: { value: 0, deltaPct: null },
    crashRate: { value: null, deltaPct: null },
    ...over,
  };
}

test("AscKpiStrip renders the ARPD tile with 2-decimal USD", () => {
  const html = String(<AscKpiStrip kpis={baseKpis({ arpd: { value: 0.43, deltaPct: null } })} />);
  expect(html).toContain("Revenue / DL");
  expect(html).toContain("$0.43");
});

test("AscKpiStrip shows em-dash ARPD when null", () => {
  const html = String(<AscKpiStrip kpis={baseKpis({ arpd: { value: null, deltaPct: null } })} />);
  expect(html).toContain("Revenue / DL");
});

test("AscKpiStrip renders the Paying Users tile", () => {
  const html = String(<AscKpiStrip kpis={baseKpis({ payingUsers: { value: 42, deltaPct: null } })} />);
  expect(html).toContain("Paying Users");
  expect(html).toContain("42");
});

function baseDaily(over: Partial<AscDailyPoint> = {}): AscDailyPoint {
  return {
    date: "2024-01-10", impressions: null, pageViews: null, firstTimeDownloads: null,
    conversionRate: null, units: 0, proceedsUsd: null, iapProceedsUsd: null, totalProceedsUsd: null,
    crashes: null, sessions: null, crashRate: null,
    hasAnalytics: false, hasSales: false, downloadsSource: "missing", isPartial: false,
    ...over,
  };
}

test("AscDailyTable Proceeds column shows combined app + IAP", () => {
  const series = [baseDaily({ hasSales: true, units: 3, proceedsUsd: 0, iapProceedsUsd: 4.62, totalProceedsUsd: 4.62 })];
  const html = String(<AscDailyTable series={series} />);
  expect(html).toContain("$4.62");
});

test("AscRevenueChart empty-state no longer claims EUR is unconverted", () => {
  const series = [baseDaily({ hasSales: true, proceedsUsd: 0, iapProceedsUsd: 0, totalProceedsUsd: 0 })];
  const html = String(<AscRevenueChart series={series} appStoreId="111" range="30d" />);
  expect(html).toContain("Kein USD-Umsatz in diesem Zeitraum.");
  expect(html).not.toContain("nicht in USD umgerechnet");
});

test("AscRevenueByTerritory renders rows with proceeds and share", () => {
  const rows: AscTerritoryRevenue[] = [
    { territory: "US", proceedsUsd: 6, sharePct: 60 },
    { territory: "DE", proceedsUsd: 4, sharePct: 40 },
  ];
  const html = String(<AscRevenueByTerritory rows={rows} />);
  expect(html).toContain("Revenue by Territory");
  expect(html).toContain("US");
  expect(html).toContain("$6");
  expect(html).toContain("60.0 %");
});

test("AscRevenueByTerritory shows empty-state when no rows", () => {
  const html = String(<AscRevenueByTerritory rows={[]} />);
  expect(html).toContain("Kein Umsatz im Zeitraum.");
});

const RIVAL: CompetitorApp = { id: 1, appStoreId: "RIVAL1", name: "Packr" };

function baseRow(over: Partial<BenchmarkRow> = {}): BenchmarkRow {
  return {
    keywordId: 1, keyword: "camping", store: "de",
    own: { currentRank: 78, delta24h: null, delta7d: -3, trend: [] },
    competitors: [{ currentRank: 1, trend: [] }],
    bestCompetitorRank: 1,
    gap: 77,
    ...over,
  };
}

test("CompetitorMatrix renders per-store table with own and competitor ranks", () => {
  const html = String(<CompetitorMatrix competitors={[RIVAL]} rows={[baseRow()]} />);
  expect(html).toContain("camping");
  expect(html).toContain("Packr");
  expect(html).toContain('data-tier="top-200"'); // own rank #78
});

test("CompetitorMatrix marks a losing gap with data-dir=trail", () => {
  const html = String(<CompetitorMatrix competitors={[RIVAL]} rows={[baseRow()]} />);
  expect(html).toContain('data-dir="trail"');
});

test("CompetitorMatrix marks a leading gap with data-dir=lead", () => {
  const row = baseRow({
    own: { currentRank: 3, delta24h: null, delta7d: null, trend: [] },
    bestCompetitorRank: 10,
    gap: -7,
  });
  const html = String(<CompetitorMatrix competitors={[RIVAL]} rows={[row]} />);
  expect(html).toContain('data-dir="lead"');
});

function baseSummary(over: Partial<BenchmarkSummaryData> = {}): BenchmarkSummaryData {
  return { keywordCount: 10, weLead: 2, weTrail: 6, weAbsentButRivalRanks: 2, avgGap: 12.5, ...over };
}

test("BenchmarkSummary renders the KPI strip", () => {
  const html = String(<BenchmarkSummary summary={baseSummary()} />);
  expect(html).toContain("Wir führen");
  expect(html).toContain("Wir hängen hinten");
  expect(html).toContain("12.5");
});

function ovRankingRow(currentRank: number | null): RankingRow {
  return {
    keywordId: 1, keyword: "k", store: "de", appId: 1, appStoreId: "111",
    appName: "TestApp", platform: "iphone", currentRank,
    delta24h: null, delta7d: null, trend: [], checkedAt: "2026-07-08T00:00:00Z",
  };
}

test("OverviewView: ASC metrics render DE numbers + DE delta, green tiers, no rank bar", () => {
  const app: App = {
    id: 1, appStoreId: "111", name: "TestApp", developer: null,
    platform: "iphone", isOwn: true, trackKeywords: true,
  };
  const rankingsByApp = new Map<number, RankingRow[]>([
    [1, [ovRankingRow(2), ovRankingRow(8), ovRankingRow(null)]],
  ]);
  const ascToday: AscTodayRow[] = [{
    appStoreId: "111", date: "2026-07-07",
    impressionsDate: "2026-07-07", downloadsDate: "2026-07-07",
    impressions: 12345, downloads: 2,
    impressionsSource: "sales", downloadsSource: "sales", isPartial: false,
    impressionsDelta7dPct: -6.9, downloadsDelta7dPct: 0,
    trendImpressions: [], trendDownloads: [], proceeds30d: 0, trendProceeds: [],
  }];

  const html = String(
    <OverviewView
      apps={[app]}
      rankingsByApp={rankingsByApp}
      ascToday={ascToday}
      feed={[]}
      window="7d"
      lastCheckAt={null}
      navApps={[]}
      tdConfigured={false}
    />,
  );

  expect(html).toContain("12.345");   // impressions, DE grouping
  expect(html).toContain("-6,9 %");   // impressions delta, DE
  expect(html).toContain("±0 %");     // downloads delta = 0
  expect(html).toContain('class="ov-metric-val num pos"'); // Top 10 / Top 3 highlighted
  expect(html).not.toContain("ov-rank-bar");
});


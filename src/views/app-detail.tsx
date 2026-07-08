import { Layout, type NavApp } from "./layout";
import { Card } from "./components/Card";
import { KpiTile } from "./components/KpiTile";
import { RankPill } from "./components/RankPill";
import { DeltaBadge } from "./components/DeltaBadge";
import { StoreBadge } from "./components/StoreBadge";
import { Sparkline } from "./components/Sparkline";
import { AscKpiStrip } from "./components/AscKpiStrip";
import { AscFunnelChart } from "./components/AscFunnelChart";
import { AscRevenueChart } from "./components/AscRevenueChart";
import { AscDailyTable } from "./components/AscDailyTable";
import { AscRevenueByTerritory } from "./components/AscRevenueByTerritory";
import { TdEngagementStrip } from "./components/TdEngagementStrip";
import { TdEngagementChart } from "./components/TdEngagementChart";
import { TdCustomEventsTable } from "./components/TdCustomEventsTable";
import { TdBreakdownPanel } from "./components/TdBreakdownPanel";
import { AsoToAppFunnel } from "./components/AsoToAppFunnel";
import { CompetitorMatrix } from "./components/CompetitorMatrix";
import { BenchmarkSummary } from "./components/BenchmarkSummary";
import { AppIconPlaceholder } from "./components/AppIconPlaceholder";
import { ReviewsSection, type ReviewsSectionProps } from "./components/ReviewsSection";
import type { App, AppStats, RankingRow } from "../db/types";
import type { AscKpis, AscDailyPoint, AscRange, AscTerritoryRevenue } from "../data/asc";
import type { TdEngagementSummary, TdEngagementPoint, TdCustomEventSummary, TdBreakdownEntry } from "../data/td";
import type { FunnelTotals } from "../data/funnel";
import type { CompetitorBenchmark } from "../data/competitors";

interface AscBlock {
  configured: boolean;
  kpis: AscKpis | null;
  funnelSeries: AscDailyPoint[];
  revenueSeries: AscDailyPoint[];
  revenueByTerritory: AscTerritoryRevenue[];
  funnelRange: AscRange;
  revenueRange: AscRange;
}

export interface AppDetailTdProps {
  tdAppId: string | null;
  summary: TdEngagementSummary;
  points: TdEngagementPoint[];
  events: TdCustomEventSummary[];
  breakdowns: {
    appVersion: TdBreakdownEntry[];
    systemVersion: TdBreakdownEntry[];
    modelName: TdBreakdownEntry[];
  };
}

export interface AppDetailFunnelProps {
  totals: FunnelTotals;
  windowDays: number;
}

interface Props {
  app: App;
  stats: AppStats;
  rankings: RankingRow[];
  asc?: AscBlock;
  td?: AppDetailTdProps | null;
  funnel?: AppDetailFunnelProps | null;
  competitors?: CompetitorBenchmark;
  reviews?: ReviewsSectionProps | null;
  navApps: NavApp[];
  tdConfigured: boolean;
}

export function AppDetailView({ app, stats, rankings, asc, td, funnel, competitors, reviews, navApps, tdConfigured }: Props) {
  const byStore = new Map<string, RankingRow[]>();
  for (const r of rankings) {
    const list = byStore.get(r.store) ?? [];
    list.push(r);
    byStore.set(r.store, list);
  }
  const stores = [...byStore.keys()].sort();

  return (
    <Layout title={app.name ?? app.appStoreId} active={null} activeApp={app.appStoreId} navApps={navApps} tdConfigured={tdConfigured}>
      <header class="app-detail-head">
        <div class="app-detail-head-id">
          <AppIconPlaceholder name={app.name ?? app.appStoreId} size={48} />
          <div>
            <h1>{app.name ?? app.appStoreId}</h1>
            <div class="app-meta">
              <span>{app.platform}</span>
              <a href={`https://apps.apple.com/app/id${app.appStoreId}`} target="_blank" rel="noreferrer">App Store</a>
              <span class="num">id: {app.appStoreId}</span>
            </div>
          </div>
        </div>
      </header>

      <h2 class="section-label">Keywords</h2>
      <div class="kpi-grid">
        <KpiTile label="Keywords" value={stats.keywordCount} />
        <KpiTile label="Top 10" value={stats.top10Count} />
        <KpiTile label="Top 50" value={stats.top50Count} />
        <KpiTile label="Avg rank" value={stats.avgRank?.toFixed(1) ?? "—"} />
      </div>

      {funnel && (
        <AsoToAppFunnel totals={funnel.totals} windowDays={funnel.windowDays} />
      )}

      <div class="app-detail-tabs" data-app-detail-tabs="store">
        <div class="tabs-bar" role="tablist">
          <button type="button" role="tab" data-tab-id="store" aria-selected="true" class="tab is-active">App Store</button>
          <button type="button" role="tab" data-tab-id="td" aria-selected="false" class="tab">TelemetryDeck</button>
        </div>

        <div role="tabpanel" data-tab-id="store">
          {asc?.configured && asc.kpis && (
            <>
              <h2 class="section-label">Performance</h2>
              <AscKpiStrip kpis={asc.kpis} />
              <AscFunnelChart series={asc.funnelSeries} appStoreId={app.appStoreId} range={asc.funnelRange} />
              <AscRevenueChart series={asc.revenueSeries} appStoreId={app.appStoreId} range={asc.revenueRange} />
              <AscRevenueByTerritory rows={asc.revenueByTerritory} />
              <AscDailyTable series={asc.funnelSeries} />
            </>
          )}
          {asc?.configured && !asc.kpis && (
            <p class="empty-block">Noch keine ASC-Daten — Sync läuft täglich 06:00 oder via System Status. Initial-Backfill kann mehrere Tage trickeln (Apples Snapshot-API).</p>
          )}
          {asc && !asc.configured && (
            <p class="empty-block">ASC API nicht konfiguriert. Siehe README → "Configure ASC API".</p>
          )}

          {stores.map((store) => (
            <section class="store-group" data-store={store}>
              <header class="store-group-head">
                <h2><StoreBadge store={store} /></h2>
              </header>
              <Card>
                <table class="rankings-table">
                  <thead>
                    <tr>
                      <th>Keyword</th>
                      <th class="num">Rank</th>
                      <th class="num">Δ24h</th>
                      <th class="num">Δ7d</th>
                      <th>Trend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(byStore.get(store) ?? []).map((r) => (
                      <tr>
                        <td><a href={`/keywords/${r.keywordId}`}>{r.keyword}</a></td>
                        <td><RankPill rank={r.currentRank} /></td>
                        <td><DeltaBadge delta={r.delta24h} /></td>
                        <td><DeltaBadge delta={r.delta7d} /></td>
                        <td><Sparkline points={r.trend} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </section>
          ))}

          {competitors && competitors.competitors.length > 0 && (
            <>
              <h2 class="section-label">Competitors</h2>
              <BenchmarkSummary summary={competitors.summary} />
              <CompetitorMatrix competitors={competitors.competitors} rows={competitors.rows} />
            </>
          )}
          {competitors && competitors.competitors.length === 0 && (
            <p class="empty-block">Keine Competitors für diese App getrackt.</p>
          )}

          {reviews && <ReviewsSection {...reviews} />}
        </div>

        <div role="tabpanel" data-tab-id="td" hidden>
          {!td?.tdAppId ? (
            <p class="empty-block">No TelemetryDeck app mapped to this app yet. <a href="/system">Manage mapping</a>.</p>
          ) : (
            <>
              <TdEngagementStrip summary={td.summary} />
              <TdEngagementChart appId={app.appStoreId} points={td.points} />
              <TdCustomEventsTable events={td.events} />
              <TdBreakdownPanel panels={[
                { dimension: "appVersion", label: "App version", entries: td.breakdowns.appVersion },
                { dimension: "systemVersion", label: "iOS version", entries: td.breakdowns.systemVersion },
                { dimension: "modelName", label: "Device model", entries: td.breakdowns.modelName },
              ]} />
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}

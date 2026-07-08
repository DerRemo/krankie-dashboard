import { Layout, type NavApp } from "./layout";
import { Card } from "./components/Card";
import { RankPill } from "./components/RankPill";
import { StoreBadge } from "./components/StoreBadge";
import { RangeSelector } from "./components/RangeSelector";
import { KpiTile } from "./components/KpiTile";
import type { Keyword, TimePoint } from "../db/types";
import type { Range } from "./components/RangeSelector";

interface Props { keyword: Keyword; current: number | null; points: TimePoint[]; range: Range; navApps: NavApp[]; tdConfigured: boolean }

export function KeywordHistoryView({ keyword, current, points, range, navApps, tdConfigured }: Props) {
  const ranks = points.map((p) => p.rank).filter((r): r is number => r !== null);
  const bestRank = ranks.length > 0 ? Math.min(...ranks) : null;
  const worstRank = ranks.length > 0 ? Math.max(...ranks) : null;
  const trackedSince = points[0]?.at.slice(0, 10) ?? null;

  return (
    <Layout title={`${keyword.keyword} — ${keyword.store.toUpperCase()}`} active={null} navApps={navApps} tdConfigured={tdConfigured}>
      <header class="keyword-head">
        <div>
          <h1>{keyword.keyword}</h1>
          <div class="app-meta">
            <a href={`/apps/${keyword.appStoreId}`}>{keyword.appName ?? keyword.appStoreId}</a>
            <StoreBadge store={keyword.store} />
            <a href={`/compare?keyword=${encodeURIComponent(keyword.keyword)}`}>show in all stores</a>
          </div>
        </div>
        <div class="keyword-rank-large">
          <RankPill rank={current} />
        </div>
      </header>

      <div class="kpi-grid">
        <KpiTile label="Current rank" value={current ?? "—"} />
        <KpiTile label="Best rank" value={bestRank ?? "—"} />
        <KpiTile label="Worst rank" value={worstRank ?? "—"} />
        <KpiTile label="Tracked since" value={trackedSince ?? "—"} />
      </div>

      <section class="ov-section">
        <h2 class="section-label">Rang-Verlauf</h2>
        <RangeSelector active={range} basePath={`/keywords/${keyword.id}`} />
        <Card>
          <div
            id="history-chart"
            data-keyword-id={String(keyword.id)}
            data-range={range}
            style="height:320px;"
          />
        </Card>
      </section>

      <section class="ov-section">
        <h2 class="section-label">Snapshots</h2>
        <Card class="data-table-card">
          <table class="data-table">
            <thead><tr><th>Date</th><th class="num">Rank</th></tr></thead>
            <tbody>
              {points.slice().reverse().map((p) => (
                <tr><td class="num">{p.at.replace("T", " ").slice(0, 16)}</td><td class="num"><RankPill rank={p.rank} /></td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>
    </Layout>
  );
}

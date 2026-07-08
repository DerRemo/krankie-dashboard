import { Layout, type NavApp } from "./layout";
import { Card } from "./components/Card";
import { RankPill } from "./components/RankPill";
import { DeltaBadge } from "./components/DeltaBadge";
import { StoreBadge } from "./components/StoreBadge";
import { Sparkline } from "./components/Sparkline";
import type { RankingRow } from "../db/types";

interface Props { keyword: string; rows: RankingRow[]; navApps: NavApp[]; tdConfigured: boolean }

export function StoreCompareView({ keyword, rows, navApps, tdConfigured }: Props) {
  return (
    <Layout title={`${keyword} — store comparison`} active={null} navApps={navApps} tdConfigured={tdConfigured}>
      <header class="keyword-head">
        <div>
          <h1>{keyword}</h1>
          <div class="app-meta">store comparison ({rows.length} stores)</div>
        </div>
      </header>
      {rows.length === 0 ? (
        <p class="empty-block">No data for this keyword.</p>
      ) : rows.length === 1 ? (
        <Card>
          <p>Only tracked in <strong>{rows[0]!.store.toUpperCase()}</strong>. Add more stores via:</p>
          <code class="num">krankie keyword add {rows[0]!.appStoreId} "{keyword}" --store us,gb,de</code>
        </Card>
      ) : (
        <Card>
          <table class="rankings-table">
            <thead>
              <tr>
                <th>Store</th>
                <th class="num">Rank</th>
                <th class="num">Δ24h</th>
                <th class="num">Δ7d</th>
                <th>Trend</th>
                <th>App</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr data-store={r.store}>
                  <td><StoreBadge store={r.store} /></td>
                  <td><RankPill rank={r.currentRank} /></td>
                  <td><DeltaBadge delta={r.delta24h} /></td>
                  <td><DeltaBadge delta={r.delta7d} /></td>
                  <td><Sparkline points={r.trend} /></td>
                  <td><a href={`/apps/${r.appStoreId}`}>{r.appName ?? r.appStoreId}</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </Layout>
  );
}

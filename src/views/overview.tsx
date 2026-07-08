import { Layout, type NavApp } from "./layout";
import { PageHead } from "./components/PageHead";
import { Tabs } from "./components/Tabs";
import { FeedList } from "./components/FeedList";
import { AppIconPlaceholder } from "./components/AppIconPlaceholder";
import { fmtNum, fmtDelta, deltaClass, ago } from "./formatting";
import type { App, RankingRow } from "../db/types";
import type { AscTodayRow } from "../data/asc";
import type { FeedEntry, FeedWindow } from "../data/feed";

interface Props {
  apps: App[];
  rankingsByApp: Map<number, RankingRow[]>;
  ascToday?: AscTodayRow[];
  feed: FeedEntry[];
  window: FeedWindow;
  lastCheckAt: string | null;
  navApps: NavApp[];
  tdConfigured: boolean;
}

const WINDOW_TABS = [
  { label: "24h", href: "/?window=24h" },
  { label: "7d", href: "/?window=7d" },
];

export function OverviewView({ apps, rankingsByApp, ascToday, feed, window, lastCheckAt, navApps, tdConfigured }: Props) {
  const ascByApp = new Map<string, AscTodayRow>();
  for (const r of ascToday ?? []) ascByApp.set(r.appStoreId, r);
  const lastCheckLine = lastCheckAt
    ? `Zuletzt geprüft ${ago(lastCheckAt)} · ${lastCheckAt.replace("T", " ").slice(0, 16)}`
    : "Noch keine Checks";

  return (
    <Layout title="Overview" active="overview" navApps={navApps} tdConfigured={tdConfigured}>
      <PageHead title="Overview" subtitle={lastCheckLine} />
      <section class="ov-section">
        <h2 class="section-label">Apps</h2>
        {apps.length === 0 ? (
          <p class="empty-block">No apps tracked. Add one with <code class="num">krankie app create &lt;app-id&gt;</code>.</p>
        ) : (
          <div class="ov-strip">
            {apps.map((app) => {
              const rows = rankingsByApp.get(app.id) ?? [];
              const total = rows.length;
              const ranked = rows.filter((r) => r.currentRank !== null).length;
              const top3 = rows.filter((r) => r.currentRank !== null && r.currentRank <= 3).length;
              const top10 = rows.filter((r) => r.currentRank !== null && r.currentRank <= 10).length;
              const top50 = rows.filter((r) => r.currentRank !== null && r.currentRank <= 50).length;
              const segs = [
                { tier: "top3", n: top3 },
                { tier: "top10", n: Math.max(0, top10 - top3) },
                { tier: "top50", n: Math.max(0, top50 - top10) },
                { tier: "ranked", n: Math.max(0, ranked - top50) },
              ];
              const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
              const asc = ascByApp.get(app.appStoreId);
              return (
                <a class="card ov-strip-row" href={`/apps/${app.appStoreId}`} data-app-id={app.appStoreId}>
                  <span class="ov-strip-id">
                    <AppIconPlaceholder name={app.name ?? app.appStoreId} size={32} />
                    <span class="ov-strip-name">{app.name ?? app.appStoreId}</span>
                  </span>
                  <span class="ov-rank-bar ov-strip-bar" role="img"
                    aria-label={`Rang-Verteilung: ${top3} Top 3, ${top10} Top 10, ${top50} Top 50, ${ranked} von ${total} platziert`}>
                    {segs.map((s) => (s.n > 0 ? <span class="ov-rank-seg" data-tier={s.tier} style={`width:${pct(s.n)}%`} /> : null))}
                  </span>
                  <span class="ov-strip-tiers num">{top3} · {top10} · {top50} <span class="ov-strip-total">/ {total}</span></span>
                  {asc?.date && (
                    <span class="ov-strip-asc">
                      <span class="ov-strip-metric"><span class="num">{fmtNum(asc.impressions)}</span> Impr. <span class={`num ${deltaClass(asc.impressionsDelta7dPct)}`}>{fmtDelta(asc.impressionsDelta7dPct)}</span></span>
                      <span class="ov-strip-metric"><span class="num">{fmtNum(asc.downloads)}</span> Downl. <span class={`num ${deltaClass(asc.downloadsDelta7dPct)}`}>{fmtDelta(asc.downloadsDelta7dPct)}</span></span>
                    </span>
                  )}
                </a>
              );
            })}
          </div>
        )}
      </section>
      <section class="ov-section">
        <div class="ov-feed-head">
          <h2 class="section-label">Bewegung</h2>
          <Tabs items={WINDOW_TABS} active={window === "24h" ? 0 : 1} />
        </div>
        <FeedList entries={feed} />
      </section>
    </Layout>
  );
}

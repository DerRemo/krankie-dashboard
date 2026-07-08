import { Layout, type NavApp } from "./layout";
import { PageHead } from "./components/PageHead";
import { Tabs } from "./components/Tabs";
import { FeedList } from "./components/FeedList";
import { AppIconPlaceholder } from "./components/AppIconPlaceholder";
import { fmtNumDe, fmtDeltaDe, deltaClass, ago } from "./formatting";
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
              const asc = ascByApp.get(app.appStoreId);
              const hasAsc = !!asc?.date;
              return (
                <div class="card ov-strip-row" data-app-id={app.appStoreId}>
                  <span class="ov-strip-id">
                    <AppIconPlaceholder name={app.name ?? app.appStoreId} size={32} />
                    <span class="ov-strip-name">{app.name ?? app.appStoreId}</span>
                    <span class="ov-strip-platform">{app.platform}</span>
                  </span>
                  <span class="ov-metric">
                    <span class="ov-metric-label">Keywords</span>
                    <span class="ov-metric-val num">{fmtNumDe(total)}</span>
                  </span>
                  <span class="ov-metric">
                    <span class="ov-metric-label">Platziert</span>
                    <span class="ov-metric-val num">{fmtNumDe(ranked)}</span>
                  </span>
                  <span class="ov-metric">
                    <span class="ov-metric-label">Top 10</span>
                    <span class={`ov-metric-val num${top10 > 0 ? " pos" : ""}`}>{fmtNumDe(top10)}</span>
                  </span>
                  <span class="ov-metric">
                    <span class="ov-metric-label">Top 3</span>
                    <span class={`ov-metric-val num${top3 > 0 ? " pos" : ""}`}>{fmtNumDe(top3)}</span>
                  </span>
                  <span class="ov-metric">
                    <span class="ov-metric-label">Impressions</span>
                    <span class="ov-metric-val">
                      <span class="num">{hasAsc ? fmtNumDe(asc!.impressions) : "—"}</span>
                      {hasAsc && asc!.impressionsDelta7dPct !== null && (
                        <span class={`num ov-metric-sub ${deltaClass(asc!.impressionsDelta7dPct)}`}>{fmtDeltaDe(asc!.impressionsDelta7dPct)}</span>
                      )}
                    </span>
                  </span>
                  <span class="ov-metric">
                    <span class="ov-metric-label">Downloads</span>
                    <span class="ov-metric-val">
                      <span class="num">{hasAsc ? fmtNumDe(asc!.downloads) : "—"}</span>
                      {hasAsc && asc!.downloadsDelta7dPct !== null && (
                        <span class={`num ov-metric-sub ${deltaClass(asc!.downloadsDelta7dPct)}`}>{fmtDeltaDe(asc!.downloadsDelta7dPct)}</span>
                      )}
                    </span>
                  </span>
                  <a class="ov-strip-link" href={`/apps/${app.appStoreId}`} aria-label={`Details zu ${app.name ?? app.appStoreId}`}>Details →</a>
                </div>
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

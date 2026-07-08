import { Layout, type NavApp } from "../layout";
import { PageHead } from "../components/PageHead";
import { Card } from "../components/Card";
import type { TdEngagementSummary } from "../../data/td";
import { fmtNum, fmtPct } from "../formatting";

export interface TdOverviewRow {
  appStoreId: string | null;
  tdAppId: string;
  appName: string;
  summary: TdEngagementSummary;
  latestVersion: string | null;
  topEvent: string | null;
}

export interface TdOverviewProps {
  rows: TdOverviewRow[];
  unmatchedCount: number;
  navApps: NavApp[];
  tdConfigured: boolean;
}

export function TdOverview({ rows, unmatchedCount, navApps, tdConfigured }: TdOverviewProps) {
  return (
    <Layout title="TelemetryDeck Overview" active="td" navApps={navApps} tdConfigured={tdConfigured}>
      <PageHead title="TelemetryDeck" />
      {unmatchedCount > 0 && (
        <div class="notice notice-warn">
          {unmatchedCount} TD app(s) are not mapped to a krankie app.{" "}
          <a href="/system">Manage on system status</a>.
        </div>
      )}
      {rows.length === 0 ? (
        <p class="empty-block">Noch keine TelemetryDeck-Daten. Sync läuft täglich oder manuell über den <a href="/system">System-Status</a>.</p>
      ) : (
        <Card>
          <div class="table-scroll">
            <table class="rankings-table">
              <thead>
                <tr>
                  <th>App</th>
                  <th class="num">DAU (latest)</th>
                  <th class="num">MAU (28d)</th>
                  <th class="num">Sessions / day</th>
                  <th class="num">Stickiness</th>
                  <th>Top event</th>
                  <th>Latest version</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr>
                    <td>
                      {r.appStoreId ? (
                        <a href={`/apps/${r.appStoreId}#td`}>{r.appName}</a>
                      ) : (
                        <span class="text-muted">{r.appName}</span>
                      )}
                    </td>
                    <td class="num">{fmtNum(r.summary.dau)}</td>
                    <td class="num">{fmtNum(r.summary.mau)}</td>
                    <td class="num">{fmtNum(r.summary.sessions)}</td>
                    <td class="num">{fmtPct(r.summary.stickiness)}</td>
                    <td>{r.topEvent ?? "—"}</td>
                    <td>{r.latestVersion ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </Layout>
  );
}

import { Layout, type NavApp } from "./layout";
import { PageHead } from "./components/PageHead";
import { Card } from "./components/Card";
import { KpiTile } from "./components/KpiTile";
import { Button } from "./components/Button";
import { StatusDot } from "./components/StatusDot";
import { AscSyncCard } from "./components/AscSyncCard";
import { TdSyncCard } from "./components/TdSyncCard";
import type { DbStats, HealthSnapshot } from "../db/types";
import type { AscAppDiagnostics, AscCoverage, AscSyncRunRow } from "../data/asc";
import type { TdSyncStatusRow } from "../data/td";

export interface AscStatusBlock {
  configured: boolean;
  running: boolean;
  currentRunId: number | null;
  lastRun: AscSyncRunRow | null;
  coverage: AscCoverage;
}

export interface AscHealth {
  configured: boolean;
  dbReachable: boolean;
  lastSyncAge: number | null;
}

interface Props {
  health: HealthSnapshot;
  stats: DbStats;
  lastCheckAt: string | null;
  lastStderrTail: string | null;
  ascStatus?: AscStatusBlock;
  ascHealth?: AscHealth;
  ascDiagnostics?: AscAppDiagnostics[];
  td?: { latest: TdSyncStatusRow | null; unmatchedCount: number };
  navApps: NavApp[];
  tdConfigured: boolean;
}

function formatBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)} KB`;
  return `${n} B`;
}

function formatAge(hours: number | null): string {
  if (hours === null) return "never";
  if (hours < 1) return `vor ${Math.round(hours * 60)} min`;
  if (hours < 48) return `vor ${hours.toFixed(1)} h`;
  return `vor ${(hours / 24).toFixed(1)} d`;
}

const ENGAGEMENT_TOOLTIP =
  "Apple liefert Sessions, Active Devices und Crashes erst ab einer Privacy-/Volumen-Schwelle teilnehmender Nutzer. Diese App liegt darunter — kein Erfassungsfehler.";

const PROCEEDS_CHECK_TOOLTIP =
  "FX-Gegenprobe: links Sales-Proceeds (EUR/CHF→USD umgerechnet), rechts native USD aus dem App-Store-Purchases-Report. Große Abweichung ⇒ FX-Problem.";

export function engagementLabel(row: { engagementMetricsAvailable: boolean; analyticsLastDate: string | null }): string {
  if (row.engagementMetricsAvailable) return "available";
  if (row.analyticsLastDate) return "n/a (Apple)";
  return "—";
}

export function proceedsCrossCheckLabel(row: { purchasesProceedsUsd30d: number; salesProceedsUsd30d: number; payingUsers30d: number }): string {
  if (row.purchasesProceedsUsd30d <= 0 && row.payingUsers30d <= 0) return "—";
  return `$${row.salesProceedsUsd30d.toFixed(0)} FX / $${row.purchasesProceedsUsd30d.toFixed(0)} nativ`;
}

export function SystemStatusView({ health, stats, lastCheckAt, lastStderrTail, ascStatus, ascHealth, ascDiagnostics = [], td, navApps, tdConfigured }: Props) {
  const checks: Array<{ label: string; ok: boolean; detail: string }> = [
    { label: "krankie.db reachable", ok: health.dbReachable, detail: health.dbReachable ? "ok" : "missing" },
    { label: "schema valid", ok: health.schemaOk, detail: health.schemaOk ? "ok" : "tables missing" },
    { label: "krankie binary", ok: health.krankieBinaryFound, detail: health.krankieBinaryFound ? "found" : "not found in PATH" },
    { label: "WAL mode", ok: health.journalMode === "wal", detail: health.journalMode },
  ];
  if (ascHealth) {
    checks.push(
      { label: "ASC API configured", ok: ascHealth.configured, detail: ascHealth.configured ? "yes" : "set ASC_* in .env" },
      { label: "ASC DB reachable", ok: ascHealth.dbReachable, detail: ascHealth.dbReachable ? "ok" : "no asc.db yet" },
      { label: "Last ASC sync < 36h", ok: ascHealth.lastSyncAge !== null && ascHealth.lastSyncAge < 36,
        detail: ascHealth.lastSyncAge === null ? "never" : `${ascHealth.lastSyncAge.toFixed(1)}h ago` },
    );
  }

  return (
    <Layout title="System" active="system" navApps={navApps} tdConfigured={tdConfigured}>
      <PageHead
        title="System"
        actions={
          <>
            <span class="site-status" id="check-status" data-state="idle">
              <StatusDot state="idle" />
              <span class="status-label">idle</span>
            </span>
            <Button id="system-run-check">Run check now</Button>
          </>
        }
      />

      <section class="ov-section">
        <h2 class="section-label">Status</h2>
        <div class="kpi-grid">
          <KpiTile label="Last check" value={formatAge(health.lastCheckAgeHours)} hint={lastCheckAt ?? undefined} />
          <KpiTile label="Apps" value={stats.apps} />
          <KpiTile label="Keywords" value={stats.keywords} />
          <KpiTile label="Rankings" value={stats.rankings} />
          <KpiTile label="DB size" value={formatBytes(stats.dbSizeBytes)} />
        </div>
      </section>

      {ascStatus && (
        <AscSyncCard
          configured={ascStatus.configured}
          running={ascStatus.running}
          lastRun={ascStatus.lastRun}
          coverage={ascStatus.coverage}
        />
      )}

      {td && (
        <TdSyncCard latest={td.latest} unmatchedCount={td.unmatchedCount} />
      )}

      {ascDiagnostics.length > 0 && (
        <Card>
          <h2>ASC Data Coverage</h2>
          <div class="table-scroll">
            <table class="asc-daily-table">
              <thead>
                <tr>
                  <th>App</th>
                  <th>Sales</th>
                  <th>Analytics</th>
                  <th class="num" title="Days in last 7 where Apple reported analytics but no sales transaction. Normal for free apps without IAP activity.">
                    No-sales 7d
                  </th>
                  <th class="num" title="Days in last 7 where Apple has not yet delivered sales or analytics. Should drop to 0 as Apple's reports land.">
                    Pending 7d
                  </th>
                  <th class="num">Missing Analytics 7d</th>
                  <th title={ENGAGEMENT_TOOLTIP}>Engagement/Crashes</th>
                  <th class="num" title="Eindeutige zahlende Nutzer (Summe über Segmente; obere Schranke), letzte 30 Tage.">Paying Users 30d</th>
                  <th class="num" title={PROCEEDS_CHECK_TOOLTIP}>Proceeds 30d (FX/nativ)</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {ascDiagnostics.map((r) => (
                  <tr class={r.isStale ? "is-partial" : ""}>
                    <td>{r.name ?? r.appStoreId}</td>
                    <td class="num">{r.salesLastDate ?? "—"}</td>
                    <td class="num">{r.analyticsLastDate ?? "—"}</td>
                    <td class="num">{r.salesNoActivityLast7d}</td>
                    <td class="num">{r.salesPendingLast7d}</td>
                    <td class="num">{r.missingAnalyticsLast7d}</td>
                    <td title={ENGAGEMENT_TOOLTIP}>{engagementLabel(r)}</td>
                    <td class="num">{r.payingUsers30d}</td>
                    <td class="num" title={PROCEEDS_CHECK_TOOLTIP}>{proceedsCrossCheckLabel(r)}</td>
                    <td>{r.isStale ? "stale" : "ok"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <h2>Health</h2>
        <ul class="health-list">
          {checks.map((c) => (
            <li>
              <StatusDot state={c.ok ? "success" : "error"} />
              <strong>{c.label}</strong>
              <span class="text-muted">{c.detail}</span>
            </li>
          ))}
        </ul>
      </Card>

      {lastStderrTail ? (
        <Card>
          <h2>Last check output</h2>
          <details>
            <summary>Show stderr tail</summary>
            <pre class="num">{lastStderrTail}</pre>
          </details>
        </Card>
      ) : null}
    </Layout>
  );
}

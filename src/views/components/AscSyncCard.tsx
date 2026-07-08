import type { AscSyncRunRow, AscCoverage } from "../../data/asc";
import { ago } from "../formatting";
import { SyncCard } from "./SyncCard";

export function AscSyncCard({
  configured, running, lastRun, coverage,
}: {
  configured: boolean;
  running: boolean;
  lastRun: AscSyncRunRow | null;
  coverage: AscCoverage;
}) {
  if (!configured) {
    return (
      <SyncCard
        title="ASC Sync"
        configured={false}
        notConfiguredHint={'⚠️ Not configured. See README → "Configure ASC API".'}
        statusIcon="—"
        statusLabel="never"
        rows={[]}
      />
    );
  }
  const status = lastRun?.status ?? "never";
  const icon = running ? "⏳" : status === "success" ? "✅" : status === "partial" ? "⚠️" : status === "failed" ? "❌" : "—";
  const summary = lastRun?.summaryJson ? JSON.parse(lastRun.summaryJson) : null;

  return (
    <SyncCard
      title="ASC Sync"
      configured={true}
      statusIcon={icon}
      statusLabel={running ? "running…" : status}
      rows={[
        { label: "Last sync", value: ago(lastRun?.finishedAt ?? lastRun?.startedAt ?? null) },
        { label: "Sales coverage", value: `${coverage.salesLastDate ?? "—"} (${Math.round(coverage.salesBackfillPct * 100)}% / 365d)` },
        { label: "Analytics coverage", value: `${coverage.analyticsLastDate ?? "—"} (${Math.round(coverage.analyticsBackfillPct * 100)}% / 365d)` },
        { label: "Next scheduled", value: "06:00 daily" },
      ]}
      action={
        <button id="asc-sync-now" class="btn btn-primary" disabled={running}>
          {running ? "Sync running…" : "Sync now"}
        </button>
      }
      details={{
        summary: "Last sync output",
        body: (
          <>
            <pre class="card-pre">{summary ? JSON.stringify(summary, null, 2) : "(no summary)"}</pre>
            {lastRun?.error && <pre class="card-pre card-pre--error">{lastRun.error}</pre>}
          </>
        ),
      }}
    />
  );
}

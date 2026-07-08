import { ago } from "../formatting";
import { SyncCard, type SyncCardRow } from "./SyncCard";
import type { TdSyncStatusRow } from "../../data/td";

export interface TdSyncCardProps {
  latest: TdSyncStatusRow | null;
  unmatchedCount: number;
}

function statusIcon(status: string, running: boolean): string {
  if (running) return "⏳";
  if (status === "success") return "✅";
  if (status === "partial") return "⚠️";
  if (status === "error" || status === "failed") return "❌";
  return "—";
}

export function TdSyncCard({ latest, unmatchedCount }: TdSyncCardProps) {
  const status = latest?.status ?? "never";
  const running = status === "running";
  const summary = latest?.summary;

  const rows: SyncCardRow[] = [
    { label: "Last run", value: ago(latest?.startedAt ?? null) },
  ];
  if (summary) {
    rows.push(
      { label: "Apps", value: Number(summary["apps"] ?? 0) },
      { label: "Engagement rows", value: Number(summary["engagementRows"] ?? 0) },
      { label: "Custom events", value: Number(summary["customEventRows"] ?? 0) },
      { label: "Breakdown rows", value: Number(summary["breakdownRows"] ?? 0) },
      { label: "Errors", value: Number(summary["errors"] ?? 0) },
    );
  }
  if (unmatchedCount > 0) {
    rows.push({ label: "Unmatched", value: `${unmatchedCount} TD app(s) need mapping`, variant: "warn" });
  }
  if (latest?.errorMessage) {
    rows.push({ label: "Error", value: latest.errorMessage, variant: "error" });
  }

  return (
    <SyncCard
      title="TelemetryDeck Sync"
      configured={true}
      statusIcon={statusIcon(status, running)}
      statusLabel={running ? "running…" : status}
      rows={rows}
      action={
        <form method="post" action="/td/sync" class="sync-trigger-form">
          <button type="submit" class="btn btn-primary">Sync now</button>
        </form>
      }
    />
  );
}

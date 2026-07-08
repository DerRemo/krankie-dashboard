/**
 * Shared "data source sync status" card — used for both the ASC and
 * TelemetryDeck sync panels on the System page. Previously each had its own
 * markup/CSS (sync-card vs. card--asc-sync); only the ASC one was actually
 * styled, so TD's was rendering with no visual treatment at all.
 */
export interface SyncCardRow {
  label: string;
  value: unknown;
  variant?: "default" | "warn" | "error";
}

export interface SyncCardProps {
  title: string;
  configured: boolean;
  notConfiguredHint?: unknown;
  statusIcon: string;
  statusLabel: string;
  rows: SyncCardRow[];
  action?: unknown;
  details?: { summary: string; body: unknown };
}

export function SyncCard({
  title, configured, notConfiguredHint, statusIcon, statusLabel, rows, action, details,
}: SyncCardProps) {
  if (!configured) {
    return (
      <section class="card card--asc-sync">
        <h3>{title}</h3>
        <p class="card-warn">{notConfiguredHint}</p>
      </section>
    );
  }
  return (
    <section class="card card--asc-sync">
      <header class="card-header">
        <h3>{title}</h3>
        <span class="card-status">{statusIcon} {statusLabel}</span>
      </header>
      <dl class="card-rows">
        {rows.map((r) => (
          <div class={r.variant && r.variant !== "default" ? `card-row--${r.variant}` : undefined}>
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
      {action}
      {details && (
        <details class="card-details">
          <summary>{details.summary}</summary>
          {details.body}
        </details>
      )}
    </section>
  );
}

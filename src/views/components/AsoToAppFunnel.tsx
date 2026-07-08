import type { FunnelTotals } from "../../data/funnel";

export interface AsoToAppFunnelProps {
  totals: FunnelTotals;
  windowDays: number;
}

const STEPS: Array<{ key: keyof FunnelTotals; label: string }> = [
  { key: "impressions", label: "Impressions" },
  { key: "productPageViews", label: "Page Views" },
  { key: "firstTimeDownloads", label: "Downloads" },
  { key: "sessions", label: "Sessions" },
  { key: "latestDau", label: "Today's DAU" },
];

export function AsoToAppFunnel({ totals, windowDays }: AsoToAppFunnelProps) {
  const values = STEPS.map((s) => {
    const v = totals[s.key];
    return typeof v === "number" ? v : 0;
  });
  const max = Math.max(1, ...values);
  return (
    <div class="aso-to-app-funnel">
      <div class="funnel-header">
        <span class="funnel-title">ASO → App Funnel · App Analytics (opt-in users)</span>
        <span class="funnel-window">last {windowDays} days</span>
      </div>
      <div class="funnel-bars">
        {STEPS.map((s, i) => (
          <div class="funnel-row">
            <div class="funnel-label">{s.label}</div>
            <div class="funnel-bar" style={`width: ${(values[i]! / max) * 100}%`} />
            <div class="funnel-value">{values[i]!.toLocaleString("en-US")}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

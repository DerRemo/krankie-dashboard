export function KpiTile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div class="kpi-tile">
      <div class="kpi-label">{label}</div>
      <div class="kpi-value num">{value}</div>
      {hint ? <div class="kpi-hint">{hint}</div> : null}
    </div>
  );
}

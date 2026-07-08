import type { AscKpis } from "../../data/asc";
import { fmtCompactNum, fmtPct, fmtUsd, fmtDelta, deltaClass } from "../formatting";

export function AscKpiStrip({ kpis }: { kpis: AscKpis }) {
  return (
    <section class="kpi-strip-wrap">
      <div class="kpi-strip-meta">
        <span>{kpis.fromDate && kpis.toDate ? `${kpis.fromDate} → ${kpis.toDate}` : "No ASC window"}</span>
        {kpis.isPartial ? <span>partial source coverage</span> : <span>complete source coverage</span>}
      </div>
      <div class="kpi-strip kpi-strip--asc">
        <Tile label="Impressions total" value={fmtCompactNum(kpis.impressions.value)} delta={kpis.impressions.deltaPct} />
        <Tile label="Page Views total"  value={fmtCompactNum(kpis.pageViews.value)} delta={kpis.pageViews.deltaPct} />
        <Tile label="Conversion"  value={fmtPct(kpis.conversionRate.value, 2)} delta={kpis.conversionRate.deltaPct} />
        <Tile label="Downloads total" value={fmtCompactNum(kpis.downloads.value)} delta={kpis.downloads.deltaPct} />
        <Tile label="Proceeds total"    value={fmtUsd(kpis.proceedsUsd.value, { cents: "none" })} delta={kpis.proceedsUsd.deltaPct} />
        <Tile label="Revenue / DL"      value={fmtUsd(kpis.arpd.value, { cents: "always" })} delta={kpis.arpd.deltaPct} />
        <Tile label="Paying Users"      value={fmtCompactNum(kpis.payingUsers.value)} delta={kpis.payingUsers.deltaPct} />
        <Tile
          label="Crash Rate"
          value={fmtPct(kpis.crashRate.value, 2)}
          delta={kpis.crashRate.deltaPct}
        />
      </div>
    </section>
  );
}

function Tile({ label, value, delta }: { label: string; value: string; delta: number | null }) {
  return (
    <div class="kpi-tile kpi-tile--asc">
      <div class="kpi-label">{label}</div>
      <div class="kpi-value num">{value}</div>
      <div class={`kpi-delta ${deltaClass(delta)}`}>{fmtDelta(delta)} <span class="kpi-delta-suffix">vs prev</span></div>
    </div>
  );
}

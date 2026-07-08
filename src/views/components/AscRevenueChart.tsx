import type { AscDailyPoint, AscRange } from "../../data/asc";

function allZero(arr: Array<number | null>): boolean {
  return arr.length === 0 || arr.every((v) => !v || v === 0);
}

export function AscRevenueChart({ series, appStoreId, range }: {
  series: AscDailyPoint[]; appStoreId: string; range: AscRange;
}) {
  const dates = series.map((p) => p.date);
  const proceedsUsd = series.map((p) => p.proceedsUsd);
  const iapProceedsUsd = series.map((p) => p.iapProceedsUsd);
  const hasRevenue = !(allZero(proceedsUsd) && allZero(iapProceedsUsd));

  const data = JSON.stringify({ dates, proceedsUsd, iapProceedsUsd });
  const ranges: AscRange[] = ["7d", "30d", "90d", "365d"];

  return (
    <section class="chart-section" id="revenue">
      <header class="chart-header">
        <h3>Revenue</h3>
        <nav class="range-selector">
          {ranges.map((r) => (
            <a class={`range-pill ${r === range ? "range-pill--active" : ""}`} href={`/apps/${appStoreId}?revenueRange=${r}`}>{r}</a>
          ))}
        </nav>
      </header>
      {series.length === 0 ? (
        <p class="chart-empty">Noch keine Daten.</p>
      ) : !hasRevenue ? (
        <p class="chart-empty">Kein USD-Umsatz in diesem Zeitraum.</p>
      ) : (
        <div class="chart-host" data-asc-revenue data-series={data}></div>
      )}
    </section>
  );
}

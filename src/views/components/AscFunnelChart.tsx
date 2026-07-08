import type { AscDailyPoint, AscRange } from "../../data/asc";

function allZero(arr: Array<number | null>): boolean {
  return arr.length === 0 || arr.every((v) => !v || v === 0);
}

export function AscFunnelChart({ series, appStoreId, range }: {
  series: AscDailyPoint[]; appStoreId: string; range: AscRange;
}) {
  const dates = series.map((p) => p.date);
  const impressions = series.map((p) => p.impressions);
  const pageViews = series.map((p) => p.pageViews);
  const firstTimeDownloads = series.map((p) => p.firstTimeDownloads);
  const conversionRate = series.map((p) => p.conversionRate);

  const hasFunnel = !(allZero(impressions) && allZero(pageViews) && allZero(firstTimeDownloads));
  const hasConversion = !allZero(conversionRate);

  const data = JSON.stringify({ dates, impressions, pageViews, firstTimeDownloads, conversionRate });

  return (
    <section class="chart-section" id="funnel">
      <header class="chart-header">
        <h3>Acquisition Funnel</h3>
        <RangeNav appStoreId={appStoreId} active={range} param="funnelRange" />
      </header>
      {series.length === 0 ? (
        <p class="chart-empty">Noch keine Daten — Sync läuft täglich 06:00.</p>
      ) : !hasFunnel ? (
        <p class="chart-empty">Apple Analytics liefert für diesen Zeitraum noch keine Daten. Initial-Snapshot kann mehrere Tage dauern.</p>
      ) : (
        <div class="chart-host" data-asc-funnel data-series={data}></div>
      )}
      {hasFunnel && hasConversion && (
        <div class="chart-host chart-host--small" data-asc-conversion data-series={data}></div>
      )}
    </section>
  );
}

function RangeNav({ appStoreId, active, param }: { appStoreId: string; active: string; param: string }) {
  const ranges: AscRange[] = ["7d", "30d", "90d", "365d"];
  return (
    <nav class="range-selector">
      {ranges.map((r) => (
        <a class={`range-pill ${r === active ? "range-pill--active" : ""}`} href={`/apps/${appStoreId}?${param}=${r}`}>{r}</a>
      ))}
    </nav>
  );
}

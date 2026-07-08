import type { AscDailyPoint } from "../../data/asc";
import { fmtNum, fmtUsd, fmtPct } from "../formatting";

function sourceLabel(p: AscDailyPoint): string {
  if (p.downloadsSource === "analytics") return "analytics";
  if (p.hasSales) return "sales only";
  return "missing";
}

export function AscDailyTable({ series }: { series: AscDailyPoint[] }) {
  const rows = series.slice(-14).reverse();
  if (rows.length === 0) return null;
  return (
    <section class="asc-daily">
      <header class="chart-header">
        <h3>Daily Data</h3>
        <span class="asc-meta-note">latest 14 days</span>
      </header>
      <div class="table-scroll">
        <table class="asc-daily-table">
          <thead>
            <tr>
              <th>Date</th>
              <th class="num">Impr.</th>
              <th class="num">Views</th>
              <th class="num">DLs</th>
              <th class="num">Conv.</th>
              <th class="num">Units</th>
              <th class="num">Proceeds</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr class={r.isPartial ? "is-partial" : ""}>
                <td class="num">{r.date}</td>
                <td class="num">{fmtNum(r.impressions)}</td>
                <td class="num">{fmtNum(r.pageViews)}</td>
                <td class="num">{fmtNum(r.firstTimeDownloads)}</td>
                <td class="num">{fmtPct(r.conversionRate, 2)}</td>
                <td class="num">{fmtNum(r.units)}</td>
                <td class="num">{fmtUsd(r.totalProceedsUsd)}</td>
                <td>{sourceLabel(r)}{r.isPartial ? " · partial" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

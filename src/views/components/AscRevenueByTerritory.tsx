import type { AscTerritoryRevenue } from "../../data/asc";
import { fmtUsd } from "../formatting";

export function AscRevenueByTerritory({ rows }: { rows: AscTerritoryRevenue[] }) {
  return (
    <section class="chart-section" id="revenue-territory">
      <header class="chart-header">
        <h3>Revenue by Territory</h3>
      </header>
      {rows.length === 0 ? (
        <p class="chart-empty">Kein Umsatz im Zeitraum.</p>
      ) : (
        <div class="table-scroll">
          <table class="asc-daily-table">
            <thead>
              <tr>
                <th>Territory</th>
                <th class="num">Proceeds</th>
                <th class="num">Share</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr>
                  <td>{r.territory}</td>
                  <td class="num">{fmtUsd(r.proceedsUsd)}</td>
                  <td class="num">{r.sharePct.toFixed(1)} %</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

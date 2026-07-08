import { KpiTile } from "./KpiTile";
import type { BenchmarkSummary as BenchmarkSummaryData } from "../../data/competitors";

export function BenchmarkSummary({ summary }: { summary: BenchmarkSummaryData }) {
  return (
    <div class="kpi-grid">
      <KpiTile label="Benchmarked" value={summary.keywordCount} />
      <KpiTile label="Wir führen" value={summary.weLead} />
      <KpiTile label="Wir hängen hinten" value={summary.weTrail} />
      <KpiTile label="Absent · Rivale rankt" value={summary.weAbsentButRivalRanks} />
      <KpiTile label="Ø Gap" value={summary.avgGap === null ? "—" : summary.avgGap.toFixed(1)} />
    </div>
  );
}

import { Card } from "./Card";
import { RankPill } from "./RankPill";
import { DeltaBadge } from "./DeltaBadge";
import { StoreBadge } from "./StoreBadge";
import { Sparkline } from "./Sparkline";
import { prepareMatrix } from "../../data/competitors";
import type { CompetitorApp, BenchmarkRow } from "../../data/competitors";

interface Props {
  competitors: CompetitorApp[];
  rows: BenchmarkRow[];
}

export function CompetitorMatrix({ competitors, rows }: Props) {
  const { activeCompetitors, absentCompetitors, rows: cleanRows } = prepareMatrix(competitors, rows);

  const byStore = new Map<string, BenchmarkRow[]>();
  for (const r of cleanRows) {
    const list = byStore.get(r.store) ?? [];
    list.push(r);
    byStore.set(r.store, list);
  }
  const stores = [...byStore.keys()].sort();

  return (
    <>
      {absentCompetitors.length > 0 && (
        <p class="matrix-absent-chip">
          {absentCompetitors.length} {absentCompetitors.length === 1 ? "Rivale" : "Rivalen"} nirgends platziert:
          {" "}{absentCompetitors.map((c) => c.name ?? c.appStoreId).join(", ")}
        </p>
      )}
      {stores.map((store, index) => (
        <details class="store-group store-collapse" data-store={store} open={index === 0 ? true : undefined}>
          <summary class="store-group-head">
            <StoreBadge store={store} />
            <span class="num store-collapse-count">{(byStore.get(store) ?? []).length} Keywords</span>
          </summary>
          <Card>
            <div class="table-scroll">
              <table class="rankings-table competitor-matrix">
                <thead>
                  <tr>
                    <th>Keyword</th>
                    <th class="num">Wir</th>
                    {activeCompetitors.map((c) => (
                      <th class="num">{c.name ?? c.appStoreId}</th>
                    ))}
                    <th class="num">Gap</th>
                  </tr>
                </thead>
                <tbody>
                  {(byStore.get(store) ?? []).map((r) => {
                    const values = [r.own.currentRank, r.bestCompetitorRank].filter(
                      (v): v is number => v !== null,
                    );
                    const rowBest = values.length > 0 ? Math.min(...values) : null;
                    const gapDir = r.gap === null ? "muted" : r.gap <= 0 ? "lead" : "trail";
                    return (
                      <tr>
                        <td><a href={`/keywords/${r.keywordId}`}>{r.keyword}</a></td>
                        <td
                          class="num competitor-cell"
                          data-best={rowBest !== null && r.own.currentRank === rowBest ? "true" : undefined}
                        >
                          <span class="competitor-cell-row">
                            <RankPill rank={r.own.currentRank} />
                            <DeltaBadge delta={r.own.delta7d} />
                            <Sparkline points={r.own.trend} />
                          </span>
                        </td>
                        {r.competitors.map((cell) => (
                          <td
                            class="num competitor-cell"
                            data-best={rowBest !== null && cell.currentRank === rowBest ? "true" : undefined}
                          >
                            <span class="competitor-cell-row">
                              <RankPill rank={cell.currentRank} />
                              <Sparkline points={cell.trend} />
                            </span>
                          </td>
                        ))}
                        <td class="num gap-cell" data-dir={gapDir}>
                          {r.gap === null ? "—" : r.gap > 0 ? `+${r.gap}` : String(r.gap)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </details>
      ))}
    </>
  );
}

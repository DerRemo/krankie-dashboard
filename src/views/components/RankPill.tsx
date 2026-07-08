export function RankPill({ rank }: { rank: number | null }) {
  if (rank === null) {
    return <span class="rank-pill" data-tier="none">—</span>;
  }
  const tier = rank <= 10 ? "top-10" : rank <= 50 ? "top-50" : rank <= 200 ? "top-200" : "out";
  return <span class="rank-pill num" data-tier={tier}>#{rank}</span>;
}

import type { TimePoint } from "../../db/types";

/**
 * Sparkline over raw metric values (impressions, downloads, revenue — higher is
 * better, unlike ranks). Used by TdCustomEventsTable, which previously
 * hand-rolled its own SVG-string version of this.
 */
export function MetricSparkline({ values, width = 60, height = 16 }: {
  values: Array<number | null>; width?: number; height?: number;
}) {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length < 2) {
    return <svg class="sparkline" width={width} height={height} aria-hidden="true" />;
  }
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = Math.max(1, max - min);
  const stepX = width / (values.length - 1);
  const points = values
    .map((v, i) => {
      if (v === null) return null;
      const x = (i * stepX).toFixed(1);
      const y = (height - 2 - ((v - min) / span) * (height - 2)).toFixed(1);
      return `${x},${y}`;
    })
    .filter((p): p is string => p !== null)
    .join(" ");
  return (
    <svg class="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round" stroke-linecap="round" />
    </svg>
  );
}

export function Sparkline({ points, width = 60, height = 16 }: {
  points: TimePoint[]; width?: number; height?: number;
}) {
  if (points.length === 0) {
    return <svg class="sparkline" width={width} height={height} aria-hidden="true" />;
  }
  const numeric = points.map((p, i) => ({ i, rank: p.rank }));
  const ranks = numeric.map((n) => n.rank).filter((r): r is number => r !== null);
  if (ranks.length === 0) {
    return <svg class="sparkline" width={width} height={height} aria-hidden="true" />;
  }
  const min = Math.min(...ranks);
  const max = Math.max(...ranks);
  const span = Math.max(1, max - min);
  const stepX = points.length > 1 ? width / (points.length - 1) : 0;
  const segments: string[] = [];
  let current: string[] = [];
  numeric.forEach((n) => {
    if (n.rank === null) {
      if (current.length > 1) segments.push(current.join(" "));
      current = [];
      return;
    }
    const x = (n.i * stepX).toFixed(1);
    const y = (((n.rank - min) / span) * (height - 2) + 1).toFixed(1);
    current.push(`${x},${y}`);
  });
  if (current.length > 1) segments.push(current.join(" "));

  const first = ranks[0]!;
  const last = ranks[ranks.length - 1]!;
  const dir = last < first ? "up" : last > first ? "down" : "flat";
  return (
    <svg class="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" data-dir={dir}>
      {segments.map((pts) => (
        <polyline points={pts} fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round" stroke-linecap="round" />
      ))}
    </svg>
  );
}

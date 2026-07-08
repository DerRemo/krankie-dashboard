export function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null || delta === 0) {
    return <span class="delta num" data-dir="flat">—</span>;
  }
  const dir = delta > 0 ? "up" : "down";
  const arrow = delta > 0 ? "▲" : "▼";
  const value = Math.abs(delta);
  return <span class="delta num" data-dir={dir}>{arrow} {value}</span>;
}

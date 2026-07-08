export type Range = "7d" | "30d" | "90d" | "all";
const RANGES: Range[] = ["7d", "30d", "90d", "all"];

export function RangeSelector({ active, basePath }: { active: Range; basePath: string }) {
  return (
    <nav class="range-selector" role="tablist">
      {RANGES.map((r) => (
        <a
          class="range-option"
          href={`${basePath}?range=${r}`}
          aria-current={r === active ? "page" : undefined}
        >
          {r}
        </a>
      ))}
    </nav>
  );
}

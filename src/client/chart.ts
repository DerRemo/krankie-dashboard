import uPlot from "uplot";
// uPlot's stylesheet is inlined into public/style.css so we don't need a separate CSS import here.

interface TimePoint { at: string; rank: number | null }

export async function initHistoryChart(): Promise<void> {
  const el = document.getElementById("history-chart");
  if (!el) return;
  const id = el.dataset.keywordId;
  const range = el.dataset.range;
  if (!id) return;

  const points: TimePoint[] = await fetch(`/api/keywords/${id}/history?range=${range ?? "30d"}`).then((r) => r.json());
  if (points.length === 0) {
    el.innerHTML = "<p>No history yet.</p>";
    return;
  }
  const xs = points.map((p) => Math.floor(new Date(p.at).getTime() / 1000));
  const ys = points.map((p) => p.rank);

  const accent = getCss("--accent") || "#4F46E5";
  const muted = getCss("--text-muted") || "#888";

  const opts: uPlot.Options = {
    width: el.clientWidth,
    height: el.clientHeight,
    scales: { y: { dir: -1 } },
    axes: [
      { stroke: muted, grid: { stroke: "rgba(127,127,127,0.08)" } },
      { stroke: muted, grid: { stroke: "rgba(127,127,127,0.08)" }, label: "Rank" },
    ],
    series: [
      {},
      { label: "Rank", stroke: accent, width: 2, spanGaps: false, points: { show: false } },
    ],
  };
  el.innerHTML = "";
  const plot = new uPlot(opts, [xs, ys as unknown as number[]], el as HTMLDivElement);
  observeWidth(el, plot);
}

/** Keep a uPlot chart fitted to its container on rotate / window resize. */
function observeWidth(el: HTMLElement, plot: uPlot): void {
  let raf = 0;
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const w = el.clientWidth;
      if (w > 0 && Math.abs(w - plot.width) > 4) {
        plot.setSize({ width: w, height: el.clientHeight || plot.height });
      }
    });
  });
  ro.observe(el);
}

function getCss(varName: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

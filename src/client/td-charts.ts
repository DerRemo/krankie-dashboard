import uPlot from "uplot";

interface TdEngagementSeries {
  dates: string[];
  sessions: Array<number | null>;
  dau: Array<number | null>;
}

function parseSeries<T>(host: HTMLElement): T | null {
  const raw = host.dataset["series"];
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function toUnix(dates: string[]): number[] {
  return dates.map((d) => Math.floor(new Date(`${d}T00:00:00Z`).getTime() / 1000));
}

/** Replace all-zero series with all-null so uPlot doesn't draw a flat line at the bottom. */
function nullIfZero(values: Array<number | null>): Array<number | null> {
  return values.every((v) => !v || v === 0) ? values.map(() => null) : values;
}

function getCss(varName: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

function dimensions(host: HTMLElement, fallbackHeight: number): { width: number; height: number } {
  const rect = host.getBoundingClientRect();
  return {
    width: Math.max(280, Math.floor(rect.width)),
    height: rect.height > 0 ? Math.floor(rect.height) : fallbackHeight,
  };
}

type Mounted = { plot: uPlot; rebuild: (opts: { width: number; height: number }) => void };

function mount(host: HTMLElement, build: (dims: { width: number; height: number }) => uPlot): Mounted {
  let plot = build(dimensions(host, host.classList.contains("chart-host--small") ? 90 : 200));
  const rebuild = (dims: { width: number; height: number }) => {
    try {
      plot.destroy();
    } catch {}
    host.innerHTML = "";
    plot = build(dims);
  };

  let raf = 0;
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const dims = dimensions(host, host.classList.contains("chart-host--small") ? 90 : 200);
      if (Math.abs(dims.width - plot.width) > 4) rebuild(dims);
    });
  });
  ro.observe(host);

  return { plot, rebuild };
}

export function initTdEngagementCharts(root: ParentNode = document): void {
  const accent = getCss("--accent") || "#4F46E5";
  const accent2 = "#0D9488";
  const muted = getCss("--text-muted") || "#888";
  const grid = "rgba(127,127,127,0.08)";

  // Outer wrapper: <div data-td-engagement-chart={appId}>
  // Inner host:    <div class="chart-host" data-td-engagement data-series={payload} />
  root.querySelectorAll<HTMLElement>("[data-td-engagement-chart]").forEach((node) => {
    const host = node.querySelector<HTMLElement>(".chart-host[data-series]");
    if (!host) return;
    const data = parseSeries<TdEngagementSeries>(host);
    if (!data || data.dates.length === 0) return;
    const x = toUnix(data.dates);
    host.innerHTML = "";
    mount(host, (dims) =>
      new uPlot(
        {
          width: dims.width,
          height: dims.height,
          legend: { show: false },
          axes: [
            { stroke: muted, grid: { stroke: grid }, size: 30 },
            { stroke: muted, grid: { stroke: grid }, size: 50 },
          ],
          scales: { y: { auto: true } },
          series: [
            {},
            { label: "Sessions", stroke: accent, width: 1.5 },
            { label: "DAU", stroke: accent2, width: 1.5 },
          ],
        },
        [x, nullIfZero(data.sessions), nullIfZero(data.dau)],
        host,
      ),
    );
  });
}

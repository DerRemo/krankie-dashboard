import uPlot from "uplot";

interface FunnelSeries {
  dates: string[];
  impressions: Array<number | null>;
  pageViews: Array<number | null>;
  firstTimeDownloads: Array<number | null>;
  conversionRate: Array<number | null>;
}
interface RevenueSeries {
  dates: string[];
  proceedsUsd: Array<number | null>;
  iapProceedsUsd: Array<number | null>;
}

function parseSeries<T>(host: HTMLElement): T | null {
  const raw = host.dataset["series"];
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
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
    try { plot.destroy(); } catch {}
    host.innerHTML = "";
    plot = build(dims);
  };

  // Re-mount on container resize so ranges stay readable on rotate / window resize.
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

export function initAscCharts(): void {
  const accent = getCss("--accent") || "#4F46E5";
  const accent2 = "#0D9488";
  const success = getCss("--success") || "#15924B";
  const muted = getCss("--text-muted") || "#888";
  const grid = "rgba(127,127,127,0.08)";

  document.querySelectorAll<HTMLElement>("[data-asc-funnel]").forEach((host) => {
    const data = parseSeries<FunnelSeries>(host);
    if (!data || data.dates.length === 0) return;
    const x = toUnix(data.dates);
    host.innerHTML = "";
    mount(host, (dims) => new uPlot({
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
        { label: "Impressions", stroke: accent, width: 1.5 },
        { label: "Page Views", stroke: accent2, width: 1.5 },
        { label: "First-time DLs", stroke: success, width: 1.5 },
      ],
    }, [x, nullIfZero(data.impressions), nullIfZero(data.pageViews), nullIfZero(data.firstTimeDownloads)], host));
  });

  document.querySelectorAll<HTMLElement>("[data-asc-conversion]").forEach((host) => {
    const data = parseSeries<FunnelSeries>(host);
    if (!data || data.dates.length === 0) return;
    const x = toUnix(data.dates);
    host.innerHTML = "";
    mount(host, (dims) => new uPlot({
      width: dims.width,
      height: dims.height,
      legend: { show: false },
      axes: [
        { stroke: muted, grid: { stroke: grid }, size: 22 },
        { stroke: muted, grid: { stroke: grid }, size: 50,
          values: (_, ticks) => ticks.map((t) => (t * 100).toFixed(1) + "%") },
      ],
      scales: { y: { auto: true } },
      series: [
        {},
        { label: "Conversion", stroke: accent, width: 1.5,
          value: (_, v) => (v == null ? "" : (v * 100).toFixed(2) + "%") },
      ],
    }, [x, data.conversionRate], host));
  });

  document.querySelectorAll<HTMLElement>("[data-asc-revenue]").forEach((host) => {
    const data = parseSeries<RevenueSeries>(host);
    if (!data || data.dates.length === 0) return;
    const x = toUnix(data.dates);
    host.innerHTML = "";
    mount(host, (dims) => new uPlot({
      width: dims.width,
      height: dims.height,
      legend: { show: false },
      axes: [
        { stroke: muted, grid: { stroke: grid }, size: 30 },
        { stroke: muted, grid: { stroke: grid }, size: 60,
          values: (_, ticks) => ticks.map((t) => "$" + (Number.isInteger(t) ? t.toFixed(0) : t.toFixed(2))) },
      ],
      scales: { y: { auto: true } },
      series: [
        {},
        { label: "Proceeds", stroke: accent, width: 1.5,
          value: (_, v) => (v == null ? "" : "$" + v.toFixed(2)) },
        { label: "IAP", stroke: accent2, width: 1.5,
          value: (_, v) => (v == null ? "" : "$" + v.toFixed(2)) },
      ],
    }, [x, nullIfZero(data.proceedsUsd), nullIfZero(data.iapProceedsUsd)], host));
  });
}

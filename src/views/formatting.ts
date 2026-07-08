// Shared number/date formatting for server-rendered views. Previously each ASC/TD
// component defined its own fmtNum/fmtUsd/fmtPct/fmtDelta with subtly different
// behavior (e.g. proceeds showing "$50,000" in one place and "$50,000.00" in
// another for the same underlying value) — this is the single source of truth.

/** Full grouped integer, e.g. 12345 -> "12,345". */
export function fmtNum(n: number | null): string {
  return n === null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** Abbreviated for tight spaces, e.g. 1234567 -> "1.2M". Use fmtNum where space allows. */
export function fmtCompactNum(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/**
 * USD amount. `cents: "auto"` (default) drops trailing zeros ("$50,000");
 * `cents: "always"` keeps exactly two decimals ("$2.35") — for per-unit values
 * like ARPD where the cents are the point; `cents: "none"` always rounds to
 * whole dollars ("$50,000") — for large totals where cents are just noise.
 */
export function fmtUsd(n: number | null, opts: { cents?: "auto" | "always" | "none" } = {}): string {
  if (n === null) return "—";
  const cents = opts.cents ?? "auto";
  const digits =
    cents === "always" ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } :
    cents === "none" ? { maximumFractionDigits: 0 } :
    { maximumFractionDigits: 2 };
  return "$" + n.toLocaleString("en-US", digits);
}

/** Percentage from a 0..1 fraction, e.g. 0.0234 -> "2.3%". */
export function fmtPct(n: number | null, decimals = 1): string {
  return n === null ? "—" : (n * 100).toFixed(decimals) + "%";
}

/** Signed percentage delta, e.g. 4.2 -> "+4.2%", -1 -> "-1.0%". */
export function fmtDelta(p: number | null): string {
  if (p === null || !Number.isFinite(p)) return "—";
  const sign = p > 0 ? "+" : "";
  return `${sign}${p.toFixed(1)}%`;
}

export type DeltaClass = "delta-up" | "delta-down" | "delta-neutral";

export function deltaClass(p: number | null): DeltaClass {
  if (p === null || !Number.isFinite(p)) return "delta-neutral";
  if (p > 0) return "delta-up";
  if (p < 0) return "delta-down";
  return "delta-neutral";
}

/** Relative time from an ISO timestamp, e.g. "vor 5 min", "vor 2.3 h", "vor 3 d". */
export function ago(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const h = ms / 3_600_000;
  if (h < 1) return `vor ${Math.round(ms / 60_000)} min`;
  if (h < 24) return `vor ${h.toFixed(1)} h`;
  return `vor ${Math.round(h / 24)} d`;
}

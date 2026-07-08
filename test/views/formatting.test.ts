import { test, expect } from "bun:test";
import { fmtNum, fmtCompactNum, fmtUsd, fmtPct, fmtDelta, fmtNumDe, fmtDeltaDe, deltaClass, ago } from "../../src/views/formatting";

test("fmtNum formats with grouping, null as em dash", () => {
  expect(fmtNum(12345)).toBe("12,345");
  expect(fmtNum(0)).toBe("0");
  expect(fmtNum(null)).toBe("—");
});

test("fmtCompactNum abbreviates large numbers", () => {
  expect(fmtCompactNum(1_234_567)).toBe("1.2M");
  expect(fmtCompactNum(45_000)).toBe("45.0k");
  expect(fmtCompactNum(999)).toBe("999");
  expect(fmtCompactNum(null)).toBe("—");
});

test("fmtUsd defaults to trailing-zero-free cents", () => {
  expect(fmtUsd(50000)).toBe("$50,000");
  expect(fmtUsd(50000.5)).toBe("$50,000.5");
  expect(fmtUsd(null)).toBe("—");
});

test("fmtUsd cents:always keeps exactly two decimals", () => {
  expect(fmtUsd(2.3, { cents: "always" })).toBe("$2.30");
  expect(fmtUsd(50000, { cents: "always" })).toBe("$50,000.00");
});

test("fmtUsd cents:none always rounds to whole dollars", () => {
  expect(fmtUsd(50000.6, { cents: "none" })).toBe("$50,001");
  expect(fmtUsd(50000, { cents: "none" })).toBe("$50,000");
});

test("fmtPct converts a 0..1 fraction with configurable decimals", () => {
  expect(fmtPct(0.0234)).toBe("2.3%");
  expect(fmtPct(0.0234, 2)).toBe("2.34%");
  expect(fmtPct(null)).toBe("—");
});

test("fmtDelta signs and null-guards", () => {
  expect(fmtDelta(4.2)).toBe("+4.2%");
  expect(fmtDelta(-1)).toBe("-1.0%");
  expect(fmtDelta(0)).toBe("0.0%");
  expect(fmtDelta(null)).toBe("—");
  expect(fmtDelta(NaN)).toBe("—");
});

test("deltaClass maps sign to a CSS class", () => {
  expect(deltaClass(1)).toBe("delta-up");
  expect(deltaClass(-1)).toBe("delta-down");
  expect(deltaClass(0)).toBe("delta-neutral");
  expect(deltaClass(null)).toBe("delta-neutral");
});

test("ago renders relative time buckets (German 'vor …' phrasing)", () => {
  expect(ago(null)).toBe("never");
  expect(ago(new Date(Date.now() - 5 * 60_000).toISOString())).toBe("vor 5 min");
  expect(ago(new Date(Date.now() - 3 * 3_600_000).toISOString())).toContain("vor 3");
  expect(ago(new Date(Date.now() - 3 * 3_600_000).toISOString())).toContain("h");
  expect(ago(new Date(Date.now() - 3 * 86_400_000).toISOString())).toContain("vor 3");
  expect(ago(new Date(Date.now() - 3 * 86_400_000).toISOString())).toContain("d");
});

test("fmtNumDe groups with dot, em dash for null", () => {
  expect(fmtNumDe(12345)).toBe("12.345");
  expect(fmtNumDe(0)).toBe("0");
  expect(fmtNumDe(null)).toBe("—");
});

test("fmtDeltaDe: comma decimal, space before percent, ±0 for zero", () => {
  expect(fmtDeltaDe(6.9)).toBe("+6,9 %");
  expect(fmtDeltaDe(-6.9)).toBe("-6,9 %");
  expect(fmtDeltaDe(247.4)).toBe("+247,4 %");
  expect(fmtDeltaDe(0)).toBe("±0 %");
  expect(fmtDeltaDe(null)).toBe("—");
});

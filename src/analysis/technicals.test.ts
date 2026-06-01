import { describe, expect, test } from "bun:test";
import type { Bar } from "../market/types.ts";
import { computeTechnicals, ema, rsi, sma } from "./technicals.ts";

const bar = (date: string, c: number, v = 1_000_000): Bar => ({
  date, open: c, high: c, low: c, close: c, volume: v,
});
const series = (closes: number[]): Bar[] =>
  closes.map((c, i) => bar(`2026-01-${String(i + 1).padStart(2, "0")}`, c));

describe("sma", () => {
  test("simple average of the last n", () => {
    expect(sma([1, 2, 3, 4, 5], 5)).toBe(3);
    expect(sma([2, 4, 6], 2)).toBe(5);
  });
  test("null when not enough data", () => {
    expect(sma([1, 2], 5)).toBeNull();
  });
});

describe("ema", () => {
  test("constant series equals the constant", () => {
    expect(ema([5, 5, 5, 5, 5], 3)).toBeCloseTo(5, 6);
  });
});

describe("rsi", () => {
  test("monotonically rising series → 100", () => {
    const up = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(rsi(up, 14)).toBeCloseTo(100, 4);
  });
  test("flat series → 50", () => {
    expect(rsi(Array(20).fill(7), 14)).toBe(50);
  });
});

describe("computeTechnicals", () => {
  test("fills indicators on a long enough series", () => {
    const closes = Array.from({ length: 220 }, (_, i) => 100 + Math.sin(i / 5) * 5 + i * 0.1);
    const t = computeTechnicals(series(closes), 1.0);
    expect(t.price).toBeCloseTo(closes.at(-1)!, 6);
    expect(t.sma20).not.toBeNull();
    expect(t.sma200).not.toBeNull();
    expect(t.rsi14).toBeGreaterThanOrEqual(0);
    expect(t.rsi14).toBeLessThanOrEqual(100);
    expect(t.high52w).toBeGreaterThanOrEqual(t.low52w!);
  });
  test("degrades to nulls on short series (no throw)", () => {
    const t = computeTechnicals(series([10, 11, 12]), null);
    expect(t.price).toBe(12);
    expect(t.sma200).toBeNull();
  });
});

describe("computeTechnicals deterministic values", () => {
  test("OBV nets to zero on up-then-down with equal volume", () => {
    const bars = [bar("2026-01-01", 10, 1000), bar("2026-01-02", 11, 1000), bar("2026-01-03", 10, 1000)];
    expect(computeTechnicals(bars, null).obv).toBe(0);
  });
  test("VWAP of a constant-price series equals that price", () => {
    expect(computeTechnicals(series(Array(20).fill(50)), null).vwap).toBeCloseTo(50, 6);
  });
  test("stochastic %K is 100 at the top of its range", () => {
    const bars = Array.from({ length: 14 }, (_, i) => bar(`2026-01-${String(i + 1).padStart(2, "0")}`, 10 + i));
    expect(computeTechnicals(bars, null).stochK).toBeCloseTo(100, 4);
  });
});

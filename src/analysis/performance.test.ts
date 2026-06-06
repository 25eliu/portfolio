import { describe, expect, test } from "bun:test";
import { computePerformanceMetrics, currentDrawdown, maxDrawdown, type EquityPoint } from "./performance.ts";

const pts = (values: number[]): EquityPoint[] =>
  values.map((v, i) => ({ date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), value: v }));

describe("maxDrawdown", () => {
  test("peak-to-trough decline as a positive fraction", () => {
    // peak 120 → trough 90 = 25% drawdown, even though it recovers after.
    expect(maxDrawdown([100, 120, 90, 110])).toBeCloseTo(0.25, 4);
  });
  test("monotonically rising series → no drawdown", () => {
    expect(maxDrawdown([100, 101, 102, 110])).toBe(0);
  });
});

describe("currentDrawdown", () => {
  test("decline from the running peak at the last point", () => {
    expect(currentDrawdown([100, 120, 90])).toBeCloseTo(0.25, 4); // 90 vs peak 120
  });
  test("zero when finishing at a high", () => {
    expect(currentDrawdown([100, 90, 130])).toBe(0);
  });
});

describe("computePerformanceMetrics", () => {
  test("null on an insufficient series", () => {
    expect(computePerformanceMetrics(pts([100]))).toBeNull();
  });

  test("total return and drawdown over a simple path", () => {
    const m = computePerformanceMetrics(pts([100, 110, 99, 120]))!;
    expect(m.totalReturn).toBeCloseTo(0.2, 4); // 100 → 120
    expect(m.maxDrawdown).toBeCloseTo(0.1, 4); // 110 → 99
    expect(m.currentDrawdown).toBe(0); // ends at the high
    expect(m.n).toBe(3);
  });

  test("a steady riser has a positive Sharpe; a flat line has none", () => {
    const riser = computePerformanceMetrics(pts(Array.from({ length: 30 }, (_, i) => 100 * 1.005 ** i)))!;
    expect(riser.sharpe!).toBeGreaterThan(0);
    const flat = computePerformanceMetrics(pts(Array(10).fill(100)))!;
    expect(flat.sharpe).toBeNull(); // zero volatility → undefined Sharpe
    expect(flat.maxDrawdown).toBe(0);
  });

  test("excess return + beta vs a benchmark (date-aligned)", () => {
    // Portfolio moves exactly 2x the benchmark each step → beta ≈ 2, and it outperforms.
    const r = Array.from({ length: 40 }, (_, i) => ((i % 5) - 2) / 100);
    const bench = [100], port = [100];
    for (let i = 1; i < r.length; i++) {
      bench.push(bench[i - 1]! * (1 + r[i]!));
      port.push(port[i - 1]! * (1 + 2 * r[i]!));
    }
    const m = computePerformanceMetrics(pts(port), pts(bench))!;
    expect(m.beta!).toBeCloseTo(2, 1);
    expect(m.excessReturn).not.toBeNull();
  });

  test("thin sample → annualized metrics suppressed, but total return + drawdown still shown", () => {
    const m = computePerformanceMetrics(pts([100, 110, 99, 120]))!; // only 3 returns
    expect(m.totalReturn).toBeCloseTo(0.2, 4); // always available
    expect(m.maxDrawdown).toBeCloseTo(0.1, 4); // always available
    expect(m.annualizedReturn).toBeNull(); // < MIN_SAMPLE → suppressed (would otherwise be absurd)
    expect(m.annualizedVolatility).toBeNull();
    expect(m.sharpe).toBeNull();
  });

  test("no benchmark → excessReturn and beta are null", () => {
    const m = computePerformanceMetrics(pts([100, 105, 110]))!;
    expect(m.excessReturn).toBeNull();
    expect(m.beta).toBeNull();
  });
});

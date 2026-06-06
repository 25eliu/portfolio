import { describe, expect, test } from "bun:test";
import type { WikiMetric } from "../domain/index.ts";
import { calibrateConviction, CALIBRATION_FLOOR } from "./calibration.ts";

/** Build a full all_time WikiMetric with only the calibration-relevant fields set. */
function metric(over: Partial<WikiMetric> & Pick<WikiMetric, "cohortKind" | "cohortKey" | "n">): WikiMetric {
  return {
    id: `all_time:${over.cohortKey}`,
    window: "all_time",
    hitRate: 0.5,
    avgConviction: 0.5,
    expectancyR: 0.2,
    avgTerminalReturn: 0.05,
    avgSpyExcess: 0.01,
    brier: 0.2,
    coverage: null,
    sampleForecastIds: [],
    computedAt: "2026-06-30T00:00:00.000Z",
    resolutionPolicyVersion: "v1",
    ...over,
  };
}

describe("calibrateConviction", () => {
  test("an overconfident SECTOR dampens a ticker with no own history (the core graph linkage)", () => {
    // Semiconductors has been overconfident (stated 0.80 vs realized 0.40) over a rich sample.
    const metrics = [
      metric({ cohortKind: "sector", cohortKey: "sector:Semiconductors", n: 30, avgConviction: 0.8, hitRate: 0.4, expectancyR: 0.1 }),
    ];
    const r = calibrateConviction({ stated: 0.8, strategyFamily: "momentum", sector: "Semiconductors", metrics });
    expect(r.calibrated).toBeLessThan(0.8); // propagated damp despite zero ticker history
    expect(r.factor).toBeLessThan(1);
    expect(r.adjustments.some((a) => a.cohortKey === "sector:Semiconductors")).toBe(true);
  });

  test("shrinkage: an identical-but-rich overconfident cohort damps far harder than a thin one", () => {
    // Same overconfidence signal (0.9 stated vs 0.2 realized), only the sample size differs.
    const withSector = (n: number) => [
      metric({ cohortKind: "sector", cohortKey: "sector:Biotech", n, avgConviction: 0.9, hitRate: 0.2 }),
      metric({ cohortKind: "overall", cohortKey: "overall", n: 300, avgConviction: 0.5, hitRate: 0.5 }),
    ];
    const thin = calibrateConviction({ stated: 0.7, strategyFamily: "value", sector: "Biotech", metrics: withSector(2) });
    const rich = calibrateConviction({ stated: 0.7, strategyFamily: "value", sector: "Biotech", metrics: withSector(300) });
    expect(rich.factor).toBeLessThan(thin.factor); // more evidence ⇒ the cohort earns more weight ⇒ more damp
    expect(thin.factor).toBeGreaterThan(0.9); // a 2-sample cohort only nudges
  });

  test("negative expectancy adds a penalty even when conviction looks calibrated", () => {
    const metrics = [
      metric({ cohortKind: "strategy_family", cohortKey: "strategy_family:momentum", n: 40, avgConviction: 0.6, hitRate: 0.6, expectancyR: -0.5 }),
    ];
    const r = calibrateConviction({ stated: 0.7, strategyFamily: "momentum", sector: null, metrics });
    expect(r.calibrated).toBeLessThan(0.7);
  });

  test("risk_off regime dampens even with no cohort data", () => {
    const r = calibrateConviction({ stated: 0.7, strategyFamily: "macro", sector: null, metrics: [], regime: "risk_off" });
    expect(r.calibrated).toBeLessThan(0.7);
    expect(r.regimeFactor).toBeLessThan(1);
    expect(r.adjustments).toHaveLength(0);
  });

  test("no data, neutral regime → no-op (factor 1, calibrated == stated)", () => {
    const r = calibrateConviction({ stated: 0.66, strategyFamily: "quality", sector: "Utilities", metrics: [], regime: "neutral" });
    expect(r.factor).toBe(1);
    expect(r.calibrated).toBe(0.66);
  });

  test("factor is gentle and dampen-only; calibrated never exceeds stated", () => {
    // Pathologically overconfident across every cohort + risk_off — the hardest possible damp.
    const metrics = [
      metric({ cohortKind: "sector", cohortKey: "sector:Meme", n: 100, avgConviction: 1, hitRate: 0, expectancyR: -2 }),
      metric({ cohortKind: "strategy_family", cohortKey: "strategy_family:momentum", n: 100, avgConviction: 1, hitRate: 0, expectancyR: -2 }),
      metric({ cohortKind: "overall", cohortKey: "overall", n: 100, avgConviction: 1, hitRate: 0, expectancyR: -2 }),
    ];
    const r = calibrateConviction({ stated: 0.9, strategyFamily: "momentum", sector: "Meme", metrics, regime: "risk_off" });
    expect(r.factor).toBeGreaterThanOrEqual(CALIBRATION_FLOOR);
    expect(r.factor).toBeLessThanOrEqual(1);
    expect(r.calibrated).toBeLessThanOrEqual(0.9);
    expect(r.calibrated).toBeCloseTo(0.9 * r.factor, 5);
  });

  test("returns the per-cohort chain with normalized weights summing to ~1", () => {
    const metrics = [
      metric({ cohortKind: "sector", cohortKey: "sector:Energy", n: 25, avgConviction: 0.75, hitRate: 0.45 }),
      metric({ cohortKind: "strategy_family", cohortKey: "strategy_family:value", n: 25, avgConviction: 0.7, hitRate: 0.5 }),
      metric({ cohortKind: "overall", cohortKey: "overall", n: 200, avgConviction: 0.6, hitRate: 0.55 }),
    ];
    const r = calibrateConviction({ stated: 0.72, strategyFamily: "value", sector: "Energy", metrics });
    expect(r.adjustments.length).toBe(3);
    const wsum = r.adjustments.reduce((a, x) => a + x.weight, 0);
    expect(wsum).toBeCloseTo(1, 5);
  });

  test("only all_time metrics are used (rolling_90d ignored)", () => {
    const metrics = [
      metric({ cohortKind: "sector", cohortKey: "sector:Tech", n: 30, avgConviction: 0.9, hitRate: 0.3, window: "rolling_90d" }),
    ];
    const r = calibrateConviction({ stated: 0.8, strategyFamily: "growth", sector: "Tech", metrics });
    expect(r.factor).toBe(1); // the only metric is rolling_90d → ignored → no-op
  });
});

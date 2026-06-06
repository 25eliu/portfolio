import { describe, expect, test } from "bun:test";
import { computeMetrics, confidenceBucket, type ResolvedRow } from "./metrics.ts";

const NOW = new Date("2026-06-30T00:00:00.000Z").getTime();

function row(over: Partial<ResolvedRow>): ResolvedRow {
  return {
    forecastId: "f", side: "bullish", strategyFamily: "momentum", sector: null, horizonSessions: 21,
    conviction: 0.6, createdAt: "2026-06-20T00:00:00.000Z", outcome: "target_hit",
    terminalReturn: 0.1, spyExcessReturn: 0.05, forecastR: 2, ...over,
  };
}

const opts = { nowMs: NOW, resolutionPolicyVersion: "v1", computedAt: "2026-06-30T00:00:00.000Z" };

describe("computeMetrics", () => {
  test("hit rate, expectancy and Brier over a simple sample", () => {
    const rows = [
      row({ forecastId: "a", outcome: "target_hit", conviction: 0.8, forecastR: 2 }),
      row({ forecastId: "b", outcome: "stop_hit", conviction: 0.8, forecastR: -1, terminalReturn: -0.05 }),
    ];
    const overall = computeMetrics(rows, opts).find((m) => m.window === "all_time" && m.cohortKey === "overall")!;
    expect(overall.n).toBe(2);
    expect(overall.hitRate).toBeCloseTo(0.5, 5);
    expect(overall.avgConviction).toBeCloseTo(0.8, 5); // both rows conviction 0.8
    expect(overall.expectancyR).toBeCloseTo(0.5, 5); // (2 + -1)/2
    // Brier: ((0.8-1)^2 + (0.8-0)^2)/2 = (0.04 + 0.64)/2 = 0.34
    expect(overall.brier).toBeCloseTo(0.34, 5);
  });

  test("ambiguous_touch is excluded from the calibration sample", () => {
    const rows = [
      row({ forecastId: "a", outcome: "target_hit" }),
      row({ forecastId: "b", outcome: "ambiguous_touch" }),
    ];
    const overall = computeMetrics(rows, opts).find((m) => m.cohortKey === "overall" && m.window === "all_time")!;
    expect(overall.n).toBe(1); // ambiguous dropped
  });

  test("rolling_90d excludes forecasts older than 90 days", () => {
    const rows = [
      row({ forecastId: "recent", createdAt: "2026-06-20T00:00:00.000Z" }),
      row({ forecastId: "old", createdAt: "2026-01-01T00:00:00.000Z" }),
    ];
    const all = computeMetrics(rows, opts);
    const allTime = all.find((m) => m.window === "all_time" && m.cohortKey === "overall")!;
    const rolling = all.find((m) => m.window === "rolling_90d" && m.cohortKey === "overall")!;
    expect(allTime.n).toBe(2);
    expect(rolling.n).toBe(1);
  });

  test("produces per-strategy and per-side cohorts", () => {
    const rows = [
      row({ forecastId: "a", strategyFamily: "momentum", side: "bullish" }),
      row({ forecastId: "b", strategyFamily: "value", side: "bearish", outcome: "stop_hit", forecastR: -1 }),
    ];
    const keys = computeMetrics(rows, opts).map((m) => m.cohortKey);
    expect(keys).toContain("strategy_family:momentum");
    expect(keys).toContain("strategy_family:value");
    expect(keys).toContain("side:bullish");
    expect(keys).toContain("side:bearish");
  });

  test("produces sector cohorts and skips rows with unknown sector", () => {
    const rows = [
      row({ forecastId: "a", sector: "Information Technology" }),
      row({ forecastId: "b", sector: "Information Technology", outcome: "stop_hit", forecastR: -1 }),
      row({ forecastId: "c", sector: null }), // unknown sector → no sector cohort, but still in overall
    ];
    const metrics = computeMetrics(rows, opts);
    const it = metrics.find((m) => m.window === "all_time" && m.cohortKey === "sector:Information Technology")!;
    expect(it.cohortKind).toBe("sector");
    expect(it.n).toBe(2); // only the two IT rows; the null-sector row is excluded from sector cohorts
    expect(metrics.some((m) => m.cohortKey === "sector:null")).toBe(false);
    // The null-sector row still counts toward overall.
    expect(metrics.find((m) => m.window === "all_time" && m.cohortKey === "overall")!.n).toBe(3);
  });
});

describe("confidenceBucket", () => {
  test("buckets conviction into 0.2-wide bands", () => {
    expect(confidenceBucket(0.05)).toBe("0.0-0.2");
    expect(confidenceBucket(0.65)).toBe("0.6-0.8");
    expect(confidenceBucket(1)).toBe("0.8-1.0");
  });
});

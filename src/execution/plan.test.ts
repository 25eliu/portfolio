import { describe, expect, test } from "bun:test";
import { Recommendation, RISK_PRESETS, type Direction } from "../domain/index.ts";
import { planTrades, sizeFraction, type PlanInput, type PlanPosition } from "./plan.ts";

const BALANCED = RISK_PRESETS.balanced; // minConfidence 0.58, rewardRiskFloor 1.5, maxPositionPct 10

function rec(over: {
  ticker?: string;
  direction: Direction;
  conviction?: number;
  target?: number | null;
  stop?: number | null;
  entry?: number | null;
  horizon?: "1d" | "1w" | "1mo" | "3mo" | "6mo" | "1y";
  strategy?: string;
}): Recommendation {
  return Recommendation.parse({
    ticker: over.ticker ?? "AAPL",
    held: false,
    action: over.direction === "bullish" ? "BUY" : over.direction === "bearish" ? "SELL" : "HOLD",
    conviction: over.conviction ?? 0.7,
    strategyFamily: over.strategy ?? "momentum",
    thesis: "t",
    signals: [],
    prediction: {
      direction: over.direction,
      horizon: over.horizon ?? "1mo",
      invalidation: "x",
      rationale: "y",
      entry: over.entry === undefined ? 100 : over.entry,
      target: over.target === undefined ? 120 : over.target,
      stop: over.stop === undefined ? 95 : over.stop,
    },
    technicals: {},
  });
}

function plan(over: Partial<PlanInput> & { recommendations: Recommendation[] }): ReturnType<typeof planTrades> {
  const positions = over.account?.positions ?? [];
  const priceMap = new Map<string, number>(positions.map((p) => [p.symbol, p.price]));
  return planTrades({
    recommendations: over.recommendations,
    account: over.account ?? { cash: 100_000, positionsValue: 0, positions: [] },
    baselineCapital: over.baselineCapital ?? 100_000,
    preset: over.preset ?? BALANCED,
    priceOf: over.priceOf ?? ((t) => priceMap.get(t) ?? 100),
    submittedToday: over.submittedToday ?? (() => false),
    journalLink: over.journalLink ?? (() => ({ journalEntryId: null, forecastId: null })),
    runId: "run-1",
    now: "2026-06-01T00:00:00.000Z",
  });
}

const pos = (symbol: string, shares: number, price = 100): PlanPosition => ({ symbol, shares, price, marketValue: shares * price });

// A "strong" idea: high conviction + RR well above the floor → reaches the full per-position cap.
const strong = (over: Parameters<typeof rec>[0]) => rec({ conviction: 1, target: 120, stop: 95, ...over });

describe("sizeFraction — thesis → fraction of the per-position cap", () => {
  test("a barely-passing idea (conviction at the floor, RR at the floor) gets the SIZE_FLOOR", () => {
    expect(sizeFraction(0.58, 1.5, BALANCED)).toBeCloseTo(0.25, 5);
  });

  test("max conviction + RR saturated → the full cap (1.0)", () => {
    // rrScore saturates once RR is RR_SPAN (2.0) above the floor → 3.5 on balanced.
    expect(sizeFraction(1.0, 3.5, BALANCED)).toBeCloseTo(1.0, 5);
  });

  test("is monotonic in conviction at a fixed RR", () => {
    expect(sizeFraction(0.9, 4, BALANCED)).toBeGreaterThan(sizeFraction(0.7, 4, BALANCED));
  });

  test("is monotonic in reward:risk at a fixed conviction", () => {
    expect(sizeFraction(0.7, 4, BALANCED)).toBeGreaterThan(sizeFraction(0.7, 1.5, BALANCED));
  });

  test("clamps below-gate inputs to the floor (never negative)", () => {
    expect(sizeFraction(0.4, 1.0, BALANCED)).toBeCloseTo(0.25, 5);
  });
});

describe("planTrades — thesis-driven entry sizing", () => {
  test("sizes a new BUY from conviction × reward:risk, not the flat cap", () => {
    // conv 0.7 → convScore (0.7-0.58)/0.42 = 0.2857; RR 4 → rrScore 1.0; frac = 0.25 + 0.75*0.2857 = 0.4643.
    const [d] = plan({ recommendations: [rec({ direction: "bullish" })] });
    expect(d!.action).toBe("BUY");
    expect(d!.status).toBe("proposed");
    expect(d!.qty).toBe(46); // 0.4643 * 10k cap = $4,643 / $100
    expect(d!.notional).toBe(4_600);
    expect(d!.reason).toContain("46% of cap");
  });

  test("a higher-conviction idea gets a bigger position than a lower-conviction one", () => {
    const [hi] = plan({ recommendations: [rec({ direction: "bullish", ticker: "HI", conviction: 0.9 })] });
    const [lo] = plan({ recommendations: [rec({ direction: "bullish", ticker: "LO", conviction: 0.62 })] });
    expect(hi!.qty).toBe(82); // frac 0.8214 → $8,214
    expect(lo!.qty).toBe(32); // frac 0.3214 → $3,214
    expect(hi!.qty).toBeGreaterThan(lo!.qty);
  });

  test("a stronger reward:risk gets a bigger position at the same conviction", () => {
    const [hi] = plan({ recommendations: [rec({ direction: "bullish", ticker: "HI", target: 120, stop: 95 })] }); // RR 4
    const [lo] = plan({ recommendations: [rec({ direction: "bullish", ticker: "LO", target: 106, stop: 96 })] }); // RR 1.5
    expect(hi!.qty).toBe(46);
    expect(lo!.qty).toBe(25); // RR at the floor → only the SIZE_FLOOR
    expect(hi!.qty).toBeGreaterThan(lo!.qty);
  });

  test("a barely-passing idea still gets the 25% floor, never dust", () => {
    // conv at the floor (0.58) + RR at the floor (1.5) → frac exactly 0.25.
    const [d] = plan({ recommendations: [rec({ direction: "bullish", conviction: 0.58, target: 106, stop: 96 })] });
    expect(d!.status).toBe("proposed");
    expect(d!.qty).toBe(25); // 0.25 * 10k = $2,500
    expect(d!.reason).toContain("25% of cap");
  });

  test("only a high-conviction, high-RR idea reaches the full per-position cap", () => {
    const [d] = plan({ recommendations: [strong({ direction: "bullish" })] });
    expect(d!.qty).toBe(100); // frac 1.0 → full 10k cap
    expect(d!.notional).toBe(10_000);
    expect(d!.reason).toContain("100% of cap");
  });
});

describe("planTrades — thesis-driven ADD sizing", () => {
  test("tops a held name up to its scaled target, not the full cap", () => {
    // conv 0.9 → frac 0.8214 → target $8,214; held $5,000 → add $3,214.
    const account = { cash: 100_000, positionsValue: 5_000, positions: [pos("AAPL", 50)] };
    const [d] = plan({ recommendations: [rec({ direction: "bullish", conviction: 0.9 })], account });
    expect(d!.action).toBe("ADD");
    expect(d!.qty).toBe(32);
  });

  test("HOLD (no row) when the held position already exceeds its thesis-sized target", () => {
    // conv 0.62 → frac 0.3214 → target $3,214; held $5,000 already above it → no add.
    const account = { cash: 100_000, positionsValue: 5_000, positions: [pos("AAPL", 50)] };
    expect(plan({ recommendations: [rec({ direction: "bullish", conviction: 0.62 })], account })).toHaveLength(0);
  });
});

describe("planTrades — entry gates (unchanged)", () => {
  test("skips a bullish idea below the conviction floor", () => {
    expect(plan({ recommendations: [rec({ direction: "bullish", conviction: 0.5 })] })).toHaveLength(0);
  });

  test("skips when reward:risk is below the floor", () => {
    const [d] = plan({ recommendations: [rec({ direction: "bullish", target: 101, stop: 90 })] });
    expect(d!.status).toBe("skipped");
    expect(d!.reason).toContain("reward:risk");
  });

  test("gates entries by the preset's allowed horizons", () => {
    // balanced excludes the 1d (day) horizon.
    const [d] = plan({ recommendations: [rec({ direction: "bullish", horizon: "1d" })] });
    expect(d!.status).toBe("skipped");
    expect(d!.reason).toContain("horizon not eligible");
    // aggressive allows 1d → it trades.
    const [d2] = plan({ recommendations: [rec({ direction: "bullish", horizon: "1d" })], preset: RISK_PRESETS.aggressive });
    expect(d2!.action).toBe("BUY");
    expect(d2!.status).toBe("proposed");
  });

  test("gates entries by the preset's strategy eligibility", () => {
    // balanced doesn't allow 'sentiment'; aggressive allows all.
    const [d] = plan({ recommendations: [rec({ direction: "bullish", strategy: "sentiment" })] });
    expect(d!.status).toBe("skipped");
    expect(d!.reason).toContain("not eligible");
    const [d2] = plan({ recommendations: [rec({ direction: "bullish", strategy: "sentiment" })], preset: RISK_PRESETS.aggressive });
    expect(d2!.status).toBe("proposed");
  });

  test("skips a new BUY when max-position-count is reached", () => {
    const positions = Array.from({ length: 10 }, (_, i) => pos(`T${i}`, 1));
    const account = { cash: 100_000, positionsValue: 1_000, positions };
    const [d] = plan({ recommendations: [rec({ direction: "bullish", ticker: "NEW" })], account });
    expect(d!.status).toBe("skipped");
    expect(d!.reason).toContain("max positions");
  });
});

describe("planTrades — exits", () => {
  test("SELL (full exit) a held position on a bearish thesis", () => {
    const account = { cash: 0, positionsValue: 5_000, positions: [pos("AAPL", 50)] };
    const [d] = plan({ recommendations: [rec({ direction: "bearish" })], account });
    expect(d!.action).toBe("SELL");
    expect(d!.side).toBe("sell");
    expect(d!.qty).toBe(50);
  });

  test("ignores a bearish idea the AI does not hold (long-only)", () => {
    expect(plan({ recommendations: [rec({ direction: "bearish", ticker: "ZZZZ" })] })).toHaveLength(0);
  });

  test("TRIM a neutral, overweight position back to the cap", () => {
    const account = { cash: 0, positionsValue: 15_000, positions: [pos("AAPL", 150)] };
    const [d] = plan({ recommendations: [rec({ direction: "neutral" })], account });
    expect(d!.action).toBe("TRIM");
    expect(d!.qty).toBe(50); // 15k → 10k cap = sell 5k = 50 shares
  });

  test("HOLD (no decision) for a neutral position within the cap", () => {
    const account = { cash: 0, positionsValue: 5_000, positions: [pos("AAPL", 50)] };
    expect(plan({ recommendations: [rec({ direction: "neutral" })], account })).toHaveLength(0);
  });
});

describe("planTrades — capital discipline", () => {
  test("caps total deployment at the baseline and ignores the extra broker cash", () => {
    // Broker has $100k but the AI's baseline (matched to the user's portfolio) is only $5k.
    // A max-strength idea targets the full cap = 10% of the $5k baseline = $500.
    const [d] = plan({ recommendations: [strong({ direction: "bullish" })], baselineCapital: 5_000 });
    expect(d!.action).toBe("BUY");
    expect(d!.notional).toBeLessThanOrEqual(5_000); // never deploys beyond baseline
    expect(d!.notional).toBe(500); // 10% of the $5k baseline, not of the $100k account
  });

  test("a second buy is constrained by remaining baseline room", () => {
    // baseline 12k, two bullish ideas; per-position cap 10% = 1.2k each, total ≤ 12k.
    const decisions = plan({
      recommendations: [rec({ direction: "bullish", ticker: "AAA", conviction: 0.9 }), rec({ direction: "bullish", ticker: "BBB", conviction: 0.8 })],
      baselineCapital: 12_000,
    });
    const total = decisions.filter((d) => d.status === "proposed").reduce((s, d) => s + d.notional, 0);
    expect(total).toBeLessThanOrEqual(12_000);
    expect(decisions[0]!.ticker).toBe("AAA"); // higher conviction sized first
  });

  test("duplicate-order guard: skip a ticker already traded today", () => {
    const [d] = plan({ recommendations: [rec({ direction: "bullish" })], submittedToday: () => true });
    expect(d!.status).toBe("skipped");
    expect(d!.reason).toContain("already traded today");
  });
});

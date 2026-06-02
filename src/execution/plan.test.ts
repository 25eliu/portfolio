import { describe, expect, test } from "bun:test";
import { Recommendation, type Direction } from "../domain/index.ts";
import { planTrades, type PlanInput, type PlanPosition } from "./plan.ts";

const BALANCED = { maxPositionPct: 10, maxPositions: 10, minConfidence: 0.58 };

function rec(over: {
  ticker?: string;
  direction: Direction;
  conviction?: number;
  target?: number | null;
  stop?: number | null;
  entry?: number | null;
}): Recommendation {
  return Recommendation.parse({
    ticker: over.ticker ?? "AAPL",
    held: false,
    action: over.direction === "bullish" ? "BUY" : over.direction === "bearish" ? "SELL" : "HOLD",
    conviction: over.conviction ?? 0.7,
    strategyFamily: "momentum",
    thesis: "t",
    signals: [],
    prediction: {
      direction: over.direction,
      horizon: "1mo",
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
    rewardRiskFloor: over.rewardRiskFloor ?? 1.0,
    priceOf: over.priceOf ?? ((t) => priceMap.get(t) ?? 100),
    submittedToday: over.submittedToday ?? (() => false),
    journalLink: over.journalLink ?? (() => ({ journalEntryId: null, forecastId: null })),
    runId: "run-1",
    now: "2026-06-01T00:00:00.000Z",
  });
}

const pos = (symbol: string, shares: number, price = 100): PlanPosition => ({ symbol, shares, price, marketValue: shares * price });

describe("planTrades — entries", () => {
  test("BUY a new bullish idea, sized to the per-position cap", () => {
    const [d] = plan({ recommendations: [rec({ direction: "bullish" })] });
    expect(d!.action).toBe("BUY");
    expect(d!.status).toBe("proposed");
    expect(d!.qty).toBe(100); // min(cash, baseline, 10% of 100k=10k) / $100
    expect(d!.notional).toBe(10_000);
  });

  test("ADD to a held winner, only up to the position cap", () => {
    const account = { cash: 100_000, positionsValue: 5_000, positions: [pos("AAPL", 50)] };
    const [d] = plan({ recommendations: [rec({ direction: "bullish" })], account });
    expect(d!.action).toBe("ADD");
    expect(d!.qty).toBe(50); // room to 10k cap = 5k → 50 shares
  });

  test("skips a bullish idea below the conviction floor", () => {
    expect(plan({ recommendations: [rec({ direction: "bullish", conviction: 0.5 })] })).toHaveLength(0);
  });

  test("skips when reward:risk is below the floor", () => {
    const [d] = plan({ recommendations: [rec({ direction: "bullish", target: 101, stop: 90 })] });
    expect(d!.status).toBe("skipped");
    expect(d!.reason).toContain("reward:risk");
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
    const [d] = plan({ recommendations: [rec({ direction: "bullish" })], baselineCapital: 5_000 });
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

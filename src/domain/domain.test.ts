import { describe, expect, test } from "bun:test";
import { Holding, HoldingInput, Symbol } from "./holding.ts";
import { Portfolio } from "./portfolio.ts";
import { Snapshot } from "./snapshot.ts";
import { DailyReport, Recommendation } from "./recommendation.ts";
import { RiskProfile } from "./risk.ts";

describe("Symbol", () => {
  test("uppercases and trims", () => {
    expect(Symbol.parse("  aapl ")).toBe("AAPL");
  });
  test("allows dotted symbols", () => {
    expect(Symbol.parse("brk.b")).toBe("BRK.B");
  });
  test("rejects garbage", () => {
    expect(() => Symbol.parse("1NV")).toThrow();
    expect(() => Symbol.parse("")).toThrow();
  });
});

describe("Holding", () => {
  test("requires positive shares", () => {
    expect(() =>
      Holding.parse({ id: "h1", portfolioId: "p1", symbol: "AAPL", shares: 0 }),
    ).toThrow();
  });
  test("defaults costBasis to null", () => {
    const h = Holding.parse({ id: "h1", portfolioId: "p1", symbol: "AAPL", shares: 3 });
    expect(h.costBasis).toBeNull();
  });
  test("HoldingInput normalizes symbol", () => {
    const input = HoldingInput.parse({ symbol: "nvda", shares: 10 });
    expect(input.symbol).toBe("NVDA");
  });
});

describe("Portfolio", () => {
  test("accepts a user portfolio", () => {
    const p = Portfolio.parse({
      id: "p1",
      name: "My Portfolio",
      kind: "user",
      decisionSource: "manual",
      createdAt: new Date().toISOString(),
    });
    expect(p.alpacaAccount).toBeNull();
  });
  test("defaults cash to 0 and rejects negative cash", () => {
    const base = {
      id: "p1",
      name: "My Portfolio",
      kind: "user" as const,
      decisionSource: "manual" as const,
      createdAt: new Date().toISOString(),
    };
    expect(Portfolio.parse(base).cash).toBe(0);
    expect(Portfolio.parse({ ...base, cash: 5000 }).cash).toBe(5000);
    expect(() => Portfolio.parse({ ...base, cash: -1 })).toThrow();
  });
  test("rejects an unknown kind", () => {
    expect(() =>
      Portfolio.parse({
        id: "p1",
        name: "x",
        kind: "crypto",
        decisionSource: "manual",
        createdAt: new Date().toISOString(),
      }),
    ).toThrow();
  });
});

describe("Snapshot", () => {
  test("validates an equity-curve point", () => {
    const s = Snapshot.parse({
      id: "s1",
      portfolioId: "p1",
      date: "2026-06-01",
      totalValue: 1000,
      cash: 200,
      positions: [{ symbol: "AAPL", shares: 4, price: 200, marketValue: 800 }],
    });
    expect(s.positions).toHaveLength(1);
  });
  test("rejects a malformed date", () => {
    expect(() =>
      Snapshot.parse({ id: "s1", portfolioId: "p1", date: "June 1", totalValue: 1, cash: 1, positions: [] }),
    ).toThrow();
  });
});

describe("Recommendation / DailyReport", () => {
  const rec = {
    ticker: "NVDA",
    action: "BUY",
    conviction: 0.64,
    horizon: "5d",
    strategyFamily: "momentum_breakout",
    thesis: "Reclaimed VWAP on volume.",
    signals: ["vwap_reclaim", "unusual_volume"],
    technicals: { rsi14: 58, macd: 0.5, support: 168.4, resistance: 182 },
    catalyst: { kind: "upgrade", summary: "analyst upgrade", sentiment: 0.7 },
    tradePlan: { entry: 172.5, stop: 167, target: 184, rMultiple: 2.1, invalidation: "close below 167" },
    briefingNote: null,
    watchTrigger: null,
  };

  test("parses a full recommendation", () => {
    const r = Recommendation.parse(rec);
    expect(r.action).toBe("BUY");
    expect(r.conviction).toBeCloseTo(0.64);
  });
  test("rejects conviction out of range", () => {
    expect(() => Recommendation.parse({ ...rec, conviction: 1.4 })).toThrow();
  });
  test("wraps recommendations in a report", () => {
    const report = DailyReport.parse({
      id: "r1",
      date: "2026-06-01",
      generatedAt: new Date().toISOString(),
      source: "fake",
      recommendations: [rec],
    });
    expect(report.recommendations).toHaveLength(1);
  });
});

describe("RiskProfile", () => {
  test("accepts a preset", () => {
    expect(RiskProfile.parse({ portfolioId: "p1", preset: "balanced" }).preset).toBe("balanced");
  });
  test("rejects an unknown preset", () => {
    expect(() => RiskProfile.parse({ portfolioId: "p1", preset: "yolo" })).toThrow();
  });
});

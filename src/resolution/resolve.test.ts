import { describe, expect, test } from "bun:test";
import type { Bar } from "../market/types.ts";
import { ScoredForecast } from "../domain/index.ts";
import { resolveForecast } from "./resolve.ts";

const TS = "2026-06-01T14:30:00.000Z"; // as-of: Monday June 1

function bar(date: string, low: number, high: number, close?: number): Bar {
  return { date, open: (low + high) / 2, high, low, close: close ?? (low + high) / 2, volume: 1_000_000 };
}

function forecast(overrides: Partial<ScoredForecast> = {}): ScoredForecast {
  return ScoredForecast.parse({
    id: "f1",
    journalEntryId: "je1",
    ticker: "AAPL",
    side: "bullish",
    strategyFamily: "momentum_breakout",
    signals: [],
    createdAt: TS,
    asOfTimestamp: TS,
    priceFeed: "fake",
    referencePrice: 100,
    entry: 100,
    target: 110,
    stop: 95,
    horizonTradingSessions: 5,
    resolveAt: "2026-06-08",
    conviction: 0.6,
    benchmarkReferencePrice: 500,
    ...overrides,
  });
}

describe("resolveForecast — bullish", () => {
  test("target hit when a bar's high reaches the target first", () => {
    const bars = [bar("2026-06-02", 99, 105), bar("2026-06-03", 104, 111, 109)];
    const r = resolveForecast(forecast(), bars, [])!;
    expect(r.outcome).toBe("target_hit");
    expect(r.exitPrice).toBe(110);
    expect(r.resolutionDate).toBe("2026-06-03");
    expect(r.terminalReturn).toBeCloseTo(0.1, 5); // (110-100)/100
    expect(r.forecastR).toBeCloseTo(2, 5); // (110-100)/(100-95)
  });

  test("stop hit when a bar's low reaches the stop first", () => {
    const bars = [bar("2026-06-02", 94, 101)];
    const r = resolveForecast(forecast(), bars, [])!;
    expect(r.outcome).toBe("stop_hit");
    expect(r.exitPrice).toBe(95);
    expect(r.forecastR).toBeCloseTo(-1, 5); // (95-100)/(100-95)
  });

  test("expired at the terminal close when neither is touched", () => {
    const bars = [bar("2026-06-02", 99, 105, 103), bar("2026-06-03", 98, 106, 104)];
    const r = resolveForecast(forecast(), bars, [])!;
    expect(r.outcome).toBe("expired");
    expect(r.exitPrice).toBe(104);
    expect(r.resolutionDate).toBe("2026-06-03");
  });

  test("ambiguous_touch when one bar spans both target and stop, graded stop-first", () => {
    const bars = [bar("2026-06-02", 94, 111)];
    const r = resolveForecast(forecast(), bars, [])!;
    expect(r.outcome).toBe("ambiguous_touch");
    expect(r.exitPrice).toBe(95); // conservative
    expect(r.warnings[0]).toContain("both touched");
  });

  test("MFE and MAE capture the favorable and adverse excursions", () => {
    const bars = [bar("2026-06-02", 96, 108, 107)]; // up to +8%, down to -4%, no touch
    const r = resolveForecast(forecast(), bars, [])!;
    expect(r.outcome).toBe("expired");
    expect(r.maxFavorableExcursion).toBeCloseTo(0.08, 5);
    expect(r.maxAdverseExcursion).toBeCloseTo(-0.04, 5);
  });
});

describe("resolveForecast — bearish (downside) inverts the touch logic", () => {
  const bear = () => forecast({ id: "f2", side: "bearish", entry: 100, target: 90, stop: 105 });

  test("target hit when price falls to the downside target", () => {
    const bars = [bar("2026-06-02", 89, 99)];
    const r = resolveForecast(bear(), bars, [])!;
    expect(r.outcome).toBe("target_hit");
    expect(r.exitPrice).toBe(90);
    expect(r.terminalReturn).toBeCloseTo(-0.1, 5); // stock fell 10%
    expect(r.forecastR).toBeCloseTo(2, 5); // (100-90)/(105-100)
  });

  test("stop hit when price rises to the upside stop", () => {
    const bars = [bar("2026-06-02", 101, 106)];
    const r = resolveForecast(bear(), bars, [])!;
    expect(r.outcome).toBe("stop_hit");
    expect(r.exitPrice).toBe(105);
    expect(r.forecastR).toBeCloseTo(-1, 5);
  });
});

describe("resolveForecast — lookahead & data guards", () => {
  test("ignores bars on or before the as-of date (no lookahead leakage)", () => {
    // A target-touching bar dated the as-of day must NOT resolve the forecast.
    const sameDay = bar("2026-06-01", 94, 120); // would be both-touch if counted
    const later = bar("2026-06-02", 99, 105, 103);
    const r = resolveForecast(forecast(), [sameDay, later], [])!;
    expect(r.outcome).toBe("expired"); // same-day bar ignored; later bar touches nothing
    expect(r.resolutionDate).toBe("2026-06-02");
  });

  test("returns null when no eligible bars exist yet", () => {
    expect(resolveForecast(forecast(), [bar("2026-06-01", 99, 101)], [])).toBeNull();
  });
});

describe("resolveForecast — SPY excess", () => {
  test("subtracts SPY's return over the same window from the stock's return", () => {
    const bars = [bar("2026-06-03", 104, 111, 109)]; // target_hit, +10%
    const spy = [bar("2026-06-03", 504, 506, 505)]; // SPY 500 → 505 = +1%
    const r = resolveForecast(forecast(), bars, spy)!;
    expect(r.spyExcessReturn).toBeCloseTo(0.1 - 0.01, 5);
  });

  test("SPY excess is null when no benchmark close precedes the resolution date", () => {
    const bars = [bar("2026-06-03", 104, 111, 109)];
    const r = resolveForecast(forecast(), bars, [])!;
    expect(r.spyExcessReturn).toBeNull();
  });
});

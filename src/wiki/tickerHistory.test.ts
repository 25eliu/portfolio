import { describe, expect, test } from "bun:test";
import { buildTickerHistory, type TickerHistoryRow } from "./tickerHistory.ts";

function row(p: Partial<TickerHistoryRow> & { ticker: string; forecastId: string }): TickerHistoryRow {
  return {
    journalEntryId: `je-${p.forecastId}`,
    side: "bullish",
    createdAt: "2026-06-01T00:00:00.000Z",
    resolveAt: "2026-06-30",
    conviction: 0.6,
    entry: 100, target: 120, stop: 90,
    outcome: null, resolutionDate: null, realizedR: null, terminalReturn: null, spyExcess: null,
    unrealizedR: null, markStatus: null, markDate: null,
    ...p,
  };
}

describe("buildTickerHistory", () => {
  test("groups by ticker with win/loss record, hit rate, and expectancy", () => {
    const [h] = buildTickerHistory([
      row({ ticker: "NVDA", forecastId: "a", outcome: "target_hit", resolutionDate: "2026-06-10", realizedR: 2.0 }),
      row({ ticker: "NVDA", forecastId: "b", outcome: "stop_hit", resolutionDate: "2026-06-12", realizedR: -1.0 }),
      row({ ticker: "NVDA", forecastId: "c", outcome: "target_hit", resolutionDate: "2026-06-14", realizedR: 1.5 }),
      row({ ticker: "NVDA", forecastId: "d", outcome: "ambiguous_touch", resolutionDate: "2026-06-15", realizedR: null }),
      row({ ticker: "NVDA", forecastId: "e", unrealizedR: 0.5, markStatus: "on_track", markDate: "2026-06-20" }),
    ]);
    expect(h!.ticker).toBe("NVDA");
    expect(h!.total).toBe(5);
    expect(h!.resolved).toBe(4);
    expect(h!.open).toBe(1);
    expect(h!.wins).toBe(2);
    expect(h!.losses).toBe(1);
    // hit rate excludes the ambiguous touch from the denominator: 2 wins / 3 graded
    expect(h!.hitRate).toBeCloseTo(2 / 3, 5);
    // expectancy = mean realized R over the 3 resolved-with-R calls: (2 - 1 + 1.5)/3
    expect(h!.expectancyR).toBeCloseTo(0.8333, 3);
    expect(h!.avgUnrealizedR).toBe(0.5);
    expect(h!.trackR).toBeCloseTo(0.8333, 3); // expectancy wins when there are resolved calls
  });

  test("calls are newest-first; resolved vs open shaped correctly", () => {
    const [h] = buildTickerHistory([
      row({ ticker: "AAPL", forecastId: "old", createdAt: "2026-05-01T00:00:00.000Z", outcome: "stop_hit", resolutionDate: "2026-05-10", realizedR: -1 }),
      row({ ticker: "AAPL", forecastId: "new", createdAt: "2026-06-01T00:00:00.000Z", unrealizedR: 1.2, markStatus: "near_target", markDate: "2026-06-05" }),
    ]);
    expect(h!.calls.map((c) => c.forecastId)).toEqual(["new", "old"]);
    const open = h!.calls[0]!;
    expect(open.resolved).toBe(false);
    expect(open.status).toBe("near_target");
    expect(open.unrealizedR).toBe(1.2);
    const resolved = h!.calls[1]!;
    expect(resolved.resolved).toBe(true);
    expect(resolved.status).toBe("stop_hit");
    expect(resolved.realizedR).toBe(-1);
    expect(resolved.unrealizedR).toBeNull(); // resolved calls don't carry a live mark
  });

  test("tickers ordered how-right → how-wrong by avg R; no-R tickers sink to bottom", () => {
    const hs = buildTickerHistory([
      row({ ticker: "WIN", forecastId: "w", outcome: "target_hit", resolutionDate: "2026-06-10", realizedR: 2.0 }),
      row({ ticker: "MEH", forecastId: "m", unrealizedR: 0.3, markStatus: "on_track", markDate: "2026-06-10" }),
      row({ ticker: "LOSE", forecastId: "l", outcome: "stop_hit", resolutionDate: "2026-06-10", realizedR: -1.0 }),
      row({ ticker: "UNK", forecastId: "u" }), // open, never marked → no R yet
    ]);
    expect(hs.map((h) => h.ticker)).toEqual(["WIN", "MEH", "LOSE", "UNK"]); // 2.0 → 0.3 → -1.0 → null
  });

  test("open-only ticker falls back to avg unrealized R for trackR", () => {
    const [h] = buildTickerHistory([
      row({ ticker: "TSLA", forecastId: "o1", unrealizedR: 1.0, markStatus: "on_track", markDate: "2026-06-10" }),
      row({ ticker: "TSLA", forecastId: "o2", unrealizedR: -0.4, markStatus: "at_risk", markDate: "2026-06-10" }),
    ]);
    expect(h!.expectancyR).toBeNull();
    expect(h!.avgUnrealizedR).toBeCloseTo(0.3, 5);
    expect(h!.trackR).toBeCloseTo(0.3, 5);
  });
});

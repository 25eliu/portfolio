import { beforeEach, describe, expect, test } from "bun:test";
import { createApp, type App } from "../app.ts";
import { openMemoryDb } from "../db/index.ts";
import { createFakeGateway } from "../market/index.ts";
import { newId, Recommendation, type DailyReport, type JournalEntry, type ScoredForecast } from "../domain/index.ts";
import type { Bar } from "../market/types.ts";
import type { HistoricalBarsProvider } from "./provider.ts";
import { resolveDueForecasts } from "./index.ts";

const ASOF = "2026-06-01T14:30:00.000Z";

/** A provider that returns a single target-hitting bar for the stock and a SPY series. */
function provider(): HistoricalBarsProvider {
  const bar = (date: string, low: number, high: number, close: number): Bar => ({
    date, open: (low + high) / 2, high, low, close, volume: 1,
  });
  return {
    name: "test",
    adjustmentPolicyVersion: "test-v1",
    async getDailyBars(symbol, _start, _end) {
      if (symbol === "SPY") return [bar("2026-06-03", 504, 506, 505)];
      return [bar("2026-06-03", 104, 112, 109)]; // high 112 ≥ target 110 → target_hit
    },
  };
}

function seedForecast(app: App, resolveAt: string): ScoredForecast {
  const report: DailyReport = { id: newId(), date: "2026-06-01", generatedAt: ASOF, source: "llm", marketContext: null, outlook: null, recommendations: [] };
  app.repos.reports.insert(report);
  const rec = Recommendation.parse({
    ticker: "AAPL", held: false, action: "BUY", conviction: 0.6, strategyFamily: "momentum_breakout",
    thesis: "t", signals: [], prediction: { direction: "bullish", horizon: "1w", invalidation: "x", rationale: "y", target: 110, stop: 95 }, technicals: {},
  });
  const entry: JournalEntry = {
    id: newId(), reportId: report.id, runId: null, date: "2026-06-01", createdAt: ASOF, ticker: "AAPL",
    held: false, action: "BUY", conviction: 0.6, strategyFamily: "momentum_breakout", recommendation: rec, marketContextId: report.id, scored: true,
  };
  app.repos.journalEntries.insert(entry);
  const forecast: ScoredForecast = {
    id: newId(), journalEntryId: entry.id, ticker: "AAPL", side: "bullish", strategyFamily: "momentum_breakout",
    signals: [], createdAt: ASOF, asOfTimestamp: ASOF, marketSession: "unknown", quoteTimestamp: ASOF, priceFeed: "fake",
    referencePrice: 100, entry: 100, target: 110, stop: 95, horizonTradingSessions: 5, resolveAt, conviction: 0.6,
    benchmarkSymbol: "SPY", benchmarkReferencePrice: 500, resolutionPolicyVersion: "v1", marketContextId: report.id,
    citedSourceIds: [], retrievedChunkIds: [],
  };
  app.repos.scoredForecasts.insert(forecast);
  return forecast;
}

let app: App;
beforeEach(() => {
  app = createApp({
    db: openMemoryDb(),
    gateway: createFakeGateway({ now: () => "2026-06-10" }),
    now: () => "2026-06-10",
    barsProvider: provider(),
  });
});

describe("resolveDueForecasts", () => {
  test("resolves a due forecast, records the outcome with provenance, and is idempotent", async () => {
    const f = seedForecast(app, "2026-06-08"); // due (≤ 2026-06-10)

    const first = await resolveDueForecasts(app);
    expect(first.resolved).toBe(1);

    const outcome = app.repos.forecastOutcomes.getByForecast(f.id)!;
    expect(outcome.outcome).toBe("target_hit");
    expect(outcome.terminalReturn).toBeCloseTo(0.1, 5);
    expect(outcome.spyExcessReturn).toBeCloseTo(0.09, 5); // +10% stock − +1% SPY
    expect(outcome.barsProvider).toBe("test");
    expect(outcome.adjustmentPolicyVersion).toBe("test-v1");
    expect(outcome.resolutionPolicyVersion).toBe("v1");

    // Re-running does not double-resolve — the forecast is no longer "due".
    const second = await resolveDueForecasts(app);
    expect(second.resolved).toBe(0);
  });

  test("forecasts not yet at their horizon are left alone", async () => {
    seedForecast(app, "2026-06-30"); // resolveAt in the future relative to now (2026-06-10)
    const res = await resolveDueForecasts(app);
    expect(res.resolved).toBe(0);
  });
});

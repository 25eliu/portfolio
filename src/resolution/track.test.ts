import { beforeEach, describe, expect, test } from "bun:test";
import { createApp, type App } from "../app.ts";
import { openMemoryDb } from "../db/index.ts";
import { createFakeGateway } from "../market/index.ts";
import { markFor, trackOpenForecasts } from "./track.ts";
import { newId, type ScoredForecast } from "../domain/index.ts";

const NOW = "2026-06-01T00:00:00.000Z";

const forecast = (over: Partial<ScoredForecast> = {}): ScoredForecast => ({
  id: "f1", journalEntryId: "j1", ticker: "NVDA", side: "bullish", strategyFamily: "momentum",
  signals: [], createdAt: "2026-06-01T00:00:00.000Z", asOfTimestamp: "2026-06-01T00:00:00.000Z",
  marketSession: "regular", quoteTimestamp: null, priceFeed: "fake", referencePrice: 100,
  entry: 100, target: 120, stop: 90,
  horizonTradingSessions: 10, resolveAt: "2026-06-15", conviction: 0.7, benchmarkSymbol: "SPY",
  benchmarkReferencePrice: 400, resolutionPolicyVersion: "v1", marketContextId: null,
  citedSourceIds: [], retrievedChunkIds: [], ...over,
});

describe("markFor", () => {
  test("computes move/progress/R/status for a bullish forecast marked up", () => {
    const m = markFor(forecast(), { markPrice: 110, date: "2026-06-03", spyPrice: 408, prior: null, now: "2026-06-03T00:00:00.000Z" });
    expect(m.moveFromEntry).toBeCloseTo(0.1, 5);
    expect(m.progressToTarget).toBeCloseTo(0.5, 5);
    expect(m.unrealizedR).toBeCloseTo(1.0, 5);
    expect(m.status).toBe("on_track");
    expect(m.mfe).toBeCloseTo(1.0, 5);
    expect(m.mae).toBeCloseTo(1.0, 5);
    expect(m.spyExcess).toBeCloseTo(0.1 - 0.02, 5);
  });

  test("rolls MFE up and MAE down from the prior mark", () => {
    const prior = markFor(forecast(), { markPrice: 115, date: "2026-06-03", spyPrice: null, prior: null, now: "2026-06-03T00:00:00.000Z" });
    expect(prior.mfe).toBeCloseTo(1.5, 5);
    const today = markFor(forecast(), { markPrice: 95, date: "2026-06-04", spyPrice: null, prior, now: "2026-06-04T00:00:00.000Z" });
    expect(today.unrealizedR).toBeCloseTo(-0.5, 5);
    expect(today.mfe).toBeCloseTo(1.5, 5);
    expect(today.mae).toBeCloseTo(-0.5, 5);
    expect(today.status).toBe("at_risk");
  });
});

describe("trackOpenForecasts", () => {
  let app: App;

  /**
   * Seed report → journal entry → scored forecast so FK constraints are satisfied.
   * Mirrors the seedForecast helper in forecastDailyMarks.test.ts.
   */
  function seedForecast(app: App, id: string): void {
    const reportId = newId();
    app.repos.reports.insert({
      id: reportId, date: "2026-06-01", generatedAt: NOW, source: "llm",
      recommendations: [], marketContext: null,
    });
    const entryId = newId();
    app.repos.journalEntries.insert({
      id: entryId, reportId, runId: null, date: "2026-06-01", createdAt: NOW,
      ticker: "NVDA", held: false, action: "BUY", conviction: 0.7,
      strategyFamily: "momentum",
      recommendation: {
        ticker: "NVDA", held: false, action: "BUY", conviction: 0.7,
        strategyFamily: "momentum", thesis: "test", signals: [],
        prediction: { direction: "bullish", horizon: "1mo", invalidation: "x", rationale: "y", target: 120, stop: 90 },
        technicals: {},
      } as Parameters<typeof app.repos.journalEntries.insert>[0]["recommendation"],
      marketContextId: null, scored: true,
    });
    app.repos.scoredForecasts.insert(forecast({ id, journalEntryId: entryId }));
  }

  beforeEach(() => {
    app = createApp({ db: openMemoryDb(), gateway: createFakeGateway({ now: () => "2026-06-03", startingCash: 100_000 }), now: () => "2026-06-03" });
  });

  test("persists a mark per open forecast and is idempotent for the day", async () => {
    seedForecast(app, "f1");
    const r1 = await trackOpenForecasts(app);
    expect(r1.tracked).toBe(1);
    const r2 = await trackOpenForecasts(app);
    expect(r2.tracked).toBe(1);
    expect(app.repos.forecastDailyMarks.listForForecast("f1").length).toBe(1);
  });

  test("no open forecasts → tracks nothing, no throw", async () => {
    expect((await trackOpenForecasts(app)).tracked).toBe(0);
  });
});

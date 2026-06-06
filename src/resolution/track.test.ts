import { beforeEach, describe, expect, test } from "bun:test";
import { createApp, type App } from "../app.ts";
import { openMemoryDb } from "../db/index.ts";
import { createFakeGateway } from "../market/index.ts";
import { markFor, trackOpenForecasts, assessInFlight, renderInFlight } from "./track.ts";
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

  test("uses short-side math for a bearish forecast marked down (favorable)", () => {
    // bearish: target below ref (80), stop above (110); a drop to 90 is favorable.
    const f = forecast({ side: "bearish", referencePrice: 100, target: 80, stop: 110 });
    const m = markFor(f, { markPrice: 90, date: "2026-06-03", spyPrice: null, prior: null, now: "2026-06-03T00:00:00.000Z" });
    expect(m.moveFromEntry).toBeCloseTo(-0.1, 5); // price fell 10%
    expect(m.progressToTarget).toBeCloseTo(0.5, 5); // (100-90)/(100-80)
    expect(m.progressToStop).toBeCloseTo(-1.0, 5); // moved away from the stop
    expect(m.unrealizedR).toBeCloseTo(1.0, 5); // (100-90)/(110-100) — favorable for a short
    expect(m.status).toBe("on_track");
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
      recommendations: [], marketContext: null, outlook: null,
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

describe("renderInFlight", () => {
  const base = { id: "x", forecastId: "f", ticker: "NVDA", date: "2026-06-03", markPrice: 100,
    moveFromEntry: 0, progressToTarget: 0, progressToStop: 0, spyExcess: null, createdAt: "2026-06-03T00:00:00.000Z" };

  test("summarizes today's marks (counts + avg unrealized R)", () => {
    const text = renderInFlight([
      { ...base, unrealizedR: 0.8, mfe: 1.0, mae: -0.1, status: "on_track" },
      { ...base, forecastId: "g", unrealizedR: -0.6, mfe: 0.2, mae: -0.6, status: "near_stop" },
    ] as any);
    expect(text).toContain("IN-FLIGHT");
    expect(text).toContain("1 on track");
    expect(text).toContain("1 near stop");
  });

  test("empty marks → empty string (nothing to inject)", () => {
    expect(renderInFlight([])).toBe("");
  });

  test("assessInFlight aggregates counts and averages", () => {
    const a = assessInFlight([
      { ...base, unrealizedR: 1.0, mfe: 1.0, mae: 0, status: "on_track" },
      { ...base, forecastId: "g", unrealizedR: -1.0, mfe: 0, mae: -1.0, status: "at_risk" },
    ] as any);
    expect(a.total).toBe(2);
    expect(a.onTrack).toBe(1);
    expect(a.atRisk).toBe(1);
    expect(a.avgUnrealizedR).toBeCloseTo(0, 5);
  });
});

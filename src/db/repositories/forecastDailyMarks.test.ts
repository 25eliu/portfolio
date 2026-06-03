import { beforeEach, describe, expect, test } from "bun:test";
import { openMemoryDb, repositories } from "../index.ts";
import type { ForecastDailyMark } from "../../domain/index.ts";
import { newId } from "../../domain/index.ts";

let repos: ReturnType<typeof repositories>;
const NOW = "2026-06-02T00:00:00.000Z";

/** Seed report → journal entry → scored forecast so FK constraints are satisfied. */
function seedForecast(id: string): void {
  const reportId = newId();
  repos.reports.insert({
    id: reportId, date: "2026-06-02", generatedAt: NOW, source: "llm",
    recommendations: [], marketContext: null,
  });
  const entryId = newId();
  repos.journalEntries.insert({
    id: entryId, reportId, runId: null, date: "2026-06-02", createdAt: NOW,
    ticker: "NVDA", held: false, action: "BUY", conviction: 0.7,
    strategyFamily: "momentum_breakout",
    recommendation: {
      ticker: "NVDA", held: false, action: "BUY", conviction: 0.7,
      strategyFamily: "momentum_breakout", thesis: "test", signals: [],
      prediction: { direction: "bullish", horizon: "1mo", invalidation: "x", rationale: "y", target: 120, stop: 95 },
      technicals: {},
    } as Parameters<typeof repos.journalEntries.insert>[0]["recommendation"],
    marketContextId: null, scored: true,
  });
  repos.scoredForecasts.insert({
    id, journalEntryId: entryId, ticker: "NVDA", side: "bullish",
    strategyFamily: "momentum_breakout", signals: [], createdAt: NOW,
    asOfTimestamp: NOW, marketSession: "regular", quoteTimestamp: null,
    priceFeed: "fake", referencePrice: 100, entry: 100, target: 120, stop: 95,
    horizonTradingSessions: 21, resolveAt: "2026-07-01", conviction: 0.7,
    benchmarkSymbol: "SPY", benchmarkReferencePrice: 500,
    resolutionPolicyVersion: "v1", marketContextId: null,
    citedSourceIds: [], retrievedChunkIds: [],
  });
}

beforeEach(() => {
  repos = repositories(openMemoryDb());
  seedForecast("f1");
  seedForecast("f2");
});

const mark = (over: Partial<ForecastDailyMark>): ForecastDailyMark => ({
  id: over.id ?? `${over.forecastId ?? "f1"}-${over.date ?? "2026-06-02"}`,
  forecastId: "f1", ticker: "NVDA", date: "2026-06-02", markPrice: 100,
  moveFromEntry: 0.05, progressToTarget: 0.3, progressToStop: 0.1, unrealizedR: 0.5,
  mfe: 0.5, mae: 0.5, spyExcess: 0.02, status: "on_track", createdAt: NOW, ...over,
});

describe("forecastDailyMarks repo", () => {
  test("upsert is idempotent per (forecast_id, date) — re-marking the same day replaces the row", () => {
    repos.forecastDailyMarks.upsert(mark({ markPrice: 100, unrealizedR: 0.5 }));
    repos.forecastDailyMarks.upsert(mark({ markPrice: 110, unrealizedR: 0.9 }));
    const rows = repos.forecastDailyMarks.listForForecast("f1");
    expect(rows.length).toBe(1);
    expect(rows[0]!.markPrice).toBe(110);
    expect(rows[0]!.unrealizedR).toBe(0.9);
  });

  test("listForForecast returns marks oldest-first across days", () => {
    repos.forecastDailyMarks.upsert(mark({ id: "f1-d2", date: "2026-06-03" }));
    repos.forecastDailyMarks.upsert(mark({ id: "f1-d1", date: "2026-06-02" }));
    expect(repos.forecastDailyMarks.listForForecast("f1").map((m) => m.date)).toEqual(["2026-06-02", "2026-06-03"]);
  });

  test("priorMark returns the latest mark strictly before a date (for MFE/MAE roll-forward)", () => {
    repos.forecastDailyMarks.upsert(mark({ id: "f1-d1", date: "2026-06-02", mfe: 0.5, mae: -0.2 }));
    expect(repos.forecastDailyMarks.priorMark("f1", "2026-06-03")?.mfe).toBe(0.5);
    expect(repos.forecastDailyMarks.priorMark("f1", "2026-06-02")).toBeNull();
  });

  test("forDate returns all marks stamped on a given day", () => {
    repos.forecastDailyMarks.upsert(mark({ id: "f1-d", forecastId: "f1", date: "2026-06-02" }));
    repos.forecastDailyMarks.upsert(mark({ id: "f2-d", forecastId: "f2", date: "2026-06-02" }));
    expect(repos.forecastDailyMarks.forDate("2026-06-02").length).toBe(2);
  });
});

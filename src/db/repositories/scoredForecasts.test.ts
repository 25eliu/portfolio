import { describe, expect, test } from "bun:test";
import { openMemoryDb, repositories } from "../index.ts";
import { newId, type DailyReport, type JournalEntry, type ScoredForecast } from "../../domain/index.ts";

const TS = "2026-06-01T00:00:00.000Z";

function seedPrerequisites(repos: ReturnType<typeof repositories>) {
  const report: DailyReport = {
    id: newId(),
    date: "2026-06-01",
    generatedAt: TS,
    source: "llm",
    marketContext: null,
    recommendations: [],
  };
  repos.reports.insert(report);
  return report.id;
}

function journalEntry(reportId: string, id = newId()): JournalEntry {
  return {
    id,
    reportId,
    runId: "run-1",
    date: "2026-06-01",
    createdAt: TS,
    ticker: "AAPL",
    held: true,
    action: "ADD",
    conviction: 0.65,
    strategyFamily: "momentum",
    recommendation: {
      ticker: "AAPL",
      held: true,
      action: "ADD",
      conviction: 0.65,
      strategyFamily: "momentum",
      thesis: "test",
      signals: ["x"],
      prediction: { direction: "bullish", horizon: "1mo", invalidation: "x", rationale: "y", target: 120, stop: 95 },
      technicals: {},
    } as JournalEntry["recommendation"],
    marketContextId: null,
    scored: true,
  };
}

function forecast(
  journalEntryId: string,
  over: Partial<{ ticker: string; resolveAt: string; createdAt: string }>,
): ScoredForecast {
  return {
    id: newId(),
    journalEntryId,
    ticker: over.ticker ?? "AAPL",
    side: "bullish",
    strategyFamily: "momentum",
    signals: ["x"],
    createdAt: over.createdAt ?? "2026-06-01T00:00:00.000Z",
    asOfTimestamp: "2026-06-01T00:00:00.000Z",
    marketSession: "regular",
    quoteTimestamp: null,
    priceFeed: "fake",
    referencePrice: 100,
    entry: 100,
    target: 130,
    stop: 95,
    horizonTradingSessions: 21,
    resolveAt: over.resolveAt ?? "2026-07-01",
    conviction: 0.7,
    benchmarkSymbol: "SPY",
    benchmarkReferencePrice: 500,
    resolutionPolicyVersion: "v1",
    marketContextId: null,
    citedSourceIds: [],
    retrievedChunkIds: [],
  };
}

describe("scoredForecasts.listOpen", () => {
  test("returns unresolved, not-yet-due forecasts newest-first, honoring the limit", () => {
    const repos = repositories(openMemoryDb());
    const reportId = seedPrerequisites(repos);

    // Insert 3 journal entries, one per forecast
    const entryNvda = journalEntry(reportId);
    const entryTsla = journalEntry(reportId);
    const entryOld = journalEntry(reportId);
    repos.journalEntries.insertMany([entryNvda, entryTsla, entryOld]);

    repos.scoredForecasts.insertMany([
      forecast(entryNvda.id, { ticker: "NVDA", resolveAt: "2026-07-01", createdAt: "2026-06-01T00:00:00.000Z" }),
      forecast(entryTsla.id, { ticker: "TSLA", resolveAt: "2026-07-02", createdAt: "2026-06-02T00:00:00.000Z" }),
      forecast(entryOld.id, { ticker: "OLD", resolveAt: "2026-05-01", createdAt: "2026-04-01T00:00:00.000Z" }), // already due
    ]);

    const open = repos.scoredForecasts.listOpen("2026-06-03", 10);
    const tickers = open.map((f) => f.ticker);
    expect(tickers).toEqual(["TSLA", "NVDA"]); // newest-first; OLD is past its resolve_at
    expect(repos.scoredForecasts.listOpen("2026-06-03", 1).map((f) => f.ticker)).toEqual(["TSLA"]);
  });
});

import { beforeEach, describe, expect, test } from "bun:test";
import { openMemoryDb, repositories, type Repositories } from "../index.ts";
import {
  newId,
  Recommendation,
  type DailyReport,
  type JournalEntry,
  type ScoredForecast,
} from "../../domain/index.ts";

const DATE = "2026-06-01";
const TS = "2026-06-01T14:30:00.000Z";

let repos: Repositories;

function seedReport(): string {
  const report: DailyReport = {
    id: newId(),
    date: DATE,
    generatedAt: TS,
    source: "llm",
    marketContext: null,
    outlook: null,
    recommendations: [],
  };
  return repos.reports.insert(report).id;
}

function makeRec(): Recommendation {
  return Recommendation.parse({
    ticker: "AAPL",
    held: true,
    action: "ADD",
    conviction: 0.65,
    strategyFamily: "momentum_breakout",
    thesis: "preserved verbatim",
    signals: ["vwap_reclaim", "unusual_volume"],
    prediction: { direction: "bullish", horizon: "1mo", invalidation: "x", rationale: "y", target: 120, stop: 95 },
    technicals: {},
  });
}

function makeEntry(reportId: string, id = newId(), scored = true): JournalEntry {
  return {
    id,
    reportId,
    runId: "run-1",
    date: DATE,
    createdAt: TS,
    ticker: "AAPL",
    held: true,
    action: "ADD",
    conviction: 0.65,
    strategyFamily: "momentum_breakout",
    recommendation: makeRec(),
    marketContextId: reportId,
    scored,
  };
}

function makeForecast(journalEntryId: string): ScoredForecast {
  return {
    id: newId(),
    journalEntryId,
    ticker: "AAPL",
    side: "bullish",
    strategyFamily: "momentum_breakout",
    signals: ["vwap_reclaim"],
    createdAt: TS,
    asOfTimestamp: TS,
    marketSession: "unknown",
    quoteTimestamp: TS,
    priceFeed: "fake",
    referencePrice: 100,
    entry: 100,
    target: 120,
    stop: 95,
    horizonTradingSessions: 21,
    resolveAt: "2026-07-01",
    conviction: 0.65,
    benchmarkSymbol: "SPY",
    benchmarkReferencePrice: 500,
    resolutionPolicyVersion: "v1",
    marketContextId: journalEntryId,
    citedSourceIds: ["https://example.com/a"],
    retrievedChunkIds: [],
  };
}

beforeEach(() => {
  repos = repositories(openMemoryDb());
});

describe("journalEntriesRepo", () => {
  test("insert + get round-trips, preserving the recommendation verbatim", () => {
    const reportId = seedReport();
    const entry = makeEntry(reportId);
    repos.journalEntries.insert(entry);
    const got = repos.journalEntries.get(entry.id)!;
    expect(got.ticker).toBe("AAPL");
    expect(got.scored).toBe(true);
    expect(got.recommendation.thesis).toBe("preserved verbatim");
    expect(got.recommendation.signals).toEqual(["vwap_reclaim", "unusual_volume"]);
  });

  test("insertMany is atomic and list returns newest-first, filterable by ticker", () => {
    const reportId = seedReport();
    repos.journalEntries.insertMany([makeEntry(reportId), makeEntry(reportId)]);
    expect(repos.journalEntries.list()).toHaveLength(2);
    expect(repos.journalEntries.list({ ticker: "AAPL" })).toHaveLength(2);
    expect(repos.journalEntries.list({ ticker: "MSFT" })).toHaveLength(0);
  });

  test("listDays counts DISTINCT tickers per day (newest first)", () => {
    const reportId = seedReport();
    const on = (date: string, ticker: string, scored: boolean, createdAt: string) => ({
      ...makeEntry(reportId, newId(), scored),
      date,
      ticker,
      createdAt,
      recommendation: { ...makeRec(), ticker },
    });
    repos.journalEntries.insertMany([
      on("2026-06-01", "AAPL", true, "2026-06-01T10:00:00.000Z"),
      on("2026-06-01", "MSFT", false, "2026-06-01T10:00:00.000Z"),
      on("2026-06-02", "AAPL", true, "2026-06-02T10:00:00.000Z"),
    ]);

    expect(repos.journalEntries.listDays()).toEqual([
      { date: "2026-06-02", count: 1, scored: 1 },
      { date: "2026-06-01", count: 2, scored: 1 },
    ]);
  });

  test("listDay dedupes same-day re-runs to the latest call per ticker", () => {
    const reportId = seedReport();
    const at = (ticker: string, createdAt: string) => ({
      ...makeEntry(reportId, newId(), true),
      date: "2026-06-02",
      ticker,
      createdAt,
      recommendation: { ...makeRec(), ticker, thesis: `thesis @ ${createdAt}` },
    });
    // Two runs on the same day re-journal AAPL; MSFT only in the later run.
    repos.journalEntries.insertMany([
      at("AAPL", "2026-06-02T01:00:00.000Z"),
      at("AAPL", "2026-06-02T07:00:00.000Z"),
      at("MSFT", "2026-06-02T07:00:00.000Z"),
    ]);

    const day = repos.journalEntries.listDay("2026-06-02");
    expect(day).toHaveLength(2); // one row per ticker, not three
    const aapl = day.find((e) => e.ticker === "AAPL")!;
    expect(aapl.recommendation.thesis).toBe("thesis @ 2026-06-02T07:00:00.000Z"); // the latest run's call
    // The full audit trail is still retained (both AAPL entries persisted).
    expect(repos.journalEntries.list({ ticker: "AAPL" })).toHaveLength(2);
  });
});

describe("journalEntries.recentActionableTickers", () => {
  test("returns distinct BUY/ADD/WATCH tickers within the window, newest-first", () => {
    const repos = repositories(openMemoryDb());
    const reportId = newId();
    repos.reports.insert({ id: reportId, date: "2026-06-01", generatedAt: "2026-06-01T00:00:00.000Z", source: "llm", recommendations: [], marketContext: null, outlook: null });
    const mk = (ticker: string, date: string, action: string, createdAt: string) => {
      const rec = Recommendation.parse({ ticker, held: false, action, conviction: 0.6, strategyFamily: "momentum", thesis: `t ${ticker}`, signals: [], prediction: { direction: "bullish", horizon: "1mo", invalidation: "x", rationale: "y", entry: 100, target: 130, stop: 95 }, technicals: {} });
      return { id: newId(), reportId, runId: null, date, createdAt, ticker, held: false, action, conviction: 0.6, strategyFamily: "momentum", recommendation: rec, marketContextId: null, scored: false };
    };
    repos.journalEntries.insertMany([
      mk("NVDA", "2026-06-01", "BUY", "2026-06-01T00:00:00.000Z"),
      mk("TSLA", "2026-06-02", "WATCH", "2026-06-02T00:00:00.000Z"),
      mk("AAPL", "2026-06-02", "PASS", "2026-06-02T00:00:01.000Z"), // not actionable
      mk("OLD", "2026-05-01", "BUY", "2026-05-01T00:00:00.000Z"),   // outside window
    ]);
    expect(repos.journalEntries.recentActionableTickers("2026-05-28", 10)).toEqual(["TSLA", "NVDA"]);
  });
});

describe("journalEntries.latestPriorForTicker", () => {
  test("returns the most recent entry strictly before the given date", () => {
    const repos = repositories(openMemoryDb());
    const reportId = newId();
    repos.reports.insert({ id: reportId, date: "2026-05-28", generatedAt: "2026-05-28T00:00:00.000Z", source: "llm", recommendations: [], marketContext: null, outlook: null });
    const mk = (date: string, action: string, createdAt: string) => {
      const rec = Recommendation.parse({ ticker: "NVDA", held: false, action, conviction: 0.6, strategyFamily: "momentum", thesis: "t", signals: [], prediction: { direction: "bullish", horizon: "1mo", invalidation: "x", rationale: "y", entry: 100, target: 130, stop: 95 }, technicals: {} });
      return { id: newId(), reportId, runId: null, date, createdAt, ticker: "NVDA", held: false, action, conviction: 0.6, strategyFamily: "momentum", recommendation: rec, marketContextId: null, scored: false };
    };
    repos.journalEntries.insertMany([
      mk("2026-05-28", "WATCH", "2026-05-28T00:00:00.000Z"),
      mk("2026-05-30", "BUY", "2026-05-30T00:00:00.000Z"),
      mk("2026-06-01", "ADD", "2026-06-01T00:00:00.000Z"), // today → excluded
    ]);
    const prior = repos.journalEntries.latestPriorForTicker("NVDA", "2026-06-01");
    expect(prior?.action).toBe("BUY");
    expect(prior?.date).toBe("2026-05-30");
    expect(repos.journalEntries.latestPriorForTicker("MSFT", "2026-06-01")).toBeNull();
  });
});

describe("scoredForecastsRepo", () => {
  test("insert + getByJournalEntry round-trips arrays and nullables", () => {
    const reportId = seedReport();
    const entry = makeEntry(reportId);
    repos.journalEntries.insert(entry);
    const forecast = makeForecast(entry.id);
    repos.scoredForecasts.insert(forecast);

    const got = repos.scoredForecasts.getByJournalEntry(entry.id)!;
    expect(got.side).toBe("bullish");
    expect(got.target).toBe(120);
    expect(got.citedSourceIds).toEqual(["https://example.com/a"]);
    expect(got.retrievedChunkIds).toEqual([]);
    expect(got.benchmarkReferencePrice).toBe(500);
  });
});

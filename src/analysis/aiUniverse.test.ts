import { describe, expect, test } from "bun:test";
import { createApp, type App } from "../app.ts";
import { openMemoryDb } from "../db/index.ts";
import { createFakeGateway } from "../market/index.ts";
import { loadEnv } from "../config/env.ts";
import { newId, Recommendation, type Action } from "../domain/index.ts";
import { collectAiThesisTickers } from "./aiUniverse.ts";

function makeApp(envOver: Record<string, string> = {}): App {
  return createApp({ db: openMemoryDb(), gateway: createFakeGateway({ now: () => "2026-06-10" }), now: () => "2026-06-10", env: loadEnv(envOver) });
}
function seedReport(app: App): string {
  const id = newId();
  app.repos.reports.insert({ id, date: "2026-06-09", generatedAt: "2026-06-09T00:00:00.000Z", source: "llm", recommendations: [], marketContext: null, outlook: null });
  return id;
}
function journal(app: App, reportId: string, ticker: string, action: Action, date: string): string {
  const id = newId();
  const rec = Recommendation.parse({ ticker, held: false, action, conviction: 0.6, strategyFamily: "momentum", thesis: "t", signals: [], prediction: { direction: "bullish", horizon: "1mo", invalidation: "x", rationale: "y", entry: 100, target: 130, stop: 95 }, technicals: {} });
  app.repos.journalEntries.insert({ id, reportId, runId: null, date, createdAt: `${date}T00:00:00.000Z`, ticker, held: false, action, conviction: 0.6, strategyFamily: "momentum", recommendation: rec, marketContextId: null, scored: false });
  return id;
}
function openForecast(app: App, journalEntryId: string, ticker: string): void {
  app.repos.scoredForecasts.insert({ id: newId(), journalEntryId, ticker, side: "bullish", strategyFamily: "momentum", signals: [], createdAt: "2026-06-09T00:00:00.000Z", asOfTimestamp: "2026-06-09T00:00:00.000Z", marketSession: "regular", quoteTimestamp: null, priceFeed: "fake", referencePrice: 100, entry: 100, target: 130, stop: 95, horizonTradingSessions: 21, resolveAt: "2026-07-09", conviction: 0.7, benchmarkSymbol: "SPY", benchmarkReferencePrice: 500, resolutionPolicyVersion: "v1", marketContextId: null, citedSourceIds: [], retrievedChunkIds: [] });
}

describe("collectAiThesisTickers", () => {
  test("unions open-forecast tickers with recent buy-interest tickers, deduped", () => {
    const app = makeApp();
    const rid = seedReport(app);
    const nvdaJe = journal(app, rid, "NVDA", "BUY", "2026-06-09");
    openForecast(app, nvdaJe, "NVDA"); // NVDA in both sources → dedup to one
    journal(app, rid, "TSLA", "WATCH", "2026-06-08");
    journal(app, rid, "OLD", "BUY", "2026-05-01"); // outside the 7-day lookback
    const out = collectAiThesisTickers(app);
    expect(out).toContain("NVDA");
    expect(out).toContain("TSLA");
    expect(out).not.toContain("OLD");
    expect(new Set(out).size).toBe(out.length);
  });

  test("honors the MAX_AI_THESIS cap", () => {
    const app = makeApp({ MAX_AI_THESIS: "1" });
    const rid = seedReport(app);
    const je = journal(app, rid, "NVDA", "BUY", "2026-06-09");
    openForecast(app, je, "NVDA");
    journal(app, rid, "TSLA", "BUY", "2026-06-09");
    expect(collectAiThesisTickers(app).length).toBe(1);
  });
});

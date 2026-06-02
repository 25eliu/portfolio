import { expect, test } from "bun:test";
import { createApp, type App } from "../app.ts";
import { openMemoryDb } from "../db/index.ts";
import { createFakeGateway } from "../market/index.ts";
import { newId, Recommendation } from "../domain/index.ts";
import { compileWiki } from "./index.ts";

test("compileWiki appends the open-book section for in-flight theses", async () => {
  const app: App = createApp({ db: openMemoryDb(), gateway: createFakeGateway({ now: () => "2026-06-10" }), now: () => "2026-06-10" });

  const reportId = newId();
  app.repos.reports.insert({ id: reportId, date: "2026-06-01", generatedAt: "2026-06-01T00:00:00.000Z", source: "llm", recommendations: [], marketContext: null });
  const jeId = newId();
  const rec = Recommendation.parse({ ticker: "NVDA", held: false, action: "BUY", conviction: 0.7, strategyFamily: "momentum", thesis: "t", signals: [], prediction: { direction: "bullish", horizon: "1mo", invalidation: "x", rationale: "y", entry: 100, target: 130, stop: 95 }, technicals: {} });
  app.repos.journalEntries.insert({ id: jeId, reportId, runId: null, date: "2026-06-01", createdAt: "2026-06-01T00:00:00.000Z", ticker: "NVDA", held: false, action: "BUY", conviction: 0.7, strategyFamily: "momentum", recommendation: rec, marketContextId: null, scored: true });
  app.repos.scoredForecasts.insert({ id: newId(), journalEntryId: jeId, ticker: "NVDA", side: "bullish", strategyFamily: "momentum", signals: [], createdAt: "2026-06-01T00:00:00.000Z", asOfTimestamp: "2026-06-01T00:00:00.000Z", marketSession: "regular", quoteTimestamp: null, priceFeed: "fake", referencePrice: 100, entry: 100, target: 130, stop: 95, horizonTradingSessions: 21, resolveAt: "2026-07-01", conviction: 0.7, benchmarkSymbol: "SPY", benchmarkReferencePrice: 500, resolutionPolicyVersion: "v1", marketContextId: null, citedSourceIds: [], retrievedChunkIds: [] });

  await compileWiki(app);
  const body = app.repos.wiki.latestBriefing()?.body ?? "";
  expect(body).toContain("OPEN BOOK");
  expect(body).toContain("NVDA");
});

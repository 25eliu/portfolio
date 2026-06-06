import { beforeEach, describe, expect, test } from "bun:test";
import { createApp, type App } from "../app.ts";
import { openMemoryDb } from "../db/index.ts";
import { createFakeGateway } from "../market/index.ts";
import { newId, nodeId, Recommendation, type DailyReport, type JournalEntry, type ScoredForecast } from "../domain/index.ts";
import { compileWiki } from "./index.ts";

const TS = "2026-06-20T00:00:00.000Z";

function seedResolved(app: App, i: number, outcome: "target_hit" | "stop_hit"): string {
  const report: DailyReport = { id: newId(), date: "2026-06-20", generatedAt: TS, source: "llm", marketContext: null, outlook: null, recommendations: [] };
  app.repos.reports.insert(report);
  const rec = Recommendation.parse({
    ticker: "AAPL", held: false, action: "BUY", conviction: 0.7, strategyFamily: "momentum",
    thesis: "t", signals: [], prediction: { direction: "bullish", horizon: "1mo", invalidation: "x", rationale: "y", target: 120, stop: 95 }, technicals: {},
  });
  const entry: JournalEntry = {
    id: newId(), reportId: report.id, runId: null, date: "2026-06-20", createdAt: TS, ticker: "AAPL",
    held: false, action: "BUY", conviction: 0.7, strategyFamily: "momentum", recommendation: rec, marketContextId: report.id, scored: true,
  };
  app.repos.journalEntries.insert(entry);
  const forecast: ScoredForecast = {
    id: newId(), journalEntryId: entry.id, ticker: "AAPL", side: "bullish", strategyFamily: "momentum",
    signals: [], createdAt: TS, asOfTimestamp: TS, marketSession: "unknown", quoteTimestamp: TS, priceFeed: "fake",
    referencePrice: 100, entry: 100, target: 120, stop: 95, horizonTradingSessions: 21, resolveAt: "2026-07-20", conviction: 0.7,
    benchmarkSymbol: "SPY", benchmarkReferencePrice: 500, resolutionPolicyVersion: "v1", marketContextId: report.id,
    citedSourceIds: [], retrievedChunkIds: [],
  };
  app.repos.scoredForecasts.insert(forecast);
  app.repos.forecastOutcomes.insert({
    id: newId(), forecastId: forecast.id, ticker: "AAPL", outcome,
    resolvedAt: TS, resolutionDate: "2026-07-10",
    entryPrice: 100, exitPrice: outcome === "target_hit" ? 120 : 95,
    terminalReturn: outcome === "target_hit" ? 0.2 : -0.05,
    spyExcessReturn: outcome === "target_hit" ? 0.15 : -0.06,
    maxFavorableExcursion: 0.2, maxAdverseExcursion: -0.05,
    forecastR: outcome === "target_hit" ? 4 : -1,
    barsProvider: "fake", adjustmentPolicyVersion: "none", resolutionPolicyVersion: "v1", warnings: [],
  });
  return forecast.id;
}

let app: App;
beforeEach(() => {
  app = createApp({ db: openMemoryDb(), gateway: createFakeGateway({ now: () => "2026-07-15" }), now: () => "2026-07-15" });
});

describe("compileWiki", () => {
  test("compiles metrics, a gated lesson, a briefing, and graph links from resolved outcomes", async () => {
    for (let i = 0; i < 4; i++) seedResolved(app, i, "target_hit");
    for (let i = 0; i < 2; i++) seedResolved(app, i + 4, "stop_hit"); // 6 total, ≥5 → provisional

    const result = await compileWiki(app);
    expect(result.lessons).toBeGreaterThan(0);

    const overall = app.repos.wiki.listMetrics({ window: "all_time" }).find((m) => m.cohortKey === "overall")!;
    expect(overall.n).toBe(6);
    expect(overall.hitRate).toBeCloseTo(4 / 6, 5);
    expect(overall.coverage).toBeCloseTo(1, 5); // all scored forecasts resolved

    const briefing = app.repos.wiki.latestBriefing()!;
    expect(briefing.body).toContain("PERFORMANCE WIKI");
    expect(briefing.body).toContain("overall | 6 |"); // compact table row

    // graph: the overall lesson is a node, derived_from its source forecasts
    const lessonNode = nodeId("lesson", "all_time:overall");
    const neighbors = app.repos.graph.neighbors(lessonNode, { direction: "out" });
    expect(neighbors.some((nb) => nb.edge.rel === "derived_from")).toBe(true);
  });

  test("sub-threshold cohorts (<5) produce no lessons", async () => {
    seedResolved(app, 0, "target_hit");
    seedResolved(app, 1, "stop_hit");
    const result = await compileWiki(app);
    expect(result.lessons).toBe(0);
    expect(app.repos.wiki.latestBriefing()!.body).toBe("");
  });
});

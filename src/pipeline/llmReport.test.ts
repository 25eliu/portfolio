import { describe, expect, test } from "bun:test";
import { createApp, type App } from "../app.ts";
import { openMemoryDb } from "../db/index.ts";
import { createFakeGateway } from "../market/index.ts";
import { createFakeFundamentals } from "../fundamentals/index.ts";
import { createMockAnalyzer } from "../llm/analyze.ts";
import { generateLlmReport } from "./llmReport.ts";
import { DailyReport, MarketContext } from "../domain/index.ts";

const DATE = "2026-06-01";
function makeApp(analyzer = createMockAnalyzer()): App {
  return createApp({
    db: openMemoryDb(),
    gateway: createFakeGateway({ now: () => DATE }),
    fundamentals: createFakeFundamentals(),
    analyzer,
    now: () => DATE,
  });
}

describe("generateLlmReport", () => {
  test("analyzes held + watchlist + scan into a schema-valid report", async () => {
    const app = makeApp();
    app.repos.holdings.upsert(app.user.id, { symbol: "AAPL", shares: 5 });
    app.repos.watchlist.add({ symbol: "MSFT" });
    const report = await generateLlmReport(app);
    expect(() => DailyReport.parse(report)).not.toThrow();
    expect(report.source).toBe("llm");
    const tickers = report.recommendations.map((r) => r.ticker);
    expect(tickers).toContain("AAPL");
    expect(tickers).toContain("MSFT");
    expect(report.marketContext).not.toBeNull();
  });

  test("one failing ticker is skipped, not fatal", async () => {
    const flaky = createMockAnalyzer();
    const orig = flaky.analyzeTicker.bind(flaky);
    flaky.analyzeTicker = async (input, ctx) => {
      if (input.symbol === "AAPL") throw new Error("boom");
      return orig(input, ctx);
    };
    const app = makeApp(flaky);
    app.repos.holdings.upsert(app.user.id, { symbol: "AAPL", shares: 5 });
    app.repos.watchlist.add({ symbol: "MSFT" });
    const report = await generateLlmReport(app);
    const tickers = report.recommendations.map((r) => r.ticker);
    expect(tickers).not.toContain("AAPL");
    expect(tickers).toContain("MSFT");
  });

  test("thematic discovery candidates appear in the report", async () => {
    const analyzer = createMockAnalyzer();
    // The mock's discoverOpportunities returns deterministic candidates (e.g. PLTR, SOFI)
    // that are not in held/watchlist; at least one should surface as a recommendation.
    const discovered = await analyzer.discoverOpportunities(MarketContext.parse({ date: DATE }), 5);
    expect(discovered.length).toBeGreaterThan(0);
    const app = makeApp(analyzer);
    app.repos.holdings.upsert(app.user.id, { symbol: "AAPL", shares: 5 });
    const report = await generateLlmReport(app);
    const tickers = report.recommendations.map((r) => r.ticker);
    expect(discovered.some((c) => tickers.includes(c.symbol))).toBe(true);
  });
});

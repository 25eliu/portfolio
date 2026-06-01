import { describe, expect, test } from "bun:test";
import { createMockAnalyzer } from "./analyze.ts";
import {
  Recommendation,
  ScanCandidate,
  emptyTechnicals,
  emptyFundamentals,
  MarketContext,
} from "../domain/index.ts";

describe("mock analyzer", () => {
  test("returns a schema-valid recommendation", async () => {
    const a = createMockAnalyzer();
    const rec = await a.analyzeTicker(
      {
        symbol: "AAPL",
        source: "held",
        screen: null,
        price: 200,
        technicals: emptyTechnicals(),
        fundamentals: emptyFundamentals("AAPL"),
        riskPreset: "balanced",
      },
      MarketContext.parse({ date: "2026-06-01" }),
    );
    expect(() => Recommendation.parse(rec)).not.toThrow();
    expect(rec.ticker).toBe("AAPL");
  });

  test("marketMacro returns a deterministic summary", async () => {
    const a = createMockAnalyzer();
    const macro = await a.marketMacro("2026-06-01", "up", 3.2);
    expect(macro.summary).toBe("mock macro");
    expect(macro.sources).toEqual([]);
  });

  test("discoverOpportunities returns schema-valid ScanCandidates", async () => {
    const a = createMockAnalyzer();
    const ctx = MarketContext.parse({ date: "2026-06-01" });
    const candidates = await a.discoverOpportunities(ctx, 5);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThanOrEqual(5);
    for (const c of candidates) {
      expect(() => ScanCandidate.parse(c)).not.toThrow();
      expect(["sentiment", "thematic"]).toContain(c.screen);
      expect(c.sources).toEqual([]);
    }
  });

  test("discoverOpportunities respects the count cap", async () => {
    const a = createMockAnalyzer();
    const ctx = MarketContext.parse({ date: "2026-06-01" });
    expect((await a.discoverOpportunities(ctx, 1)).length).toBe(1);
    expect((await a.discoverOpportunities(ctx, 0)).length).toBe(0);
  });
});

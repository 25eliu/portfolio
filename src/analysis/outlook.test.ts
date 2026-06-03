import { describe, expect, test } from "bun:test";
import { buildOutlook } from "./outlook.ts";
import { createMockAnalyzer } from "../llm/analyze.ts";
import { MarketContext } from "../domain/index.ts";

const ctx = MarketContext.parse({ date: "2026-06-02", spyTrend: "up", spyPctFromSma200: 3, macroSummary: "ok", sources: [], macro: null });

describe("buildOutlook", () => {
  test("returns the analyzer's outlook", async () => {
    const o = await buildOutlook(createMockAnalyzer(), ctx, []);
    expect(o.sectors.length).toBeGreaterThanOrEqual(1);
  });

  test("degrades to an empty outlook if the analyzer throws", async () => {
    const broken = { ...createMockAnalyzer(), synthesizeOutlook: () => Promise.reject(new Error("boom")) } as ReturnType<typeof createMockAnalyzer>;
    const o = await buildOutlook(broken, ctx, []);
    expect(o).toEqual({ regime: null, sectors: [], themes: [] });
  });
});

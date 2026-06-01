import { describe, expect, test } from "bun:test";
import { createFakeGateway } from "../market/index.ts";
import { createMockAnalyzer } from "../llm/analyze.ts";
import { buildMarketContext } from "./marketContext.ts";
import { MarketContext } from "../domain/index.ts";

test("builds a schema-valid market context from SPY bars + analyzer", async () => {
  const gw = createFakeGateway({ now: () => "2026-06-01" });
  const ctx = await buildMarketContext(gw, createMockAnalyzer(), "2026-06-01");
  expect(() => MarketContext.parse(ctx)).not.toThrow();
  expect(["up", "down", "sideways", null]).toContain(ctx.spyTrend);
  expect(ctx.macroSummary).toBe("mock macro");
});

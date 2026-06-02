import { describe, expect, test } from "bun:test";
import { buildTickerResearchPrompt, buildTickerStructurePrompt } from "./prompts.ts";
import { MarketContext, emptyTechnicals, emptyFundamentals } from "../domain/index.ts";

const ctx = MarketContext.parse({ date: "2026-06-02" });
const base = {
  symbol: "AAPL", source: "held" as const, screen: null, price: 200,
  technicals: emptyTechnicals(), fundamentals: emptyFundamentals("AAPL"),
  riskPreset: "balanced", availableCash: 1000, held: true,
};

describe("research prompt", () => {
  test("demands a bear case / counter-thesis", () => {
    const p = buildTickerResearchPrompt(base, ctx);
    expect(p.toLowerCase()).toContain("bear case");
  });
});

describe("structure prompt", () => {
  test("held tickers are offered only held verbs and forbidden from hedging", () => {
    const p = buildTickerStructurePrompt(base, ctx, "research");
    expect(p).toContain("ADD");
    expect(p).toContain("SELL");
    expect(p).not.toContain("WATCH (wait"); // held tickers don't get WATCH
    expect(p.toLowerCase()).toContain("do not");
  });
  test("candidates are offered BUY/WATCH/PASS", () => {
    const p = buildTickerStructurePrompt({ ...base, held: false, source: "scan" }, ctx, "research");
    expect(p).toContain("WATCH");
    expect(p).toContain("PASS");
  });
});

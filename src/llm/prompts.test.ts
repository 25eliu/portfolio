import { describe, expect, test } from "bun:test";
import { buildTickerResearchPrompt, buildTickerStructurePrompt, type TickerInput } from "./prompts.ts";
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

const ctx2: MarketContext = { date: "2026-06-10", spyTrend: "up", macroSummary: "calm", macro: null } as MarketContext;

function input(over: Partial<TickerInput> = {}): TickerInput {
  return {
    symbol: "NVDA", source: "scan", screen: null, price: 120, technicals: {} as TickerInput["technicals"],
    fundamentals: {} as TickerInput["fundamentals"], riskPreset: "balanced", availableCash: 10_000, held: false,
    ...over,
  };
}

describe("buildTickerStructurePrompt — prior thesis continuity", () => {
  test("renders the prior call when present", () => {
    const prompt = buildTickerStructurePrompt(
      input({ priorThesis: { date: "2026-06-07", action: "BUY", conviction: 0.74, target: 142, stop: 110, thesis: "AI demand inflection" } }),
      ctx2, "research text",
    );
    expect(prompt).toContain("Your prior call on NVDA (2026-06-07): BUY");
    expect(prompt).toContain("AI demand inflection");
    expect(prompt).toContain("Build on it or revise it");
  });

  test("omits the prior-call line cleanly when absent", () => {
    const prompt = buildTickerStructurePrompt(input(), ctx2, "research text");
    expect(prompt).not.toContain("Your prior call on");
  });
});

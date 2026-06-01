import type { Recommendation, ScanCandidate } from "../domain/index.ts";
import type { MarketContext } from "../domain/marketContext.ts";
import type { TickerInput } from "./prompts.ts";

export interface Analyzer {
  readonly kind: "gemini" | "mock";
  analyzeTicker(input: TickerInput, ctx: MarketContext): Promise<Recommendation>;
  marketMacro(
    date: string,
    spyTrend: string,
    spyPctFromSma200: number | null,
  ): Promise<{ summary: string; sources: { title: string; url: string }[] }>;
  /**
   * Sentiment/thematic opportunity discovery (Addendum A): scout the wider market for high-potential
   * candidates credible professionals are flagging. Returns up to `count` ScanCandidates with cited
   * sources. Never fatal — returns [] on failure.
   */
  discoverOpportunities(ctx: MarketContext, count: number): Promise<ScanCandidate[]>;
}

/** Deterministic offline analyzer for tests — never calls the network. */
export function createMockAnalyzer(): Analyzer {
  return {
    kind: "mock",
    async analyzeTicker(input): Promise<Recommendation> {
      return {
        ticker: input.symbol,
        action: "HOLD",
        conviction: 0.5,
        horizon: "5d",
        strategyFamily: "trend",
        thesis: `mock thesis for ${input.symbol}`,
        signals: ["mock"],
        technicals: input.technicals,
        catalyst: null,
        tradePlan: null,
        briefingNote: null,
        watchTrigger: null,
        fundamentals: input.fundamentals,
        priceTargetUpside: null,
        sources: [],
        screen: input.source === "scan" ? "momentum" : null,
      };
    },
    async marketMacro() {
      return { summary: "mock macro", sources: [] };
    },
    async discoverOpportunities(_ctx, count): Promise<ScanCandidate[]> {
      const seed: ScanCandidate[] = [
        { symbol: "PLTR", screen: "thematic", reason: "mock thematic: AI infrastructure tailwind", sources: [] },
        { symbol: "SOFI", screen: "sentiment", reason: "mock sentiment: credible-investor interest", sources: [] },
      ];
      return seed.slice(0, Math.max(0, count));
    },
  };
}

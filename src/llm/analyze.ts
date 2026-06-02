import type { Recommendation, ScanCandidate, Source } from "../domain/index.ts";
import type { MarketContext } from "../domain/marketContext.ts";
import type { TickerInput } from "./prompts.ts";

/**
 * A narrow streaming callback the analyzer calls as it works: stage transitions, thinking/text token
 * deltas, and tool (Google Search) activity. The pipeline maps these onto bus events per ticker.
 */
export type StreamSink = (
  e:
    | { kind: "stage"; stage: "research" | "structure" }
    | { kind: "thinking"; text: string }
    | { kind: "text"; text: string }
    | { kind: "tool"; query?: string; sources?: Source[] },
) => void;

export interface Analyzer {
  readonly kind: "gemini" | "mock";
  analyzeTicker(input: TickerInput, ctx: MarketContext, sink?: StreamSink): Promise<Recommendation>;
  marketMacro(
    date: string,
    spyTrend: string,
    spyPctFromSma200: number | null,
    sink?: StreamSink,
  ): Promise<{ summary: string; sources: Source[] }>;
  /**
   * Sentiment/thematic opportunity discovery (Addendum A): scout the wider market for high-potential
   * candidates credible professionals are flagging. Returns up to `count` ScanCandidates with cited
   * sources. Never fatal — returns [] on failure.
   */
  discoverOpportunities(ctx: MarketContext, count: number, sink?: StreamSink): Promise<ScanCandidate[]>;
}

/** Deterministic offline analyzer for tests — never calls the network; emits synthetic stream events. */
export function createMockAnalyzer(): Analyzer {
  return {
    kind: "mock",
    async analyzeTicker(input, _ctx, sink): Promise<Recommendation> {
      sink?.({ kind: "stage", stage: "research" });
      sink?.({ kind: "text", text: `Researching ${input.symbol}… ` });
      sink?.({
        kind: "tool",
        query: `${input.symbol} latest news`,
        sources: [{ title: "example.com", url: "https://example.com" }],
      });
      sink?.({ kind: "stage", stage: "structure" });
      return {
        ticker: input.symbol,
        held: input.held,
        action: input.held ? "HOLD" : "WATCH",
        conviction: 0.5,
        strategyFamily: "trend",
        thesis: `mock thesis for ${input.symbol}`,
        signals: ["mock"],
        prediction: {
          direction: "neutral",
          horizon: "1mo",
          entry: input.price,
          target: null,
          stop: null,
          expectedReturnPct: null,
          rMultiple: null,
          trigger: input.held ? null : "breaks above resistance on volume",
          actionIfTriggered: input.held ? null : "BUY",
          invalidation: "thesis no longer supported",
          rationale: `mock prediction for ${input.symbol}`,
        },
        technicals: input.technicals,
        catalyst: null,
        briefingNote: null,
        fundamentals: input.fundamentals,
        priceTargetUpside: null,
        sources: [],
        screen: input.screen,
        memorableFacts: [
          { fact: `mock durable fact for ${input.symbol}`, citationUrl: "https://example.com", scope: "ticker" },
        ],
      };
    },
    async marketMacro(_date, _trend, _pct, sink) {
      sink?.({ kind: "text", text: "mock macro" });
      return { summary: "mock macro", sources: [] };
    },
    async discoverOpportunities(_ctx, count, sink): Promise<ScanCandidate[]> {
      sink?.({ kind: "text", text: "scanning the market…" });
      const seed: ScanCandidate[] = [
        { symbol: "PLTR", screen: "thematic", reason: "mock thematic: AI infrastructure tailwind", sources: [] },
        { symbol: "SOFI", screen: "sentiment", reason: "mock sentiment: credible-investor interest", sources: [] },
      ];
      return seed.slice(0, Math.max(0, count));
    },
  };
}

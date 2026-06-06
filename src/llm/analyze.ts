import type { LibrarianNode, Outlook, ProposedEdge, Recommendation, ScanCandidate, Source } from "../domain/index.ts";
import type { MarketContext } from "../domain/marketContext.ts";
import type { TickerInput } from "./prompts.ts";

/**
 * A narrow streaming callback the analyzer calls as it works: stage transitions, thinking/text token
 * deltas, and tool (Google Search) activity. The pipeline maps these onto bus events per ticker.
 */
export type StreamSink = (
  e:
    | { kind: "stage"; stage: "research" | "deliberate" | "structure" }
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
  /**
   * Cross-cutting outlook synthesis (Phase 3): given the market context and this run's recommendations,
   * author a regime call + sector leans + named themes. Never fatal — returns an empty outlook on failure.
   */
  synthesizeOutlook(ctx: MarketContext, recs: Recommendation[], sink?: StreamSink): Promise<Outlook>;
  /**
   * Graph librarian (KB maintenance): given concept nodes, propose associative edges between them
   * (`related_to` / `contradicts`) that membership-based wiring can't infer. The pipeline gates every
   * proposal before persisting. Never fatal — returns [] on failure.
   */
  proposeGraphEdges(nodes: LibrarianNode[]): Promise<ProposedEdge[]>;
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
      sink?.({ kind: "stage", stage: "deliberate" });
      sink?.({ kind: "stage", stage: "structure" });
      return {
        ticker: input.symbol,
        held: input.held,
        action: input.held ? "HOLD" : "WATCH",
        conviction: 0.5,
        strategyFamily: "trend",
        thesis: `mock thesis for ${input.symbol}`,
        signals: ["mock"],
        deliberation: {
          bullCase: `mock bull case for ${input.symbol}`,
          bearCase: `mock bear case for ${input.symbol}`,
          keyUncertainties: ["mock uncertainty"],
          disconfirmers: ["mock disconfirmer"],
          baseRateNote: null,
          reversalCheck: null,
          provisionalStance: "neutral",
          provisionalConviction: 0.5,
        },
        calibratedConviction: null,
        calibration: null,
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
          { fact: `mock durable fact for ${input.symbol}`, citationUrl: "https://example.com", scope: "ticker", significance: 0.9, category: "moat" },
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
    async synthesizeOutlook(_ctx, _recs, sink): Promise<Outlook> {
      sink?.({ kind: "text", text: "synthesizing outlook…" });
      return {
        regime: { subject: "market", stance: "risk_on", conviction: 0.55, horizon: "1mo", summary: "mock constructive", thesis: "mock regime thesis", tickers: [], sources: [] },
        sectors: [{ subject: "Information Technology", stance: "bullish", conviction: 0.6, horizon: "3mo", summary: "mock", thesis: "mock sector thesis", tickers: ["NVDA"], sources: [] }],
        themes: [{ subject: "AI infrastructure", stance: "bullish", conviction: 0.6, horizon: "6mo", summary: "mock", thesis: "mock theme thesis", tickers: [], sources: [] }],
      };
    },
    async proposeGraphEdges(nodes): Promise<ProposedEdge[]> {
      // Deterministic: associate the two most-recent concept nodes so the gating path is exercised offline.
      if (nodes.length < 2) return [];
      return [{ srcId: nodes[0]!.id, rel: "related_to", dstId: nodes[1]!.id, rationale: "mock association" }];
    },
  };
}

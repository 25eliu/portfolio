import type { Analyzer, StreamSink } from "../llm/analyze.ts";
import type { MarketContext, Outlook, Recommendation } from "../domain/index.ts";

/** Report-level outlook synthesis (mirrors buildMarketContext). Never fatal — empty outlook on failure. */
export async function buildOutlook(
  analyzer: Analyzer,
  ctx: MarketContext,
  recs: Recommendation[],
  sink?: StreamSink,
): Promise<Outlook> {
  return analyzer.synthesizeOutlook(ctx, recs, sink).catch(() => ({ regime: null, sectors: [], themes: [] }));
}

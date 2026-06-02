import type { MarketData } from "../market/types.ts";
import type { Analyzer, StreamSink } from "../llm/analyze.ts";
import { MarketContext } from "../domain/marketContext.ts";
import { computeTechnicals } from "./technicals.ts";

export async function buildMarketContext(
  market: MarketData,
  analyzer: Analyzer,
  date: string,
  sink?: StreamSink,
): Promise<MarketContext> {
  const bars = await market.getBars("SPY", 250).catch(() => []);
  const t = computeTechnicals(bars, null);
  const pct = t.priceVsSma200Pct;
  const spyTrend = pct == null ? null : pct > 1 ? "up" : pct < -1 ? "down" : "sideways";
  const macro = await analyzer
    .marketMacro(date, spyTrend ?? "unknown", pct, sink)
    .catch(() => ({ summary: "", sources: [] }));
  return MarketContext.parse({
    date,
    spyTrend,
    spyPctFromSma200: pct,
    macroSummary: macro.summary,
    sources: macro.sources,
  });
}

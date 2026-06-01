import type { Fundamentals, MarketContext, Technicals } from "../domain/index.ts";

export type TickerInput = {
  symbol: string;
  source: "held" | "watchlist" | "scan";
  screenReason?: string;
  price: number;
  technicals: Technicals;
  fundamentals: Fundamentals;
  riskPreset: string;
};

export function buildTickerPrompt(t: TickerInput, ctx: MarketContext): string {
  return [
    `You are an equity analyst. Analyze ${t.symbol} and return ONE recommendation via the`,
    `submit_recommendation function. Use Google Search to verify recent catalysts/news and cite them.`,
    `Base any numeric facts ONLY on the provided data; do not invent figures.`,
    ``,
    `Market context (${ctx.date}): SPY trend ${ctx.spyTrend ?? "unknown"}; ${ctx.macroSummary}`,
    `Risk profile: ${t.riskPreset}. Candidate source: ${t.source}${t.screenReason ? ` (${t.screenReason})` : ""}.`,
    ``,
    `Technicals: ${JSON.stringify(t.technicals)}`,
    `Fundamentals: ${JSON.stringify(t.fundamentals)}`,
    `Latest price: ${t.price}.`,
    ``,
    `Decide BUY / SELL / HOLD / WATCH with a concise thesis, conviction (0..1), horizon, a strategy`,
    `family, the signals you used, an optional catalyst (with sentiment), and an optional trade plan`,
    `(entry/stop/target/rMultiple/invalidation). For WATCH, give the trigger to promote to BUY.`,
  ].join("\n");
}

export function buildMarketContextPrompt(date: string, spyTrend: string, spyPctFromSma200: number | null): string {
  return [
    `Summarize today's (${date}) US equity market regime in 2-3 sentences for a trader.`,
    `SPY trend is ${spyTrend}${spyPctFromSma200 != null ? ` (${spyPctFromSma200.toFixed(1)}% vs its 200-day SMA)` : ""}.`,
    `Use Google Search for VIX level, rates, and notable macro catalysts. Cite sources.`,
  ].join("\n");
}

/**
 * Sentiment/thematic opportunity discovery prompt (Addendum A). Asks the model to scout the wider
 * market — via Google Search grounding — for high-potential US-listed equities that credible
 * professionals and high-signal communities are currently flagging, returning structured candidates
 * via the submit_candidates function.
 */
export function buildDiscoveryPrompt(ctx: MarketContext, count: number): string {
  return [
    `You are a research analyst scouting the wider US equity market for breakthrough, high-potential`,
    `opportunities. Use Google Search to find up to ${count} US-listed equities that credible`,
    `professionals and high-signal communities are currently flagging.`,
    ``,
    `Current market regime (${ctx.date}): SPY trend ${ctx.spyTrend ?? "unknown"}; ${ctx.macroSummary}`,
    ``,
    `Weight reputable analysts, notable investors, and substantive Reddit/X/financial-press`,
    `discussion over anonymous hype. Favor high-potential industries and secular tech / market /`,
    `economy tailwinds (e.g. AI infrastructure, energy transition, biotech breakthroughs) aligned`,
    `with the current regime above.`,
    ``,
    `Return your picks via the submit_candidates function. For each, provide:`,
    `  - symbol: the US ticker`,
    `  - screen: "sentiment" (credible-source sentiment driven) or "thematic" (secular theme driven)`,
    `  - reason: a one-line, credibility-aware rationale naming the kind of source behind it`,
    `Cite your sources via grounding.`,
    ``,
    `This is research, not investment advice. Exclude pump-and-dump / low-quality hype. Prefer`,
    `liquid, established names over thinly-traded microcaps.`,
  ].join("\n");
}

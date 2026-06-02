import type { Fundamentals, MarketContext, ScreenType, Technicals } from "../domain/index.ts";

export type TickerInput = {
  symbol: string;
  source: "held" | "watchlist" | "scan";
  screen: ScreenType | null;
  screenReason?: string;
  price: number;
  technicals: Technicals;
  fundamentals: Fundamentals;
  riskPreset: string;
  /** Uninvested cash the portfolio has available to deploy (its buying-power limit). */
  availableCash: number;
};

/**
 * Two-stage analysis: Gemini 3 can't return real grounding citations together with a function call
 * in one request (the combined call yields no extractable sources), so we run a grounded RESEARCH
 * call (Search only → text + citations) followed by a STRUCTURE call (function tool only) that turns
 * the research into the schema. Stage-A prompt builders are `*ResearchPrompt`; stage-B are the
 * structuring prompts that take the research text.
 */

export function buildTickerResearchPrompt(t: TickerInput, ctx: MarketContext): string {
  return [
    `You are an equity analyst researching ${t.symbol}. Use Google Search to find the most recent`,
    `catalysts, news, earnings/guidance, analyst opinions, and credible sentiment (reputable analysts,`,
    `notable investors, substantive financial press / Reddit / X). Weight credible voices over hype.`,
    ``,
    `Market regime (${ctx.date}): SPY trend ${ctx.spyTrend ?? "unknown"}; ${ctx.macroSummary}`,
    `Candidate source: ${t.source}${t.screenReason ? ` (${t.screenReason})` : ""}.`,
    ``,
    `Summarize your findings in 4-6 sentences: the key catalysts, the prevailing sentiment and who`,
    `holds it, and the main risks. Do not give a recommendation yet — just the researched facts.`,
  ].join("\n");
}

export function buildTickerStructurePrompt(t: TickerInput, ctx: MarketContext, research: string): string {
  return [
    `You are an equity analyst. Using the research findings and quantitative data below, return ONE`,
    `recommendation for ${t.symbol} by calling the submit_recommendation function.`,
    `Base any numeric facts ONLY on the provided technicals/fundamentals; do not invent figures.`,
    ``,
    `Market context (${ctx.date}): SPY trend ${ctx.spyTrend ?? "unknown"}; ${ctx.macroSummary}`,
    `Risk profile: ${t.riskPreset}.`,
    ``,
    `Research findings (sources already captured separately):`,
    research || "(no external research available)",
    ``,
    `Technicals: ${JSON.stringify(t.technicals)}`,
    `Fundamentals: ${JSON.stringify(t.fundamentals)}`,
    `Latest price: ${t.price}.`,
    `Portfolio buying power: $${t.availableCash} in uninvested cash. This is a hard limit — do not`,
    `assume unlimited capital. When cash is scarce, reserve BUYs for the highest-conviction ideas and`,
    `size any trade plan within this cash; prefer WATCH over BUY if there isn't cash to act on it.`,
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
 * Sentiment/thematic opportunity discovery (Addendum A) — stage A research prompt. Scouts the wider
 * market via Google Search for high-potential US equities credible professionals/communities flag.
 */
export function buildDiscoveryResearchPrompt(ctx: MarketContext, count: number): string {
  return [
    `You are a research analyst scouting the wider US equity market for breakthrough, high-potential`,
    `opportunities. Use Google Search to find ${count} US-listed equities that credible professionals`,
    `and high-signal communities are currently flagging as opportunities.`,
    ``,
    `Current market regime (${ctx.date}): SPY trend ${ctx.spyTrend ?? "unknown"}; ${ctx.macroSummary}`,
    ``,
    `Weight reputable analysts, notable investors, and substantive Reddit/X/financial-press discussion`,
    `over anonymous hype. Favor high-potential industries and secular tech / market / economy tailwinds`,
    `(e.g. AI infrastructure, energy transition, biotech breakthroughs) aligned with the regime above.`,
    `Exclude pump-and-dump / low-quality hype; prefer liquid, established names over thin microcaps.`,
    ``,
    `For each pick, note: the ticker, whether it is sentiment-driven or theme-driven, and a one-line`,
    `credibility-aware rationale naming the kind of source behind it. This is research, not advice.`,
  ].join("\n");
}

export function buildDiscoveryStructurePrompt(ctx: MarketContext, count: number, research: string): string {
  return [
    `From the research below, return up to ${count} opportunity candidates by calling the`,
    `submit_candidates function. For each candidate provide:`,
    `  - symbol: the US ticker`,
    `  - screen: "sentiment" (credible-source sentiment driven) or "thematic" (secular theme driven)`,
    `  - reason: a one-line, credibility-aware rationale naming the kind of source behind it`,
    ``,
    `Market regime (${ctx.date}): SPY trend ${ctx.spyTrend ?? "unknown"}; ${ctx.macroSummary}`,
    ``,
    `Research findings (sources already captured separately):`,
    research || "(no external research available)",
  ].join("\n");
}

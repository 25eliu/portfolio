import type { Deliberation, Fundamentals, MarketContext, RetrievedExcerpt, ScreenType, Technicals } from "../domain/index.ts";
import { renderEvidenceBlock } from "../knowledge/retrieve.ts";

/** The AI's most recent prior call on a ticker, fed back for day-to-day continuity. */
export type PriorThesis = {
  date: string;
  action: string;
  conviction: number;
  entry: number | null;
  target: number | null;
  stop: number | null;
  thesis: string;
};

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
  /** Whether the portfolio currently holds this ticker (drives the position-aware verb set). */
  held: boolean;
  /** Retrieved knowledge-base excerpts injected into the research stage as untrusted evidence. */
  evidence?: RetrievedExcerpt[];
  /** Compiled performance-wiki briefing injected as trusted, computed context (Phase 4). */
  wikiBriefing?: string;
  /** Durable facts the system has already self-curated for this ticker — shown so the model only
   *  proposes net-new facts (the key to keeping the self-curated library dense, not bloated). */
  priorFacts?: string[];
  /** The AI's own latest prior call on this ticker — trusted continuity, distinct from user evidence. */
  priorThesis?: PriorThesis;
};

/**
 * Two-stage analysis: Gemini 3 can't return real grounding citations together with a function call
 * in one request (the combined call yields no extractable sources), so we run a grounded RESEARCH
 * call (Search only → text + citations) followed by a STRUCTURE call (function tool only) that turns
 * the research into the schema. Stage-A prompt builders are `*ResearchPrompt`; stage-B are the
 * structuring prompts that take the research text.
 */

export function buildTickerResearchPrompt(t: TickerInput, ctx: MarketContext): string {
  const evidenceBlock = renderEvidenceBlock(t.evidence ?? []);
  return [
    `You are a senior equity analyst building a rigorous research brief on ${t.symbol}.`,
    `Use Google Search to gather and synthesize the most recent information across all factors below.`,
    `Weight credible voices (reputable analysts, notable investors, substantive financial press) over hype.`,
    `If you cannot verify a specific figure (price target, earnings number, date) via search, say it is unconfirmed rather than inferring it from memory.`,
    ``,
    `Market regime (${ctx.date}): SPY trend ${ctx.spyTrend ?? "unknown"}; ${ctx.macroSummary}`,
    `Candidate source: ${t.source}${t.screenReason ? ` (${t.screenReason})` : ""}.`,
    ...(evidenceBlock ? [``, evidenceBlock] : []),
    ``,
    `Research the following in order and include each in your brief:`,
    `1. Business update & news catalysts — recent developments, product/regulatory news, M&A.`,
    `2. Earnings & guidance — most recent results vs. expectations, management forward guidance.`,
    `3. Analyst actions & price targets — recent upgrades/downgrades, consensus target range.`,
    `4. Valuation context — how current multiples compare to history and peers.`,
    `5. Technical posture — trend direction, key levels, momentum signals.`,
    `6. Credible-source sentiment — what reputable analysts, notable investors, and high-signal communities (substantive financial press, Reddit, X) are currently saying — weighting credibility over hype.`,
    `7. Bear case / counter-thesis — state the strongest argument against acting on this ticker,`,
    `   the specific conditions that would make this call wrong, and the realistic base rate of failure.`,
    ``,
    `Summarize your findings in a tight paragraph per factor (roughly 8–14 sentences total) so the bear case has room.`,
    `Do not give a recommendation yet — just the researched facts.`,
  ].join("\n");
}

/**
 * Decision Engine v2 — the deliberation stage (between research and structure). Forces a structured
 * bull/bear argument, disconfirmer-seeking, and a base-rate-aware provisional conviction BEFORE the
 * model commits. Grounded in the research, the wiki's track record, and the prior thesis (reversal
 * check). Persisted on the recommendation so the reasoning is auditable, not ephemeral.
 */
export function buildDeliberationPrompt(t: TickerInput, ctx: MarketContext, research: string): string {
  return [
    `You are a buy-side analyst stress-testing a potential decision on ${t.symbol} BEFORE committing.`,
    `Argue BOTH sides honestly from the evidence below — do NOT pick a verdict yet. The goal is to surface`,
    `the strongest bear case and the specific facts that would prove the call wrong, so the final verdict is earned.`,
    ``,
    `Market regime (${ctx.date}): SPY trend ${ctx.spyTrend ?? "unknown"}; ${ctx.macroSummary}`,
    ...(t.wikiBriefing
      ? [``, `This system's own calibrated track record (trusted, computed) — let it temper your provisional conviction:`, t.wikiBriefing]
      : []),
    ...(t.priorThesis
      ? [
          ``,
          `Your prior call on ${t.symbol} (${t.priorThesis.date}): ${t.priorThesis.action}, conviction ${t.priorThesis.conviction.toFixed(2)} — "${t.priorThesis.thesis}".`,
          `If your stance now flips from that, you MUST justify the reversal explicitly in reversal_check — otherwise return reversal_check: null.`,
        ]
      : []),
    ``,
    `Research findings:`,
    research || "(no external research available)",
    ``,
    `Call submit_deliberation with:`,
    `  - bull_case: the strongest evidence-grounded case FOR acting.`,
    `  - bear_case: the strongest, most credible case AGAINST — steelman the counter-thesis.`,
    `  - key_uncertainties: the unknowns that most affect the outcome.`,
    `  - disconfirmers: SPECIFIC, testable facts or events that would prove this call wrong (not vague "market risk").`,
    `  - base_rate_note: the realistic base rate of success for this kind of setup, if you can ground one.`,
    `  - reversal_check: see above (null if no prior call or no reversal).`,
    `  - provisional_stance: bullish | bearish | neutral.`,
    `  - provisional_conviction: a CALIBRATED probability 0..1 — reserve high values for genuinely strong, well-evidenced cases; a balanced/uncertain case is ~0.5.`,
  ].join("\n");
}

export function buildTickerStructurePrompt(
  t: TickerInput,
  ctx: MarketContext,
  research: string,
  sources: { title: string; url: string }[] = [],
  deliberation?: Deliberation | null,
): string {
  const macroLine = ctx.macro
    ? [
        ctx.macro.vix != null ? `VIX ${ctx.macro.vix.toFixed(1)}` : null,
        ctx.macro.tenYearYield != null ? `10y ${ctx.macro.tenYearYield.toFixed(2)}%` : null,
        ctx.macro.twoYearYield != null ? `2y ${ctx.macro.twoYearYield.toFixed(2)}%` : null,
        ctx.macro.yieldCurveSpread != null
          ? `curve ${ctx.macro.yieldCurveSpread > 0 ? "+" : ""}${ctx.macro.yieldCurveSpread.toFixed(2)}%`
          : null,
        ctx.macro.cpiYoY != null ? `CPI ${ctx.macro.cpiYoY.toFixed(1)}% YoY` : null,
        ctx.macro.fedFunds != null ? `Fed Funds ${ctx.macro.fedFunds.toFixed(2)}%` : null,
        ctx.macro.unemployment != null ? `unemployment ${ctx.macro.unemployment.toFixed(1)}%` : null,
      ]
        .filter(Boolean)
        .join(", ")
    : null;

  return [
    `You are an equity analyst. Using the research findings and quantitative data below, return ONE`,
    `recommendation for ${t.symbol} by calling the submit_recommendation function.`,
    `Base any numeric facts ONLY on the provided technicals/fundamentals; do not invent figures.`,
    ``,
    `Market context (${ctx.date}): SPY trend ${ctx.spyTrend ?? "unknown"}; ${ctx.macroSummary}${macroLine ? ` | Macro: ${macroLine}` : ""}`,
    `Risk profile: ${t.riskPreset}.`,
    ...(t.wikiBriefing
      ? [
          ``,
          `Performance wiki — this system's own calibrated track record (trusted, computed statistics).`,
          `Use it to calibrate THIS call's conviction and position size — e.g. trim conviction in cohorts`,
          `where stated conviction has run ahead of realized hit-rate, or that show negative expectancy.`,
          `It informs how strongly to act, not whether to commit; still pick the verdict the evidence demands.`,
          t.wikiBriefing,
        ]
      : []),
    ...(t.priorThesis
      ? [
          ``,
          `Your prior call on ${t.symbol} (${t.priorThesis.date}): ${t.priorThesis.action}, conviction ${t.priorThesis.conviction.toFixed(2)}` +
            `${t.priorThesis.target != null ? `, target ${t.priorThesis.target}` : ""}${t.priorThesis.stop != null ? ` / stop ${t.priorThesis.stop}` : ""} — "${t.priorThesis.thesis}".`,
          t.priorThesis.entry != null && t.priorThesis.entry !== 0
            ? `Since that call (entry ~$${t.priorThesis.entry}), price is now $${t.price} (${(((t.price - t.priorThesis.entry) / t.priorThesis.entry) * 100).toFixed(1)}%). Revise your target/stop/stance to reflect how price has moved vs your plan — do not restate a stale thesis.`
            : `This is your own earlier reasoning (trusted continuity). Build on it or revise it as the evidence now warrants — do not ignore it.`,
        ]
      : []),
    ``,
    `Research findings (sources already captured separately):`,
    research || "(no external research available)",
    ...(deliberation
      ? [
          ``,
          `Your prior deliberation on ${t.symbol} — weigh it; do NOT ignore the bear case:`,
          `  Bull: ${deliberation.bullCase}`,
          `  Bear: ${deliberation.bearCase}`,
          deliberation.disconfirmers.length ? `  Would be wrong if: ${deliberation.disconfirmers.join("; ")}` : "",
          `  Provisional: ${deliberation.provisionalStance} @ ${deliberation.provisionalConviction.toFixed(2)}.`,
          `Commit to the verdict the balance of evidence supports. If you act against the bear case, your thesis must say why it loses.`,
        ].filter(Boolean)
      : []),
    ``,
    `Technicals: ${JSON.stringify(t.technicals)}`,
    `Fundamentals: ${JSON.stringify(t.fundamentals)}`,
    `Latest price: ${t.price}.`,
    `Portfolio buying power: $${t.availableCash} in uninvested cash. This is a hard limit — do not`,
    `assume unlimited capital. When cash is scarce, reserve BUYs for the highest-conviction ideas and`,
    `size any trade plan within this cash.`,
    ...(t.held
      ? [
          `When cash is scarce, prefer HOLD/TRIM over ADD; never assume capital you don't have.`,
          ``,
          `You HOLD ${t.symbol}. Decide exactly one — and do not default to HOLD to avoid committing:`,
          `  ADD (high-quality dip / thesis strengthening), TRIM (overextended / risk management), HOLD (thesis intact & fairly valued), SELL (thesis broken or better uses of capital).`,
          `Your action is acted on directly: SELL exits the whole position and TRIM reduces it, independent of prediction.direction — a SELL does NOT need a bearish outlook to justify it. Set prediction.direction to your honest price outlook regardless.`,
        ]
      : [
          `When cash is scarce, prefer WATCH over BUY when there isn't cash to act.`,
          ``,
          `${t.symbol} is a CANDIDATE you do not own. Decide exactly one — passing is a valid, expected outcome:`,
          `  BUY (you would act at today's price), WATCH (clear thesis but needs a concrete trigger), PASS (not compelling).`,
        ]),
    `Weigh the bull and bear cases from the research; commit to the verdict the evidence supports.`,
    `Do not hedge — a non-committal verdict is a failure; pick the action the evidence demands.`,
    `Conviction (0..1) must be a calibrated probability — reserve high values for genuinely high-confidence calls; a genuinely uncertain/neutral call maps to ~0.5.`,
    `Return conviction (0..1), a strategyFamily (momentum / value / event-driven / macro / mean-reversion / quality), the key signals that drove the decision, an optional catalyst, and the REQUIRED prediction object.`,
    `prediction.direction is your price outlook — bullish if you expect appreciation, bearish if decline, neutral if range-bound/uncertain (a HOLD or PASS is usually neutral).`,
    `Return a REQUIRED prediction: { direction, horizon (1d|1w|1mo|3mo|6mo|1y), entry, target, stop, expectedReturnPct, rMultiple, trigger, actionIfTriggered, invalidation, rationale }.`,
    ...(!t.held
      ? [`For WATCH: trigger = the specific, testable condition to act on; actionIfTriggered = what it becomes (e.g. "BUY"); also state the bearish branch in invalidation. Base every number ONLY on the provided technicals/fundamentals.`]
      : [`Base every number ONLY on the provided technicals/fundamentals.`]),
    ``,
    `Long-term memory — durable, structural facts this system already knows about ${t.symbol}:`,
    (t.priorFacts ?? []).length ? (t.priorFacts ?? []).map((f) => `  • ${f}`).join("\n") : `  (none yet)`,
    `Optionally return up to 3 NEW durable facts in memorableFacts. Each fact MUST include:`,
    `  • significance (0..1): its lasting decision value — ONLY facts with significance ≥ 0.6 are kept.`,
    `  • category: one of moat | secular | management | capital_structure | regulatory | unit_economics.`,
    `A durable fact has lasting decision value: competitive moats, secular theses, management track`,
    `record, capital structure, regulatory shifts, structural unit economics. Do NOT add ephemeral`,
    `price moves, daily news, today's quote, or anything already listed above. Each fact ≤140 chars,`,
    `self-contained (name the company/ticker), and MUST cite one of the research source URLs below —`,
    `if you cannot cite it, or it lacks a category, omit it.`,
    sources.length
      ? [`Research source URLs (set citationUrl to one of these):`, ...sources.slice(0, 12).map((s, i) => `  [${i + 1}] ${s.url}${s.title ? ` — ${s.title}` : ""}`)].join("\n")
      : `(No research source URLs were captured this run — return memorableFacts: [].)`,
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

export function buildOutlookResearchPrompt(date: string, macroSummary: string, recLines: string[]): string {
  return [
    `Today is ${date}. Synthesize a cross-cutting US-equity OUTLOOK for a trader.`,
    `Market context: ${macroSummary || "(none)"}.`,
    recLines.length ? `This run's calls:\n${recLines.join("\n")}` : `(no individual calls this run)`,
    `Use Google Search to ground a market-regime read, the most attractive/unattractive SECTORS, and 1-6 named cross-cutting THEMES. Cite sources.`,
  ].join("\n");
}

export function buildOutlookStructurePrompt(date: string, research: string): string {
  return [
    `From the research below, return the structured outlook for ${date} via submit_outlook.`,
    `regime.subject MUST be "market"; regime.stance one of risk_on|neutral|risk_off|defensive.`,
    `sectors: up to 8 GICS sectors; themes: up to 6; each with stance bullish|bearish|neutral, conviction 0..1, horizon, a one-line summary, a 1-3 sentence thesis, and any tickers.`,
    `Only include a sector/theme with a genuine lean — omit filler.`,
    ``,
    research,
  ].join("\n");
}
